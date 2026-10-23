'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { addTestCost, removeEntry, type P1State } from '@/lib/actions/p1';

export type TestRow = { id: string; test_name: string; cost: number; logged_on: string };
export type MarginRow = {
  fee: number; consult_cost: number; staff_time_cost: number; test_costs: number; supplement_cost: number; margin: number;
  test_budget: number | null;
};

const usd = (n: number) => {
  const a = Math.abs(n); const cents = Math.round(a * 100) % 100 !== 0;
  return `${n < 0 ? '-' : ''}$${a.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })}`;
};
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const input = 'w-full rounded border border-line bg-white px-2 py-1.5 outline-none focus:border-brand';
const num = (s: string) => Number(s.replace(/[$,\s]/g, ''));

export function P1Panel({ enrollmentId, patientId, today, isAdmin, budget, tests, margin }: {
  enrollmentId: string; patientId: string; today: string; isAdmin: boolean;
  budget: number; tests: TestRow[]; margin: MarginRow;
}) {
  const used = Number(margin.supplement_cost);
  const testBudget = Number(margin.test_budget ?? 0);
  const testUsed = Number(margin.test_costs);
  const fixed = Number(margin.consult_cost) + Number(margin.staff_time_cost);

  return (
    <section className="mb-5 overflow-hidden rounded border border-line bg-white">
      <h2 className="border-b border-line bg-paper px-4 py-2 text-sm font-semibold">Protocol I costs</h2>

      <div className="grid gap-px bg-line text-sm sm:grid-cols-3">
        <BudgetCell label="Supplements (wholesale, logged below)" used={used} budget={budget} />
        <BudgetCell label="Testing" used={testUsed} budget={testBudget} />
        <div className="bg-white px-4 py-3">
          <div className="text-xs text-muted">Margin</div>
          <div className={`font-medium ${Number(margin.margin) < 0 ? 'text-late' : ''}`}>{usd(Number(margin.margin))}</div>
          <div className="text-xs text-muted">
            {usd(Number(margin.fee))} fee - {usd(fixed)} consults and staff - tests - supplements
          </div>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="bg-white p-4 md:max-w-md">
          <h3 className="mb-2 text-sm font-semibold">Functional tests</h3>
          <EntryList
            empty="None logged yet."
            rows={tests.map((t) => ({ id: t.id, main: t.test_name, sub: day(t.logged_on), amount: usd(Number(t.cost)) }))}
            table="test_cost_log" patientId={patientId} isAdmin={isAdmin}
          />
          <TestForm enrollmentId={enrollmentId} patientId={patientId} today={today} />
        </div>
      </div>
    </section>
  );
}

function BudgetCell({ label, used, budget }: { label: string; used: number; budget: number }) {
  const left = budget - used;
  const pct = budget > 0 ? Math.min(100, Math.max(0, (used / budget) * 100)) : 0;
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`font-medium ${left < 0 ? 'text-late' : ''}`}>
        {usd(used)} of {usd(budget)} · {left < 0 ? `${usd(-left)} over` : `${usd(left)} left`}
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded bg-paper">
        <div className={`h-full ${left < 0 ? 'bg-late' : pct > 80 ? 'bg-[#c98a1b]' : 'bg-done'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function EntryList({ rows, empty, table, patientId, isAdmin }: {
  rows: { id: string; main: string; sub: string; amount: string }[];
  empty: string; table: 'supplement_log' | 'test_cost_log'; patientId: string; isAdmin: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!rows.length) return <p className="mb-3 text-sm text-muted">{empty}</p>;
  return (
    <>
      <ul className="mb-3 divide-y divide-line rounded border border-line text-sm">
        {rows.map((r) => (
          <li key={r.id} className={`flex items-start gap-2 px-3 py-2 ${pending ? 'opacity-60' : ''}`}>
            <div className="min-w-0 flex-1">
              <div>{r.main}</div>
              <div className="text-xs text-muted">{r.sub}</div>
            </div>
            <div className="font-medium">{r.amount}</div>
            {isAdmin && (
              <button type="button" title="Remove (admin)" className="text-xs text-muted hover:text-late"
                onClick={() => {
                  if (!confirm(`Remove "${r.main}"? This is recorded in the audit log.`)) return;
                  start(async () => { const res = await removeEntry(table, r.id, patientId); setError(res.error ?? null); });
                }}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mb-2 text-xs text-late">{error}</p>}
    </>
  );
}

function TestForm({ enrollmentId, patientId, today }: { enrollmentId: string; patientId: string; today: string }) {
  const [state, action, pending] = useActionState<P1State, FormData>(addTestCost.bind(null, enrollmentId, patientId), {});
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  useEffect(() => { if (state.ok) { setName(''); setCost(''); } }, [state.ok]);
  return (
    <form action={action} className="space-y-2 rounded bg-paper p-3 text-sm">
      <input name="test_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Test (e.g. GI-MAP)" required className={input} />
      <div className="grid grid-cols-2 gap-2">
        <label><span className="mb-0.5 block text-xs text-muted">Cost to practice</span>
          <input name="cost" value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="$" required className={input} /></label>
        <label><span className="mb-0.5 block text-xs text-muted">Date</span>
          <input name="logged_on" type="date" defaultValue={today} required className={input} /></label>
      </div>
      {state.needsApproval ? (
        <div className="rounded border border-late/30 bg-white p-2">
          <p className="mb-2 text-late">This puts the patient {usd(state.needsApproval.overBy)} over the testing budget.</p>
          <button name="approve_over" value="1" disabled={pending}
            className="rounded bg-late px-3 py-1.5 font-medium text-white disabled:opacity-60">Save anyway</button>
        </div>
      ) : (
        <button disabled={pending} className="rounded bg-brand px-3 py-1.5 font-medium text-white disabled:opacity-60">
          {pending ? 'Saving...' : 'Log test cost'}
        </button>
      )}
      {state.error && <p className="text-late">{state.error}</p>}
    </form>
  );
}
