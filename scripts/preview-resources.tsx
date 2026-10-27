// Preview of Resources pages with test data. Usage: npx tsx scripts/preview-resources.tsx <css file> <out dir>
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProgramResourcesView } from '../app/(app)/resources/[program]/ProgramResourcesView';
import { BUILT_IN_TOOLS, RESOURCE_PROGRAMS } from '../lib/resources';

const [cssFile, outDir] = process.argv.slice(2);
const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create role authenticator nologin; create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
await db.exec(readFileSync('setup.sql', 'utf8'));

const SAMPLE = `# Session 1
20 to 30 minutes. Staff only.

- Bloodwork slip: print from the [bloodwork slip form](https://form.jotform.com/251805506276155) and give it to the patient.
- Metabolomics kit: walk the patient through collection. They freeze the sample and mail it Monday to Wednesday only.
- OmegaQuant finger prick, done in the office.

# Session 2
Ideally 7 to 10 days after Session 1.

1. Body composition
2. Grip strength
3. BOLT test

Send the sleep EEG device home with the patient. They wear it one night and drop it off before Visit 3.

# Scoring and packet
- [ ] Staff complete the Vitality score
- [ ] Physician completes the Lab and Sleep scores
- [ ] Cover sheet written
- [ ] Packet scanned into the chart

# Visit 3: results consult
**Do not start the consult without the completed FHE score.**

Total Health Score, then what went well, what didn't, how to improve over the next year, and future services.`;

const css = readFileSync(cssFile, 'utf8');
const nav = (code: string) => `<div class="mb-4 flex flex-wrap items-end justify-between gap-3"><h1 class="text-xl font-semibold">Resources</h1><nav class="flex flex-wrap gap-1 text-sm">${
  RESOURCE_PROGRAMS.map((p) => `<span class="rounded border px-3 py-1 ${p.code === code ? 'border-brand bg-brand text-white' : 'border-line bg-white'}">${p.label}</span>`).join('')}</nav></div>`;
const page = (b: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="font-sans"><main class="mx-auto max-w-6xl px-4 py-6">${b}</main></body></html>`;

for (const [code, body, admin] of [['FHE', SAMPLE, true], ['TS', '', false]] as const) {
  const program = (await db.query(`select id, name from program where code = $1`, [code])).rows[0] as any;
  const links = (await db.query(`select id, label, url, note from program_link where program_id = $1 order by sort`, [program.id])).rows as any[];
  const stages = (await db.query(`select id, name, sort from program_stage where program_id = $1 order by sort`, [program.id])).rows as any[];
  const steps = (await db.query(`select name, owner_role, offset_days, sort, optional, stage_id from step_template where program_id = $1`, [program.id])).rows as any[];
  const html = renderToStaticMarkup(<ProgramResourcesView code={code} programName={program.name} isAdmin={admin} tools={BUILT_IN_TOOLS[code] ?? []}
    links={links} body={body} updated={body ? 'Last updated Oct 27, 2026 by Alan' : null} stages={stages} steps={steps} />);
  writeFileSync(`${outDir}/res-${code}.html`, page(nav(code) + html));
}
console.log('ok');
