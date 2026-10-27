import { notFound } from 'next/navigation';
import { getCurrentStaff } from '@/lib/supabase/server';
import { BUILT_IN_TOOLS, RESOURCE_PROGRAMS } from '@/lib/resources';
import { type ProgramLink } from './ResourceEditors';
import { ProgramResourcesView, type Stage, type StepRow } from './ProgramResourcesView';


export default async function ProgramResourcesPage({ params }: { params: Promise<{ program: string }> }) {
  const { program: code } = await params;
  if (!RESOURCE_PROGRAMS.some((p) => p.code === code)) notFound();
  const { supabase, staff } = await getCurrentStaff();
  const isAdmin = staff?.role === 'admin';

  const { data: program } = await supabase.from('program').select('id, name').eq('code', code).maybeSingle();
  if (!program) notFound();

  const [{ data: guide }, { data: links }, { data: stages }, { data: steps }] = await Promise.all([
    supabase.from('program_guide').select('body, updated_at, staff_user:updated_by(name)').eq('program_id', program.id).maybeSingle(),
    supabase.from('program_link').select('id, label, url, note').eq('program_id', program.id).order('sort').order('created_at'),
    supabase.from('program_stage').select('id, name, sort').eq('program_id', program.id).order('sort'),
    supabase.from('step_template').select('name, owner_role, offset_days, sort, optional, stage_id').eq('program_id', program.id),
  ]);

  const tools = BUILT_IN_TOOLS[code] ?? [];
  const updatedBy = (guide?.staff_user as unknown as { name: string } | null)?.name ?? null;
  const updatedOn = guide?.updated_at
    ? new Date(guide.updated_at).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <ProgramResourcesView code={code} programName={program.name} isAdmin={isAdmin} tools={tools}
      links={(links ?? []) as ProgramLink[]} body={guide?.body ?? ''}
      updated={updatedOn ? `Last updated ${updatedOn}${updatedBy ? ` by ${updatedBy}` : ''}` : null}
      stages={(stages ?? []) as Stage[]} steps={(steps ?? []) as StepRow[]} />
  );
}

