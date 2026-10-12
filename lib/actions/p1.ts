'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentStaff } from '@/lib/supabase/server';
import { todayInNewYork } from '@/lib/dates';

export type P1State = { error?: string; needsApproval?: { overBy: number }; ok?: number };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const money = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(/[$,\s]/g, ''));

function refresh(patientId: string) {
  revalidatePath(`/patients/${patientId}`);
  revalidatePath('/margin');
}

export async function addSupplement(
  enrollmentId: string, patientId: string, _prev: P1State, form: FormData,
): Promise<P1State> {
  const { supabase, staff } = await getCurrentStaff();
  if (!staff) return { error: 'You are not logged in as staff.' };

  const item = String(form.get('item') ?? '').trim();
  const retail = money(form.get('retail_price'));
  const wholesaleRaw = String(form.get('wholesale_cost') ?? '').trim();
  const wholesale = wholesaleRaw ? money(wholesaleRaw) : null;
  const date = String(form.get('given_on') ?? '');
  const approved = form.get('approve_over') === '1';

  if (!item) return { error: 'Enter the supplement.' };
  if (!Number.isFinite(retail) || retail <= 0) return { error: 'Enter the retail price.' };
  if (wholesale !== null && (!Number.isFinite(wholesale) || wholesale < 0)) return { error: 'Wholesale cost must be a number.' };
  if (!ISO_DATE.test(date) || date > todayInNewYork()) return { error: 'Pick the date it was given (not in the future).' };

  // Budget check before saving. Wholesale defaults to the program's rate (50%) unless entered.
  const { data: check, error: checkError } = await supabase
    .rpc('supplement_check', { p_enrollment: enrollmentId, p_new_retail: retail }).single<{
      budget: number | null; remaining_now: number; remaining_after: number;
    }>();
  if (checkError) return { error: `Could not check the budget: ${checkError.message}` };
  if (check?.budget != null) {
    const after = wholesale !== null ? Number(check.remaining_now) - wholesale : Number(check.remaining_after);
    if (after < 0 && !approved) return { needsApproval: { overBy: Math.abs(after) } };
  }

  const { error } = await supabase.from('supplement_log').insert({
    enrollment_id: enrollmentId, item, retail_price: retail, wholesale_cost: wholesale, given_on: date,
  });
  if (error) return { error: `Could not save: ${error.message}` };
  refresh(patientId);
  return { ok: Date.now() };
}

export async function addTestCost(
  enrollmentId: string, patientId: string, _prev: P1State, form: FormData,
): Promise<P1State> {
  const { supabase, staff } = await getCurrentStaff();
  if (!staff) return { error: 'You are not logged in as staff.' };

  const name = String(form.get('test_name') ?? '').trim();
  const cost = money(form.get('cost'));
  const date = String(form.get('logged_on') ?? '');
  if (!name) return { error: 'Enter the test name.' };
  if (!Number.isFinite(cost) || cost < 0) return { error: 'Enter what the test cost the practice.' };
  if (!ISO_DATE.test(date)) return { error: 'Pick a date.' };

  // Testing budget check, same as supplements.
  if (form.get('approve_over') !== '1') {
    const { data: m } = await supabase.from('v_p1_margin')
      .select('test_budget, test_remaining').eq('enrollment_id', enrollmentId).maybeSingle();
    if (m?.test_budget != null && Number(m.test_remaining) - cost < 0) {
      return { needsApproval: { overBy: Math.abs(Number(m.test_remaining) - cost) } };
    }
  }

  const { error } = await supabase.from('test_cost_log').insert({
    enrollment_id: enrollmentId, test_name: name, cost, logged_on: date,
  });
  if (error) return { error: `Could not save: ${error.message}` };
  refresh(patientId);
  return { ok: Date.now() };
}

// Admins can remove an entry made by mistake. The removal is kept in the audit log.
export async function removeEntry(table: 'supplement_log' | 'test_cost_log', id: string, patientId: string): Promise<P1State> {
  const { supabase, staff } = await getCurrentStaff();
  if (staff?.role !== 'admin') return { error: 'Only an admin can remove entries.' };
  const { data, error } = await supabase.from(table).delete().eq('id', id).select('id');
  if (error) return { error: `Could not remove: ${error.message}` };
  if (!data?.length) return { error: 'Nothing was removed.' };
  refresh(patientId);
  return { ok: Date.now() };
}
