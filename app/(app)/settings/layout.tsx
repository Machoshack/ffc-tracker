import Link from 'next/link';
import { getCurrentStaff } from '@/lib/supabase/server';

const TABS = [
  { href: '/settings/staff', label: 'Staff' },
  { href: '/settings/programs', label: 'Programs' },
  { href: '/settings/steps', label: 'Program steps' },
  { href: '/settings/supplements', label: 'Supplements' },
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { staff } = await getCurrentStaff();
  if (staff?.role !== 'admin') {
    return <p className="rounded border border-line bg-white p-6 text-muted">Settings are for admins only.</p>;
  }
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-3 text-xl font-semibold">Settings</h1>
      <nav className="mb-5 flex flex-wrap gap-1 border-b border-line text-sm">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="-mb-px border-b-2 border-transparent px-3 py-2 hover:border-brand hover:text-brand">
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
