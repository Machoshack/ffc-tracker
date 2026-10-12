import Link from 'next/link';
import { addDays, daysBetween, mondayOf, shortDate, toDate, weekdayDate } from '@/lib/dates';

export type TimelineEnrollment = {
  enrollment_id: string;
  patient_id: string;
  patient_code: string;
  display_name: string;
  program_code: string;
  start_date: string;
  current_stage: string | null;
  days_in_stage: number | null;
  overdue_steps: number;
  next_due: string | null;
  planned_end: string | null;
  status?: string;
};

export type TimelineStep = {
  enrollment_id: string;
  stage_name: string;
  stage_sort: number;
  step_sort: number;
  step_name: string;
  owner_role: string;
  due_date: string;
  status: 'not_started' | 'in_progress' | 'done' | 'skipped';
  completed_on: string | null;
  is_blocked: boolean;
};

type Marker = {
  stage: string;
  date: string;
  kind: 'done' | 'late' | 'due' | 'wait';
  steps: string[];
};

const KIND_STYLE: Record<Marker['kind'], string> = {
  done: 'bg-done',
  late: 'bg-late',
  due: 'bg-due',
  wait: 'bg-wait',
};
const KIND_LABEL: Record<Marker['kind'], string> = {
  done: 'Done',
  late: 'Overdue',
  due: 'Upcoming',
  wait: 'Waiting on an earlier step',
};

// One marker per stage: where it finished, or when its next unfinished step is due.
function markersFor(steps: TimelineStep[], today: string): Marker[] {
  const byStage = new Map<number, TimelineStep[]>();
  for (const s of [...steps].sort((a, b) => a.step_sort - b.step_sort)) byStage.set(s.stage_sort, [...(byStage.get(s.stage_sort) ?? []), s]);

  return [...byStage.values()].map((stageSteps) => {
    const open = stageSteps.filter((s) => s.status === 'not_started' || s.status === 'in_progress');
    const stage = stageSteps[0].stage_name;
    if (open.length === 0) {
      const date = stageSteps.map((s) => s.completed_on ?? s.due_date).sort().at(-1)!;
      return { stage, date, kind: 'done', steps: stageSteps.map((s) => `${s.step_name}: done`) };
    }
    const date = open.map((s) => s.due_date).sort()[0];
    const kind: Marker['kind'] =
      date < today ? 'late' : open.every((s) => s.is_blocked) ? 'wait' : 'due';
    return {
      stage,
      date,
      kind,
      steps: stageSteps.map((s) =>
        s.status === 'done' || s.status === 'skipped'
          ? `${s.step_name}: ${s.status}`
          : `${s.step_name}: due ${shortDate(s.due_date)}${s.is_blocked ? ' (waiting)' : ''}`,
      ),
    };
  });
}

