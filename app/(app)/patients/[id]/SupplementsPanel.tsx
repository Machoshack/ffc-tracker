'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { addSupplement, removeEntry, setRefillStatus, updateDose, type P1State } from '@/lib/actions/p1';
import { AutoSync } from '@/components/CatalogEditor';

export type SupplementRow = {
  id: string; item: string; retail_price: number; wholesale_cost: number; given_on: string; given_by_name: string | null;
  size: number | null; unit_form: string | null; packages: number; daily_dose: number | null;
  run_out_date: string | null; refill_status: 'refilled' | 'stopped' | null; counts_toward_p1: boolean;
};
export type SupplementChoice = {
  size_id: string; label: string; retail_price: number | null; size: number | null; unit_form: string | null;
};

const UNIT_FORMS = ['capsules', 'softgels', 'tablets', 'scoops', 'mL', 'drops', 'packets'];
const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
const fmtDose = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));
const usd = (n: number) => {
  const a = Math.abs(n); const cents = Math.round(a * 100) % 100 !== 0;
  return `${n < 0 ? '-' : ''}$${a.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })}`;
};
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const input = 'w-full rounded border border-line bg-white px-2 py-1.5 outline-none focus:border-brand';
const num = (s: string) => Number(s.replace(/[$,\s]/g, ''));

export function SupplementsPanel({ patientId, today, isAdmin, rows, choices, p1, squareConnected }: {
  patientId: string; today: string; isAdmin: boolean; rows: SupplementRow[]; choices: SupplementChoice[];
  p1: { left: number; rate: number } | null; squareConnected: boolean;
}) {
  const current = rows.filter((r) => r.refill_status == null);
  const past = rows.filter((r) => r.refill_status != null);
  return (
    <section className="mb-5 overflow-hidden rounded border border-line bg-white">
      {squareConnected && <AutoSync />}
      <h2 className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-paper px-4 py-2 text-sm font-semibold">
        Supplements
        <span className="text-xs font-normal text-muted">
          {p1 ? 'Protocol I is open: new supplements count against its budget' : 'Tracked for refills; no budget'}
        </span>
      </h2>
      <div className="grid gap-px bg-line md:grid-cols-2">
        <div className="bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">Taking now <span className="font-normal text-muted">({current.length})</span></h3>
          <SupplementList rows={current} patientId={patientId} isAdmin={isAdmin} today={today} empty="Nothing logged." />
          {past.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted hover:text-brand">Earlier and stopped ({past.length})</summary>
              <div className="mt-2"><SupplementList rows={past} patientId={patientId} isAdmin={isAdmin} today={today} empty="" /></div>
            </details>
          )}
        </div>
        <div className="bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold">Log a supplement</h3>
          <SupplementForm patientId={patientId} today={today} choices={choices} p1={p1} />
        </div>
      </div>
    </section>
  );
}

