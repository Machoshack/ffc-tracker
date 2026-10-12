'use client';

import { useActionState } from 'react';
import { createPatient, enrollExisting, type FormState } from '@/lib/actions/enroll';
import { EnrollFields, type ProgramOption } from '@/components/EnrollFields';

const input = 'w-full rounded border border-line bg-white px-3 py-2 outline-none focus:border-brand';

export function NewPatientForm({ programs, defaultStart, today, existing }: {
  programs: ProgramOption[];
  defaultStart: string;
  today: string;
  existing?: { id: string; display_name: string; dob: string };
}) {
  const action = existing ? enrollExisting.bind(null, existing.id) : createPatient;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="rounded border border-line bg-white p-5">
      {existing ? (
        <p className="mb-4 text-sm">
          <span className="font-medium">{existing.display_name}</span>
          <span className="text-muted"> · {existing.dob}</span>
        </p>
      ) : (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium">First name</span>
            <input name="first_name" required autoComplete="off" defaultValue={state.values?.first_name} className={input} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Last name</span>
            <input name="last_name" required autoComplete="off" defaultValue={state.values?.last_name} className={input} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Date of birth</span>
            <input name="date_of_birth" type="date" required max={today} defaultValue={state.values?.date_of_birth} className={input} />
          </label>
        </div>
      )}

      <EnrollFields programs={programs} defaultStart={state.values?.start_date ?? defaultStart} today={today}
        defaultPaidDate={state.values?.paid_date} />

      {state.error && (
        <p className="mb-3 rounded bg-late/10 px-3 py-2 text-sm text-late">
          {state.error}{' '}
          {state.existingId && (
            <a href={`/patients/${state.existingId}`} className="font-medium underline">Open patient</a>
          )}
        </p>
      )}

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
