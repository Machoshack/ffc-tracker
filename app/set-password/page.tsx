'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Invite links can arrive with the login in the address after "#". Pick it up so the person is signed in.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get('access_token');
    const refresh_token = hash.get('refresh_token');
    if (access_token && refresh_token) {
      createClient().auth.setSession({ access_token, refresh_token }).then(({ error }) => {
        if (error) setError('This invite link has expired. Ask an admin to send a new one.');
        window.history.replaceState(null, '', window.location.pathname);
      });
    } else if (hash.get('error_description')) {
      setError(`${hash.get('error_description')}. Ask an admin to send a new invite.`);
    }
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 12) return setError('Use at least 12 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setError('Could not save. The link may have expired. Request a new one from the login page.');
    router.replace('/');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Set your password</h1>
        <p className="mb-5 text-sm text-muted">At least 12 characters.</p>

        <label className="mb-1 block text-sm font-medium" htmlFor="pw">New password</label>
        <input id="pw" type="password" autoComplete="new-password" required value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded border border-line px-3 py-2 outline-none focus:border-brand" />

        <label className="mb-1 block text-sm font-medium" htmlFor="pw2">Type it again</label>
        <input id="pw2" type="password" autoComplete="new-password" required value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mb-4 w-full rounded border border-line px-3 py-2 outline-none focus:border-brand" />

        {error && <p className="mb-3 text-sm text-late">{error}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded bg-brand px-3 py-2 font-medium text-white disabled:opacity-60">
          {busy ? 'Saving...' : 'Save password'}
        </button>
      </form>
    </main>
  );
}