function SupplementList({ rows, patientId, isAdmin, today, empty }: {
  rows: SupplementRow[]; patientId: string; isAdmin: boolean; today: string; empty: string;
}) {
  if (!rows.length) return empty ? <p className="mb-3 text-sm text-muted">{empty}</p> : null;
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
            Given {day(r.given_on)} · {r.given_by_name ?? 'Staff'} · {usd(Number(r.retail_price))} retail
          </div>
          {r.run_out_date && (
            <div className={`text-xs ${out ? 'font-medium text-late' : soon ? 'font-medium text-[#a86f0f]' : 'text-muted'}`}>
              {r.refill_status === 'refilled' ? `Refilled · would have run out ${day(r.run_out_date)}`
                : r.refill_status === 'stopped' ? `Not refilling · ran out ${day(r.run_out_date)}`
                : out ? `Ran out ${day(r.run_out_date)}` : `Runs out ${day(r.run_out_date)}${soon ? ', refill due' : ''}`}
            </div>
          )}
        </div>
        {r.counts_toward_p1 && (
          <div className="text-right">
            <div className="font-medium">{usd(Number(r.wholesale_cost))}</div>
            <div className="text-[11px] text-muted">P1 budget</div>
          </div>
        )}
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

function SupplementForm({ patientId, today, choices, p1 }: {
  patientId: string; today: string; choices: SupplementChoice[]; p1: { left: number; rate: number } | null;
}) {
  const [state, action, pending] = useActionState<P1State, FormData>(addSupplement.bind(null, patientId), {});
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<SupplementChoice | null>(null);
  const [manual, setManual] = useState(choices.length === 0);
  const [item, setItem] = useState('');
  const [size, setSize] = useState('');
  const [unitForm, setUnitForm] = useState('capsules');
  const [packages, setPackages] = useState('1');
  const [dose, setDose] = useState('');
  const [retail, setRetail] = useState('');
  const [wholesale, setWholesale] = useState('');
  const [given, setGiven] = useState(today);

  const reset = () => {
    setPicked(null); setSearch(''); setItem(''); setSize(''); setPackages('1'); setDose(''); setRetail(''); setWholesale(''); setGiven(today);
  };
  useEffect(() => { if (state.ok) reset(); }, [state.ok]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return choices.filter((c) => words.every((w) => c.label.toLowerCase().includes(w))).slice(0, 8);
  }, [search, choices]);

  const pick = (c: SupplementChoice) => {
    setPicked(c); setSearch('');
    setSize(c.size ? String(c.size) : ''); setUnitForm(c.unit_form ?? 'capsules');
    setRetail(c.retail_price != null ? String(c.retail_price) : '');
  };

  const n = Math.max(1, Math.floor(num(packages)) || 1);
  const w = p1 ? (wholesale.trim() ? num(wholesale) : num(retail) * p1.rate) * n : 0;
  const after = p1 ? p1.left - (Number.isFinite(w) ? w : 0) : 0;
  const days = num(size) > 0 && num(dose) > 0 ? Math.floor((num(size) * n) / num(dose)) : null;
  const lbl = 'mb-0.5 block text-xs text-muted';
  const unitsMissing = picked != null && picked.size == null;
  const ready = manual || picked != null;

  return (
    <form action={action} className="space-y-2 rounded bg-paper p-3 text-sm">
      <input type="hidden" name="size_id" value={!manual && picked ? picked.size_id : ''} />

      {manual ? (
        <>
          <input name="item" value={item} onChange={(e) => setItem(e.target.value)} placeholder="Supplement name" required className={input} />
          {choices.length > 0 && (
            <button type="button" className="text-xs text-brand underline" onClick={() => { setManual(false); setItem(''); }}>
              Pick from the Square list instead
            </button>
          )}
        </>
      ) : picked ? (
        <div className="flex items-start gap-2 rounded border border-line bg-white px-2 py-1.5">
          <span className="flex-1 font-medium">{picked.label}</span>
          <button type="button" className="text-xs text-brand underline" onClick={() => setPicked(null)}>Change</button>
        </div>
      ) : (
        <div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search supplements (e.g. vitamin d)"
            className={input} autoComplete="off" />
          {matches.length > 0 && (
            <ul className="mt-1 max-h-64 divide-y divide-line overflow-auto rounded border border-line bg-white">
              {matches.map((c) => (
                <li key={c.size_id}>
                  <button type="button" onClick={() => pick(c)} className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left hover:bg-paper">
                    <span className="flex-1">{c.label}</span>
                    {c.retail_price != null && <span className="text-xs text-muted">{usd(c.retail_price)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {search.trim() && matches.length === 0 && <p className="mt-1 text-xs text-muted">No match in the list.</p>}
          <button type="button" className="mt-1 text-xs text-brand underline" onClick={() => { setManual(true); setItem(search); }}>
            Not in the list? Type it in
          </button>
        </div>
      )}

      {ready && (
        <>
          {unitsMissing && (
            <p className="text-xs text-[#a86f0f]">How many are in a bottle isn’t filled in for this product yet. Enter it once and it’s saved for next time.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label><span className={lbl}>Per bottle</span>
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
          <div className={`grid gap-2 ${p1 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            <label><span className={lbl}>Retail (each)</span>
              <input name="retail_price" value={retail} onChange={(e) => setRetail(e.target.value)} inputMode="decimal"
                placeholder="$" required className={input} /></label>
            {p1 && (
              <label><span className={lbl}>Wholesale each (optional)</span>
                <input name="wholesale_cost" value={wholesale} onChange={(e) => setWholesale(e.target.value)} inputMode="decimal"
                  placeholder={`${Math.round(p1.rate * 100)}% of retail`} className={input} /></label>
            )}
            <label><span className={lbl}>Date given</span>
              <input name="given_on" type="date" value={given} onChange={(e) => setGiven(e.target.value)} max={today} required className={input} /></label>
          </div>
          {days != null && given && (
            <p className="text-muted">Lasts {days} days, runs out {day(addDaysIso(given, days))}.</p>
          )}
          {p1 && num(retail) > 0 && (
            <p className={after < 0 ? 'text-late' : 'text-muted'}>
              Counts {usd(Math.round(w * 100) / 100)}{n > 1 ? ` for ${n} bottles` : ''} against the Protocol I budget.{' '}
              {after < 0 ? `${usd(-after)} over budget.` : `${usd(after)} left after this.`}
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
        </>
      )}
      {state.error && <p className="text-late">{state.error}</p>}
    </form>
  );
}
