import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentStaff } from '@/lib/supabase/server';
import { todayInNewYork, weekdayDate } from '@/lib/dates';
import { StepRow, type StepView } from './StepRow';
import { UpgradeBox } from './UpgradeBox';
import { DeletePatient } from './DeletePatient';
import { P1Panel, type MarginRow, type SupplementRow, type TestRow } from './P1Panel';

type Enrollment = {
  enrollment_id: string;
  program_code: string;
  program_name: string;
  start_date: string;
  status: string;
  amount_paid: number;
  completed_on: string | null;
  current_stage: string | null;
  days_in_stage: number | null;
  overdue_steps: number;
  planned_end: string | null;
};

type StepRowData = {
  step_id: string;
  step_key: string;
  stage_name: string;
  stage_sort: number;
  step_sort: number;
  step_name: string;
  owner_role: string;
  owner_name: string | null;
  due_date: string;
  status: StepView['status'];
  completed_on: string | null;
  notes: string | null;
  is_overdue: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled', converted: 'Upgraded',
};

export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ enrollment?: string }>;
}) {
  const { id } = await params;
  const { enrollment: chosen } = await searchParams;
  const { supabase, staff } = await getCurrentStaff();

  const { data: patient } = await supabase
    .from('patient').select('id, patient_code').eq('id', id).maybeSingle();
  if (!patient) notFound();

  await supabase.rpc('log_view', { p_record_type: 'patient', p_record_id: id });

  const { data: enrollmentRows } = await supabase
    .from('v_enrollments')
    .select('enrollment_id, program_code, program_name, start_date, status, amount_paid, completed_on, current_stage, days_in_stage, overdue_steps, planned_end')
    .eq('patient_id', id)
    .order('start_date', { ascending: false });
  const enrollments = (enrollmentRows ?? []) as Enrollment[];

  const current =
    enrollments.find((e) => e.enrollment_id === chosen) ??
    enrollments.find((e) => e.status === 'active' || e.status === 'paused') ??
    enrollments[0];

  let steps: StepRowData[] = [];
  let waitingOn = new Map<string, string[]>();
  if (current) {
    const { data } = await supabase
      .from('v_steps')
      .select('step_id, step_key, stage_name, stage_sort, step_sort, step_name, owner_role, owner_name, due_date, status, completed_on, notes, is_overdue')
      .eq('enrollment_id', current.enrollment_id)
      .order('stage_sort').order('step_sort');
    steps = (data ?? []) as StepRowData[];

    // Which unfinished steps each step is waiting on.
    const { data: templates } = await supabase
      .from('step_template')
      .select('key, blocked_by_keys, block_enabled, program!inner(code)')
      .eq('program.code', current.program_code);
    const byKey = new Map(steps.map((s) => [s.step_key, s]));
    waitingOn = new Map(
      (templates ?? []).map((t) => [
        t.key as string,
        t.block_enabled
          ? (t.blocked_by_keys as string[])
              .map((k) => byKey.get(k))
              .filter((b) => b && b.status !== 'done' && b.status !== 'skipped')
              .map((b) => b!.step_name)
          : [],
      ]),
    );
  }

  // FHE patients who can still move to Protocol II.
  const { data: upgrade } = current
    ? await supabase.from('v_upgrade_window').select('enrollment_id, days_left').eq('enrollment_id', current.enrollment_id).maybeSingle()
    : { data: null };
  const { data: p2 } = upgrade
    ? await supabase.from('program').select('price').eq('code', 'P2').maybeSingle()
    : { data: null };
  // Protocol I: supplements, tests, budget and margin.
  let p1: null | { budget: number; rate: number; supplements: SupplementRow[]; tests: TestRow[]; margin: MarginRow } = null;
  if (current?.program_code === 'P1') {
    const [{ data: prog }, { data: supp }, { data: tst }, { data: m }] = await Promise.all([
      supabase.from('program').select('supplement_budget, wholesale_rate').eq('code', 'P1').single(),
      supabase.from('supplement_log')
        .select('id, item, retail_price, wholesale_cost, given_on, staff_user:given_by(name)')
        .eq('enrollment_id', current.enrollment_id).order('given_on', { ascending: false }),
      supabase.from('test_cost_log').select('id, test_name, cost, logged_on')
        .eq('enrollment_id', current.enrollment_id).order('logged_on', { ascending: false }),
      supabase.from('v_p1_margin')
        .select('fee, consult_cost, staff_time_cost, test_costs, supplement_cost, margin, test_budget')
        .eq('enrollment_id', current.enrollment_id).maybeSingle(),
    ]);
    p1 = {
      budget: Number(prog?.supplement_budget ?? 0),
      rate: Number(prog?.wholesale_rate ?? 0.5),
      supplements: (supp ?? []).map((r) => ({
        ...r,
        given_by_name: (r.staff_user as unknown as { name: string } | null)?.name ?? null,
      })) as SupplementRow[],
      tests: (tst ?? []) as TestRow[],
      margin: (m ?? { fee: current.amount_paid, consult_cost: 0, staff_time_cost: 0, test_costs: 0, supplement_cost: 0, margin: 0, test_budget: null }) as MarginRow,
    };
  }

  const hasOpenProgram = enrollments.some((e) => e.status === 'active' || e.status === 'paused');

  const stages = new Map<string, StepRowData[]>();
  for (const s of steps) stages.set(s.stage_name, [...(stages.get(s.stage_name) ?? []), s]);
  const doneCount = steps.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const today = todayInNewYork();

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/patients" className="text-sm text-muted hover:text-brand">← Patients</Link>

      <div className="mt-2 mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-wide">{patient.patient_code}</h1>
        </div>
        {!hasOpenProgram && (
          <Link href={`/patients/new?patient=${id}`} className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white">
            Start a program
          </Link>
        )}
        {enrollments.length > 1 && (
          <nav className="flex flex-wrap gap-1 text-sm">
            {enrollments.map((e) => (
              <Link key={e.enrollment_id} href={`/patients/${id}?enrollment=${e.enrollment_id}`}
                className={`rounded border px-3 py-1 ${
                  e.enrollment_id === current?.enrollment_id ? 'border-brand bg-brand text-white' : 'border-line bg-white'
                }`}>
                {e.program_code} · {STATUS_LABEL[e.status] ?? e.status}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {!current ? (
        <p className="rounded border border-line bg-white p-6 text-muted">Not enrolled in a program.</p>
      ) : (
        <>
          <section className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line text-sm sm:grid-cols-4">
            {[
              ['Program', current.program_name],
              ['Status', `${STATUS_LABEL[current.status] ?? current.status}${current.current_stage ? `: ${current.current_stage}` : ''}`],
              ['Started', weekdayDate(current.start_date)],
              [current.status === 'completed' ? 'Finished' : 'Planned end',
                current.completed_on ? weekdayDate(current.completed_on) : current.planned_end ? weekdayDate(current.planned_end) : '-'],
              ['Paid', `$${Number(current.amount_paid).toLocaleString()}`],
              ['Steps done', `${doneCount} of ${steps.length}`],
              ['Overdue', String(current.overdue_steps)],
              ['Days in stage', current.current_stage && current.days_in_stage != null ? String(current.days_in_stage) : '-'],
            ].map(([k, v]) => (
              <div key={k} className="bg-white px-3 py-2">
                <div className="text-xs text-muted">{k}</div>
                <div className={`font-medium ${k === 'Overdue' && current.overdue_steps > 0 ? 'text-late' : ''}`}>{v}</div>
              </div>
            ))}
          </section>

          {p1 && (
            <P1Panel enrollmentId={current.enrollment_id} patientId={id} today={today} isAdmin={staff?.role === 'admin'}
              budget={p1.budget} rate={p1.rate} supplements={p1.supplements} tests={p1.tests} margin={p1.margin} />
          )}

          {upgrade && p2 && (
            <UpgradeBox enrollmentId={current.enrollment_id} patientId={id} credit={Number(current.amount_paid)}
              p2Price={Number(p2.price)} daysLeft={upgrade.days_left} />
          )}

          <div className="space-y-4">
            {[...stages.entries()].map(([stage, stageSteps]) => {
              const finished = stageSteps.every((s) => s.status === 'done' || s.status === 'skipped');
              return (
                <section key={stage} className="overflow-hidden rounded border border-line bg-white">
                  <h2 className="flex items-center justify-between border-b border-line bg-paper px-4 py-2 text-sm font-semibold">
                    {stage}
                    {finished && <span className="text-xs font-medium text-done">Complete</span>}
                  </h2>
                  <ul className="divide-y divide-line">
                    {stageSteps.map((s) => (
                      <StepRow
                        key={s.step_id}
                        patientId={id}
                        today={today}
                        step={{ ...s, waiting_on: waitingOn.get(s.step_key) ?? [] }}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
      {staff?.role === 'admin' && (
        <div className="mt-8 border-t border-line pt-4">
          <DeletePatient patientId={id} code={patient.patient_code} />
        </div>
      )}
    </div>
  );
}
