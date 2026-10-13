// Runs the migrations and seed on a throwaway in-memory Postgres and checks the rules.
// Usage: node tests/run-tests.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Stand-ins for what Supabase provides: the auth schema and login roles.
const SUPABASE_STUBS = `
  create role anon nologin; create role authenticated nologin; create role authenticator nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on function auth.uid() to authenticated, anon;
`;

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok    ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${detail}`); }
}
async function expectError(db, name, sql, match) {
  try { await db.exec(sql); check(name, false, '(no error raised)'); }
  catch (e) { check(name, match.test(e.message), `(got: ${e.message})`); }
}

async function freshDb({ seed = false } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const f of readdirSync(join(root, 'supabase/migrations')).sort()) {
    await db.exec(read(`supabase/migrations/${f}`));
  }
  if (seed) await db.exec(read('supabase/seed.sql'));
  return db;
}
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const rows = async (db, sql, params) => (await db.query(sql, params)).rows;
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

async function stepDue(db, enrollment, key) {
  const r = await one(db, `select s.due_date, s.status from step s join step_template t on t.id = s.template_id
                           where s.enrollment_id = $1 and t.key = $2`, [enrollment, key]);
  return iso(r.due_date);
}
async function setStep(db, enrollment, key, status, completedOn) {
  await db.query(`update step s set status = $3, completed_on = $4::date from step_template t
                  where t.id = s.template_id and s.enrollment_id = $1 and t.key = $2`,
                 [enrollment, key, status, completedOn ?? null]);
}
const setStepSql = (e, key, status, on) =>
  `update step s set status = '${status}'${on ? `, completed_on = '${on}'` : ''} from step_template t
   where t.id = s.template_id and s.enrollment_id = '${e}' and t.key = '${key}'`;

// ---------------------------------------------------------------------------
console.log('\nClinic-day snapping');
{
  const db = await freshDb();
  // Mon 10/12/2026 through Sun 10/18/2026
  const expect = { '2026-10-12': '2026-10-12', '2026-10-13': '2026-10-14', '2026-10-14': '2026-10-14',
                   '2026-10-15': '2026-10-16', '2026-10-16': '2026-10-16', '2026-10-17': '2026-10-16',
                   '2026-10-18': '2026-10-19' };
  for (const [d, want] of Object.entries(expect)) {
    const r = await one(db, `select snap_clinic_day($1::date) as d`, [d]);
    check(`${d} snaps to ${want}`, iso(r.d) === want, `(got ${iso(r.d)})`);
  }
}

// ---------------------------------------------------------------------------
console.log('\nFHE enrollment, blocks, and shifting');
{
  const db = await freshDb();
  const pid = (await one(db, `insert into patient (patient_code) values ('TPAT01') returning id`)).id;
  const e = (await one(db, `select enroll_patient($1, 'FHE', '2026-10-12', 950) as id`, [pid])).id;

  const n = await one(db, `select count(*)::int as n from step where enrollment_id = $1`, [e]);
  check('FHE creates 14 steps', n.n === 14, `(got ${n.n})`);
  check('Session 1 due Mon 10/12', await stepDue(db, e, 'fhe_v1_bloodwork') === '2026-10-12');
  check('Session 2 due Mon 10/19 (day 7)', await stepDue(db, e, 'fhe_v2_bodycomp') === '2026-10-19');
  check('Results consult due Fri 11/6 (day 24 is a Thursday)',
        ['2026-11-06'].includes(await stepDue(db, e, 'fhe_v3_consult')),
        `(got ${await stepDue(db, e, 'fhe_v3_consult')})`);

  await expectError(db, 'Results consult blocked until scores are done',
    setStepSql(e, 'fhe_v3_consult', 'done'), /BLOCKED.*Vitality score.*Lab score.*Sleep score/);
  await expectError(db, 'Grip strength blocked until body composition is done',
    setStepSql(e, 'fhe_v2_grip', 'done'), /BLOCKED.*Body composition/);
  await expectError(db, 'Results consult cannot even be started early',
    setStepSql(e, 'fhe_v3_consult', 'in_progress'), /BLOCKED/);

  // Visit 1 on time
  for (const k of ['fhe_v1_bloodwork', 'fhe_v1_metabolomics', 'fhe_v1_omegaquant'])
    await setStep(db, e, k, 'done', '2026-10-12');
  const before = await stepDue(db, e, 'fhe_v3_consult');
  check('On-time Session 1 does not move anything', before === '2026-11-06');

  // Visit 2 happens 5 days late (Sat 10/24 -> treat as Fri 10/23, 4 days late). All four items same day.
  await setStep(db, e, 'fhe_v2_eeg_pickup', 'done', '2026-10-23');
  await setStep(db, e, 'fhe_v2_bodycomp',   'done', '2026-10-23');
  await setStep(db, e, 'fhe_v2_grip',       'done', '2026-10-23');
  await setStep(db, e, 'fhe_v2_bolt',       'done', '2026-10-23');
  const sh = await one(db, `select shift_days from enrollment where id = $1`, [e]);
  check('Four late Session 2 items shift the plan once (4 days), not four times', sh.shift_days === 4,
        `(got ${sh.shift_days})`);
  check('Vitality score moved from 10/23 to 10/26', await stepDue(db, e, 'fhe_vitality_score') === '2026-10-26',
        `(got ${await stepDue(db, e, 'fhe_vitality_score')})`);
  check('Results consult moved from 11/6 to 11/9 (Mon)', await stepDue(db, e, 'fhe_v3_consult') === '2026-11-09',
        `(got ${await stepDue(db, e, 'fhe_v3_consult')})`);

  // Rebooking: physician pushes Lab score out a week; consult moves with it.
  await db.query(`update step s set due_date = '2026-11-09' from step_template t
                  where t.id = s.template_id and s.enrollment_id = $1 and t.key = 'fhe_lab_score'`, [e]);
  check('Rebooking Lab score a week later pushes the results consult',
        await stepDue(db, e, 'fhe_v3_consult') > '2026-11-09',
        `(got ${await stepDue(db, e, 'fhe_v3_consult')})`);

  // Finish everything, consult allowed, enrollment closes
  for (const k of ['fhe_eeg_returned', 'fhe_vitality_score', 'fhe_lab_score', 'fhe_sleep_score',
                   'fhe_cover_sheet', 'fhe_packet'])
    await setStep(db, e, k, 'done', '2026-11-09');
  await setStep(db, e, 'fhe_v3_consult', 'done', '2026-11-13');
  const en = await one(db, `select status, completed_on from enrollment where id = $1`, [e]);
  check('Enrollment closes itself when the last step is done', en.status === 'completed', `(got ${en.status})`);
  check('Completion date is the last step date', iso(en.completed_on) === '2026-11-13');

  // Upgrade to P2 after completion (window is checked against today, so move completion to today)
  await db.query(`update enrollment set completed_on = current_date - 10 where id = $1`, [e]);
  const p2 = (await one(db, `select convert_enrollment($1, 700) as id`, [e])).id;
  const p2e = await one(db, `select amount_paid, status, shift_days from enrollment where id = $1`, [p2]);
  check('Upgrade credits FHE payment ($950 + $700 = $1,650)', Number(p2e.amount_paid) === 1650,
        `(got ${p2e.amount_paid})`);
  const carried = await one(db, `select count(*)::int as n from step where enrollment_id = $1 and status = 'done'`, [p2]);
  check('All 14 finished FHE steps carry over to P2', carried.n === 14, `(got ${carried.n})`);
  const old = await one(db, `select status from enrollment where id = $1`, [e]);
  check('FHE enrollment marked converted', old.status === 'converted');
  const c1 = await stepDue(db, p2, 'p2_consult1');
  check('P2 Consultation 1 lands about 3 months after start, adjusted for delays', c1 > '2027-01-10' && c1 < '2027-02-15',
        `(got ${c1})`);
}

// ---------------------------------------------------------------------------
console.log('\nUpgrade window and one-program rule');
{
  const db = await freshDb();
  const pid = (await one(db, `insert into patient (patient_code) values ('TPAT02') returning id`)).id;
  const e = (await one(db, `select enroll_patient($1, 'FHE', current_date - 80, 950) as id`, [pid])).id;
  await expectError(db, 'Second open program for the same patient is refused',
    `select enroll_patient('${pid}', 'P1', current_date, 3000)`, /one_open_enrollment_per_patient/);
  await db.query(`update enrollment set status = 'completed', completed_on = current_date - 40 where id = $1`, [e]);
  await expectError(db, 'Upgrade refused after the 31-day window',
    `select convert_enrollment('${e}', 700)`, /Upgrade window closed/);
  await expectError(db, 'P1 has no upgrade path',
    `select convert_enrollment((select enroll_patient('${pid}', 'P1', current_date, 3000)), 0)`, /no upgrade path/);
}

// ---------------------------------------------------------------------------
console.log('\nP1 supplements, budget and margin');
{
  const db = await freshDb();
  const pid = (await one(db, `insert into patient (patient_code) values ('TPAT03') returning id`)).id;
  const e = (await one(db, `select enroll_patient($1, 'P1', '2026-10-12', 3000) as id`, [pid])).id;

  check('Consultation 1 due week 4 (Mon 11/9)', await stepDue(db, e, 'p1_consult1') === '2026-11-09');
  check('Consultation 4 due week 24 (Mon 3/29/2027)', await stepDue(db, e, 'p1_consult4') === '2027-03-29');
  await setStep(db, e, 'p1_test1_ordered', 'done', '2026-10-12');
  await expectError(db, 'Consultation 1 blocked until Test 1 results are in',
    setStepSql(e, 'p1_consult1', 'done'), /BLOCKED.*Test 1 results/);

  await db.query(`insert into supplement_log (enrollment_id, item, retail_price) values ($1, 'Item A', 400)`, [e]);
  const s = await one(db, `select wholesale_cost from supplement_log where enrollment_id = $1`, [e]);
  check('Wholesale fills in at 50% of retail ($400 -> $200)', Number(s.wholesale_cost) === 200);

  const ok = await one(db, `select * from supplement_check($1, 300)`, [e]);
  check('Adding $300 retail leaves $250 of $600', Number(ok.remaining_after) === 250 && !ok.over_budget);
  const over = await one(db, `select * from supplement_check($1, 900)`, [e]);
  check('Adding $900 retail warns: over budget by $50', over.over_budget && Number(over.remaining_after) === -50);

  await db.query(`insert into test_cost_log (enrollment_id, test_name, cost) values ($1, 'GI-MAP', 450), ($1, 'OAT', 380)`, [e]);
  const m = await one(db, `select * from v_p1_margin where enrollment_id = $1`, [e]);
  // 3000 - 1500 - 830 - 200 = 470
  check('Margin = 3000 - 1500 consults and staff - 830 tests - 200 supplements = $470',
        Number(m.margin) === 470, `(got ${m.margin})`);
  check('Testing budget is $900, with $70 left after $830 of tests', Number(m.test_budget) === 900 && Number(m.test_remaining) === 70,
        `(got ${m.test_budget}, ${m.test_remaining})`);
}

// ---------------------------------------------------------------------------
console.log('\nTwo-Step and P2 templates');
{
  const db = await freshDb();
  const pid = (await one(db, `insert into patient (patient_code) values ('TPAT04') returning id`)).id;
  const e = (await one(db, `select enroll_patient($1, 'TS', '2026-10-14', 495) as id`, [pid])).id;
  await expectError(db, 'Session 1 blocked until payment is collected',
    setStepSql(e, 'ts_session1', 'done'), /BLOCKED.*Payment collected/);
  check('Session 2 due a week after Session 1 (Wed 10/21)', await stepDue(db, e, 'ts_session2') === '2026-10-21');

  const pid2 = (await one(db, `insert into patient (patient_code) values ('TPAT05') returning id`)).id;
  const p2 = (await one(db, `select enroll_patient($1, 'P2', '2026-10-12', 1650) as id`, [pid2])).id;
  const n = await one(db, `select count(*)::int as n from step where enrollment_id = $1`, [p2]);
  check('P2 creates 14 FHE steps + 3 consultations', n.n === 17);
  check('P2 consults at months 3, 6, 9',
    [await stepDue(db, p2, 'p2_consult1'), await stepDue(db, p2, 'p2_consult2'), await stepDue(db, p2, 'p2_consult3')]
      .join() === '2027-01-11,2027-04-12,2027-07-12',
    `(got ${[await stepDue(db, p2, 'p2_consult1'), await stepDue(db, p2, 'p2_consult2'), await stepDue(db, p2, 'p2_consult3')]})`);
}

// ---------------------------------------------------------------------------
console.log('\nFake data, screens, audit log, and access rules');
{
  const db = await freshDb({ seed: true });
  const en = await rows(db, `select patient_code, program_code, current_stage, days_in_stage, overdue_steps
                             from v_enrollments where status = 'active' order by patient_code`);
  check('Fake data loads 10 active enrollments', en.length === 10, `(got ${en.length})`);
  console.table(en);

  const t1002 = await one(db, `select shift_days from enrollment e join patient p on p.id = e.patient_id
                               where p.patient_code = 'BSAM85'`);
  check('T-1002 late Session 2 shifted plan by 2 days', t1002.shift_days === 2, `(got ${t1002.shift_days})`);

  const margin = await rows(db, `select patient_code, fee, test_costs, supplement_cost, supplement_remaining, margin
                                 from v_p1_margin order by patient_code`);
  console.table(margin);
  check('P1 margin view has 3 patients', margin.length === 3);

  const dev = await rows(db, `select patient_code, device_type, rental_status from v_devices order by patient_code`);
  console.table(dev);
  check('One Firstbeat and one sleep EEG are overdue', dev.filter((d) => d.rental_status === 'overdue').length === 2);

  const audit = await one(db, `select count(*)::int as n from audit_log`);
  check('Audit log recorded changes', audit.n > 100, `(got ${audit.n})`);

  // Access rules
  const admin = (await one(db, `select id from staff_user where name = 'Admin Tester'`)).id;
  const staff = (await one(db, `select id from staff_user where name = 'Front Desk Tester'`)).id;
  const adminLogin = '11111111-1111-1111-1111-111111111111';
  const staffLogin = '22222222-2222-2222-2222-222222222222';
  const strangerLogin = '33333333-3333-3333-3333-333333333333';
  await db.query(`update staff_user set auth_user_id = $1 where id = $2`, [adminLogin, admin]);
  await db.query(`update staff_user set auth_user_id = $1 where id = $2`, [staffLogin, staff]);

  const as = async (login, fn) => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${login}', false);`);
    try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
  };

  const seen = await as(staffLogin, () => one(db, `select count(*)::int as n from patient`));
  check('Staff can see patients', seen.n === 12);
  const hidden = await as(strangerLogin, () => one(db, `select count(*)::int as n from patient`));
  check('A login that is not on the staff list sees nothing', hidden.n === 0);

  await as(staffLogin, () => db.query(`update program set price = 1 where code = 'FHE'`));
  const price = await one(db, `select price from program where code = 'FHE'`);
  check('Staff cannot change program prices', Number(price.price) === 950);

  await as(adminLogin, () => db.query(`update program set supplement_budget = 650 where code = 'P1'`));
  const budget = await one(db, `select supplement_budget from program where code = 'P1'`);
  check('Admin can change the P1 supplement budget', Number(budget.supplement_budget) === 650);

  const pid = (await one(db, `select id from patient where patient_code = 'KTES83'`)).id;
  const eid = await as(staffLogin, () => one(db, `select enroll_patient($1, 'TS', current_date + 3, 495) as id`, [pid]));
  check('Staff can enroll a patient', !!eid.id);
  const who = await one(db, `select s.name from audit_log a join staff_user s on s.id = a.staff_user_id
                             where a.record_type = 'enrollment' and a.record_id = $1`, [eid.id]);
  check('Audit log names who did it', who?.name === 'Front Desk Tester', `(got ${who?.name})`);

  let blocked = false;
  try { await as(strangerLogin, () => db.query(`select enroll_patient($1, 'TS', current_date, 495)`, [pid])); }
  catch (e) { blocked = /Not an active staff account/.test(e.message); }
  check('A login that is not on the staff list cannot enroll anyone', blocked);

  await as(staffLogin, () => db.query(`delete from patient where patient_code = 'LSAM90'`));
  const still = await one(db, `select count(*)::int as n from patient where patient_code = 'LSAM90'`);
  check('Staff cannot delete records', still.n === 1);

  // What the patient page does, done as a logged-in staff member
  const t1001 = (await one(db, `select e.id from enrollment e join patient p on p.id = e.patient_id
                                where p.patient_code = 'ATES78' and e.status = 'active'`)).id;
  const stepId = async (key) => (await one(db, `select s.id from step s join step_template t on t.id = s.template_id
                                               where s.enrollment_id = $1 and t.key = $2`, [t1001, key])).id;
  let msg = '';
  try {
    const grip = await stepId('fhe_v2_grip');
    await as(staffLogin, () => db.query(`update step set status = 'done' where id = $1`, [grip]));
  } catch (e) { msg = e.message; }
  check('Staff marking Grip strength done before Body composition is refused', /BLOCKED.*Body composition/.test(msg), `(got ${msg})`);

  const bc = await stepId('fhe_v2_bodycomp');
  const r = await as(staffLogin, () => db.query(`update step set status = 'done', completed_on = current_date where id = $1 returning id`, [bc]));
  check('Staff can mark a step done', r.rows.length === 1);
  const note = await as(staffLogin, () => db.query(`update step set notes = 'Patient asked for afternoon slot' where id = $1 returning id`, [bc]));
  check('Staff can add a note', note.rows.length === 1);
  const stepWho = await one(db, `select s.name from audit_log a join staff_user s on s.id = a.staff_user_id
                             where a.record_type = 'step' and a.record_id = $1 order by a.id desc limit 1`, [bc]);
  check('The audit log records who changed the step', stepWho?.name === 'Front Desk Tester');

  const consult = await stepId('fhe_v3_consult');
  const before = (await one(db, `select due_date from step where id = $1`, [consult])).due_date;
  const lab = await stepId('fhe_lab_score');
  await as(staffLogin, () => db.query(`update step set due_date = due_date + 7 where id = $1`, [lab]));
  const after = (await one(db, `select due_date from step where id = $1`, [consult])).due_date;
  check('Staff rebooking a step a week later pushes the results consult back', after > before);

  const undo = await as(staffLogin, () => db.query(`update step set status = 'not_started' where id = $1 returning completed_on`, [bc]));
  check('Undo clears the done date', undo.rows[0].completed_on === null);

  // P1 logging, as staff
  const p1e = (await one(db, `select e.id from enrollment e join patient p on p.id = e.patient_id
                              where p.patient_code = 'DFAK91' and e.status = 'active'`)).id;
  const chk = await as(staffLogin, () => one(db, `select * from supplement_check($1, 200)`, [p1e]));
  check('Staff can check the supplement budget', Number(chk.budget) === 650 && Number(chk.remaining_after) === Number(chk.remaining_now) - 100,
        `(got ${JSON.stringify(chk)})`);
  const ins = await as(staffLogin, () => db.query(
    `insert into supplement_log (enrollment_id, item, retail_price, given_on) values ($1, 'Vitamin D', 30, current_date) returning wholesale_cost, given_by`, [p1e]));
  check('Staff can log a supplement; wholesale fills in at 50%', Number(ins.rows[0].wholesale_cost) === 15);
  check('The supplement records who gave it', ins.rows[0].given_by === staff);
  const tc = await as(staffLogin, () => db.query(
    `insert into test_cost_log (enrollment_id, test_name, cost) values ($1, 'Stool test', 300) returning id`, [p1e]));
  check('Staff can log a test cost', tc.rows.length === 1);
  const mrow = await as(staffLogin, () => one(db, `select margin, test_costs from v_p1_margin where enrollment_id = $1`, [p1e]));
  check('Staff can see the margin, and it includes the new test', Number(mrow.test_costs) === 750, `(got ${mrow?.test_costs})`);
  const sd = await as(staffLogin, () => db.query(`delete from supplement_log where enrollment_id = $1 returning id`, [p1e]));
  check('Staff cannot remove supplement entries', sd.rows.length === 0);
  const ad = await as(adminLogin, () => db.query(`delete from test_cost_log where id = $1 returning id`, [tc.rows[0].id]));
  check('Admin can remove an entry made by mistake', ad.rows.length === 1);
  const gone = await one(db, `select count(*)::int as n from audit_log where record_type = 'test_cost_log' and action = 'delete'`);
  check('The removal is recorded in the audit log', gone.n === 1);

  // Settings, as admin and as staff
  const addByStaff = await as(staffLogin, () => db.query(
    `insert into staff_user (name, role, email) values ('Sneaky', 'admin', 'sneaky@example.com') returning id`).catch((e) => e));
  check('Staff cannot add people to the staff list', addByStaff instanceof Error);
  const addByAdmin = await as(adminLogin, () => db.query(
    `insert into staff_user (name, role, email) values ('New Nurse', 'staff', 'nurse@example.com') returning id`));
  check('Admin can add people to the staff list', addByAdmin.rows.length === 1);
  const tsSession2 = (await one(db, `select t.id from step_template t join program p on p.id = t.program_id
                                    where p.code = 'TS' and t.key = 'ts_session2'`)).id;
  const ren = await as(adminLogin, () => db.query(`update step_template set name = 'Session 2: plan delivered' where id = $1 returning id`, [tsSession2]));
  check('Admin can rename a program step', ren.rows.length === 1);
  const ren2 = await as(staffLogin, () => db.query(`update step_template set name = 'x' where id = $1 returning id`, [tsSession2]));
  check('Staff cannot edit program steps', ren2.rows.length === 0);
  let fk = '';
  try { await as(adminLogin, () => db.query(`delete from step_template where id = $1`, [tsSession2])); } catch (e) { fk = e.message; }
  check('A step patients already have cannot be removed', /foreign key/.test(fk), `(got ${fk})`);

  // Deleting a patient, the way the admin button does it
  const lsam = (await one(db, `select id from patient where patient_code = 'LSAM90'`)).id;
  const staffTry = await as(staffLogin, () => db.query(`delete from patient where id = $1 returning id`, [lsam]).catch((e) => e));
  check('Staff cannot delete a patient', staffTry instanceof Error || staffTry.rows.length === 0);
  const fes = (await one(db, `select id from patient where patient_code = 'EMOC74'`)).id;
  await as(adminLogin, async () => {
    await db.query(`delete from enrollment where patient_id = $1 and converted_from is not null`, [fes]);
    await db.query(`delete from enrollment where patient_id = $1`, [fes]);
    await db.query(`delete from device_rental where patient_id = $1`, [fes]);
    await db.query(`delete from patient where id = $1`, [fes]);
  });
  const goneP = await one(db, `select count(*)::int as n from patient where id = $1`, [fes]);
  const goneS = await one(db, `select count(*)::int as n from supplement_log sl join enrollment e on e.id = sl.enrollment_id where e.patient_id = $1`, [fes]);
  check('Admin can delete a patient, and their supplements go with them', goneP.n === 0 && goneS.n === 0);
  const logged = await one(db, `select count(*)::int as n from audit_log where record_type = 'patient' and action = 'delete' and record_id = $1`, [fes]);
  check('The deletion is recorded in the audit log', logged.n === 1);

  await as(staffLogin, () => db.query(`delete from audit_log`).catch(() => {}));
  const kept = await one(db, `select count(*)::int as n from audit_log`);
  check('Nobody can erase the audit log', kept.n > 100);
}

