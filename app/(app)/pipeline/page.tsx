import { getCurrentStaff } from '@/lib/supabase/server';
import { loadBoardData } from '@/lib/boardData';
import { PipelineView } from '@/components/PipelineView';
import { PROGRAM_ORDER } from '@/lib/board';

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ program?: string }> }) {
  const { program } = await searchParams;
  const code = PROGRAM_ORDER.includes(program as (typeof PROGRAM_ORDER)[number]) ? program! : 'TS';
  const { supabase } = await getCurrentStaff();
  const d = await loadBoardData(supabase);
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Pipeline</h1>
      {d.error && <p className="mb-4 rounded border border-late bg-white p-3 text-late">Could not load: {d.error}</p>}
      <PipelineView active={d.active} stages={d.stages} program={code} today={d.today} />
    </div>
  );
}
