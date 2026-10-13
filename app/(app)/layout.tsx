import Link from 'next/link';
import { getCurrentStaff } from '@/lib/supabase/server';

const NAV = [
  { href: '/', label: 'Timeline' },
  { href: '/queue', label: 'My queue' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/patients', label: 'Patients' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/margin', label: 'P1 margin' },
  // Devices comes later. Settings shows for admins only.
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { staff, email, userId, lookupError } = await getCurrentStaff();

  if (!staff) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm rounded-lg border border-line bg-white p-6 text-sm">
          <h1 className="mb-2 text-lg font-semibold">Not on the staff list</h1>
          <p className="mb-4 text-muted">
            {email ?? 'This login'} is not linked to an active staff account. Ask an admin to add this email.
          </p>
          {lookupError && (
            <p className="mb-4 rounded bg-paper p-2 font-mono text-xs text-late">Database error: {lookupError}</p>
          )}
          <p className="mb-4 font-mono text-xs text-muted">Login ID: {userId}</p>
          <form action="/auth/signout" method="post">
            <button className="rounded border border-line px-3 py-1.5">Log out</button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold text-brand">FFC Waypoint</span>
          <nav className="order-last -mx-4 flex w-[calc(100%+2rem)] gap-5 overflow-x-auto whitespace-nowrap px-4 text-sm sm:order-none sm:mx-0 sm:w-auto sm:px-0">
            {[...NAV, ...(staff.role === 'admin' ? [{ href: '/settings', label: 'Settings' }] : [])].map((n) => (
              <Link key={n.href} href={n.href} className="text-ink hover:text-brand">{n.label}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">{staff.name} · {staff.role}</span>
            <form action="/auth/signout" method="post">
              <button className="rounded border border-line px-2.5 py-1 hover:bg-paper">Log out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
