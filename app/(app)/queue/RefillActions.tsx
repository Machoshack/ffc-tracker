'use client';

import { useState, useTransition } from 'react';
import { setRefillStatus } from '@/lib/actions/p1';

export function NotRefilling({ id, patientId }: { id: string; patientId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="shrink-0 text-right">
      <button type="button" disabled={pending}
        onClick={() => start(async () => { const r = await setRefillStatus(id, patientId, 'stopped'); setError(r.error ?? null); })}
        className="rounded border border-line bg-white px-3 py-1.5 text-sm hover:border-brand disabled:opacity-50">
        {pending ? 'Saving...' : 'Not refilling'}
      </button>
      {error && <p className="mt-1 text-xs text-late">{error}</p>}
    </div>
  );
}
