import Link from 'next/link';
import { getCurrentStaff } from '@/lib/supabase/server';
import { StepEditor, NewStepForm, StageName, type StepTemplate, type Stage } from './StepEditor';

const ORDER = [
  { code: 'TS', label: 'Two-Step' },
  { code: 'FHE', label: 'FHE' },
  { code: 'P1', label: 'Protocol I' },
  { code: 'P2', label: 'Protocol II' },
  { code: 'LAB', label: 'Labs' },
  { code: 'FT', label: 'Tests' },
];

export default async function StepSettingsPage({ searchParams }: { searchParams: Promise<{ program?: string }> }) {
  const { program: code = 'TS' } = await searchParams;
  const { supabase } = await getCurrentStaff();

  const { data: program } = await supabase.from('program').select('id, code, name').eq('code', code).maybeSingle();
  const { data: stageRows } = program
    ? await supabase.from('program_stage').select('id, name, sort').eq('program_id', program.id).order('sort')
    : { data: [] };
  const { data: stepRows } = program
    ? await supabase.from('step_template')
        .select('id, key, name, owner_role, offset_days, sort, stage_id, blocked_by_keys, block_enabled')
        .eq('program_id', program.id)
    : { data: [] };

  const stages = (stageRows ?? []) as Stage[];
  const stageSort = new Map(stages.map((s) => [s.id, s.sort]));
  const steps = ((stepRows ?? []) as StepTemplate[]).sort(
    (a, b) => (stageSort.get(a.stage_id)! - stageSort.get(b.stage_id)!) || a.offset_days - b.offset_days || a.sort - b.sort,
  );

  // Which steps patients already have (those can be renamed or retimed, not removed).
  const { data: used } = steps.length
    ? await supabase.from('step').select('template_id').in('template_id', steps.map((s) => s.id))
    : { data: [] };
  const inUse = new Set((used ?? []).map((u) => u.template_id));

  return (
    <div>
      <nav className="mb-4 flex flex-wrap gap-1 text-sm">
        {ORDER.map((p) => (
          <Link key={p.code} href={`/settings/steps?program=${p.code}`}
            className={`rounded border px-3 py-1 ${code === p.code ? 'border-brand bg-brand text-white' : 'border-line bg-white hover:border-brand'}`}>
            {p.label}
          </Link>
        ))}
      </nav>

      <p className="mb-4 text-sm text-muted">
        Step names, stages and waiting rules update for everyone right away. Timing, who does it, and new steps apply to
        patients enrolled from now on; patients already in {program?.name ?? 'this program'} keep their dates. Days count
        from the first visit and move to the nearest Mon, Wed or Fri.
        {(code === 'FHE' || code === 'P2') && ' Protocol II has its own copy of the FHE steps, so change both if needed.'}
      </p>

      {stages.map((stage) => {
        const inStage = steps.filter((s) => s.stage_id === stage.id);
        return (
          <section key={stage.id} className="mb-4 overflow-hidden rounded border border-line bg-white">
            <h2 className="border-b border-line bg-paper px-4 py-2 text-sm font-semibold"><StageName stage={stage} /></h2>
            {inStage.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted">No steps.</p>
            ) : (
              <ul className="divide-y divide-line">
                {inStage.map((s) => (
                  <StepEditor key={s.id} step={s} programCode={code} stages={stages}
                    allSteps={steps} inUse={inUse.has(s.id)} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {program && (
        <section className="rounded border border-line bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold">Add a step to {program.name}</h2>
          <NewStepForm programCode={code} stages={stages} allSteps={steps} />
        </section>
      )}
    </div>
  );
}
