// Preview of the Supplements section (Protocol I patient and a patient in no program) and Settings, Supplements.
// Usage: npx tsx scripts/preview-supplements.tsx <css file> <out dir>
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { SupplementsPanel } from '../app/(app)/patients/[id]/SupplementsPanel';
import { CatalogEditor } from '../components/CatalogEditor';
import { choiceLabel } from '../lib/square';
import { todayInNewYork } from '../lib/dates';

const [cssFile, outDir] = process.argv.slice(2);
const db = new PGlite();
await db.exec(`create role anon nologin; create role authenticated nologin; create role authenticator nologin; create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
await db.exec(readFileSync('setup.sql', 'utf8'));
await db.exec(`update staff_user set auth_user_id = '22222222-2222-2222-2222-222222222222' where name = 'Front Desk Tester';
  select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);`);
const items = [
  { item_id: 'I1', name: 'Vitamin D Supreme', sizes: [
    { variation_id: 'V1', name: '60 caps', price: 24, sort: 0, guess_size: 60, guess_form: 'capsules' },
    { variation_id: 'V2', name: '180 caps', price: 55, sort: 1, guess_size: 180, guess_form: 'capsules' }] },
  { item_id: 'I2', name: 'OmegaAvail Ultra', sizes: [{ variation_id: 'V3', name: '120 softgels', price: 62, sort: 0, guess_size: 120, guess_form: 'softgels' }] },
  { item_id: 'I3', name: 'Whey Protein Isolate', sizes: [{ variation_id: 'V4', name: 'Regular', price: 68, sort: 0, guess_size: null, guess_form: null }] },
  { item_id: 'I4', name: 'Magnesium Glycinate', sizes: [{ variation_id: 'V5', name: '90 capsules', price: 32, sort: 0, guess_size: 90, guess_form: 'capsules' }] },
  { item_id: 'I5', name: 'Gift card', sizes: [{ variation_id: 'V6', name: 'Regular', price: 50, sort: 0 }] },
  { item_id: 'I6', name: 'Probiotic 50B', sizes: [{ variation_id: 'V7', name: '30 caps', price: 48, sort: 0, guess_size: 30, guess_form: 'capsules' }] },
];
await db.query(`select sync_supplement_catalog($1)`, [JSON.stringify(items)]);
await db.exec(`update supplement_product set hidden = true where square_item_id = 'I5'`);

const fix = (r: any) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v]));
const today = todayInNewYork();
const p1 = (await db.query(`select p.id, e.id as eid from patient p join enrollment e on e.patient_id = p.id where p.patient_code = 'DFAK91'`)).rows[0] as any;
const none = (await db.query(`insert into patient (patient_code) values ('MSMI94') returning id`)).rows[0] as any;
const sz = async (v: string) => ((await db.query(`select id from supplement_size where square_variation_id = $1`, [v])).rows[0] as any).id;
await db.query(`insert into supplement_log (patient_id, size_id, item, retail_price, given_on, size, unit_form, packages, daily_dose)
  values ($1, $2, 'Vitamin D Supreme, 60 caps', 24, current_date - 52, 60, 'capsules', 1, 1),
         ($1, $3, 'Magnesium Glycinate, 90 capsules', 32, current_date - 20, 90, 'capsules', 1, 2)`, [none.id, await sz('V1'), await sz('V5')]);
await db.query(`insert into supplement_log (patient_id, size_id, item, retail_price, given_on, size, unit_form, packages, daily_dose)
  values ($1, $2, 'OmegaAvail Ultra, 120 softgels', 62, current_date - 50, 120, 'softgels', 1, 2)`, [p1.id, await sz('V3')]);

const loadRows = async (pid: string) => (await db.query(`select sl.*, st.name as given_by_name, (pr.code = 'P1') is true as counts_toward_p1
  from supplement_log sl left join staff_user st on st.id = sl.given_by left join enrollment e on e.id = sl.enrollment_id
  left join program pr on pr.id = e.program_id where sl.patient_id = $1 order by given_on desc`, [pid])).rows.map(fix) as any[];
const choices = ((await db.query(`select * from v_supplement_choices order by product_name, sort`)).rows as any[]).map((c) => ({
  size_id: c.size_id, label: choiceLabel(c.product_name, c.size_name), retail_price: Number(c.retail_price), size: c.size, unit_form: c.unit_form,
}));
const m = (await db.query(`select supplement_cost from v_p1_margin where enrollment_id = $1`, [p1.eid])).rows[0] as any;

const css = readFileSync(cssFile, 'utf8');
const page = (title: string, b: string) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body class="font-sans"><main class="mx-auto max-w-4xl px-4 py-6"><p class="mb-3 text-xs text-muted">${title}</p>${b}</main></body></html>`;
writeFileSync(`${outDir}/supp-p1.html`, page('Patient page, Protocol I patient (DFAK91)', renderToStaticMarkup(
  <SupplementsPanel patientId={p1.id} today={today} isAdmin={false} rows={await loadRows(p1.id)} choices={choices}
    p1={{ left: 600 - Number(m.supplement_cost), rate: 0.5 }} squareConnected={false} />)));
writeFileSync(`${outDir}/supp-none.html`, page('Patient page, patient in no program (MSMI94), typing a product in by hand', renderToStaticMarkup(
  <SupplementsPanel patientId={none.id} today={today} isAdmin={false} rows={await loadRows(none.id)} choices={[]}
    p1={null} squareConnected={false} />)));
const prods = (await db.query(`select * from supplement_product order by name`)).rows as any[];
const sizes = (await db.query(`select * from supplement_size order by sort`)).rows as any[];
const list = prods.map((p) => ({ ...p, sizes: sizes.filter((s) => s.product_id === p.id).map((s) => ({ ...s, retail_price: Number(s.retail_price) })) }));
writeFileSync(`${outDir}/supp-settings.html`, page('Settings, Supplements', renderToStaticMarkup(<CatalogEditor list={list} />)));
const refills = (await db.query(`select patient_code, item, run_out_date, program_code from v_supplement_supply where refill_status is null and run_out_date <= current_date + 14`)).rows.map(fix);
console.log('refills due:', JSON.stringify(refills));
