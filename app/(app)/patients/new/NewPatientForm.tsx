'use client';

import { useActionState, useState } from 'react';
import { createPatient, enrollExisting, type FormState } from '@/lib/actions/enroll';
import { EnrollFields, type ProgramOption } from '@/components/EnrollFields';
import { buildPatientCode } from '@/lib/patientCode';

const input = 'w-full rounded border border-line bg-white px-3 py-2 outline-none focus:border-brand';

export function NewPatientForm({ programs, defaultStart, today, existing }: {
  programs: ProgramOption[];
  defaultStart: string;
  today: string;
  existing?: { id: string; code: string };
}) {
  const action = existing ? enrollExisting.bind(null, existing.id) : createPatient;
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});

  // These three stay in the browser. Only the code is sent.
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [year, setYear] = useState('');
  const code = buildPatientCode(first, last, year);

  return (
    <form action={formAction} className="rounded border border-line bg-white p-5">
      {existing ? (
        <p className="mb-4 font-mono text-lg font-semibold tracking-wide">{existing.code}</p>
      ) : (
        <>
          <div className="mb-3 grid gap-4 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">First name</span>
              <input value={first} onChange={(e) => setFirst(e.target.value)} required autoComplete="off" className={input} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Last name</span>
              <input value={last} onChange={(e) => setLast(e.target.value)} required autoComplete="off" className={input} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Birth year</span>
              <input value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                required inputMode="numeric" placeholder="1994" autoComplete="off" className={input} />
            </label>
          </div>
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded bg-paper px-3 py-2 text-sm">
            <span className="text-muted">Patient code</span>
            <span className="font-mono text-lg font-semibold tracking-wide">{code ?? '------'}</span>
            <span className="text-xs text-muted">
              Only this code is saved. Write it in the patient's chart or JotForm record.
            </span>
          </div>
          <input type="hidden" name="patient_code" value={code ?? ''} />
        </>
      )}

      <EnrollFields programs={programs} defaultStart={state.values?.start_date ?? defaultStart} today={today}
        defaultPaidDate={state.values?.paid_date} />

      {state.error && (
        <div className="mb-3 rounded bg-late/10 px-3 py-2 text-sm text-late">
          <p>{state.error}</p>
          {state.existingId && state.suggestedCode && (
            <div className="mt-2 flex flex-wrap gap-2">
              <a href={`/patients/${state.existingId}`}
                className="rounded border border-late/40 bg-white px-3 py-1.5 font-medium text-ink">
                Same person: open their record
              </a>
              <button type="submit" name="different_person" value="1" disabled={pending}
                className="rounded border border-late/40 bg-white px-3 py-1.5 font-medium text-ink">
                Different person: save as {state.suggestedCode}
              </button>
            </div>
          )}
        </div>
      )}

      <button type="submit" disabled={pending || (!existing && !code)}
        className="rounded bg-brand px-4 py-2 font-medium text-white disabled:opacity-60">
        {pending ? 'Saving...' : existing ? 'Start program' : 'Add patient and start program'}
      </button>
      <p className="mt-3 text-xs text-muted">
        Every step in the program is created with its due date as soon as you save.
      </p>
    </form>
  );
}
