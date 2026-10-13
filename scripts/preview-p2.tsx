// Preview of the collapsed Protocol II FHE on the timeline and pipeline, using the fake data plus one P2 patient mid-FHE.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { Timeline } from '../components/Timeline';
import { PipelineView } from '../components/PipelineView';
import { todayInNewYork } from '../lib/dates';
import { resolveWindow } from '../lib/timelineWindow';
import { collapseEnrollment, COLLAPSED_STAGES } from '../lib/board';

const [cssFile, outDir] = process.argv.slice(2);
const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create role authenticator nologin; create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
await db.exec(readFileSync('setup.sql', 'utf8'));
const pid = (await db.query(`insert into patient (patient_code) values ('MSMI94') returning id`)).rows[0] as { id: string };
const e = (await db.query(`select enroll_patient($1, 'P2', current_date - 12, 1650) as id`, [pid.id])).rows[0] as { id: string };
await db.query(`update step s set status = 'done', completed_on = s.due_date from step_template t
  where t.id = s.template_id and s.enrollment_id = $1 and t.key in ('fhe_v1_bloodwork','fhe_v1_metabolomics','fhe_v1_omegaquant','fhe_v2_eeg_pickup','fhe_v2_bodycomp')`, [e.id]);

const fix = (r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v]));
const today = todayInNewYork();
const enr = (await db.query(`select * from v_enrollments where status = 'active' and program_code = 'P2'`)).rows.map(fix) as any[];
const steps = (await db.query(`select * from v_steps where program_code = 'P2'`)).rows.map(fix) as any[];
const sortByName = new Map(steps.map((s) => [`${s.program_code}|${s.stage_name}`, s.stage_sort]));
const rows = enr.map((r) => ({ ...collapseEnrollment({ ...r, overdue_steps: Number(r.overdue_steps) }, sortByName, today) }));
const stages = (await db.query(`select s.name, s.sort, p.code as program_code from program_stage s join program p on p.id = s.program_id`)).rows as any[];
const fhe = new Map<string, any>();
for (const st of steps) {
  if (st.stage_sort > COLLAPSED_STAGES.P2.upToSort) continue;
  const p = fhe.get(st.enrollment_id) ?? { done: 0, total: 0, next: null };
  p.total++; if (st.status === 'done' || st.status === 'skipped') p.done++; else if (!p.next) p.next = st.step_name;
  fhe.set(st.enrollment_id, p);
}
const active = rows.map((r) => (r.current_stage === 'FHE' ? { ...r, fhe: fhe.get(r.enrollment_id) } : r));
const w = resolveWindow({ scale: '1y' }, today);
const css = readFileSync(cssFile, 'utf8');
const page = (b: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="font-sans"><main class="mx-auto max-w-7xl px-4 py-6">${b}</main></body></html>`;
writeFileSync(`${outDir}/p2-timeline.html`, page(renderToStaticMarkup(<Timeline enrollments={rows} steps={steps} today={today} start={w.start} end={w.end} />)));
writeFileSync(`${outDir}/p2-pipeline.html`, page(renderToStaticMarkup(<PipelineView active={active} stages={stages} program="P2" today={today} />)));
console.log('ok', rows.map((r) => `${r.patient_code}: ${r.current_stage} ${r.days_in_stage}d`).join(', '));
