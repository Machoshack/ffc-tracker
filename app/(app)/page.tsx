import Link from 'next/link';
import { getCurrentStaff } from '@/lib/supabase/server';
import { Timeline, type TimelineEnrollment, type TimelineStep } from '@/components/Timeline';
import { TimelineControls } from '@/components/TimelineControls';
import { todayInNewYork } from '@/lib/dates';
import { resolveWindow, timelineHref, type TimelineParams } from '@/lib/timelineWindow';
import { collapseEnrollment } from '@/lib/board';

const PROGRAMS = [
  { code: '', label: 'All' },
  { code: 'TS', label: 'Two-Step' },
  { code: 'FHE', label: 'FHE' },
  { code: 'P1', label: 'Protocol I' },
  { code: 'P2', label: 'Protocol II' },
  { code: 'LAB', label: 'Labs' },
  { code: 'FT', label: 'Tests' },
];

export default async function TimelinePage({ searchParams }: { searchParams: Promise<TimelineParams> }) {
  const params = await searchParams;
  const program = params.program ?? '';
  const today = todayInNewYork();
  const win = resolveWindow(params, today);
  const { supabase } = await getCurrentStaff();

  let eq = supabase
    .from('v_enrollments')
    .select('enrollment_id, patient_id, patient_code, display_name, program_code, start_date, status, current_stage, days_in_stage, overdue_steps, next_due, planned_end, completed_on, detail');
  if (win.mode === 'year') {
    // Anyone in a program at any point during the year, finished or not.
    eq = eq
      .not('status', 'eq', 'cancelled')
      .lt('start_date', win.end)
      .or(`completed_on.gte.${win.start},completed_on.is.null`);
  } else {
    eq = eq.in('status', ['active', 'paused']);
  }
  if (program) eq = eq.eq('program_code', program);
  const { data: enrollments, error } = await eq;

  const ids = (enrollments ?? []).map((e) => e.enrollment_id);
  const { data: steps } = ids.length
    ? await supabase
        .from('v_steps')
        .select('enrollment_id, program_code, stage_name, stage_sort, step_sort, step_name, owner_role, due_date, status, completed_on, is_blocked, optional')
        .in('enrollment_id', ids)
    : { data: [] };

  // Years to offer: from the first program start to next year.
  const { data: first } = await supabase.from('enrollment').select('start_date').order('start_date').limit(1).maybeSingle();
  const firstYear = Number((first?.start_date ?? today).slice(0, 4));
  const thisYear = Number(today.slice(0, 4));
  const years = Array.from({ length: thisYear + 1 - firstYear + 1 }, (_, i) => thisYear + 1 - i);

  // Protocol II patients still in their FHE show "FHE" as their stage.
  const sortByName = new Map((steps ?? []).map((st) => [`${st.program_code}|${st.stage_name}`, st.stage_sort as number]));
  const rows = (enrollments ?? []).map((e) => collapseEnrollment(e, sortByName, today));

  const overdue = (enrollments ?? []).reduce((n, e) => n + (e.overdue_steps ?? 0), 0);
  const finished = (enrollments ?? []).filter((e) => e.status === 'completed' || e.status === 'converted').length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{win.mode === 'year' ? `Patients in ${win.year}` : 'Active patients'}</h1>
          <p className="text-sm text-muted">
            {win.mode === 'year'
              ? `${enrollments?.length ?? 0} programs · ${finished} finished · ${overdue} overdue step${overdue === 1 ? '' : 's'}`
              : `${enrollments?.length ?? 0} active · ${overdue} overdue step${overdue === 1 ? '' : 's'}`}
          </p>
        </div>
        <nav className="flex flex-wrap gap-1 text-sm">
          {PROGRAMS.map((p) => (
            <Link
              key={p.code}
              href={timelineHref(params, { program: p.code || null })}
              className={`rounded border px-3 py-1 ${
                program === p.code ? 'border-brand bg-brand text-white' : 'border-line bg-white hover:border-brand'
              }`}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </div>

      <TimelineControls params={params} mode={win.mode} scale={win.scale} start={win.start}
        year={win.year} years={years} today={today} />

      {error ? (
        <p className="rounded border border-late bg-white p-4 text-late">Could not load patients: {error.message}</p>
      ) : (
        <Timeline
          enrollments={rows as TimelineEnrollment[]}
          steps={(steps ?? []) as TimelineStep[]}
          today={today}
          start={win.start}
          end={win.end}
        />
      )}
    </div>
  );
}
