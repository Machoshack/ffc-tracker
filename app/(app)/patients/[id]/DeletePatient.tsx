'use client';

import { useActionState, useState } from 'react';
import { deletePatient, type FormState } from '@/lib/actions/enroll';

export function DeletePatient({ patientId, code }: { patientId: string; code: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FormState, FormData>(deletePatient.bind(null, patientId), {});
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-muted underline hover:text-late">
        Delete patient (admin)
      </button>
    );
  }
  return (
    <form action={action} className="rounded border border-late/40 bg-white p-4 text-sm">
      <p className="mb-2 font-medium text-late">Delete {code} and all of their programs, steps, supplements and tests?</p>
      <p className="mb-3 text-muted">This can’t be undone. The audit log keeps a record that it happened. Type the code to confirm.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input name="confirm_code" autoComplete="off" placeholder={code}
          className="w-32 rounded border border-line px-2 py-1.5 font-mono uppercase outline-none focus:border-late" />
        <button disabled={pending} className="rounded bg-late px-3 py-1.5 font-medium text-white disabled:opacity-60">
          {pending ? 'Deleting...' : 'Delete'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-muted underline">Cancel</button>
      </div>
      {state.error && <p className="mt-2 text-late">{state.error}</p>}
    </form>
  );
}
