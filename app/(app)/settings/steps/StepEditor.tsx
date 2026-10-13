'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { addStep, removeStep, renameStage, updateStep, type SettingsState } from '@/lib/actions/settings';

export type Stage = { id: string; name: string; sort: number };
export type StepTemplate = {
  id: string; key: string; name: string; owner_role: 'staff' | 'physician'; offset_days: number; sort: number;
  stage_id: string; blocked_by_keys: string[]; block_enabled: boolean;
};

const input = 'w-full rounded border border-line bg-white px-2 py-1.5 outline-none focus:border-brand';

function StepFields({ step, stages, allSteps }: { step?: StepTemplate; stages: Stage[]; allSteps: StepTemplate[] }) {
  const others = allSteps.filter((s) => s.id !== step?.id);
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-[1fr_9rem_8rem_12rem]">
        <label><span className="mb-1 block font-medium">Step</span>
          <input name="name" defaultValue={step?.name} required className={input} /></label>
        <label><span className="mb-1 block font-medium">Done by</span>
          <select name="owner_role" defaultValue={step?.owner_role ?? 'staff'} className={input}>
            <option value="staff">Staff</option>
            <option value="physician">Physician</option>
          </select></label>
        <label><span className="mb-1 block font-medium">Days after start</span>
          <input name="offset_days" type="number" min={0} max={730} defaultValue={step?.offset_days ?? 0} required className={input} /></label>
        <label><span className="mb-1 block font-medium">Stage</span>
          <select name="stage_id" defaultValue={step?.stage_id ?? stages[0]?.id} className={input}>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
      </div>
      {others.length > 0 && (
        <fieldset>
          <legend className="mb-1 font-medium">Can’t be done until these are finished</legend>
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {others.map((o) => (
              <label key={o.key} className="flex items-center gap-2">
                <input type="checkbox" name="blocked_by" value={o.key} defaultChecked={step?.blocked_by_keys.includes(o.key)} />
                {o.name}
              </label>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" name="block_enabled" value="1" defaultChecked={step?.block_enabled ?? true} />
            Enforce this (uncheck to keep the list but allow finishing early)
          </label>
        </fieldset>
      )}
    </div>
  );
}

export function StepEditor({ step, programCode, stages, allSteps, inUse }: {
  step: StepTemplate; programCode: string; stages: Stage[]; allSteps: StepTemplate[]; inUse: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateStep.bind(null, step.id, programCode), {});
  const [removing, start] = useTransition();
  const [removeError, setRemoveError] = useState<string | null>(null);
  useEffect(() => { if (state.ok) setOpen(false); }, [state.ok]);

  const blockers = step.blocked_by_keys
    .map((k) => allSteps.find((s) => s.key === k)?.name)
    .filter(Boolean);

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{step.name}</div>
          <div className="text-xs text-muted">
            <span className="capitalize">{step.owner_role}</span> · day {step.offset_days}
            {blockers.length > 0 && (
              <> · waits for {blockers.join(', ')}{!step.block_enabled && ' (not enforced)'}</>
            )}
          </div>
        </div>
        <button onClick={() => setOpen(!open)} className="rounded border border-line bg-white px-2.5 py-1 text-sm hover:border-brand">
          {open ? 'Close' : 'Edit'}
        </button>
      </div>
      {open && (
        <form action={action} className="mt-3 rounded bg-paper p-3">
          <StepFields step={step} stages={stages} allSteps={allSteps} />
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <button disabled={pending} className="rounded bg-brand px-4 py-1.5 font-medium text-white disabled:opacity-60">
              {pending ? 'Saving...' : 'Save'}
            </button>
            {inUse ? (
              <span className="text-xs text-muted">Patients already have this step, so it can be changed but not removed.</span>
            ) : (
              <button type="button" disabled={removing}
                onClick={() => {
                  if (!confirm(`Remove "${step.name}"?`)) return;
                  start(async () => { const r = await removeStep(step.id); setRemoveError(r.error ?? null); });
                }}
                className="text-late underline">
                Remove step
              </button>
            )}
            {state.error && <span className="text-late">{state.error}</span>}
            {removeError && <span className="text-late">{removeError}</span>}
          </div>
        </form>
      )}
      {!open && state.message && <p className="mt-1 text-xs text-done">{state.message}</p>}
    </li>
  );
}

export function NewStepForm({ programCode, stages, allSteps }: { programCode: string; stages: Stage[]; allSteps: StepTemplate[] }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(addStep.bind(null, programCode), {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) ref.current?.reset(); }, [state.ok]);
  return (
    <form ref={ref} action={action}>
      <StepFields stages={stages} allSteps={allSteps} />
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <button disabled={pending} className="rounded bg-brand px-4 py-1.5 font-medium text-white disabled:opacity-60">
          {pending ? 'Adding...' : 'Add step'}
        </button>
        {state.message && <span className="text-done">{state.message}</span>}
        {state.error && <span className="text-late">{state.error}</span>}
      </div>
    </form>
  );
}

export function StageName({ stage }: { stage: Stage }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!editing) {
    return (
      <span className="flex items-center gap-2">
        {stage.name}
        <button type="button" onClick={() => setEditing(true)} className="text-xs font-normal text-muted underline hover:text-brand">
          Rename
        </button>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 font-normal">
      <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
        className="rounded border border-line bg-white px-2 py-1 text-sm outline-none focus:border-brand" />
      <button type="button" disabled={pending}
        onClick={() => start(async () => {
          const r = await renameStage(stage.id, name);
          if (r.error) setError(r.error); else { setError(null); setEditing(false); }
        })}
        className="rounded bg-brand px-3 py-1 text-sm font-medium text-white disabled:opacity-60">Save</button>
      <button type="button" onClick={() => { setEditing(false); setName(stage.name); }} className="text-sm text-muted underline">Cancel</button>
      {error && <span className="text-sm text-late">{error}</span>}
    </span>
  );
}
