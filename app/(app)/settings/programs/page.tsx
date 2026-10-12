import { getCurrentStaff } from '@/lib/supabase/server';
import { ProgramForm, type ProgramSettings } from './ProgramForm';

const ORDER = ['TS', 'FHE', 'P1', 'P2'];

export default async function ProgramSettingsPage() {
  const { supabase } = await getCurrentStaff();
  const { data } = await supabase
    .from('program')
    .select('code, name, price, consult_cost, test_budget, supplement_budget, wholesale_rate, upgrade_to_code, upgrade_window_days');
  const programs = ((data ?? []) as ProgramSettings[]).sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Price is what new patients are charged by default. Budgets and costs feed the P1 margin screen and the
        over-budget warnings. Changes apply right away; amounts already paid don’t change.
      </p>
      {programs.map((p) => <ProgramForm key={p.code} program={p} />)}
    </div>
  );
}
