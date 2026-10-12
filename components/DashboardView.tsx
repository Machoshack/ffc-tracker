import Link from 'next/link';
import {
  PROGRAM_LABEL, PROGRAM_ORDER, stagesFor,
  type ActiveEnrollment, type EnrollmentHistory, type OverdueStep, type StageRow,
} from '@/lib/board';
import { addDays, daysBetween, shortDate } from '@/lib/dates';

function Tile({ label, value, sub, alert }: { label: string; value: string | number; sub?: string; alert?: boolean }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="flex items-center gap-2 text-2xl font-semibold">
        {alert && <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-late" />}
        {value}
      </div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

function monthKey(iso: string) { return iso.slice(0, 7); }
function monthLabel(key: string) {
  return new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function DashboardView({ active, stages, overdue, history, today, overBudget }: {
  active: ActiveEnrollment[];
  stages: StageRow[];
  overdue: OverdueStep[];
  history: EnrollmentHistory[];
  today: string;
  overBudget: number;
}) {
  const weekEnd = addDays(today, 7);
  const dueSoon = active.filter((e) => e.next_due && e.next_due >= today && e.next_due <= weekEnd).length;
  const overdueStaff = overdue.filter((s) => s.owner_role === 'staff').length;
  const overduePhys = overdue.filter((s) => s.owner_role === 'physician').length;

  // Patients by program and stage
  const byStage = PROGRAM_ORDER.map((code) => {
    const inProgram = active.filter((e) => e.program_code === code);
    const rows = stagesFor(stages, code).map((stage) => {
      const here = inProgram.filter((e) => e.current_stage === stage);
      const days = here.map((e) => e.days_in_stage ?? 0);
      const longest = here.reduce<ActiveEnrollment | null>((a, e) => (!a || (e.days_in_stage ?? 0) > (a.days_in_stage ?? 0) ? e : a), null);
      return {
        stage, count: here.length,
        avg: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 0,
        longest,
        overdue: here.filter((e) => e.overdue_steps > 0).length,
      };
    });
    return { code, total: inProgram.length, rows };
  });
  const maxCount = Math.max(1, ...byStage.flatMap((p) => p.rows.map((r) => r.count)));

  // Time in stage, slowest first
  const slow = byStage
    .flatMap((p) => p.rows.filter((r) => r.count > 0).map((r) => ({ ...r, code: p.code })))
    .sort((a, b) => b.avg - a.avg);

  // Started and finished, last 6 months
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - (5 - i));
    return d.toISOString().slice(0, 7);
  });
  const started = (code: string, m: string) => history.filter((h) => h.program_code === code && monthKey(h.start_date) === m).length;
  const finished = (code: string, m: string) =>
    history.filter((h) => h.program_code === code && (h.status === 'completed' || h.status === 'converted') && h.completed_on && monthKey(h.completed_on) === m).length;

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-4">
        <Tile label="Active patients" value={active.length} />
        <Tile label="Overdue steps" value={overdue.length} alert={overdue.length > 0}
          sub={`${overdueStaff} staff · ${overduePhys} physician`} />
        <Tile label="Next step due in 7 days" value={dueSoon} sub="patients" />
        <Tile label="Over a P1 budget" value={overBudget} alert={overBudget > 0} sub="patients" />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Patients by stage</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {byStage.map((p) => (
            <div key={p.code} className="rounded border border-line bg-white p-4">
              <div className="mb-3 flex items-baseline justify-between">
                <Link href={`/pipeline?program=${p.code}`} className="font-medium hover:text-brand hover:underline">
                  {PROGRAM_LABEL[p.code]}
                </Link>
                <span className="text-sm text-muted">{p.total} active</span>
              </div>
              <ul className="space-y-2">
                {p.rows.map((r) => (
                  <li key={r.stage} className="group relative grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-3 text-sm">
                    <span className="truncate text-muted" title={r.stage}>{r.stage}</span>
                    <span className="flex items-center gap-2">
                      <span className="h-4 rounded-r bg-brand transition-opacity group-hover:opacity-80"
                        style={{ width: `${(r.count / maxCount) * 100}%`, minWidth: r.count ? 6 : 0 }} />
                      <span className="tabular-nums text-ink">{r.count}</span>
                      {r.overdue > 0 && <span className="whitespace-nowrap text-xs text-late" title="Patients with late steps">{r.overdue} late</span>}
                    </span>
                    {r.count > 0 && (
                      <span role="tooltip"
                        className="pointer-events-none absolute left-44 top-6 z-20 hidden w-60 rounded border border-line bg-white p-2 text-xs shadow-lg group-hover:block">
                        <span className="block font-medium text-ink">{r.stage}</span>
                        <span className="block text-muted">{r.count} patient{r.count === 1 ? '' : 's'} · average {r.avg} days here</span>
                        {r.longest && <span className="block text-muted">Longest: {r.longest.patient_code}, {r.longest.days_in_stage} days</span>}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded border border-line bg-white">
          <h2 className="border-b border-line bg-paper px-4 py-2 text-sm font-semibold">Oldest overdue steps</h2>
          {overdue.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">Nothing overdue.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {overdue.slice(0, 8).map((s) => (
                <li key={s.step_id} className="flex items-baseline gap-3 px-4 py-2">
                  <Link href={`/patients/${s.patient_id}`} className="w-20 shrink-0 font-mono font-semibold text-brand hover:underline">
                    {s.patient_code}
                  </Link>
                  <span className="min-w-0 flex-1 truncate">{s.step_name}</span>
                  <span className="hidden shrink-0 text-xs capitalize text-muted sm:inline">{s.owner_role}</span>
                  <span className="w-20 shrink-0 text-right text-xs font-medium text-late">
                    {daysBetween(s.due_date, today)} days late
                  </span>
                </li>
              ))}
              {overdue.length > 8 && (
                <li className="px-4 py-2 text-xs text-muted">
                  <Link href="/queue?who=all" className="underline">See all {overdue.length} in the queue</Link>
                </li>
              )}
            </ul>
          )}
        </section>

        <section className="overflow-hidden rounded border border-line bg-white">
          <h2 className="border-b border-line bg-paper px-4 py-2 text-sm font-semibold">Time in current stage</h2>
          {slow.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">No active patients.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-medium">Stage</th>
                  <th className="px-2 py-2 text-right font-medium">Patients</th>
                  <th className="px-2 py-2 text-right font-medium">Avg days</th>
                  <th className="px-4 py-2 text-right font-medium">Longest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {slow.map((r) => (
                  <tr key={`${r.code}-${r.stage}`}>
                    <td className="px-4 py-2"><span className="text-xs text-muted">{r.code}</span> {r.stage}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.count}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.avg}</td>
                    <td className="px-4 py-2 text-right text-xs text-muted">
                      {r.longest && <>{r.longest.patient_code}, {r.longest.days_in_stage}d</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="overflow-x-auto rounded border border-line bg-white">
        <h2 className="border-b border-line bg-paper px-4 py-2 text-sm font-semibold">Started and finished, last 6 months</h2>
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-2 font-medium">Month</th>
              {PROGRAM_ORDER.map((c) => (
                <th key={c} className="px-3 py-2 text-right font-medium">{PROGRAM_LABEL[c]}<br /><span className="font-normal">started / finished</span></th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {months.map((m) => (
              <tr key={m}>
                <td className="px-4 py-2">{monthLabel(m)}</td>
                {PROGRAM_ORDER.map((c) => (
                  <td key={c} className="px-3 py-2 text-right tabular-nums">
                    {started(c, m)} <span className="text-muted">/</span> {finished(c, m)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          Finished includes FHE patients who upgraded to Protocol II. Today is {shortDate(today)}.
        </p>
      </section>
    </div>
  );
}