// Grid lines and labels: weekly for short windows, every other week for medium, monthly for long ones.
function ticksFor(start: string, end: string): string[] {
  const span = daysBetween(start, end);
  const out: string[] = [];
  if (span <= 110) {
    for (let d = mondayOf(start) < start ? addDays(mondayOf(start), 7) : mondayOf(start); d < end; d = addDays(d, 7)) out.push(d);
  } else if (span <= 200) {
    for (let d = mondayOf(start) < start ? addDays(mondayOf(start), 7) : mondayOf(start); d < end; d = addDays(d, 14)) out.push(d);
  } else {
    const first = new Date(`${start.slice(0, 7)}-01T00:00:00Z`);
    if (first.toISOString().slice(0, 10) < start) first.setUTCMonth(first.getUTCMonth() + 1);
    for (const d = first; d.toISOString().slice(0, 10) < end; d.setUTCMonth(d.getUTCMonth() + 1)) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function tickLabel(d: string, span: number) {
  return span > 200
    ? toDate(d).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) + (d.slice(5, 7) === '01' ? ` ${d.slice(0, 4)}` : '')
    : shortDate(d);
}

export function Timeline({
  enrollments,
  steps,
  today,
  start,
  end,
}: {
  enrollments: TimelineEnrollment[];
  steps: TimelineStep[];
  today: string;
  start: string;
  end: string; // first day after the window
}) {
  const span = daysBetween(start, end);
  const pos = (d: string) => (Math.min(Math.max(daysBetween(start, d), 0), span) / span) * 100;
  const weeks = ticksFor(start, end);
  const todayVisible = today >= start && today < end;

  const stepsBy = new Map<string, TimelineStep[]>();
  for (const s of steps) stepsBy.set(s.enrollment_id, [...(stepsBy.get(s.enrollment_id) ?? []), s]);

  const rows = [...enrollments].sort(
    (a, b) => b.overdue_steps - a.overdue_steps || (a.next_due ?? '9999').localeCompare(b.next_due ?? '9999'),
  );

  if (rows.length === 0) {
    return <p className="rounded border border-line bg-white p-6 text-muted">No patients to show for this view.</p>;
  }

  return (
    <>
      {/* Phone: a simple list */}
      <ul className="space-y-2 md:hidden">
        {rows.map((e) => (
          <li key={e.enrollment_id} className="rounded border border-line bg-white p-3">
            <div className="flex items-baseline justify-between gap-2">
              <Link href={`/patients/${e.patient_id}`} className="font-medium text-brand underline-offset-2 hover:underline">{e.display_name}</Link>
              <span className="text-xs text-muted">{e.program_code}</span>
            </div>
            <div className="mt-1 text-sm text-muted">{e.current_stage ?? (e.status === 'converted' ? 'Upgraded' : 'Finished')}</div>
            <div className="mt-2 flex items-center gap-2 text-sm">
              {e.overdue_steps > 0 && (
                <span className="rounded bg-late px-2 py-0.5 text-xs font-medium text-white">
                  {e.overdue_steps} overdue
                </span>
              )}
              {e.next_due && (
                <span>{e.next_due < today ? 'Late since' : 'Next due'} {weekdayDate(e.next_due)}</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop: the timeline */}
      <div className="hidden overflow-x-auto rounded border border-line bg-white md:block">
        {/* With only a few rows, leave room under them so step popups aren't cut off by the box edge. */}
        <div className={`min-w-[960px] ${rows.length <= 4 ? 'pb-56' : ''}`}>
          <div className="grid grid-cols-[240px_1fr] border-b border-line text-xs text-muted">
            <div className="px-3 py-2">Patient</div>
            <div className="relative h-8">
              {weeks.map((w) => (
                <span key={w} className="absolute top-2 -translate-x-1/2" style={{ left: `${pos(w)}%` }}>
                  {tickLabel(w, span)}
                </span>
              ))}
            </div>
          </div>

          {rows.map((e, rowIndex) => {
            const markers = markersFor(stepsBy.get(e.enrollment_id) ?? [], today);
            const later = markers.filter((m) => m.date >= end).length;
            const earlier = markers.filter((m) => m.date < start).length;
            const barStart = e.start_date;
            const barEnd = e.planned_end ?? e.start_date;
            return (
              <div key={e.enrollment_id} className="grid grid-cols-[240px_1fr] border-b border-line last:border-b-0">
                <div className="px-3 py-2">
                  <div className="flex items-baseline gap-2">
                    <Link href={`/patients/${e.patient_id}`} className="truncate font-medium hover:text-brand hover:underline underline-offset-2">{e.display_name}</Link>
                    <span className="text-xs text-muted">{e.program_code}</span>
                  </div>
                  <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
                    <span className="min-w-0 truncate">{e.current_stage ?? (e.status === 'converted' ? 'Upgraded' : 'Finished')}</span>
                    {e.days_in_stage != null && e.current_stage && (
                      <span className="shrink-0 whitespace-nowrap" title="Days in this stage">· {e.days_in_stage}d</span>
                    )}
                    {e.overdue_steps > 0 && (
                      <span className="shrink-0 whitespace-nowrap rounded bg-late px-1.5 text-[11px] font-medium text-white">
                        {e.overdue_steps} late
                      </span>
                    )}
                  </div>
                </div>

                <div className="relative h-14">
                  {weeks.map((w) => (
                    <span key={w} className="absolute inset-y-0 w-px bg-line" style={{ left: `${pos(w)}%` }} />
                  ))}
                  <span
                    className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-line"
                    style={{ left: `${pos(barStart)}%`, width: `${Math.max(pos(barEnd) - pos(barStart), 0.5)}%` }}
                  />
                  {todayVisible && <span className="absolute inset-y-0 w-0.5 bg-brand/60" style={{ left: `${pos(today)}%` }} />}
                  {markers
                    .filter((m) => m.date >= start && m.date < end)
                    .map((m) => {
                      const x = pos(m.date);
                      const below = rows.length <= 4 || rowIndex < rows.length / 2;
                      return (
                        <span
                          key={m.stage}
                          className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2 hover:z-30 focus-within:z-30"
                          style={{ left: `${x}%` }}
                        >
                          <button
                            type="button"
                            aria-label={`${m.stage}: ${KIND_LABEL[m.kind]}`}
                            className={`block h-3.5 w-3.5 cursor-pointer rounded-full ring-2 ring-white outline-none focus:ring-ink ${KIND_STYLE[m.kind]}`}
                          />
                          <span
                            role="tooltip"
                            className={`pointer-events-none absolute z-30 hidden w-64 rounded border border-line bg-white p-2.5 text-left text-xs shadow-lg group-hover:block group-focus-within:block ${
                              below ? 'top-5' : 'bottom-5'
                            } ${x > 70 ? 'right-0' : x < 30 ? 'left-0' : 'left-1/2 -translate-x-1/2'}`}
                          >
                            <span className="mb-1 flex items-center gap-1.5 font-medium text-ink">
                              <span className={`inline-block h-2 w-2 rounded-full ${KIND_STYLE[m.kind]}`} />
                              {m.stage}
                            </span>
                            <span className="mb-1.5 block text-muted">{KIND_LABEL[m.kind]} · {weekdayDate(m.date)}</span>
                            {m.steps.map((s) => (
                              <span key={s} className="block leading-5 text-ink">{s}</span>
                            ))}
                          </span>
                        </span>
                      );
                    })}
                  {earlier > 0 && (
                    <span className="absolute left-1 top-1 text-[11px] text-muted">{earlier} earlier</span>
                  )}
                  {later > 0 && (
                    <span className="absolute right-1 top-1 text-[11px] text-muted">+{later} later</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 hidden flex-wrap gap-4 text-xs text-muted md:flex">
        {(Object.keys(KIND_LABEL) as Marker['kind'][]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${KIND_STYLE[k]}`} />
            {KIND_LABEL[k]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 bg-brand/60" /> Today
        </span>
        <span>Hover or click a dot to see each step.</span>
      </div>
    </>
  );
}
