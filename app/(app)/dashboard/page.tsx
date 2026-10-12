import { getCurrentStaff } from '@/lib/supabase/server';
import { loadBoardData } from '@/lib/boardData';
import { DashboardView } from '@/components/DashboardView';

export default async function DashboardPage() {
  const { supabase } = await getCurrentStaff();
  const d = await loadBoardData(supabase);
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Dashboard</h1>
      {d.error && <p className="mb-4 rounded border border-late bg-white p-3 text-late">Could not load: {d.error}</p>}
      <DashboardView active={d.active} stages={d.stages} overdue={d.overdue} history={d.history}
        today={d.today} overBudget={d.overBudget} />
    </div>
  );
}
