// Shared data shapes and helpers for the Dashboard and Pipeline board.
// Both screens take plain data so they can be checked with the fake data outside the app.

export const PROGRAM_ORDER = ['TS', 'FHE', 'P1', 'P2'] as const;
export const PROGRAM_LABEL: Record<string, string> = {
  TS: 'Two-Step', FHE: 'FHE', P1: 'Protocol I', P2: 'Protocol II',
};

export type ActiveEnrollment = {
  enrollment_id: string;
  patient_id: string;
  patient_code: string;
  program_code: string;
  status: string;
  current_stage: string | null;
  days_in_stage: number | null;
  overdue_steps: number;
  next_due: string | null;
  start_date: string;
};

export type StageRow = { program_code: string; name: string; sort: number };

export type OverdueStep = {
  step_id: string;
  patient_id: string;
  patient_code: string;
  program_code: string;
  step_name: string;
  owner_role: string;
  due_date: string;
};

export type EnrollmentHistory = {
  program_code: string;
  status: string;
  start_date: string;
  completed_on: string | null;
};

export function stagesFor(stages: StageRow[], program: string): string[] {
  return stages.filter((s) => s.program_code === program).sort((a, b) => a.sort - b.sort).map((s) => s.name);
}

// Supabase returns numbers from views as strings in some columns; make them numbers.
export function numify<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T {
  const out = { ...row };
  for (const k of keys) if (out[k] != null) (out as Record<string, unknown>)[k as string] = Number(out[k]);
  return out;
}
