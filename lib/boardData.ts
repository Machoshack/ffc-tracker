import type { SupabaseClient } from '@supabase/supabase-js';
import { numify, type ActiveEnrollment, type EnrollmentHistory, type OverdueStep, type StageRow } from '@/lib/board';
import { todayInNewYork } from '@/lib/dates';

// Loads what the Dashboard and Pipeline board show. Runs as the logged-in user.
export async function loadBoardData(supabase: SupabaseClient) {
  const today = todayInNewYork();
  const [active, stages, overdue, history, p1] = await Promise.all([
    supabase.from('v_enrollments')
      .select('enrollment_id, patient_id, patient_code, program_code, status, current_stage, days_in_stage, overdue_steps, next_due, start_date')
      .in('status', ['active', 'paused']),
    supabase.from('program_stage').select('name, sort, program!inner(code)'),
    supabase.from('v_steps')
      .select('step_id, patient_id, patient_code, program_code, step_name, owner_role, due_date')
      .eq('enrollment_status', 'active')
      .in('status', ['not_started', 'in_progress'])
      .lt('due_date', today)
      .order('due_date'),
    supabase.from('v_enrollments').select('program_code, status, start_date, completed_on'),
    supabase.from('v_p1_margin').select('supplement_remaining, test_remaining').in('status', ['active', 'paused']),
  ]);

  return {
    today,
    error: active.error?.message ?? stages.error?.message ?? overdue.error?.message ?? null,
    active: ((active.data ?? []) as ActiveEnrollment[]).map((e) => numify(e, ['days_in_stage', 'overdue_steps'])),
    stages: (stages.data ?? []).map((s) => ({
      name: s.name as string,
      sort: s.sort as number,
      program_code: (s.program as unknown as { code: string }).code,
    })) as StageRow[],
    overdue: (overdue.data ?? []) as OverdueStep[],
    history: (history.data ?? []) as EnrollmentHistory[],
    overBudget: (p1.data ?? []).filter((r) => Number(r.supplement_remaining) < 0 || Number(r.test_remaining) < 0).length,
  };
}
