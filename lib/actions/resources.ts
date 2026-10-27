'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentStaff } from '@/lib/supabase/server';

export type ResourceState = { error?: string; ok?: number };

async function adminProgram(code: string) {
  const { supabase, staff } = await getCurrentStaff();
  if (staff?.role !== 'admin') return { supabase, error: 'Only admins can change Resources.' as string, programId: null };
  const { data } = await supabase.from('program').select('id').eq('code', code).maybeSingle();
  if (!data) return { supabase, error: 'Program not found.', programId: null };
  return { supabase, error: null, programId: data.id as string };
}

export async function saveGuide(code: string, body: string): Promise<ResourceState> {
  const { supabase, error, programId } = await adminProgram(code);
  if (error || !programId) return { error: error ?? 'Program not found.' };
  if (body.length > 200_000) return { error: 'The guide is too long to save.' };
  const { error: e } = await supabase.from('program_guide').upsert({ program_id: programId, body });
  if (e) return { error: `Could not save: ${e.message}` };
  revalidatePath(`/resources/${code}`);
  return { ok: Date.now() };
}

export async function addLink(code: string, _prev: ResourceState, form: FormData): Promise<ResourceState> {
  const { supabase, error, programId } = await adminProgram(code);
  if (error || !programId) return { error: error ?? 'Program not found.' };
  const label = String(form.get('label') ?? '').trim();
  let url = String(form.get('url') ?? '').trim();
  const note = String(form.get('note') ?? '').trim() || null;
  if (!label) return { error: 'Enter a name for the link.' };
  if (/^http:\/\//i.test(url)) url = url.replace(/^http:/i, 'https:');
  if (!/^https:\/\/\S+\.\S+/.test(url)) return { error: 'Enter a full web address starting with https://' };
  const { count } = await supabase.from('program_link').select('id', { count: 'exact', head: true }).eq('program_id', programId);
  const { error: e } = await supabase.from('program_link').insert({ program_id: programId, label, url, note, sort: (count ?? 0) + 1 });
  if (e) return { error: `Could not save: ${e.message}` };
  revalidatePath(`/resources/${code}`);
  return { ok: Date.now() };
}

export async function removeLink(code: string, id: string): Promise<ResourceState> {
  const { supabase, error } = await adminProgram(code);
  if (error) return { error };
  const { data, error: e } = await supabase.from('program_link').delete().eq('id', id).select('id');
  if (e) return { error: `Could not remove: ${e.message}` };
  if (!data?.length) return { error: 'Nothing was removed.' };
  revalidatePath(`/resources/${code}`);
  return { ok: Date.now() };
}
