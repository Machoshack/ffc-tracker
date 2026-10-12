'use client';

import { useState, useTransition } from 'react';
import { markDone } from '@/lib/actions/steps';

// One-tap "done today" for the queue. Blocks and errors show right under the step.
export function QuickDone({ stepId, patientId, today }: { stepId: string; patientId: string; today: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="shrink-0 text-right">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await markDone(stepId, patientId, today);
            if (r.error) setError(r.error);
          })
        }
        className="rounded border border-line bg-white px-3 py-1.5 text-sm hover:border-brand disabled:opacity-50"
      >
        {pending ? 'Saving...' : 'Done today'}
      </button>
      {error && <p className="mt-1 max-w-56 text-left text-xs text-late">{error}</p>}
    </div>
  );
}
