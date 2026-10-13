'use client';

import { useState, useTransition } from 'react';
import { markDone, markStarted, undoStep, skipStep, rebook, saveNote, type ActionResult } from '@/lib/actions/steps';

export type StepView = {
  step_id: string;
  step_name: string;
  owner_role: string;
  owner_name: string | null;
  due_date: string;
  status: 'not_started' | 'in_progress' | 'done' | 'skipped';
  completed_on: string | null;
  notes: string | null;
  is_overdue: boolean;
  optional?: boolean;
  waiting_on: string[];
};

const STATUS: Record<StepView['status'], { label: string; cls: string }> = {
  not_started: { label: 'Not started', cls: 'bg-paper text-muted border-line' },
  in_progress: { label: 'In progress', cls: 'bg-due/10 text-due border-due/30' },
  done: { label: 'Done', cls: 'bg-done/10 text-done border-done/30' },
  skipped: { label: 'Skipped', cls: 'bg-paper text-muted border-line' },
};

function fmt(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

export function StepRow({ step, patientId, today }: { step: StepView; patientId: string; today: string }) {
  const [panel, setPanel] = useState<null | 'done' | 'rebook' | 'note' | 'skip'>(null);
  const [doneDate, setDoneDate] = useState(today);
  const [dueDate, setDueDate] = useState(step.due_date);
  const [note, setNote] = useState(step.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const open = step.status === 'not_started' || step.status === 'in_progress';
  const waiting = open && step.waiting_on.length > 0;
  const status = STATUS[step.status];

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else setPanel(null);
    });
  }

  const btn = 'rounded border border-line bg-white px-2.5 py-1 text-sm hover:border-brand disabled:opacity-50';

  return (
    <li className={`px-4 py-3 ${pending ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className={`mt-0.5 shrink-0 rounded border px-2 py-0.5 text-xs font-medium ${status.cls}`}>
          {status.label}
        </span>

        <div className="min-w-0 flex-1">
          <div className="font-medium">
            {step.step_name}
            {step.optional && <span className="ml-2 rounded bg-paper px-1.5 py-0.5 text-xs font-normal text-muted">Optional</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-sm text-muted">
            <span className="capitalize">{step.owner_name ?? step.owner_role}</span>
            {step.status === 'done' && step.completed_on ? (
              <span>Done {fmt(step.completed_on)}</span>
            ) : step.status === 'skipped' ? null : (
              <span className={step.is_overdue ? 'font-medium text-late' : ''}>
                {step.is_overdue ? 'Overdue, was due' : 'Due'} {fmt(step.due_date)}
              </span>
            )}
          </div>
          {waiting && (
            <div className="mt-1 text-sm text-muted">Waiting on: {step.waiting_on.join(', ')}</div>
          )}
          {step.notes && panel !== 'note' && (
            <div className="mt-1 whitespace-pre-wrap rounded bg-paper px-2 py-1 text-sm">{step.notes}</div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {open && (
            <button className={btn} disabled={pending || waiting} onClick={() => setPanel(panel === 'done' ? null : 'done')}
              title={waiting ? 'Finish the steps it is waiting on first' : undefined}>
              Mark done
            </button>
          )}
          {step.status === 'not_started' && !waiting && (
            <button className={btn} disabled={pending} onClick={() => run(() => markStarted(step.step_id, patientId))}>
              Start
            </button>
          )}
          {open && (
            <button className={btn} disabled={pending} onClick={() => setPanel(panel === 'rebook' ? null : 'rebook')}>
              Rebook
            </button>
          )}
          <button className={btn} disabled={pending} onClick={() => setPanel(panel === 'note' ? null : 'note')}>
            {step.notes ? 'Edit note' : 'Note'}
          </button>
          {open && (
            <button className={btn} disabled={pending} onClick={() => setPanel(panel === 'skip' ? null : 'skip')}>
              Skip
            </button>
          )}
          {!open && (
            <button className={btn} disabled={pending} onClick={() => run(() => undoStep(step.step_id, patientId))}>
              Undo
            </button>
          )}
        </div>
      </div>

      {panel === 'done' && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded bg-paper p-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted">Done on</span>
            <input type="date" value={doneDate} max={today} onChange={(e) => setDoneDate(e.target.value)}
              className="rounded border border-line bg-white px-2 py-1" />
          </label>
          <button className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white" disabled={pending}
            onClick={() => run(() => markDone(step.step_id, patientId, doneDate))}>
            Save
          </button>
          {doneDate > step.due_date && (
            <span className="text-sm text-muted">This is late, so later steps will move back to match.</span>
          )}
        </div>
      )}

      {panel === 'rebook' && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded bg-paper p-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted">New date</span>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              className="rounded border border-line bg-white px-2 py-1" />
          </label>
          <button className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white" disabled={pending}
            onClick={() => run(() => rebook(step.step_id, patientId, dueDate))}>
            Save
          </button>
          {dueDate > step.due_date && (
            <span className="text-sm text-muted">Later steps will move back to match.</span>
          )}
        </div>
      )}

      {(panel === 'note' || panel === 'skip') && (
        <div className="mt-3 rounded bg-paper p-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted">
              {panel === 'skip' ? 'Why is this step being skipped?' : 'Note'}
            </span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              className="w-full rounded border border-line bg-white px-2 py-1" />
          </label>
          <p className="mb-2 text-xs text-muted">Keep clinical details in the chart. Use notes for scheduling and handoffs.</p>
          <button className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white" disabled={pending}
            onClick={() => run(() => panel === 'skip'
              ? skipStep(step.step_id, patientId, note)
              : saveNote(step.step_id, patientId, note))}>
            {panel === 'skip' ? 'Skip step' : 'Save note'}
          </button>
        </div>
      )}

      {error && <p className="mt-2 rounded bg-late/10 px-2 py-1 text-sm text-late">{error}</p>}
    </li>
  );
}
