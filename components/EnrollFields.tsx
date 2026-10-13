'use client';

import { useState } from 'react';

export type ProgramOption = { code: string; name: string; price: number; kind?: string };

const input = 'w-full rounded border border-line bg-white px-3 py-2 outline-none focus:border-brand';

// Program, start date and payment. Used by Add patient and Start a program.
export function EnrollFields({ programs, defaultStart, today, defaultPaidDate, inProtocolII }: {
  programs: ProgramOption[];
  defaultStart: string;
  today: string;
  defaultPaidDate?: string;
  inProtocolII?: boolean;
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
              {p.kind !== 'followup' && <span className="text-sm text-muted">${Number(p.price).toLocaleString()}</span>}
            </label>
          ))}
        </div>
      </fieldset>

      {(() => {
        const chosen = programs.find((p) => p.code === program);
        const followup = chosen?.kind === 'followup';
        return (
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">{followup ? 'Start date' : 'First visit'}</span>
              <input type="date" name="start_date" required defaultValue={defaultStart} className={input} />
              <span className="mt-1 block text-xs text-muted">Moves to the nearest Mon, Wed or Fri.</span>
            </label>
            {followup ? (
              <>
                <label className="text-sm">
                  <span className="mb-1 block font-medium">{program === 'FT' ? 'Functional test' : 'What’s ordered (optional)'}</span>
                  <input name="detail" required={program === 'FT'} autoComplete="off" className={input}
                    placeholder={program === 'FT' ? 'e.g. GI-MAP' : 'e.g. thyroid panel'} />
                </label>
                {program === 'FT' && (
                  <label className="text-sm">
                    <span className="mb-1 block font-medium">Prepaid?</span>
                    <select name="prepaid" required defaultValue="" className={input}>
                      <option value="" disabled>Choose</option>
                      <option value="yes">Yes, prepaid</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                )}
                {inProtocolII && (
                  <label className="flex items-start gap-2 text-sm sm:col-span-3">
                    <input type="checkbox" name="review_at_p2" value="1" className="mt-1" />
                    <span>Go over the results at the patient’s next Protocol II consult (no separate results consult)</span>
                  </label>
                )}
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        );
      })()}
    </>
  );
}