// ---------------------------------------------------------------------------
console.log('\nLinking logins to the staff list');
{
  const db = await freshDb();
  const u = (await one(db, `insert into auth.users (email) values ('Alan.Macioszek@gmail.com') returning id`)).id;
  const alan = await one(db, `select auth_user_id, role from staff_user where email = 'alan.macioszek@gmail.com'`);
  check('A new login is linked to the matching staff row (email case ignored)', alan.auth_user_id === u);
  check('Alan is set up as admin', alan.role === 'admin');

  const v = (await one(db, `insert into auth.users (email) values ('newhire@example.com') returning id`)).id;
  await db.query(`insert into staff_user (name, role, email) values ('New Hire', 'staff', 'newhire@example.com')`);
  const hire = await one(db, `select auth_user_id from staff_user where email = 'newhire@example.com'`);
  check('Adding a staff row for someone who already has a login links it', hire.auth_user_id === v);

  await db.query(`insert into auth.users (email) values ('stranger@example.com')`);
  const n = await one(db, `select count(*)::int as n from staff_user where auth_user_id is not null`);
  check('A login not on the staff list is not linked to anyone', n.n === 2);
}

// ---------------------------------------------------------------------------
console.log('\nPatient codes');
{
  const db = await freshDb({ seed: true });
  const p = await one(db, `insert into patient (patient_code) values (' MSMI94 ') returning patient_code, display_name`);
  check('Code is stored trimmed and used as the display name', p.patient_code === 'MSMI94' && p.display_name === 'MSMI94');
  let dup = '';
  try { await db.query(`insert into patient (patient_code) values ('MSMI94')`); } catch (e) { dup = e.message; }
  check('The same code cannot be saved twice', /patient_patient_code_key/.test(dup), `(got ${dup})`);
  await db.query(`insert into patient (patient_code) values ('MSMI94-2')`);
  check('A second person with the same code is saved with -2', true);
  await db.query(`insert into patient (patient_code) values ('MLI94')`);
  check('Short last names make shorter codes (MLI94)', true);
  let bad = '';
  try { await db.query(`insert into patient (patient_code) values ('Mike Smith 1991')`); } catch (e) { bad = e.message; }
  check('Codes in the wrong format are refused', /patient_code_format/.test(bad), `(got ${bad})`);
  const cols = await one(db, `select count(*)::int as n from information_schema.columns
                              where table_name = 'patient' and column_name in ('first_name','last_name','date_of_birth')`);
  check('Full name and date of birth are not stored', cols.n === 0);
  const fake = await one(db, `select count(*)::int as n from patient where patient_code ~ '^[A-Z]{4}[0-9]{2}$'`);
  check('Fake patients use codes', fake.n === 13, `(got ${fake.n})`);

  // One program, then another
  const pid = (await one(db, `select id from patient where patient_code = 'FTES88'`)).id;
  await db.query(`update enrollment set status = 'completed', completed_on = current_date where patient_id = $1`, [pid]);
  const next = await one(db, `select enroll_patient($1, 'FHE', current_date + 2, 950) as id`, [pid]);
  const count = await one(db, `select count(*)::int as n from enrollment where patient_id = $1`, [pid]);
  check('A patient can start a new program after finishing one', !!next.id && count.n === 2);
}

