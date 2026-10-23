'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setProductHidden, setSizeUnits, syncFromSquare, syncIfStale, type CatalogState } from '@/lib/actions/catalog';
import { UNIT_FORMS } from '@/lib/square';

export type CatalogSizeRow = {
  id: string; name: string; retail_price: number | null; size: number | null; unit_form: string | null; in_square: boolean; sort: number;
};
export type CatalogProduct = { id: string; name: string; hidden: boolean; in_square: boolean; sizes: CatalogSizeRow[] };

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

// Quietly refreshes the list from Square when it's more than 12 hours old.
export function AutoSync() {
  const router = useRouter();
  useEffect(() => {
    let live = true;
    syncIfStale().then((r) => { if (live && r.ok) router.refresh(); }).catch(() => {});
    return () => { live = false; };
  }, [router]);
  return null;
}

export function SyncButton({ disabled }: { disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<CatalogState>({});
  return (
    <>
      <button type="button" disabled={disabled || pending}
        onClick={() => start(async () => setState(await syncFromSquare()))}
        className="rounded bg-brand px-3 py-1.5 font-medium text-white disabled:opacity-50">
        {pending ? 'Updating...' : 'Update from Square now'}
      </button>
      {state.message && <span className="text-done">{state.message}</span>}
      {state.error && <span className="text-late">{state.error}</span>}
    </>
  );
}

export function CatalogEditor({ list }: { list: CatalogProduct[] }) {
  const [q, setQ] = useState('');
  const [view, setView] = useState<'shown' | 'missing' | 'hidden' | 'gone'>('shown');
  const groups = useMemo(() => ({
    shown: list.filter((p) => p.in_square && !p.hidden),
    missing: list.filter((p) => p.in_square && !p.hidden && p.sizes.some((s) => s.in_square && s.size == null)),
    hidden: list.filter((p) => p.in_square && p.hidden),
    gone: list.filter((p) => !p.in_square),
  }), [list]);
  const rows = groups[view].filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  const tabs: [typeof view, string][] = [
    ['shown', `In the pick list (${groups.shown.length})`],
    ['missing', `Missing units per bottle (${groups.missing.length})`],
    ['hidden', `Hidden (${groups.hidden.length})`],
    ['gone', `No longer in Square (${groups.gone.length})`],
  ];

  if (!list.length) {
    return <p className="rounded border border-dashed border-line px-4 py-6 text-center text-sm text-muted">No products yet. They appear after the first update from Square.</p>;
  }
  return (
    <section className="overflow-hidden rounded border border-line bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paper px-3 py-2 text-sm">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setView(k)}
            className={`rounded border px-2.5 py-1 ${view === k ? 'border-brand bg-brand text-white' : 'border-line bg-white hover:border-brand'}`}>
            {label}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products"
          className="ml-auto w-full rounded border border-line bg-white px-2 py-1 outline-none focus:border-brand sm:w-56" />
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">Nothing here.</p>
      ) : (
        <ul className="divide-y divide-line">{rows.map((p) => <ProductRow key={p.id} p={p} />)}</ul>
      )}
    </section>
  );
}

function ProductRow({ p }: { p: CatalogProduct }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sizes = p.sizes.filter((s) => s.in_square || !p.in_square);
  return (
    <li className={`px-4 py-3 text-sm ${pending ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 font-medium">{p.name}</span>
        {p.in_square && (
          <button type="button" disabled={pending}
            onClick={() => start(async () => { const r = await setProductHidden(p.id, !p.hidden); setError(r.error ?? null); })}
            className="rounded border border-line bg-white px-2.5 py-1 text-xs hover:border-brand">
            {p.hidden ? 'Show in pick list' : 'Hide'}
          </button>
        )}
      </div>
      <ul className="mt-1.5 space-y-1">
        {sizes.map((s) => <SizeRow key={s.id} s={s} />)}
      </ul>
      {error && <p className="mt-1 text-xs text-late">{error}</p>}
    </li>
  );
}

export function SizeRow({ s }: { s: CatalogSizeRow }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [size, setSize] = useState(s.size ? String(s.size) : '');
  const [form, setForm] = useState(s.unit_form ?? 'capsules');
  const [error, setError] = useState<string | null>(null);
  const missing = s.size == null;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="min-w-24">{s.name}</span>
      <span className="text-muted">{s.retail_price != null ? usd(s.retail_price) : 'No set price'}</span>
      {editing ? (
        <span className="flex items-center gap-1.5">
          <input value={size} onChange={(e) => setSize(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="90"
            className="w-16 rounded border border-line px-1.5 py-0.5" />
          <select value={form} onChange={(e) => setForm(e.target.value)} className="rounded border border-line px-1 py-0.5">
            {UNIT_FORMS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <button type="button" disabled={pending} className="rounded bg-brand px-2 py-0.5 font-medium text-white"
            onClick={() => start(async () => {
              const r = await setSizeUnits(s.id, Number(size), form); setError(r.error ?? null); if (!r.error) setEditing(false);
            })}>Save</button>
          <button type="button" className="text-muted underline" onClick={() => setEditing(false)}>Cancel</button>
        </span>
      ) : (
        <button type="button" onClick={() => setEditing(true)}
          className={missing ? 'font-medium text-[#a86f0f] underline' : 'text-muted underline hover:text-brand'}>
          {missing ? 'Add units per bottle' : `${s.size} ${s.unit_form} per bottle`}
        </button>
      )}
      {error && <span className="text-late">{error}</span>}
    </li>
  );
}
