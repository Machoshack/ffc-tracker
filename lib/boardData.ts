import type { SupabaseClient } from '@supabase/supabase-js';
import { collapseEnrollment, numify, COLLAPSED_STAGES, type ActiveEnrollment, type EnrollmentHistory, type FheProgress, type OverdueStep, type StageRow } from '@/lib/board';
import { todayInNewYork } from '@/lib/dates';

// Loads what the Dashboard and Pipeline board show. Runs as the logged-in user.
export async function loadBoardData(supabase: SupabaseClient) {
  const today = todayInNewYork();
  const collapsedPrograms = Object.keys(COLLAPSED_STAGES);
  const [active, stages, overdue, history, p1, fheSteps] = await Promise.all([
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
    supabase.from('v_steps')
      .select('enrollment_id, program_code, stage_sort, step_sort, step_name, status')
      .in('program_code', collapsedPrograms)
      .in('enrollment_status', ['active', 'paused'])
      .order('stage_sort').order('step_sort'),
  ]);

  const stageRows = (stages.data ?? []).map((s) => ({
    name: s.name as string,
    sort: s.sort as number,
    program_code: (s.program as unknown as { code: string }).code,
  })) as StageRow[];
  const sortByName = new Map(stageRows.map((s) => [`${s.program_code}|${s.name}`, s.sort]));

  // Progress through the collapsed FHE part, per enrollment.
  const fhe = new Map<string, FheProgress>();
  for (const st of fheSteps.data ?? []) {
    if (st.stage_sort > COLLAPSED_STAGES[st.program_code].upToSort) continue;
    const p = fhe.get(st.enrollment_id) ?? { done: 0, total: 0, next: null };
    p.total++;
    if (st.status === 'done' || st.status === 'skipped') p.done++;
    else if (!p.next) p.next = st.step_name;
    fhe.set(st.enrollment_id, p);
  }

  return {
    today,
    error: active.error?.message ?? stages.error?.message ?? overdue.error?.message ?? null,
    active: ((active.data ?? []) as ActiveEnrollment[])
      .map((e) => numify(e, ['days_in_stage', 'overdue_steps']))
      .map((e) => {
        const c = collapseEnrollment(e, sortByName, today);
        return c.current_stage === COLLAPSED_STAGES[c.program_code]?.label ? { ...c, fhe: fhe.get(c.enrollment_id) } : c;
      }),
    stages: stageRows,
    overdue: (overdue.data ?? []) as OverdueStep[],
    history: (history.data ?? []) as EnrollmentHistory[],
    overBudget: (p1.data ?? []).filter((r) => Number(r.supplement_remaining) < 0 || Number(r.test_remaining) < 0).length,
  };
}
