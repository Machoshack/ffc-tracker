import Link from 'next/link';
import { GuideSection, LinksSection, type ProgramLink } from './ResourceEditors';

export type StepRow = { name: string; owner_role: string; offset_days: number; sort: number; optional: boolean | null; stage_id: string };
export type Stage = { id: string; name: string; sort: number };

// The page itself, from plain data (so it can be previewed with test data).
export function ProgramResourcesView({ code, programName, isAdmin, tools, links, body, updated, stages, steps }: {
  code: string; programName: string; isAdmin: boolean; tools: { href: string; label: string; note: string }[];
  links: ProgramLink[]; body: string; updated: string | null; stages: Stage[]; steps: StepRow[];
}) {
  const stageSort = new Map(stages.map((s) => [s.id, s.sort]));
  const schedule = [...steps].sort(
    (a, b) => (stageSort.get(a.stage_id)! - stageSort.get(b.stage_id)!) || a.offset_days - b.offset_days || a.sort - b.sort,
  );
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem] lg:grid-rows-[auto_1fr]">
      <div className="order-2 min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        <GuideSection code={code} programName={programName} body={body} isAdmin={isAdmin} updated={updated} />
      </div>

      <section className="order-1 self-start overflow-hidden rounded border border-line bg-white lg:col-start-2 lg:row-start-1">
          <h2 className="border-b border-line bg-paper px-4 py-2 text-sm font-semibold">Tools and forms</h2>
          {tools.length > 0 && (
            <ul className="divide-y divide-line">
              {tools.map((t) => (
                <li key={t.href} className="px-4 py-3 text-sm">
                  <Link href={t.href} className="font-medium text-brand hover:underline">{t.label} →</Link>
                  <p className="mt-0.5 text-xs text-muted">{t.note}</p>
                </li>
              ))}
            </ul>
          )}
          <LinksSection code={code} links={links} isAdmin={isAdmin} hasTools={tools.length > 0} />
      </section>

      <section className="order-3 self-start overflow-hidden rounded border border-line bg-white lg:col-start-2 lg:row-start-2">
          <h2 className="flex items-baseline justify-between border-b border-line bg-paper px-4 py-2 text-sm font-semibold">
            Schedule
            {isAdmin && <Link href={`/settings/steps?program=${code}`} className="text-xs font-normal text-brand underline">Change in Settings</Link>}
          </h2>
          {stages.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">No steps set up.</p>
          ) : (
            <div className="divide-y divide-line text-sm">
              {stages.map((st) => {
                const inStage = schedule.filter((s) => s.stage_id === st.id);
                if (!inStage.length) return null;
                return (
                  <div key={st.id} className="px-4 py-2.5">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{st.name}</div>
                    <ul className="space-y-1">
                      {inStage.map((s, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="w-14 shrink-0 text-xs leading-5 text-muted">Day {s.offset_days}</span>
                          <span className="min-w-0 flex-1">
                            {s.name}
                            <span className="text-xs text-muted"> · {s.owner_role === 'physician' ? 'Physician' : s.owner_role === 'admin' ? 'Admin' : 'Staff'}{s.optional ? ' · optional' : ''}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              <p className="px-4 py-2 text-xs text-muted">Days count from the first visit and move to the nearest Mon, Wed or Fri.</p>
            </div>
          )}
      </section>
    </div>
  );
}
