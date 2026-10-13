// Shared data shapes and helpers for the Dashboard and Pipeline board.
// Both screens take plain data so they can be checked with the fake data outside the app.

export const PROGRAM_ORDER = ['TS', 'FHE', 'P1', 'P2', 'LAB', 'FT'] as const;
export const PROGRAM_LABEL: Record<string, string> = {
  TS: 'Two-Step', FHE: 'FHE', P1: 'Protocol I', P2: 'Protocol II', LAB: 'Labs', FT: 'Tests',
};

export type FheProgress = { done: number; total: number; next: string | null };

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
  fhe?: FheProgress;
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
  return displayStagesFor(stages, program);
}

// Supabase returns numbers from views as strings in some columns; make them numbers.
export function numify<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T {
  const out = { ...row };
  for (const k of keys) if (out[k] != null) (out as Record<string, unknown>)[k as string] = Number(out[k]);
  return out;
}

// Protocol II runs a full FHE first. On overview screens those FHE stages show as one "FHE" stage.
// Steps are still tracked one by one underneath; this only changes how they're grouped for display.
export const COLLAPSED_STAGES: Record<string, { upToSort: number; label: string }> = {
  P2: { upToSort: 4, label: 'FHE' },
};

export function collapsedLabel(program: string, stageSort: number | null | undefined): string | null {
  const c = COLLAPSED_STAGES[program];
  return c && stageSort != null && stageSort <= c.upToSort ? c.label : null;
}

// Stage list for a program with the collapsed stages merged into one.
export function displayStagesFor(stages: StageRow[], program: string): string[] {
  const out: string[] = [];
  for (const s of stages.filter((x) => x.program_code === program).sort((a, b) => a.sort - b.sort)) {
    const name = collapsedLabel(program, s.sort) ?? s.name;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

// Rewrites an enrollment's current stage to the collapsed name, and counts days from the program start.
export function collapseEnrollment<T extends { program_code: string; current_stage: string | null; days_in_stage: number | null; start_date: string }>(
  e: T, stageSortByName: Map<string, number>, today: string,
): T {
  if (!e.current_stage) return e;
  const label = collapsedLabel(e.program_code, stageSortByName.get(`${e.program_code}|${e.current_stage}`));
  if (!label) return e;
  const days = Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${e.start_date}T00:00:00Z`)) / 86_400_000));
  return { ...e, current_stage: label, days_in_stage: days };
}
