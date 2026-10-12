import Link from 'next/link';
import { getCurrentStaff } from '@/lib/supabase/server';
import { Timeline, type TimelineEnrollment, type TimelineStep } from '@/components/Timeline';
import { todayInNewYork } from '@/lib/dates';

const PROGRAMS = [
  { code: '', label: 'All' },
  { code: 'TS', label: 'Two-Step' },
  { code: 'FHE', label: 'FHE' },
  { code: 'P1', label: 'Protocol I' },
  { code: 'P2', label: 'Protocol II' },
];

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ program?: string }>;
}) {
  const { program = '' } = await searchParams;
  const { supabase } = await getCurrentStaff();

  let eq = supabase
    .from('v_enrollments')
    .select('enrollment_id, patient_id, patient_code, display_name, program_code, start_date, current_stage, days_in_stage, overdue_steps, next_due, planned_end')
    .in('status', ['active', 'paused']);
  if (program) eq = eq.eq('program_code', program);
  const { data: enrollments, error } = await eq;

  const ids = (enrollments ?? []).map((e) => e.enrollment_id);
  const { data: steps } = ids.length
    ? await supabase
        .from('v_steps')
        .select('enrollment_id, stage_name, stage_sort, step_sort, step_name, owner_role, due_date, status, completed_on, is_blocked')
        .in('enrollment_id', ids)
    : { data: [] };

  const overdue = (enrollments ?? []).reduce((n, e) => n + (e.overdue_steps ?? 0), 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Active patients</h1>
          <p className="text-sm text-muted">
            {enrollments?.length ?? 0} active · {overdue} overdue step{overdue === 1 ? '' : 's'}
          </p>
        </div>
        <nav className="flex flex-wrap gap-1 text-sm">
          {PROGRAMS.map((p) => (
            <Link
              key={p.code}
              href={p.code ? `/?program=${p.code}` : '/'}
              className={`rounded border px-3 py-1 ${
                program === p.code ? 'border-brand bg-brand text-white' : 'border-line bg-white hover:border-brand'
              }`}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </div>

      {error ? (
        <p className="rounded border border-late bg-white p-4 text-late">Could not load patients: {error.message}</p>
      ) : (
        <Timeline
          enrollments={(enrollments ?? []) as TimelineEnrollment[]}
          steps={(steps ?? []) as TimelineStep[]}
          today={todayInNewYork()}
        />
      )}
    </div>
  );
}