// ---------------------------------------------------------------------------
console.log('\nFHE stage names');
{
  const db = await freshDb({ seed: true });
  const names = await rows(db, `select p.code, s.name from program_stage s join program p on p.id = s.program_id
                                where p.code in ('FHE','P2') and s.sort in (1,2) order by p.code, s.sort`);
  check('FHE and P2 use Session 1 and Session 2', names.map((n) => n.name).join() === 'Session 1,Session 2,Session 1,Session 2',
        `(got ${names.map((n) => n.name).join()})`);
  await db.exec(`update program_stage set name = 'Visit 1' where name = 'Session 1' and program_id in (select id from program where code in ('FHE','P2')); update program_stage set name = 'Visit 2' where name = 'Session 2' and program_id in (select id from program where code in ('FHE','P2'))`);
  await db.exec(read('supabase/migrations/0010_fhe_sessions.sql'));
  await db.exec(read('supabase/migrations/0010_fhe_sessions.sql'));
  const after = await one(db, `select count(*)::int as n from program_stage where name like 'Visit 1' or name like 'Visit 2'`);
  const ts = await one(db, `select count(*)::int as n from program_stage s join program p on p.id = s.program_id where p.code = 'TS' and s.name = 'Session 1'`);
  check('The update renames old Visit 1 and 2, and leaves Two-Step alone', after.n === 0 && ts.n === 1);
}

