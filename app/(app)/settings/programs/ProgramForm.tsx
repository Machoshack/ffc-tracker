'use client';

import { useActionState } from 'react';
import { updateProgram, type SettingsState } from '@/lib/actions/settings';

export type ProgramSettings = {
  code: string; name: string; price: number; consult_cost: number; test_budget: number | null;
  supplement_budget: number | null; wholesale_rate: number; upgrade_to_code: string | null; upgrade_window_days: number | null;
};

const input = 'w-full rounded border border-line bg-white px-2 py-1.5 outline-none focus:border-brand';

function Field({ label, name, value, hint, prefix }: { label: string; name: string; value: string | number | null; hint?: string; prefix?: string }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-muted">{prefix}</span>}
        <input name={name} defaultValue={value ?? ''} inputMode="decimal" className={input} />
      </div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function ProgramForm({ program: p }: { program: ProgramSettings }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateProgram.bind(null, p.code), {});
  const isP1 = p.code === 'P1';

  return (
    <form action={action} className="rounded border border-line bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded bg-paper px-2 py-0.5 font-mono text-xs">{p.code}</span>
        <input name="name" defaultValue={p.name} className="flex-1 rounded border border-transparent px-1 py-0.5 font-semibold hover:border-line focus:border-brand focus:outline-none" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Price" name="price" value={Number(p.price)} prefix="$" />
        {isP1 && (
          <>
            <Field label="Consults and staff" name="consult_cost" value={Number(p.consult_cost)} prefix="$" hint="Fixed cost per patient" />
            <Field label="Testing budget" name="test_budget" value={p.test_budget == null ? null : Number(p.test_budget)} prefix="$" />
            <Field label="Supplement budget (wholesale)" name="supplement_budget" value={p.supplement_budget == null ? null : Number(p.supplement_budget)} prefix="$" />
            <Field label="Wholesale as % of retail" name="wholesale_rate" value={Math.round(Number(p.wholesale_rate) * 100)} hint="Used when wholesale isn't entered" />
          </>
        )}
        {p.upgrade_to_code && (
          <Field label={`Days to upgrade to ${p.upgrade_to_code}`} name="upgrade_window_days" value={p.upgrade_window_days}
            hint="After this program finishes" />
        )}
      </div>
      <div className="mt-3 flex items-center gap-3 text-sm">
        <button disabled={pending} className="rounded bg-brand px-4 py-1.5 font-medium text-white disabled:opacity-60">
          {pending ? 'Saving...' : 'Save'}
        </button>
        {state.message && <span className="text-done">{state.message}</span>}
        {state.error && <span className="text-late">{state.error}</span>}
      </div>
    </form>
  );
}
