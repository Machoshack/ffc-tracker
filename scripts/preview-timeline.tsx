// Renders the timeline with the fake data from a local test database into one HTML file.
// Usage: npx tsx scripts/preview-timeline.tsx <css file> <out file>
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { Timeline } from '../components/Timeline';
import { todayInNewYork } from '../lib/dates';
import { resolveWindow } from '../lib/timelineWindow';

const [cssFile, outFile, scale = '3m', year = '', program = ''] = process.argv.slice(2);
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role authenticator nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
`);
await db.exec(readFileSync('setup.sql', 'utf8'));

const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : (d as string | null));
const fix = <T extends Record<string, unknown>>(r: T) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? iso(v) : v])) as T;

const enrollments = (await db.query(`select * from v_enrollments where status in ('active','paused','completed')`)).rows.map(
  (r) => fix(r as Record<string, unknown>),
).filter((e) => !program || e.program_code === program);
const steps = (await db.query(`select * from v_steps`)).rows.map(
  (r) => fix(r as Record<string, unknown>),
);
const overdue = enrollments.reduce((n, e) => n + Number(e.overdue_steps), 0);

const body = renderToStaticMarkup(
  <div className="min-h-screen">
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <span className="font-semibold text-brand">FFC Waypoint</span>
        <nav className="flex gap-4 text-sm"><a className="text-ink">Timeline</a></nav>
        <div className="ml-auto text-sm text-muted">Preview with fake data</div>
      </div>
    </header>
    <main className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-xl font-semibold">Active patients</h1>
      <p className="mb-4 text-sm text-muted">{enrollments.length} active · {overdue} overdue steps</p>
      <Timeline enrollments={enrollments as never} steps={steps as never} today={todayInNewYork()} {...(() => { const w = resolveWindow({ scale, year }, todayInNewYork()); return { start: w.start, end: w.end }; })()} />
    </main>
  </div>,
);

writeFileSync(
  outFile,
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>FFC Waypoint Preview</title><style>${readFileSync(cssFile, 'utf8')}</style></head><body class="min-h-screen font-sans antialiased">${body}</body></html>`,
);
console.log(`wrote ${outFile}`);
