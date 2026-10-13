'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { addSupplement, addTestCost, removeEntry, setRefillStatus, updateDose, type P1State } from '@/lib/actions/p1';

export type SupplementRow = {
  id: string; item: string; retail_price: number; wholesale_cost: number; given_on: string; given_by_name: string | null;
  size: number | null; unit_form: string | null; packages: number; daily_dose: number | null;
  run_out_date: string | null; refill_status: 'refilled' | 'stopped' | null;
};

const UNIT_FORMS = ['capsules', 'softgels', 'tablets', 'scoops', 'mL', 'drops', 'packets'];
const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
const fmtDose = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));
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

export function P1Panel({ enrollmentId, patientId, today, isAdmin, budget, rate, supplements, tests, margin }: {
  enrollmentId: string; patientId: string; today: string; isAdmin: boolean;
  budget: number; rate: number; supplements: SupplementRow[]; tests: TestRow[]; margin: MarginRow;
}) {
  const used = supplements.reduce((n, s) => n + Number(s.wholesale_cost), 0);
  const left = budget - used;
  const testBudget = Number(margin.test_budget ?? 0);
  const testUsed = Number(margin.test_costs);
  const fixed = Number(margin.consult_cost) + Number(margin.staff_time_cost);

  return (
    <section className="mb-5 overflow-hidden rounded border border-line bg-white">
      <h2 className="border-b border-line bg-paper px-4 py-2 text-sm font-semibold">Protocol I costs</h2>

      <div className="grid gap-px bg-line text-sm sm:grid-cols-3">
        <BudgetCell label="Supplements (wholesale)" used={used} budget={budget} />
        <BudgetCell label="Testing" used={testUsed} budget={testBudget} />
        <div className="bg-white px-4 py-3">
          <div className="text-xs text-muted">Margin</div>
          <div className={`font-medium ${Number(margin.margin) < 0 ? 'text-late' : ''}`}>{usd(Number(margin.margin))}</div>
          <div className="text-xs text-muted">
            {usd(Number(margin.fee))} fee - {usd(fixed)} consults and staff - tests - supplements
          </div>
        </div>
      </div>

      <div className="grid gap-px border-t border-line bg-line md:grid-cols-2">
        <div className="bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">Supplements given</h3>
          <SupplementList rows={supplements} patientId={patientId} isAdmin={isAdmin} today={today} />
          <SupplementForm enrollmentId={enrollmentId} patientId={patientId} today={today} rate={rate} left={left} />
        </div>
        <div className="bg-white p-4">
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

function SupplementList({ rows, patientId, isAdmin, today }: {
  rows: SupplementRow[]; patientId: string; isAdmin: boolean; today: string;
}) {
  if (!rows.length) return <p className="mb-3 text-sm text-muted">None logged yet.</p>;
  return (
    <ul className="mb-3 divide-y divide-line rounded border border-line text-sm">
      {rows.map((r) => <SupplementItem key={r.id} r={r} patientId={patientId} isAdmin={isAdmin} today={today} />)}
    </ul>
  );
}

function SupplementItem({ r, patientId, isAdmin, today }: { r: SupplementRow; patientId: string; isAdmin: boolean; today: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dose, setDose] = useState(r.daily_dose != null ? fmtDose(Number(r.daily_dose)) : '');
  const run = (fn: () => Promise<P1State>, after?: () => void) =>
    start(async () => { const res = await fn(); setError(res.error ?? null); if (!res.error) after?.(); });

  const open = r.refill_status == null;
  const soon = open && r.run_out_date != null && r.run_out_date <= addDaysIso(today, 14);
  const out = open && r.run_out_date != null && r.run_out_date < today;
  const btn = 'text-xs text-muted underline hover:text-brand';

  return (
    <li className={`px-3 py-2 ${pending ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{r.item}</div>
          {r.size != null && (
            <div className="text-xs text-ink">
              {r.size} {r.unit_form}{r.packages > 1 ? ` × ${r.packages}` : ''}
              {r.daily_dose != null && <> · {fmtDose(Number(r.daily_dose))} {r.unit_form === 'mL' ? 'mL' : ''} a day</>}
            </div>
          )}
          <div className="text-xs text-muted">
            Given {day(r.given_on)} · {r.given_by_name ?? 'Staff'} · retail {usd(Number(r.retail_price))}
          </div>
          {r.run_out_date && (
            <div className={`text-xs ${out ? 'font-medium text-late' : soon ? 'font-medium text-[#a86f0f]' : 'text-muted'}`}>
              {r.refill_status === 'refilled' ? `Refilled · would have run out ${day(r.run_out_date)}`
                : r.refill_status === 'stopped' ? `Not refilling · ran out ${day(r.run_out_date)}`
                : out ? `Ran out ${day(r.run_out_date)}` : `Runs out ${day(r.run_out_date)}${soon ? ', refill due' : ''}`}
            </div>
          )}
        </div>
        <div className="font-medium">{usd(Number(r.wholesale_cost))}</div>
      </div>

      {editing ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input value={dose} onChange={(e) => setDose(e.target.value)} inputMode="decimal"
            className="w-20 rounded border border-line px-2 py-1 text-xs" />
          <span className="text-xs text-muted">{r.unit_form} a day</span>
          <button className="rounded bg-brand px-2 py-1 text-xs font-medium text-white" disabled={pending}
            onClick={() => run(() => updateDose(r.id, patientId, Number(dose)), () => setEditing(false))}>Save</button>
          <button className={btn} onClick={() => setEditing(false)}>Cancel</button>
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap gap-3">
          {r.size != null && open && <button className={btn} onClick={() => setEditing(true)}>Change dose</button>}
          {r.run_out_date && open && (
            <button className={btn} onClick={() => run(() => setRefillStatus(r.id, patientId, 'stopped'))}>Not refilling</button>
          )}
          {r.refill_status === 'stopped' && (
            <button className={btn} onClick={() => run(() => setRefillStatus(r.id, patientId, null))}>Undo</button>
          )}
          {isAdmin && (
            <button className="text-xs text-muted hover:text-late" title="Remove (admin)"
              onClick={() => {
                if (!confirm(`Remove "${r.item}"? This is recorded in the audit log.`)) return;
                run(() => removeEntry('supplement_log', r.id, patientId));
              }}>Remove</button>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-late">{error}</p>}
    </li>
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

function SupplementForm({ enrollmentId, patientId, today, rate, left }: {
  enrollmentId: string; patientId: string; today: string; rate: number; left: number;
}) {
  const [state, action, pending] = useActionState<P1State, FormData>(addSupplement.bind(null, enrollmentId, patientId), {});
  const [item, setItem] = useState('');
  const [size, setSize] = useState('');
  const [unitForm, setUnitForm] = useState('capsules');
  const [packages, setPackages] = useState('1');
  const [dose, setDose] = useState('');
  const [retail, setRetail] = useState('');
  const [wholesale, setWholesale] = useState('');
  const [given, setGiven] = useState(today);

  useEffect(() => {
    if (state.ok) { setItem(''); setSize(''); setPackages('1'); setDose(''); setRetail(''); setWholesale(''); setGiven(today); }
  }, [state.ok, today]);

  const n = Math.max(1, Math.floor(num(packages)) || 1);
  const r = num(retail) * n;
  const w = (wholesale.trim() ? num(wholesale) : num(retail) * rate) * n;
  const after = left - (Number.isFinite(w) ? w : 0);
  const showPreview = num(retail) > 0;
  const days = num(size) > 0 && num(dose) > 0 ? Math.floor((num(size) * n) / num(dose)) : null;
  const lbl = 'mb-0.5 block text-xs text-muted';

  return (
    <form action={action} className="space-y-2 rounded bg-paper p-3 text-sm">
      <input name="item" value={item} onChange={(e) => setItem(e.target.value)} placeholder="Supplement (e.g. Omega Plus)" required className={input} />
      <div className="grid grid-cols-2 gap-2">
        <label><span className={lbl}>Size</span>
          <input name="size" value={size} onChange={(e) => setSize(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
            placeholder="90" required className={input} /></label>
        <label><span className={lbl}>Form</span>
          <select name="unit_form" value={unitForm} onChange={(e) => setUnitForm(e.target.value)} className={input}>
            {UNIT_FORMS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select></label>
        <label><span className={lbl}>Bottles</span>
          <input name="packages" value={packages} onChange={(e) => setPackages(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
            required className={input} /></label>
        <label><span className={lbl}>{unitForm} a day</span>
          <input name="daily_dose" value={dose} onChange={(e) => setDose(e.target.value)} inputMode="decimal"
            placeholder="2" required className={input} /></label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <label><span className="mb-0.5 block text-xs text-muted">Retail (each)</span>
          <input name="retail_price" value={retail} onChange={(e) => setRetail(e.target.value)} inputMode="decimal"
            placeholder="$" required className={input} /></label>
        <label><span className="mb-0.5 block text-xs text-muted">Wholesale each (optional)</span>
          <input name="wholesale_cost" value={wholesale} onChange={(e) => setWholesale(e.target.value)} inputMode="decimal"
            placeholder={`${Math.round(rate * 100)}% of retail`} className={input} /></label>
        <label><span className="mb-0.5 block text-xs text-muted">Date given</span>
          <input name="given_on" type="date" value={given} onChange={(e) => setGiven(e.target.value)} max={today} required className={input} /></label>
      </div>
      {days != null && given && (
        <p className="text-muted">Lasts {days} days, runs out {day(addDaysIso(given, days))}.</p>
      )}
      {showPreview && (
        <p className={after < 0 ? 'text-late' : 'text-muted'}>
          Counts {usd(Math.round(w * 100) / 100)}{n > 1 ? ` for ${n} bottles` : ''} against the budget. {after < 0 ? `${usd(-after)} over budget.` : `${usd(after)} left after this.`}
        </p>
      )}
      {state.needsApproval ? (
        <div className="rounded border border-late/30 bg-white p-2">
          <p className="mb-2 text-late">This puts the patient {usd(state.needsApproval.overBy)} over the supplement budget.</p>
          <button name="approve_over" value="1" disabled={pending}
            className="rounded bg-late px-3 py-1.5 font-medium text-white disabled:opacity-60">Save anyway</button>
        </div>
      ) : (
        <button disabled={pending} className="rounded bg-brand px-3 py-1.5 font-medium text-white disabled:opacity-60">
          {pending ? 'Saving...' : 'Log supplement'}
        </button>
      )}
      {state.error && <p className="text-late">{state.error}</p>}
    </form>
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
