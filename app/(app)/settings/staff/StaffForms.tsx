'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { addStaff, inviteLogin, updateStaff, type SettingsState } from '@/lib/actions/settings';

export type StaffMember = {
  id: string; name: string; email: string | null; role: 'admin' | 'staff' | 'physician'; active: boolean; has_login: boolean;
};

const input = 'w-full rounded border border-line bg-white px-3 py-2 outline-none focus:border-brand';

export function AddStaffForm({ invitesReady }: { invitesReady: boolean }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(addStaff, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok && !state.error) ref.current?.reset(); }, [state.ok, state.error]);

  return (
    <form ref={ref} action={action} className="text-sm">
      <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_10rem]">
        <label><span className="mb-1 block font-medium">Name</span>
          <input name="name" required autoComplete="off" className={input} /></label>
        <label><span className="mb-1 block font-medium">Work email</span>
          <input name="email" type="email" required autoComplete="off" className={input} /></label>
        <label><span className="mb-1 block font-medium">Role</span>
          <select name="role" defaultValue="staff" className={input}>
            <option value="staff">Staff</option>
            <option value="physician">Physician</option>
            <option value="admin">Admin</option>
          </select></label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {invitesReady && (
          <label className="flex items-center gap-2">
            <input type="checkbox" name="send_invite" value="1" defaultChecked /> Email them a login invite
          </label>
        )}
        <button disabled={pending} className="rounded bg-brand px-4 py-2 font-medium text-white disabled:opacity-60">
          {pending ? 'Adding...' : 'Add'}
        </button>
      </div>
      {state.message && <p className="mt-2 text-done">{state.message}</p>}
      {state.error && <p className="mt-2 text-late">{state.error}</p>}
    </form>
  );
}

export function StaffRow({ person, isMe, invitesReady }: { person: StaffMember; isMe: boolean; invitesReady: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<SettingsState>({});
  const run = (fn: () => Promise<SettingsState>) => start(async () => setMsg(await fn()));

  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm ${person.active ? '' : 'opacity-60'} ${pending ? 'opacity-50' : ''}`}>
      <div className="min-w-48 flex-1">
        <div className="font-medium">{person.name}{isMe && <span className="ml-1 text-xs text-muted">(you)</span>}</div>
        <div className="text-xs text-muted">
          {person.email ?? 'No email'} · {person.has_login ? 'Has a login' : 'No login yet'}
          {!person.active && ' · Deactivated'}
        </div>
      </div>
      <select value={person.role} disabled={isMe || pending} onChange={(e) => run(() => updateStaff(person.id, { role: e.target.value }))}
        className="rounded border border-line bg-white px-2 py-1">
        <option value="staff">Staff</option>
        <option value="physician">Physician</option>
        <option value="admin">Admin</option>
      </select>
      {invitesReady && person.email && !person.has_login && person.active && (
        <button disabled={pending} onClick={() => run(() => inviteLogin(person.email!))}
          className="rounded border border-line bg-white px-2.5 py-1 hover:border-brand">Send invite</button>
      )}
      {!isMe && (
        <button disabled={pending}
          onClick={() => {
            if (person.active && !confirm(`Deactivate ${person.name}? They won't be able to log in.`)) return;
            run(() => updateStaff(person.id, { active: !person.active }));
          }}
          className="rounded border border-line bg-white px-2.5 py-1 hover:border-brand">
          {person.active ? 'Deactivate' : 'Reactivate'}
        </button>
      )}
      {(msg.error || msg.message) && (
        <p className={`basis-full text-xs ${msg.error ? 'text-late' : 'text-done'}`}>{msg.error ?? msg.message}</p>
      )}
    </li>
  );
}
