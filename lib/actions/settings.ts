'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { getCurrentStaff } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type SettingsState = { error?: string; ok?: number; message?: string };

const ROLES = ['admin', 'staff', 'physician'] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireAdmin() {
  const ctx = await getCurrentStaff();
  if (ctx.staff?.role !== 'admin') return { ...ctx, denied: true as const };
  return { ...ctx, denied: false as const };
}

function friendly(message: string) {
  if (/staff_user_email_key/.test(message)) return 'Someone on the staff list already uses that email.';
  if (/step_template_program_id_key_key/.test(message)) return 'That step key is already used in this program.';
  if (/violates foreign key constraint.*step_template/.test(message))
    return 'Patients already have this step, so it can’t be removed. Rename it instead.';
  return `Could not save: ${message}`;
}

async function siteOrigin() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

// ---------------------------------------------------------------- Staff

export async function inviteLogin(email: string): Promise<SettingsState> {
  const { supabase, denied } = await requireAdmin();
  if (denied) return { error: 'Only admins can send invites.' };
  // Only people already on the staff list can be invited.
  const { data: onList } = await supabase.from('staff_user').select('id').eq('email', email.toLowerCase()).eq('active', true).maybeSingle();
  if (!onList) return { error: 'Add this person to the staff list first.' };

  const admin = createAdminClient();
  if (!admin) return { error: 'Invites aren’t set up yet. See the note at the top of this page.' };
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${await siteOrigin()}/set-password`,
  });
  if (error) {
    if (/already been registered|already exists/i.test(error.message))
      return { message: `${email} already has a login. They can use “First time, or forgot your password?” on the login page.` };
    return { error: `Invite not sent: ${error.message}` };
  }
  return { message: `Invite sent to ${email}.` };
}

export async function addStaff(_prev: SettingsState, form: FormData): Promise<SettingsState> {
  const { supabase, denied } = await requireAdmin();
  if (denied) return { error: 'Only admins can change settings.' };

  const name = String(form.get('name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const role = String(form.get('role') ?? 'staff') as (typeof ROLES)[number];
  if (!name) return { error: 'Enter a name.' };
  if (!EMAIL.test(email)) return { error: 'Enter a valid email.' };
  if (!ROLES.includes(role)) return { error: 'Pick a role.' };

  const { error } = await supabase.from('staff_user').insert({ name, email, role });
  if (error) return { error: friendly(error.message) };

  revalidatePath('/settings/staff');
  const invite = form.get('send_invite') === '1' ? await inviteLogin(email) : { message: `${name} added.` };
  return { ok: Date.now(), message: invite.message ?? `${name} added.`, error: invite.error };
}

export async function updateStaff(id: string, values: { role?: string; active?: boolean; name?: string }): Promise<SettingsState> {
  const { supabase, staff, denied } = await requireAdmin();
  if (denied) return { error: 'Only admins can change settings.' };
  if (id === staff!.id && (values.active === false || (values.role && values.role !== 'admin')))
    return { error: 'You can’t remove your own admin access or deactivate yourself.' };
  if (values.role && !ROLES.includes(values.role as (typeof ROLES)[number])) return { error: 'Unknown role.' };

  const { data, error } = await supabase.from('staff_user').update(values).eq('id', id).select('id');
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: 'Nothing was changed.' };
  revalidatePath('/settings/staff');
  return { ok: Date.now() };
}

// ---------------------------------------------------------------- Programs

const PROGRAM_FIELDS = ['price', 'consult_cost', 'test_budget', 'supplement_budget', 'wholesale_rate', 'upgrade_window_days'] as const;

export async function updateProgram(code: string, _prev: SettingsState, form: FormData): Promise<SettingsState> {
  const { supabase, denied } = await requireAdmin();
  if (denied) return { error: 'Only admins can change settings.' };

  const values: Record<string, number | null | string> = {};
  const name = String(form.get('name') ?? '').trim();
  if (!name) return { error: 'The program needs a name.' };
  values.name = name;
  for (const f of PROGRAM_FIELDS) {
    if (!form.has(f)) continue;
    const raw = String(form.get(f) ?? '').replace(/[$,%\s]/g, '');
    if (raw === '') { values[f] = null; continue; }
    let n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return { error: `${f.replace(/_/g, ' ')} must be a number.` };
    if (f === 'wholesale_rate') n = n > 1 ? n / 100 : n; // accept 50 or 0.5
    values[f] = n;
  }
  if (form.has('price') && values.price == null) return { error: 'The program needs a price.' };

  const { data, error } = await supabase.from('program').update(values).eq('code', code).select('code');
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: 'Nothing was changed.' };
  revalidatePath('/settings/programs');
  revalidatePath('/resources/P1/margin');
  return { ok: Date.now(), message: 'Saved.' };
}

// ---------------------------------------------------------------- Steps

type StepValues = {
  name: string; owner_role: string; offset_days: number; stage_id: string;
  blocked_by_keys: string[]; block_enabled: boolean;
};

function readStep(form: FormData): StepValues | { error: string } {
  const name = String(form.get('name') ?? '').trim();
  const owner = String(form.get('owner_role') ?? '');
  const offset = Number(form.get('offset_days'));
  const stage = String(form.get('stage_id') ?? '');
  if (!name) return { error: 'Enter a step name.' };
  if (!ROLES.includes(owner as (typeof ROLES)[number]) || owner === 'admin') return { error: 'Pick staff or physician.' };
  if (!Number.isInteger(offset) || offset < 0 || offset > 730) return { error: 'Days after start must be a whole number from 0 to 730.' };
  if (!stage) return { error: 'Pick a stage.' };
  return {
    name, owner_role: owner, offset_days: offset, stage_id: stage,
    blocked_by_keys: form.getAll('blocked_by').map(String),
    block_enabled: form.get('block_enabled') === '1',
  };
}

export async function updateStep(id: string, programCode: string, _prev: SettingsState, form: FormData): Promise<SettingsState> {
  const { supabase, denied } = await requireAdmin();
  if (denied) return { error: 'Only admins can change settings.' };
  const v = readStep(form);
  if ('error' in v) return v;
  const { data, error } = await supabase.from('step_template').update(v).eq('id', id).select('id');
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: 'Nothing was changed.' };
  revalidatePath(`/settings/steps`);
  return { ok: Date.now(), message: 'Saved.' };
}

export async function addStep(programCode: string, _prev: SettingsState, form: FormData): Promise<SettingsState> {
  const { supabase, denied } = await requireAdmin();
  if (denied) return { error: 'Only admins can change settings.' };
  const v = readStep(form);
  if ('error' in v) return v;

  const { data: program } = await supabase.from('program').select('id').eq('code', programCode).single();
  const { data: existing } = await supabase.from('step_template').select('key, sort').eq('program_id', program!.id);
  const base = `${programCode.toLowerCase()}_${v.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30)}`;
  const keys = new Set((existing ?? []).map((s) => s.key));
  let key = base, n = 2;
  while (keys.has(key)) key = `${base}_${n++}`;
  const sort = Math.max(0, ...(existing ?? []).map((s) => s.sort)) + 1;

  const { error } = await supabase.from('step_template').insert({ ...v, program_id: program!.id, key, sort });
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/settings/steps`);
  return { ok: Date.now(), message: `Added. New ${programCode} patients will get this step.` };
}

export async function removeStep(id: string): Promise<SettingsState> {
  const { supabase, denied } = await requireAdmin();
  if (denied) return { error: 'Only admins can change settings.' };
  const { data, error } = await supabase.from('step_template').delete().eq('id', id).select('id');
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: 'Nothing was removed.' };
  revalidatePath(`/settings/steps`);
  return { ok: Date.now() };
}

export async function renameStage(id: string, name: string): Promise<SettingsState> {
  const { supabase, denied } = await requireAdmin();
  if (denied) return { error: 'Only admins can change settings.' };
  const clean = name.trim();
  if (!clean) return { error: 'The stage needs a name.' };
  const { data, error } = await supabase.from('program_stage').update({ name: clean }).eq('id', id).select('id');
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: 'Nothing was changed.' };
  revalidatePath('/settings/steps');
  revalidatePath('/');
  revalidatePath('/pipeline');
  revalidatePath('/dashboard');
  return { ok: Date.now(), message: 'Renamed.' };
}