// ---------------------------------------------------------------------------
console.log('\nFollow-ups: labs and functional tests');
{
  const db = await freshDb({ seed: true });
  const newPatient = async (code) => (await one(db, `insert into patient (patient_code) values ($1) returning id`, [code])).id;

  // Lab follow-up: two weeks, bloodwork drawn optional
  const a = await newPatient('LABA90');
  const lab = (await one(db, `select enroll_patient($1, 'LAB', '2026-10-12') as id`, [a])).id;
  check('Lab follow-up results consult is due two weeks out (Mon 10/26)', await stepDue(db, lab, 'lab_consult') === '2026-10-26');
  await setStep(db, lab, 'lab_order', 'done', '2026-10-12');
  const late = await one(db, `select overdue_steps from v_enrollments where enrollment_id = $1`, [lab]);
  const drawn = await one(db, `select is_overdue, optional from v_steps where enrollment_id = $1 and step_key = 'lab_drawn'`, [lab]);
  check('Bloodwork drawn is optional and never counts as late', drawn.optional === true && drawn.is_overdue === false);
  await expectError(db, 'Lab results consult waits for results',
    setStepSql(lab, 'lab_consult', 'done'), /BLOCKED.*Results received/);
  await setStep(db, lab, 'lab_results', 'done', '2026-10-22');
  await setStep(db, lab, 'lab_consult', 'done', '2026-10-26');
  const done = await one(db, `select status from enrollment where id = $1`, [lab]);
  const skipped = await one(db, `select s.status from step s join step_template t on t.id = s.template_id
                                 where s.enrollment_id = $1 and t.key = 'lab_drawn'`, [lab]);
  check('Lab follow-up finishes without bloodwork drawn being recorded', done.status === 'completed' && skipped.status === 'skipped',
        `(got ${done.status}, ${skipped.status})`);

  // Functional test: test name and prepaid
  const b = await newPatient('FTBB85');
  const ft = (await one(db, `select enroll_patient($1, 'FT', '2026-10-12', 0, null, 'GI-MAP', true) as id`, [b])).id;
  const fte = await one(db, `select detail, prepaid, program_kind from v_enrollments where enrollment_id = $1`, [ft]);
  check('Functional test records the test name and prepaid', fte.detail === 'GI-MAP' && fte.prepaid === true && fte.program_kind === 'followup');

  // Overlap rules
  await expectError(db, 'A second follow-up at the same time is refused',
    `select enroll_patient('${b}', 'LAB', current_date)`, /one_open_enrollment_per_patient/);
  const c = await newPatient('PTWO80');
  await db.query(`select enroll_patient($1, 'P2', current_date - 100, 1650)`, [c]);
  const withP2 = (await one(db, `select enroll_patient($1, 'FT', current_date, 0, null, 'OAT', false, true) as id`, [c])).id;
  check('A follow-up can run alongside Protocol II', !!withP2);
  const consult = await one(db, `select s.status, s.notes from step s join step_template t on t.id = s.template_id
                                 where s.enrollment_id = $1 and t.key = 'ft_consult'`, [withP2]);
  check('"Review at a Protocol II consult" skips the separate results consult', consult.status === 'skipped' && /Protocol II/.test(consult.notes));
  const d = await newPatient('PONE80');
  await db.query(`select enroll_patient($1, 'P1', current_date, 3000)`, [d]);
  await expectError(db, 'A follow-up alongside Protocol I is refused',
    `select enroll_patient('${d}', 'LAB', current_date)`, /one_open_enrollment_per_patient/);
  const e2 = await newPatient('ETWO80');
  await db.query(`select enroll_patient($1, 'LAB', current_date)`, [e2]);
  await expectError(db, 'Starting FHE while a follow-up is open is refused',
    `select enroll_patient('${e2}', 'FHE', current_date, 950)`, /one_open_enrollment_per_patient/);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
