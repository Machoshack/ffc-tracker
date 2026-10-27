import Link from 'next/link';
import { RESOURCE_PROGRAMS } from '@/lib/resources';

export default async function ResourcesLayout({ children, params }: { children: React.ReactNode; params: Promise<{ program: string }> }) {
  const { program } = await params;
  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Resources</h1>
        <nav className="flex flex-wrap gap-1 text-sm">
          {RESOURCE_PROGRAMS.map((p) => (
            <Link key={p.code} href={`/resources/${p.code}`}
              className={`rounded border px-3 py-1 ${program === p.code ? 'border-brand bg-brand text-white' : 'border-line bg-white hover:border-brand'}`}>
              {p.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  );
}
