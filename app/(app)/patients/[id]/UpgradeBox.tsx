'use client';

import { useActionState } from 'react';
import { upgradeToP2, type FormState } from '@/lib/actions/enroll';

export function UpgradeBox({ enrollmentId, patientId, credit, p2Price, daysLeft }: {
  enrollmentId: string;
  patientId: string;
  credit: number;
  p2Price: number;
  daysLeft: number | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    upgradeToP2.bind(null, enrollmentId, patientId), {},
  );
  const balance = Math.max(p2Price - credit, 0);
  return (
    <form action={action} className="mb-5 rounded border border-due/30 bg-due/5 p-4 text-sm">
      <div className="mb-2 font-medium">Upgrade to Protocol II</div>
      <p className="mb-3 text-muted">
        Finished FHE steps carry over and the ${credit.toLocaleString()} FHE payment is credited toward ${p2Price.toLocaleString()}.
        {daysLeft != null && ` ${daysLeft} day${daysLeft === 1 ? '' : 's'} left in the one-month window.`}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="mb-1 block text-muted">Additional payment</span>
          <input name="extra_paid" inputMode="decimal" defaultValue={balance}
            className="w-32 rounded border border-line bg-white px-2 py-1" />
        </label>
        <button disabled={pending} className="rounded bg-brand px-3 py-1.5 font-medium text-white disabled:opacity-60">
          {pending ? 'Upgrading...' : 'Upgrade'}
        </button>
      </div>
      {state.error && <p className="mt-2 text-late">{state.error}</p>}
    </form>
  );
}
