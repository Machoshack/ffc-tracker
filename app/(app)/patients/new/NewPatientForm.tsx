'use client';

import { useActionState } from 'react';
import { createPatient, enrollExisting, type FormState } from '@/lib/actions/enroll';
import { EnrollFields, type ProgramOption } from '@/components/EnrollFields';

const input = 'w-full rounded border border-line bg-white px-3 py-2 outline-none focus:border-brand';

export function NewPatientForm({ programs, defaultStart, today, existing }: {
  programs: ProgramOption[];
  defaultStart: string;
  today: string;
  existing?: { id: string; display_name: string; patient_code: string };
}) {
  const action = existing ? enrollExisting.bind(null, existing.id) : createPatient;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="rounded border border-line bg-white p-5">
      {existing ? (
        <p className="mb-4 text-sm">
          <span className="font-medium">{existing.display_name}</span>
          <span className="text-muted"> · {existing.patient_code}</span>
        </p>
      ) : (
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Name</span>
            <input name="display_name" required autoComplete="off" className={input} placeholder="First name and last initial" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Patient code</span>
            <input name="patient_code" required autoComplete="off" className={input} placeholder="Chart number" />
          </label>
        </div>
      )}

      <EnrollFields programs={programs} defaultStart={defaultStart} today={today} />

      {state.error && <p className="mb-3 rounded bg-late/10 px-3 py-2 text-sm text-late">{state.error}</p>}

      <button type="submit" disabled={pending}
        className="rounded bg-brand px-4 py-2 font-medium text-white disabled:opacity-60">
        {pending ? 'Saving...' : existing ? 'Start program' : 'Add patient and start program'}
      </button>
      <p className="mt-3 text-xs text-muted">
        Every step in the program is created with its due date as soon as you save.
      </p>
    </form>
  );
}
