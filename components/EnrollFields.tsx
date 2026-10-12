'use client';

import { useState } from 'react';

export type ProgramOption = { code: string; name: string; price: number };

const input = 'w-full rounded border border-line bg-white px-3 py-2 outline-none focus:border-brand';

// Program, start date and payment. Used by Add patient and Start a program.
export function EnrollFields({ programs, defaultStart, today, defaultPaidDate }: {
  programs: ProgramOption[];
  defaultStart: string;
  today: string;
  defaultPaidDate?: string;
}) {
  const [program, setProgram] = useState('');
  const [paid, setPaid] = useState('');
  const [paidEdited, setPaidEdited] = useState(false);

  return (
    <>
      <fieldset className="mb-4">
        <legend className="mb-2 block text-sm font-medium">Program</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {programs.map((p) => (
            <label key={p.code}
              className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-2 ${program === p.code ? 'border-brand bg-brand/5' : 'border-line bg-white'}`}>
              <input type="radio" name="program" value={p.code} required checked={program === p.code}
                onChange={() => { setProgram(p.code); if (!paidEdited) setPaid(String(p.price)); }} />
              <span className="flex-1">{p.name}</span>
              <span className="text-sm text-muted">${Number(p.price).toLocaleString()}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">First visit</span>
          <input type="date" name="start_date" required defaultValue={defaultStart} className={input} />
          <span className="mt-1 block text-xs text-muted">Moves to the nearest Mon, Wed or Fri.</span>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Amount paid</span>
          <input name="amount_paid" inputMode="decimal" value={paid} placeholder="0"
            onChange={(e) => { setPaid(e.target.value); setPaidEdited(true); }} className={input} />
          <span className="mt-1 block text-xs text-muted">Enter 0 if not paid yet.</span>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Paid on</span>
          <input type="date" name="paid_date" defaultValue={defaultPaidDate ?? today} max={today} className={input} />
        </label>
      </div>
    </>
  );
}
