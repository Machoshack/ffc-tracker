import Link from 'next/link';
import { getCurrentStaff } from '@/lib/supabase/server';

const NAV = [
  { href: '/', label: 'Timeline' },
  // More screens are added here as they're built: My queue, Pipeline, Dashboard, P1 margin, Devices, Settings.
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { staff, email } = await getCurrentStaff();

  if (!staff) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm rounded-lg border border-line bg-white p-6 text-sm">
          <h1 className="mb-2 text-lg font-semibold">Not on the staff list</h1>
          <p className="mb-4 text-muted">
            {email ?? 'This login'} is not linked to an active staff account. Ask an admin to add this email.
          </p>
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
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
          <span className="font-semibold text-brand">FFC Tracker</span>
          <nav className="flex gap-4 text-sm">
            {NAV.map((n) => (
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
