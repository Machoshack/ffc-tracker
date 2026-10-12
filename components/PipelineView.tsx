import Link from 'next/link';
import { PROGRAM_LABEL, PROGRAM_ORDER, stagesFor, type ActiveEnrollment, type StageRow } from '@/lib/board';
import { weekdayDate } from '@/lib/dates';

export function PipelineView({ active, stages, program, today, linkBase = '/pipeline' }: {
  active: ActiveEnrollment[];
  stages: StageRow[];
  program: string;
  today: string;
  linkBase?: string;
}) {
  const columns = stagesFor(stages, program);
  const inProgram = active.filter((e) => e.program_code === program);
  const counts = Object.fromEntries(PROGRAM_ORDER.map((c) => [c, active.filter((e) => e.program_code === c).length]));

  return (
    <div>
      <nav className="mb-4 flex flex-wrap gap-1 text-sm">
        {PROGRAM_ORDER.map((c) => (
          <Link key={c} href={`${linkBase}?program=${c}`}
            className={`rounded border px-3 py-1 ${program === c ? 'border-brand bg-brand text-white' : 'border-line bg-white hover:border-brand'}`}>
            {PROGRAM_LABEL[c]} <span className={program === c ? 'opacity-80' : 'text-muted'}>{counts[c]}</span>
          </Link>
        ))}
      </nav>

      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map((stage) => {
          const cards = inProgram
            .filter((e) => e.current_stage === stage)
            .sort((a, b) => b.overdue_steps - a.overdue_steps || (b.days_in_stage ?? 0) - (a.days_in_stage ?? 0));
          return (
            <section key={stage} className="flex w-64 shrink-0 flex-col rounded border border-line bg-paper">
              <h2 className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2 text-sm font-semibold">
                <span className="min-w-0">{stage}</span>
                <span className="shrink-0 font-normal text-muted">{cards.length}</span>
              </h2>
              <ul className="flex-1 space-y-2 p-2">
                {cards.length === 0 && <li className="px-1 py-2 text-xs text-muted">No patients here.</li>}
                {cards.map((e) => (
                  <li key={e.enrollment_id}>
                    <Link href={`/patients/${e.patient_id}`}
                      className={`block rounded border bg-white px-3 py-2 text-sm hover:border-brand ${e.overdue_steps > 0 ? 'border-late/50' : 'border-line'}`}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono font-semibold">{e.patient_code}</span>
                        <span className="text-xs text-muted">{e.days_in_stage ?? 0}d here</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
                        {e.overdue_steps > 0 && (
                          <span className="rounded bg-late px-1.5 font-medium text-white">{e.overdue_steps} late</span>
                        )}
                        {e.status === 'paused' && <span className="rounded bg-paper px-1.5 text-muted">Paused</span>}
                        {e.next_due && (
                          <span className={e.next_due < today ? 'text-late' : 'text-muted'}>
                            {e.next_due < today ? 'Was due' : 'Next due'} {weekdayDate(e.next_due)}
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="text-xs text-muted">
        Each card sits in the patient’s current stage: the earliest stage that still has unfinished steps. Patients with
        late steps are listed first.
      </p>
    </div>
  );
}
