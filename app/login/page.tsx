'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();

    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) return setError('Email or password is incorrect.');
      router.replace('/');
      router.refresh();
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/confirm?next=/set-password`,
      });
      setBusy(false);
      if (error) return setError('Could not send the email. Try again in a minute.');
      setMessage('If that email is on the staff list, a link to set your password is on its way.');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-lg border border-line bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold">FFC Waypoint</h1>
        <p className="mb-5 text-sm text-muted">
          {mode === 'login' ? 'Fresh Fit Consulting staff login' : 'Set or reset your password'}
        </p>

        <label className="mb-1 block text-sm font-medium" htmlFor="email">Email</label>
        <input
          id="email" type="email" required autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full rounded border border-line px-3 py-2 outline-none focus:border-brand"
        />

        {mode === 'login' && (
          <>
            <label className="mb-1 block text-sm font-medium" htmlFor="password">Password</label>
            <input
              id="password" type="password" required autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mb-4 w-full rounded border border-line px-3 py-2 outline-none focus:border-brand"
            />
          </>
        )}

        {error && <p className="mb-3 text-sm text-late">{error}</p>}
        {message && <p className="mb-3 text-sm text-done">{message}</p>}

        <button
          type="submit" disabled={busy}
          className="w-full rounded bg-brand px-3 py-2 font-medium text-white disabled:opacity-60"
        >
          {busy ? 'Working...' : mode === 'login' ? 'Log in' : 'Send link'}
        </button>

        <button
          type="button"
          onClick={() => { setMode(mode === 'login' ? 'reset' : 'login'); setError(null); setMessage(null); }}
          className="mt-4 w-full text-center text-sm text-muted underline"
        >
          {mode === 'login' ? 'First time, or forgot your password?' : 'Back to login'}
        </button>
      </form>
    </main>
  );
}
