-- FFC Patient Tracker: full database setup. Paste all of this into the Supabase SQL Editor and click Run.
-- Includes FAKE patients for testing. No real patient data.

-- ===== supabase/migrations/0001_schema.sql =====
-- FFC Patient Tracker: tables
-- Runs on Supabase (Postgres 15+). Plain English notes above each table.


create type user_role         as enum ('admin', 'staff', 'physician');
create type step_status       as enum ('not_started', 'in_progress', 'done', 'skipped');
create type enrollment_status as enum ('active', 'paused', 'completed', 'cancelled', 'converted');

-- People who log in. auth_user_id links to the Supabase login account.
create table staff_user (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique,
  name          text not null,
  role          user_role not null default 'staff',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Patients. Only a code and a short display name. Clinical detail stays in the chart system.
create table patient (
  id            uuid primary key default gen_random_uuid(),
  patient_code  text not null unique,
  display_name  text not null,
  created_at    timestamptz not null default now()
);

-- Programs (FHE, P1, Two-Step, P2) and their money settings.
create table program (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,        -- FHE, P1, TS, P2
  name                   text not null,
  price                  numeric(10,2) not null,
  length_days            int not null,
  consult_cost           numeric(10,2) not null default 0,  -- P1 margin: total consult cost
  staff_time_cost        numeric(10,2) not null default 0,  -- P1 margin: flat staff time per patient
  supplement_budget      numeric(10,2),                     -- P1: wholesale dollars per patient
  wholesale_rate         numeric(4,3) not null default 0.5, -- wholesale as a share of retail
  upgrade_to_code        text,                              -- FHE -> P2
  upgrade_window_days    int,                               -- days after FHE completes to upgrade
  active                 boolean not null default true
);

-- Stages group steps (Visit 1, Visit 2, Scoring, Visit 3...). Order matters for shifting.
create table program_stage (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references program(id) on delete cascade,
  name        text not null,
  sort        int not null,
  unique (program_id, sort)
);

-- The template list of steps for each program.
-- offset_days: days after start. blocked_by_keys: steps that must be done first.
create table step_template (
  id               uuid primary key default gen_random_uuid(),
  program_id       uuid not null references program(id) on delete cascade,
  stage_id         uuid not null references program_stage(id) on delete cascade,
  key              text not null,
  name             text not null,
  owner_role       user_role not null,
  offset_days      int not null,
  sort             int not null,
  blocked_by_keys  text[] not null default '{}',
  block_enabled    boolean not null default true,
  unique (program_id, key)
);

-- A patient in a program.
create table enrollment (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references patient(id),
  program_id      uuid not null references program(id),
  start_date      date not null,
  amount_paid     numeric(10,2) not null default 0,
  paid_date       date,
  status          enrollment_status not null default 'active',
  completed_on    date,
  shift_days      int not null default 0,   -- how many days behind the original plan
  converted_from  uuid references enrollment(id),
  created_at      timestamptz not null default now()
);

-- One active (or paused) program per patient.
create unique index one_open_enrollment_per_patient
  on enrollment (patient_id) where status in ('active', 'paused');

-- The actual steps for one enrollment, created from the template.
create table step (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references enrollment(id) on delete cascade,
  template_id    uuid not null references step_template(id),
  owner_role     user_role not null,
  owner_id       uuid references staff_user(id),
  due_date       date not null,
  status         step_status not null default 'not_started',
  completed_on   date,
  notes          text,
  updated_at     timestamptz not null default now(),
  unique (enrollment_id, template_id)
);
create index step_due_idx on step (due_date) where status in ('not_started', 'in_progress');

-- P1 supplements given. Wholesale fills in from retail if left blank.
create table supplement_log (
  id              uuid primary key default gen_random_uuid(),
  enrollment_id   uuid not null references enrollment(id) on delete cascade,
  item            text not null,
  retail_price    numeric(10,2) not null,
  wholesale_cost  numeric(10,2),
  given_on        date not null default current_date,
  given_by        uuid references staff_user(id),
  created_at      timestamptz not null default now()
);

-- P1 functional test costs.
create table test_cost_log (
  id             uuid primary key default gen_random_uuid(),
  enrollment_id  uuid not null references enrollment(id) on delete cascade,
  test_name      text not null,
  cost           numeric(10,2) not null,
  logged_on      date not null default current_date,
  created_at     timestamptz not null default now()
);

-- Devices out with patients (Firstbeat, sleep devices).
create table device_rental (
  id             uuid primary key default gen_random_uuid(),
  patient_id     uuid not null references patient(id),
  device_type    text not null,
  device_label   text,
  out_date       date not null,
  due_back_date  date not null,
  returned_date  date,
  notes          text,
  created_at     timestamptz not null default now()
);

-- Who changed what. Written by triggers, never edited by hand.
create table audit_log (
  id             bigserial primary key,
  staff_user_id  uuid references staff_user(id),
  action         text not null,      -- insert, update, delete, view
  record_type    text not null,
  record_id      uuid,
  detail         jsonb,
  at             timestamptz not null default now()
);
create index audit_record_idx on audit_log (record_type, record_id);


-- ===== supabase/migrations/0002_scheduling.sql =====
-- FFC Patient Tracker: scheduling rules
-- Everything that keeps the timeline honest lives in the database,
-- so no screen can skip a rule by accident.

-- Who is logged in, as a staff_user row.
create or replace function current_staff_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from staff_user where auth_user_id = auth.uid() and active
$$;

create or replace function current_staff_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from staff_user where auth_user_id = auth.uid() and active
$$;

-- Functions that bypass access rules call this first.
-- Logged-in callers must be active staff. Calls with no login are only allowed
-- from a direct database session (migrations, seeding), never from the website.
create or replace function require_staff() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if current_staff_role() is null then
      raise exception 'Not an active staff account';
    end if;
  elsif session_user in ('authenticator', 'anon', 'authenticated') then
    raise exception 'Login required';
  end if;
end $$;

-- Move a date to the nearest clinic day (Mon, Wed, Fri).
-- Tue -> Wed, Thu -> Fri, Sat -> Fri, Sun -> Mon.
create or replace function snap_clinic_day(d date) returns date
language sql immutable as $$
  select case extract(isodow from d)::int
    when 2 then d + 1
    when 4 then d + 1
    when 6 then d - 1
    when 7 then d + 1
    else d
  end
$$;

-- How shifting works:
-- Each enrollment keeps one number, shift_days: how far behind the original plan it is.
-- Every unfinished step is due on (start + its offset + shift_days), snapped to a clinic day.
-- When a step finishes (or is rebooked) on date D, the plan must be at least
-- D - (start + offset) days behind. If that's more than shift_days, shift_days grows
-- and every later step moves. Several Visit 2 items finishing late on the same day
-- therefore move the timeline once, not once per item.
create or replace function apply_shift(p_step_id uuid, p_on date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_enrollment enrollment;
  v_offset     int;
  v_needed     int;
begin
  select t.offset_days into v_offset
  from step s join step_template t on t.id = s.template_id
  where s.id = p_step_id;
  select e.* into v_enrollment
  from step s join enrollment e on e.id = s.enrollment_id
  where s.id = p_step_id;

  -- Compare against the unsnapped plan date, so snapping alone never counts as late.
  v_needed := p_on - snap_clinic_day(v_enrollment.start_date + v_offset + v_enrollment.shift_days)
              + v_enrollment.shift_days;
  if v_needed <= v_enrollment.shift_days then return; end if;

  update enrollment set shift_days = v_needed where id = v_enrollment.id;

  perform set_config('ffc.shifting', 'on', true);
  update step s
     set due_date = greatest(s.due_date,
                             snap_clinic_day(v_enrollment.start_date + t.offset_days + v_needed))
    from step_template t
   where t.id = s.template_id
     and s.enrollment_id = v_enrollment.id
     and t.offset_days > v_offset
     and s.status in ('not_started', 'in_progress');
  perform set_config('ffc.shifting', 'off', true);
end $$;

-- Before a step changes: enforce hard blocks, fill in completion date.
create or replace function step_before_update() returns trigger
language plpgsql set search_path = public as $$
declare
  v_open_blockers text;
begin
  new.updated_at := now();

  if new.status in ('in_progress', 'done') and old.status is distinct from new.status then
    select string_agg(bt.name, ', ' order by bt.sort) into v_open_blockers
    from step_template t
    join step_template bt on bt.program_id = t.program_id and bt.key = any (t.blocked_by_keys)
    join step b on b.template_id = bt.id and b.enrollment_id = new.enrollment_id
    where t.id = new.template_id
      and t.block_enabled
      and b.status not in ('done', 'skipped');

    if v_open_blockers is not null then
      raise exception 'BLOCKED: finish these first: %', v_open_blockers
        using errcode = 'P0001';
    end if;
  end if;

  if new.status = 'done' and new.completed_on is null then
    new.completed_on := current_date;
  end if;
  if new.status <> 'done' then
    new.completed_on := null;
  end if;

  return new;
end $$;

create trigger step_before_update
  before update on step
  for each row execute function step_before_update();

-- After a step changes: shift the timeline if it ran late or was rebooked later,
-- and close the enrollment when everything is finished.
create or replace function step_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_remaining int;
begin
  if coalesce(current_setting('ffc.shifting', true), 'off') = 'on' then
    return null;
  end if;

  -- Done late: later steps move back.
  if new.status = 'done' and old.status <> 'done' and new.completed_on > new.due_date then
    perform apply_shift(new.id, new.completed_on);

  -- Rebooked later (due date moved out by hand): later steps move back the same way.
  elsif new.due_date > old.due_date and new.status in ('not_started', 'in_progress') then
    perform apply_shift(new.id, new.due_date);
  end if;

  select count(*) into v_remaining
  from step where enrollment_id = new.enrollment_id and status in ('not_started', 'in_progress');

  if v_remaining = 0 then
    update enrollment
       set status = 'completed',
           completed_on = (select max(completed_on) from step where enrollment_id = new.enrollment_id)
     where id = new.enrollment_id and status = 'active';
  end if;

  return null;
end $$;

create trigger step_after_update
  after update on step
  for each row execute function step_after_update();

-- Enroll a patient: creates every step with its due date in one go.
create or replace function enroll_patient(
  p_patient_id   uuid,
  p_program_code text,
  p_start_date   date,
  p_amount_paid  numeric default 0,
  p_paid_date    date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_program    program;
  v_enrollment uuid;
  v_start      date := snap_clinic_day(p_start_date);
begin
  perform require_staff();
  select * into v_program from program where code = p_program_code and active;
  if not found then
    raise exception 'Unknown program: %', p_program_code;
  end if;

  insert into enrollment (patient_id, program_id, start_date, amount_paid, paid_date)
  values (p_patient_id, v_program.id, v_start, p_amount_paid, p_paid_date)
  returning id into v_enrollment;

  insert into step (enrollment_id, template_id, owner_role, due_date)
  select v_enrollment, t.id, t.owner_role, snap_clinic_day(v_start + t.offset_days)
  from step_template t
  where t.program_id = v_program.id;

  return v_enrollment;
end $$;

-- FHE to P2 upgrade. Allowed while FHE is open, or within the upgrade window after it completes.
-- Finished FHE steps carry over; P2 consultations are added; FHE payment is credited.
create or replace function convert_enrollment(p_from uuid, p_extra_paid numeric default 0)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_from     enrollment;
  v_prog     program;
  v_target   program;
  v_new      uuid;
  v_shift    int;
begin
  perform require_staff();
  select * into v_from from enrollment where id = p_from;
  select * into v_prog from program where id = v_from.program_id;

  if v_prog.upgrade_to_code is null then
    raise exception '% has no upgrade path', v_prog.code;
  end if;
  if v_from.status in ('cancelled', 'converted') then
    raise exception 'This enrollment is % and cannot be upgraded', v_from.status;
  end if;
  if v_from.status = 'completed'
     and current_date > v_from.completed_on + v_prog.upgrade_window_days then
    raise exception 'Upgrade window closed on %', v_from.completed_on + v_prog.upgrade_window_days;
  end if;

  select * into v_target from program where code = v_prog.upgrade_to_code;

  update enrollment set status = 'converted' where id = p_from;

  -- Carry the FHE's delay over. If the FHE already finished, P2 consultations
  -- count from the day it finished.
  select greatest(v_from.shift_days,
                  coalesce(v_from.completed_on - (v_from.start_date + max(ft.offset_days)), 0))
    into v_shift
  from step_template ft where ft.program_id = v_prog.id;

  insert into enrollment (patient_id, program_id, start_date, amount_paid, paid_date,
                          converted_from, shift_days)
  values (v_from.patient_id, v_target.id, v_from.start_date,
          v_from.amount_paid + p_extra_paid, current_date, p_from, v_shift)
  returning id into v_new;

  -- New steps: copy status, dates and notes from matching FHE steps where they exist.
  perform set_config('ffc.shifting', 'on', true);
  insert into step (enrollment_id, template_id, owner_role, owner_id, due_date, status, completed_on, notes)
  select v_new, t.id, t.owner_role, old.owner_id,
         coalesce(old.due_date, snap_clinic_day(v_from.start_date + t.offset_days + v_shift)),
         coalesce(old.status, 'not_started'), old.completed_on, old.notes
  from step_template t
  left join lateral (
    select s.* from step s
    join step_template ot on ot.id = s.template_id
    where s.enrollment_id = p_from and ot.key = t.key
  ) old on true
  where t.program_id = v_target.id;
  perform set_config('ffc.shifting', 'off', true);

  return v_new;
end $$;

-- Supplements: fill wholesale from retail when blank. Only P1 has a budget.
create or replace function supplement_before_insert() returns trigger
language plpgsql set search_path = public as $$
declare
  v_rate numeric;
begin
  if new.wholesale_cost is null then
    select p.wholesale_rate into v_rate
    from enrollment e join program p on p.id = e.program_id
    where e.id = new.enrollment_id;
    new.wholesale_cost := round(new.retail_price * coalesce(v_rate, 0.5), 2);
  end if;
  if new.given_by is null then
    new.given_by := current_staff_id();
  end if;
  return new;
end $$;

create trigger supplement_before_insert
  before insert on supplement_log
  for each row execute function supplement_before_insert();

-- What's left in a patient's supplement budget, and what it would be after a new item.
-- The app calls this before saving so it can warn.
create or replace function supplement_check(p_enrollment uuid, p_new_retail numeric default 0)
returns table (budget numeric, used numeric, remaining_now numeric, remaining_after numeric, over_budget boolean)
language sql stable security invoker set search_path = public as $$
  select p.supplement_budget,
         coalesce(sum(l.wholesale_cost), 0),
         p.supplement_budget - coalesce(sum(l.wholesale_cost), 0),
         p.supplement_budget - coalesce(sum(l.wholesale_cost), 0) - round(p_new_retail * p.wholesale_rate, 2),
         (p.supplement_budget - coalesce(sum(l.wholesale_cost), 0) - round(p_new_retail * p.wholesale_rate, 2)) < 0
  from enrollment e
  join program p on p.id = e.program_id
  left join supplement_log l on l.enrollment_id = e.id
  where e.id = p_enrollment
  group by p.supplement_budget, p.wholesale_rate
$$;


-- ===== supabase/migrations/0003_views_audit_access.sql =====
-- FFC Patient Tracker: screen views, audit log, access rules

-------------------------------------------------------------------------------
-- Views the screens read from. security_invoker means access rules still apply.
-------------------------------------------------------------------------------

-- Every step with patient and program info, plus whether it's overdue or waiting on another step.
create view v_steps with (security_invoker = true) as
select s.id              as step_id,
       s.enrollment_id,
       e.status          as enrollment_status,
       p.id              as patient_id,
       p.patient_code,
       p.display_name,
       pr.code           as program_code,
       pr.name           as program_name,
       ps.name           as stage_name,
       ps.sort           as stage_sort,
       t.key             as step_key,
       t.name            as step_name,
       t.sort            as step_sort,
       s.owner_role,
       s.owner_id,
       su.name           as owner_name,
       s.due_date,
       s.status,
       s.completed_on,
       s.notes,
       (s.status in ('not_started', 'in_progress') and s.due_date < current_date) as is_overdue,
       exists (
         select 1 from step_template bt
         join step b on b.template_id = bt.id and b.enrollment_id = s.enrollment_id
         where t.block_enabled
           and bt.program_id = t.program_id
           and bt.key = any (t.blocked_by_keys)
           and b.status not in ('done', 'skipped')
       ) as is_blocked
from step s
join enrollment e     on e.id = s.enrollment_id
join patient p        on p.id = e.patient_id
join step_template t  on t.id = s.template_id
join program_stage ps on ps.id = t.stage_id
join program pr       on pr.id = t.program_id
left join staff_user su on su.id = s.owner_id;

-- One row per enrollment: current stage, how long they've been in it, overdue count.
create view v_enrollments with (security_invoker = true) as
with stage_state as (
  select s.enrollment_id, ps.id as stage_id, ps.name as stage_name, ps.sort,
         bool_and(s.status in ('done', 'skipped')) as stage_done,
         max(s.completed_on) as stage_finished_on
  from step s
  join step_template t  on t.id = s.template_id
  join program_stage ps on ps.id = t.stage_id
  group by s.enrollment_id, ps.id, ps.name, ps.sort
),
current_stage as (
  select distinct on (enrollment_id) enrollment_id, stage_name, sort
  from stage_state where not stage_done
  order by enrollment_id, sort
)
select e.id as enrollment_id,
       p.id as patient_id, p.patient_code, p.display_name,
       pr.code as program_code, pr.name as program_name,
       e.start_date, e.status, e.amount_paid, e.completed_on, e.converted_from,
       cs.stage_name as current_stage,
       greatest(0, coalesce(
         current_date - (select max(ss.stage_finished_on) from stage_state ss
                          where ss.enrollment_id = e.id and ss.stage_done and ss.sort < cs.sort),
         current_date - e.start_date
       )) as days_in_stage,
       (select count(*) from step s where s.enrollment_id = e.id
          and s.status in ('not_started', 'in_progress') and s.due_date < current_date) as overdue_steps,
       (select min(s.due_date) from step s where s.enrollment_id = e.id
          and s.status in ('not_started', 'in_progress')) as next_due,
       (select max(s.due_date) from step s where s.enrollment_id = e.id) as planned_end
from enrollment e
join patient p  on p.id = e.patient_id
join program pr on pr.id = e.program_id
left join current_stage cs on cs.enrollment_id = e.id;

-- P1 margin per patient.
create view v_p1_margin with (security_invoker = true) as
select e.id as enrollment_id, p.patient_code, p.display_name, e.status, e.start_date,
       e.amount_paid                                   as fee,
       pr.consult_cost,
       pr.staff_time_cost,
       coalesce(t.test_costs, 0)                       as test_costs,
       coalesce(sl.supplement_cost, 0)                 as supplement_cost,
       pr.supplement_budget,
       pr.supplement_budget - coalesce(sl.supplement_cost, 0) as supplement_remaining,
       e.amount_paid - pr.consult_cost - pr.staff_time_cost
         - coalesce(t.test_costs, 0) - coalesce(sl.supplement_cost, 0) as margin
from enrollment e
join program pr on pr.id = e.program_id and pr.code = 'P1'
join patient p  on p.id = e.patient_id
left join (select enrollment_id, sum(cost) as test_costs from test_cost_log group by 1) t
       on t.enrollment_id = e.id
left join (select enrollment_id, sum(wholesale_cost) as supplement_cost from supplement_log group by 1) sl
       on sl.enrollment_id = e.id
where e.status <> 'cancelled';

-- Devices out and whether they're late.
create view v_devices with (security_invoker = true) as
select d.*, p.patient_code, p.display_name,
       case when d.returned_date is not null then 'returned'
            when d.due_back_date < current_date then 'overdue'
            else 'out' end as rental_status
from device_rental d
join patient p on p.id = d.patient_id;

-- FHE patients who can still upgrade to P2, and how many days are left.
create view v_upgrade_window with (security_invoker = true) as
select e.id as enrollment_id, p.patient_code, p.display_name, pr.code as program_code,
       pr.upgrade_to_code, e.status, e.completed_on,
       case when e.status = 'completed'
            then e.completed_on + pr.upgrade_window_days - current_date end as days_left
from enrollment e
join program pr on pr.id = e.program_id and pr.upgrade_to_code is not null
join patient p  on p.id = e.patient_id
where e.status = 'active'
   or (e.status = 'completed' and current_date <= e.completed_on + pr.upgrade_window_days);

-------------------------------------------------------------------------------
-- Audit log: every insert, update and delete on patient data is recorded.
-------------------------------------------------------------------------------
create or replace function write_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_detail jsonb;
begin
  if tg_op = 'DELETE' then
    v_id := old.id; v_detail := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_id := new.id; v_detail := to_jsonb(new);
  else
    v_id := new.id;
    select jsonb_object_agg(n.key, n.value) into v_detail
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o using (key)
    where n.value is distinct from o.value and n.key <> 'updated_at';
    if v_detail is null then return null; end if;
  end if;

  insert into audit_log (staff_user_id, action, record_type, record_id, detail)
  values (current_staff_id(), lower(tg_op), tg_table_name, v_id, v_detail);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['patient','enrollment','step','supplement_log','test_cost_log',
                           'device_rental','staff_user','program','step_template'] loop
    execute format('create trigger audit_%1$s after insert or update or delete on %1$I
                    for each row execute function write_audit()', t);
  end loop;
end $$;

-- The app calls this when someone opens a patient page, so views are logged too.
create or replace function log_view(p_record_type text, p_record_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into audit_log (staff_user_id, action, record_type, record_id)
  values (current_staff_id(), 'view', p_record_type, p_record_id)
$$;

-------------------------------------------------------------------------------
-- Access rules.
-- Any active staff member can read and work on patient data.
-- Only admins can change programs, templates, budgets and staff accounts, or delete records.
-- Nobody can edit the audit log.
-------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['staff_user','patient','program','program_stage','step_template',
                           'enrollment','step','supplement_log','test_cost_log',
                           'device_rental','audit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %1$s_read on %1$I for select to authenticated
                    using (current_staff_role() is not null)', t);
  end loop;

  -- Day-to-day work: staff, physician and admin.
  foreach t in array array['patient','enrollment','step','supplement_log','test_cost_log','device_rental'] loop
    execute format('create policy %1$s_insert on %1$I for insert to authenticated
                    with check (current_staff_role() is not null)', t);
    execute format('create policy %1$s_update on %1$I for update to authenticated
                    using (current_staff_role() is not null)
                    with check (current_staff_role() is not null)', t);
    execute format('create policy %1$s_delete on %1$I for delete to authenticated
                    using (current_staff_role() = ''admin'')', t);
  end loop;

  -- Setup: admin only.
  foreach t in array array['staff_user','program','program_stage','step_template'] loop
    execute format('create policy %1$s_admin on %1$I for all to authenticated
                    using (current_staff_role() = ''admin'')
                    with check (current_staff_role() = ''admin'')', t);
  end loop;
end $$;

-- Supabase gives the web roles broad default rights. Take them all back, then grant only what's needed.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated;

grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on patient, enrollment, step, supplement_log, test_cost_log,
      device_rental, staff_user, program, program_stage, step_template to authenticated;
revoke execute on all functions in schema public from public;
grant execute on function enroll_patient, convert_enrollment, supplement_check, log_view,
      snap_clinic_day, current_staff_id, current_staff_role, require_staff to authenticated;


-- ===== supabase/migrations/0004_program_templates.sql =====
-- FFC Patient Tracker: the four program templates
-- Offsets are days after the start date. Every due date snaps to Mon, Wed or Fri.

insert into program (code, name, price, length_days, consult_cost, staff_time_cost,
                     supplement_budget, wholesale_rate, upgrade_to_code, upgrade_window_days) values
  ('FHE', 'Foundational Health Evaluation', 950,  28,  0,    0,   null, 0.5, 'P2', 31),
  ('P1',  'Protocol I: Testing and Treatment', 3000, 168, 1200, 200, 600,  0.5, null, null),
  ('TS',  'Two-Step Assessment', 495, 7, 0, 0, null, 0.5, null, null),
  ('P2',  'Protocol II: Health Management', 1650, 365, 0, 0, null, 0.5, null, null);

-- Helpers for writing templates. Admin-only screens will use the tables directly later.
create function _stage(p_program text, p_sort int, p_name text) returns void
language sql as $$
  insert into program_stage (program_id, name, sort)
  select id, p_name, p_sort from program where code = p_program
$$;

create function _step(p_program text, p_stage_sort int, p_sort int, p_key text, p_name text,
                      p_owner user_role, p_offset int, p_blocked_by text[] default '{}')
returns void language sql as $$
  insert into step_template (program_id, stage_id, key, name, owner_role, offset_days, sort, blocked_by_keys)
  select pr.id, ps.id, p_key, p_name, p_owner, p_offset, p_sort, p_blocked_by
  from program pr join program_stage ps on ps.program_id = pr.id and ps.sort = p_stage_sort
  where pr.code = p_program
$$;

-- FHE steps are shared by FHE and P2, so they're written once here.
create function _fhe_steps(p text) returns void language plpgsql as $$
begin
  perform _stage(p, 1, 'Session 1');
  perform _stage(p, 2, 'Session 2');
  perform _stage(p, 3, 'Scoring and packet');
  perform _stage(p, 4, 'Visit 3: results consult');

  perform _step(p, 1, 10, 'fhe_v1_bloodwork',   'Bloodwork slip given',             'staff', 0);
  perform _step(p, 1, 11, 'fhe_v1_metabolomics','Metabolomics kit handed out',      'staff', 0);
  perform _step(p, 1, 12, 'fhe_v1_omegaquant',  'OmegaQuant finger prick',          'staff', 0);

  perform _step(p, 2, 20, 'fhe_v2_eeg_pickup',  'Sleep EEG device picked up',       'staff', 7);
  perform _step(p, 2, 21, 'fhe_v2_bodycomp',    'Body composition',                 'staff', 7);
  perform _step(p, 2, 22, 'fhe_v2_grip',        'Grip strength',                    'staff', 7, '{fhe_v2_bodycomp}');
  perform _step(p, 2, 23, 'fhe_v2_bolt',        'BOLT test',                        'staff', 7, '{fhe_v2_grip}');

  perform _step(p, 3, 30, 'fhe_eeg_returned',   'Sleep EEG device returned',        'staff', 10);
  perform _step(p, 3, 31, 'fhe_vitality_score', 'Vitality score',                   'staff', 10,
                '{fhe_v2_bodycomp,fhe_v2_grip,fhe_v2_bolt}');
  perform _step(p, 3, 32, 'fhe_lab_score',      'Lab score',                        'physician', 19);
  perform _step(p, 3, 33, 'fhe_sleep_score',    'Sleep score',                      'physician', 19, '{fhe_eeg_returned}');
  perform _step(p, 3, 34, 'fhe_cover_sheet',    'Cover sheet written',              'physician', 21,
                '{fhe_vitality_score,fhe_lab_score,fhe_sleep_score}');
  perform _step(p, 3, 35, 'fhe_packet',         'Packet assembled and scanned to chart', 'staff', 22, '{fhe_cover_sheet}');

  perform _step(p, 4, 40, 'fhe_v3_consult',     'Results consult',                  'physician', 24,
                '{fhe_vitality_score,fhe_lab_score,fhe_sleep_score}');
end $$;

select _fhe_steps('FHE');

-- Protocol I: 24 weeks
select _stage('P1', 1, 'Start');
select _stage('P1', 2, 'Week 4: Test 1 interpretation');
select _stage('P1', 3, 'Week 10: Re-evaluation');
select _stage('P1', 4, 'Week 16: Test 2 interpretation');
select _stage('P1', 5, 'Week 24: Final evaluation');
select _step('P1', 1, 10, 'p1_test1_ordered',  'Test 1 ordered',               'physician', 0);
select _step('P1', 1, 11, 'p1_supp_started',   'Supplementation started',      'staff',     0);
select _step('P1', 2, 20, 'p1_test1_results',  'Test 1 results received',      'staff',     24, '{p1_test1_ordered}');
select _step('P1', 2, 21, 'p1_consult1',       'Consultation 1: Test 1 interpretation', 'physician', 28, '{p1_test1_results}');
select _step('P1', 3, 30, 'p1_consult2',       'Consultation 2: Protocol re-evaluation', 'physician', 70);
select _step('P1', 3, 31, 'p1_test2_ordered',  'Test 2 ordered',               'physician', 70);
select _step('P1', 4, 40, 'p1_test2_results',  'Test 2 results received',      'staff',     108, '{p1_test2_ordered}');
select _step('P1', 4, 41, 'p1_consult3',       'Consultation 3: Test 2 interpretation', 'physician', 112);
select _step('P1', 5, 50, 'p1_consult4',       'Consultation 4: Total protocol evaluation', 'physician', 168);

-- Two-Step Assessment
select _stage('TS', 1, 'Session 1');
select _stage('TS', 2, 'Review period');
select _stage('TS', 3, 'Session 2');
select _step('TS', 1, 10, 'ts_payment',  'Payment collected',            'staff',     0);
select _step('TS', 1, 11, 'ts_session1', 'Session 1: patient introduction', 'physician', 0, '{ts_payment}');
select _step('TS', 2, 20, 'ts_review',   'Review and care plan drafted', 'physician', 4, '{ts_session1}');
select _step('TS', 3, 30, 'ts_session2', 'Session 2: care plan delivered', 'physician', 7, '{ts_review}');

-- Protocol II: FHE, then consultations at months 3, 6, 9
select _fhe_steps('P2');
select _stage('P2', 5, 'Month 3: Progress review');
select _stage('P2', 6, 'Month 6: Mid-program review');
select _stage('P2', 7, 'Month 9: Final review');
select _step('P2', 5, 50, 'p2_consult1', 'Consultation 1: Progress review',    'physician', 91);
select _step('P2', 6, 60, 'p2_consult2', 'Consultation 2: Mid-program review', 'physician', 182);
select _step('P2', 7, 70, 'p2_consult3', 'Consultation 3: Final review',       'physician', 273);

drop function _fhe_steps(text);
drop function _step(text, int, int, text, text, user_role, int, text[]);
drop function _stage(text, int, text);


-- ===== supabase/migrations/0005_login_link.sql =====
-- FFC Patient Tracker: connect Supabase logins to the staff list
-- A staff row is added with an email. When that person accepts their invite and logs in,
-- their login is linked to the staff row automatically. A login whose email is not on
-- the staff list can sign in but sees nothing and can do nothing.

alter table staff_user add column email text unique;

create or replace function link_staff_login() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update staff_user
     set auth_user_id = new.id
   where lower(email) = lower(new.email)
     and (auth_user_id is null or auth_user_id = new.id);
  return new;
end $$;

create trigger link_staff_login
  after insert or update of email on auth.users
  for each row execute function link_staff_login();

-- When an admin adds a staff row for someone who already has a login, link it right away.
create or replace function staff_link_existing_login() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if new.auth_user_id is null and new.email is not null then
    select id into new.auth_user_id from auth.users where lower(email) = lower(new.email);
  end if;
  return new;
end $$;

create trigger staff_link_existing_login
  before insert or update of email on staff_user
  for each row execute function staff_link_existing_login();

-- First real admin.
insert into staff_user (name, role, email) values ('Alan', 'admin', 'alan.macioszek@gmail.com');

-- "Today" and "overdue" should follow the practice's clock, not UTC.
do $$ begin
  execute format('alter database %I set timezone to %L', current_database(), 'America/New_York');
end $$;


-- ===== supabase/migrations/0006_patient_names_dob.sql =====
-- FFC Patient Tracker: first name, last name, date of birth, automatic patient ID
-- Safe to run on a database that already has 0001 to 0005.

alter table patient add column if not exists first_name text;
alter table patient add column if not exists last_name text;
alter table patient add column if not exists date_of_birth date;

-- The app assigns IDs (FFC-0001, FFC-0002...). Nobody types one.
create sequence if not exists patient_code_seq;
alter table patient
  alter column patient_code set default ('FFC-' || lpad(nextval('patient_code_seq')::text, 4, '0'));
grant usage on sequence patient_code_seq to authenticated;

-- display_name is what every screen shows. Keep it in step with first and last name.
create or replace function patient_names() returns trigger
language plpgsql set search_path = public as $$
begin
  new.first_name := nullif(trim(new.first_name), '');
  new.last_name  := nullif(trim(new.last_name), '');
  if new.first_name is not null or new.last_name is not null then
    new.display_name := trim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, ''));
  end if;
  return new;
end $$;

drop trigger if exists patient_names on patient;
create trigger patient_names
  before insert or update on patient
  for each row execute function patient_names();

-- Fill in first and last name for patients added before this change.
update patient
   set first_name = split_part(display_name, ' ', 1),
       last_name  = nullif(substr(display_name, length(split_part(display_name, ' ', 1)) + 2), '')
 where first_name is null;

-- The same person can't be added twice. Returning patients start a new program on their existing record.
create unique index if not exists patient_same_person
  on patient (lower(first_name), lower(last_name), date_of_birth)
  where date_of_birth is not null;

-- Fake patients get fake birthdays so the screens look realistic.
update patient p
   set date_of_birth = v.dob
  from (values
    ('T-1001', date '1978-03-14'), ('T-1002', date '1985-07-02'), ('T-1003', date '1969-11-23'),
    ('T-1004', date '1991-01-30'), ('T-1005', date '1974-09-09'), ('T-1006', date '1988-05-17'),
    ('T-1007', date '1963-12-04'), ('T-1008', date '1980-08-21'), ('T-1009', date '1995-02-11'),
    ('T-1010', date '1972-06-28'), ('T-1011', date '1983-10-15'), ('T-1012', date '1990-04-06')
  ) as v(code, dob)
 where p.patient_code = v.code and p.date_of_birth is null;


-- ===== supabase/migrations/0007_patient_codes.sql =====
-- FFC Patient Tracker: patients are identified by a short code only.
-- Code = first initial + first 3 letters of last name + last 2 digits of birth year (Mike Smith 1994 -> MSMI94).
-- Full name and date of birth are no longer stored. Safe to run more than once.

-- Convert anyone added with full details (fake patients) to a code first.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'patient' and column_name = 'first_name') then
    -- Two people with the same code get -2, -3... in the order they were added.
    with coded as (
      select id,
             upper(left(regexp_replace(first_name, '[^A-Za-z]', '', 'g'), 1)) ||
             upper(left(regexp_replace(last_name,  '[^A-Za-z]', '', 'g'), 3)) ||
             to_char(date_of_birth, 'YY') as base,
             created_at
        from patient
       where first_name is not null and last_name is not null and date_of_birth is not null
         and patient_code !~ '^[A-Z]{2,4}[0-9]{2}(-[0-9]+)?$'
    ), numbered as (
      select id, base, row_number() over (partition by base order by created_at, id) as n from coded
    )
    update patient p
       set patient_code = case when n.n = 1 then n.base else n.base || '-' || n.n end
      from numbered n
     where p.id = n.id;
  end if;
end $$;

drop trigger if exists patient_names on patient;
drop function if exists patient_names();
drop index if exists patient_same_person;
alter table patient drop column if exists first_name;
alter table patient drop column if exists last_name;
alter table patient drop column if exists date_of_birth;

-- Screens show display_name; it always equals the code now.
alter table patient alter column patient_code drop default;
drop sequence if exists patient_code_seq;

create or replace function patient_display_is_code() returns trigger
language plpgsql set search_path = public as $$
begin
  new.patient_code := trim(new.patient_code);
  new.display_name := new.patient_code;
  return new;
end $$;

drop trigger if exists patient_display_is_code on patient;
create trigger patient_display_is_code
  before insert or update on patient
  for each row execute function patient_display_is_code();

update patient set display_name = patient_code where display_name is distinct from patient_code;

-- Codes must look like MSMI94, with -2, -3... for a second person who shares a code.
alter table patient drop constraint if exists patient_code_format;
alter table patient add constraint patient_code_format
  check (patient_code ~ '^[A-Z]{2,4}[0-9]{2}(-[0-9]+)?$') not valid;

-- Old audit entries for patients held full names. Remove those fields from the log.
update audit_log
   set detail = detail - 'first_name' - 'last_name' - 'date_of_birth'
 where record_type = 'patient'
   and (detail ? 'first_name' or detail ? 'last_name' or detail ? 'date_of_birth');


-- ===== supabase/migrations/0008_fake_patient_codes.sql =====
-- FFC Patient Tracker: give the fake test patients proper codes (MSMI94 style)
-- if they still have their placeholder IDs (T-1001...). Safe to run more than once.

update patient p
   set patient_code = v.code
  from (values
    ('T-1001', 'ATES78'), ('T-1002', 'BSAM85'), ('T-1003', 'CDEM69'), ('T-1004', 'DFAK91'),
    ('T-1005', 'EMOC74'), ('T-1006', 'FTES88'), ('T-1007', 'GSAM63'), ('T-1008', 'HDEM80'),
    ('T-1009', 'IFAK95'), ('T-1010', 'JMOC72'), ('T-1011', 'KTES83'), ('T-1012', 'LSAM90')
  ) as v(old_code, code)
 where p.patient_code = v.old_code
   and not exists (select 1 from patient x where x.patient_code = v.code);


-- ===== supabase/migrations/0009_p1_cost_model.sql =====
-- FFC Patient Tracker: Protocol I cost model
-- Consults and staff are one $1,500 line. Testing has a $900 budget. Supplements stay at $600.
-- Safe to run more than once.

alter table program add column if not exists test_budget numeric(10,2);

update program
   set consult_cost = 1500,      -- consults and staff time together
       staff_time_cost = 0,
       test_budget = 900,
       supplement_budget = 600
 where code = 'P1';

-- Margin view: adds the testing budget and what's left of it.
create or replace view v_p1_margin with (security_invoker = true) as
select e.id as enrollment_id, p.patient_code, p.display_name, e.status, e.start_date,
       e.amount_paid                                   as fee,
       pr.consult_cost,
       pr.staff_time_cost,
       coalesce(t.test_costs, 0)                       as test_costs,
       coalesce(sl.supplement_cost, 0)                 as supplement_cost,
       pr.supplement_budget,
       pr.supplement_budget - coalesce(sl.supplement_cost, 0) as supplement_remaining,
       e.amount_paid - pr.consult_cost - pr.staff_time_cost
         - coalesce(t.test_costs, 0) - coalesce(sl.supplement_cost, 0) as margin,
       pr.test_budget,
       pr.test_budget - coalesce(t.test_costs, 0)      as test_remaining
from enrollment e
join program pr on pr.id = e.program_id and pr.code = 'P1'
join patient p  on p.id = e.patient_id
left join (select enrollment_id, sum(cost) as test_costs from test_cost_log group by 1) t
       on t.enrollment_id = e.id
left join (select enrollment_id, sum(wholesale_cost) as supplement_cost from supplement_log group by 1) sl
       on sl.enrollment_id = e.id
where e.status <> 'cancelled';

grant select on v_p1_margin to authenticated;


-- ===== supabase/migrations/0010_fhe_sessions.sql =====
-- FFC Waypoint: FHE Visit 1 and Visit 2 are staff sessions, not physician visits.
-- Renames them in FHE and in Protocol II (which includes the FHE). Safe to run more than once.

update program_stage s
   set name = case s.name when 'Visit 1' then 'Session 1' when 'Visit 2' then 'Session 2' end
  from program p
 where p.id = s.program_id
   and p.code in ('FHE', 'P2')
   and s.name in ('Visit 1', 'Visit 2');


-- ===== supabase/migrations/0011_followups.sql =====
-- FFC Waypoint: follow-up programs (Lab follow-up, Functional test follow-up)
-- - Optional steps: never late, never hold up the rest, don't keep a program open.
-- - Follow-ups record the test name and whether it was prepaid.
-- - A follow-up may run at the same time as Protocol II, and nothing else.
-- Safe to run more than once.

-------------------------------------------------------------------------------
-- New fields
-------------------------------------------------------------------------------
alter table program       add column if not exists kind text not null default 'program';  -- program | followup
alter table step_template add column if not exists optional boolean not null default false;
alter table enrollment    add column if not exists detail text;      -- e.g. the test name
alter table enrollment    add column if not exists prepaid boolean;  -- functional tests only

-------------------------------------------------------------------------------
-- Overlap rule (replaces "one open program per patient")
-------------------------------------------------------------------------------
drop index if exists one_open_enrollment_per_patient;

create or replace function check_enrollment_overlap() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
  v_code text;
  v_other record;
begin
  if new.status not in ('active', 'paused') then return new; end if;
  select kind, code into v_kind, v_code from program where id = new.program_id;

  for v_other in
    select e.id, p.kind, p.code
    from enrollment e join program p on p.id = e.program_id
    where e.patient_id = new.patient_id and e.id <> new.id and e.status in ('active', 'paused')
  loop
    -- Allowed: one follow-up alongside an open Protocol II.
    if (v_kind = 'followup' and v_other.code = 'P2') or (v_code = 'P2' and v_other.kind = 'followup') then
      continue;
    end if;
    raise exception 'one_open_enrollment_per_patient: this patient already has an open %', v_other.code
      using errcode = '23505';
  end loop;
  return new;
end $$;

drop trigger if exists check_enrollment_overlap on enrollment;
create trigger check_enrollment_overlap
  before insert or update of status, patient_id, program_id on enrollment
  for each row execute function check_enrollment_overlap();

-------------------------------------------------------------------------------
-- Completion ignores optional steps; leftovers are marked skipped when the rest is done
-------------------------------------------------------------------------------
create or replace function step_after_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_remaining int;
begin
  if coalesce(current_setting('ffc.shifting', true), 'off') = 'on' then
    return null;
  end if;

  if new.status = 'done' and old.status <> 'done' and new.completed_on > new.due_date then
    perform apply_shift(new.id, new.completed_on);
  elsif new.due_date > old.due_date and new.status in ('not_started', 'in_progress') then
    perform apply_shift(new.id, new.due_date);
  end if;

  select count(*) into v_remaining
  from step s join step_template t on t.id = s.template_id
  where s.enrollment_id = new.enrollment_id and s.status in ('not_started', 'in_progress') and not t.optional;

  if v_remaining = 0 and exists (select 1 from enrollment where id = new.enrollment_id and status = 'active') then
    perform set_config('ffc.shifting', 'on', true);
    update step s set status = 'skipped', notes = coalesce(s.notes, 'Optional, not recorded')
      from step_template t
     where t.id = s.template_id and s.enrollment_id = new.enrollment_id
       and t.optional and s.status in ('not_started', 'in_progress');
    perform set_config('ffc.shifting', 'off', true);

    update enrollment
       set status = 'completed',
           completed_on = (select max(completed_on) from step where enrollment_id = new.enrollment_id)
     where id = new.enrollment_id and status = 'active';
  end if;

  return null;
end $$;

-------------------------------------------------------------------------------
-- Enrolling: test name, prepaid, and "review at a Protocol II consult"
-------------------------------------------------------------------------------
drop function if exists enroll_patient(uuid, text, date, numeric, date);
create or replace function enroll_patient(
  p_patient_id    uuid,
  p_program_code  text,
  p_start_date    date,
  p_amount_paid   numeric default 0,
  p_paid_date     date default null,
  p_detail        text default null,
  p_prepaid       boolean default null,
  p_review_at_p2  boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_program    program;
  v_enrollment uuid;
  v_start      date := snap_clinic_day(p_start_date);
begin
  perform require_staff();
  select * into v_program from program where code = p_program_code and active;
  if not found then
    raise exception 'Unknown program: %', p_program_code;
  end if;

  insert into enrollment (patient_id, program_id, start_date, amount_paid, paid_date, detail, prepaid)
  values (p_patient_id, v_program.id, v_start, p_amount_paid, p_paid_date,
          nullif(trim(p_detail), ''), p_prepaid)
  returning id into v_enrollment;

  insert into step (enrollment_id, template_id, owner_role, due_date)
  select v_enrollment, t.id, t.owner_role, snap_clinic_day(v_start + t.offset_days)
  from step_template t
  where t.program_id = v_program.id;

  -- Results to be gone over at the patient's next Protocol II consult instead of a separate one.
  if p_review_at_p2 and v_program.kind = 'followup' then
    perform set_config('ffc.shifting', 'on', true);
    update step s set status = 'skipped', notes = 'Results reviewed at the next Protocol II consult'
      from step_template t
     where t.id = s.template_id and s.enrollment_id = v_enrollment and t.key like '%_consult';
    perform set_config('ffc.shifting', 'off', true);
  end if;

  return v_enrollment;
end $$;

revoke execute on function enroll_patient(uuid, text, date, numeric, date, text, boolean, boolean) from public, anon;
grant execute on function enroll_patient(uuid, text, date, numeric, date, text, boolean, boolean) to authenticated;

-------------------------------------------------------------------------------
-- The two follow-up programs
-------------------------------------------------------------------------------
insert into program (code, name, price, length_days, kind)
values ('LAB', 'Lab follow-up', 0, 14, 'followup'),
       ('FT',  'Functional test follow-up', 0, 35, 'followup')
on conflict (code) do nothing;

do $$
declare v_lab uuid; v_ft uuid;
begin
  select id into v_lab from program where code = 'LAB';
  select id into v_ft  from program where code = 'FT';

  if not exists (select 1 from program_stage where program_id = v_lab) then
    insert into program_stage (program_id, name, sort) values
      (v_lab, 'Lab order', 1), (v_lab, 'Results', 2), (v_lab, 'Results consult', 3);
    insert into step_template (program_id, stage_id, key, name, owner_role, offset_days, sort, blocked_by_keys, optional)
    select v_lab, (select id from program_stage where program_id = v_lab and sort = x.stage), x.key, x.name, x.owner::user_role,
           x.day, x.sort, x.blocked, x.optional
    from (values
      (1, 'lab_order',    'Lab order given to patient', 'staff',      0, 10, '{}'::text[],      false),
      (1, 'lab_drawn',    'Bloodwork drawn',            'staff',      3, 11, '{}'::text[],      true),
      (2, 'lab_results',  'Results received',           'staff',     10, 20, '{}'::text[],      false),
      (3, 'lab_consult',  'Results consult',            'physician', 14, 30, '{lab_results}',   false)
    ) as x(stage, key, name, owner, day, sort, blocked, optional);
  end if;

  if not exists (select 1 from program_stage where program_id = v_ft) then
    insert into program_stage (program_id, name, sort) values
      (v_ft, 'Test ordered', 1), (v_ft, 'Sample', 2), (v_ft, 'Results', 3), (v_ft, 'Results consult', 4);
    insert into step_template (program_id, stage_id, key, name, owner_role, offset_days, sort, blocked_by_keys, optional)
    select v_ft, (select id from program_stage where program_id = v_ft and sort = x.stage), x.key, x.name, x.owner::user_role,
           x.day, x.sort, x.blocked, false
    from (values
      (1, 'ft_kit',      'Test ordered, kit given to patient', 'staff',      0, 10, '{}'::text[]),
      (2, 'ft_sample',   'Sample sent by patient',             'staff',     10, 20, '{}'::text[]),
      (3, 'ft_results',  'Results received',                   'staff',     28, 30, '{}'::text[]),
      (4, 'ft_consult',  'Results consult',                    'physician', 35, 40, '{ft_results}')
    ) as x(stage, key, name, owner, day, sort, blocked);
  end if;
end $$;

-------------------------------------------------------------------------------
-- Views: optional steps are never late and don't hold a stage open
-------------------------------------------------------------------------------
create or replace view v_steps with (security_invoker = true) as
select s.id              as step_id,
       s.enrollment_id,
       e.status          as enrollment_status,
       p.id              as patient_id,
       p.patient_code,
       p.display_name,
       pr.code           as program_code,
       pr.name           as program_name,
       ps.name           as stage_name,
       ps.sort           as stage_sort,
       t.key             as step_key,
       t.name            as step_name,
       t.sort            as step_sort,
       s.owner_role,
       s.owner_id,
       su.name           as owner_name,
       s.due_date,
       s.status,
       s.completed_on,
       s.notes,
       (s.status in ('not_started', 'in_progress') and s.due_date < current_date and not t.optional) as is_overdue,
       exists (
         select 1 from step_template bt
         join step b on b.template_id = bt.id and b.enrollment_id = s.enrollment_id
         where t.block_enabled
           and bt.program_id = t.program_id
           and bt.key = any (t.blocked_by_keys)
           and b.status not in ('done', 'skipped')
       ) as is_blocked,
       t.optional
from step s
join enrollment e     on e.id = s.enrollment_id
join patient p        on p.id = e.patient_id
join step_template t  on t.id = s.template_id
join program_stage ps on ps.id = t.stage_id
join program pr       on pr.id = t.program_id
left join staff_user su on su.id = s.owner_id;

create or replace view v_enrollments with (security_invoker = true) as
with stage_state as (
  select s.enrollment_id, ps.id as stage_id, ps.name as stage_name, ps.sort,
         bool_and(s.status in ('done', 'skipped') or t.optional) as stage_done,
         max(s.completed_on) as stage_finished_on
  from step s
  join step_template t  on t.id = s.template_id
  join program_stage ps on ps.id = t.stage_id
  group by s.enrollment_id, ps.id, ps.name, ps.sort
),
current_stage as (
  select distinct on (enrollment_id) enrollment_id, stage_name, sort
  from stage_state where not stage_done
  order by enrollment_id, sort
)
select e.id as enrollment_id,
       p.id as patient_id, p.patient_code, p.display_name,
       pr.code as program_code, pr.name as program_name,
       e.start_date, e.status, e.amount_paid, e.completed_on, e.converted_from,
       cs.stage_name as current_stage,
       greatest(0, coalesce(
         current_date - (select max(ss.stage_finished_on) from stage_state ss
                          where ss.enrollment_id = e.id and ss.stage_done and ss.sort < cs.sort),
         current_date - e.start_date
       )) as days_in_stage,
       (select count(*) from step s join step_template t on t.id = s.template_id
         where s.enrollment_id = e.id and not t.optional
           and s.status in ('not_started', 'in_progress') and s.due_date < current_date) as overdue_steps,
       (select min(s.due_date) from step s join step_template t on t.id = s.template_id
         where s.enrollment_id = e.id and not t.optional
           and s.status in ('not_started', 'in_progress')) as next_due,
       (select max(s.due_date) from step s where s.enrollment_id = e.id) as planned_end,
       e.detail,
       e.prepaid,
       pr.kind as program_kind
from enrollment e
join patient p  on p.id = e.patient_id
join program pr on pr.id = e.program_id
left join current_stage cs on cs.enrollment_id = e.id;

grant select on v_steps, v_enrollments to authenticated;


-- ===== supabase/migrations/0012_supplement_supply.sql =====
-- FFC Waypoint: supplement size, dose, run-out date and refill reminders.
-- Safe to run more than once.

alter table supplement_log add column if not exists size        int;            -- units per bottle (90 capsules, 30 scoops)
alter table supplement_log add column if not exists unit_form   text;           -- capsules, softgels, tablets, scoops, mL, drops
alter table supplement_log add column if not exists packages    int not null default 1;
alter table supplement_log add column if not exists daily_dose  numeric(6,2);   -- units per day
alter table supplement_log add column if not exists refill_status text;         -- null (open), refilled, stopped
alter table supplement_log add column if not exists refill_updated_on date;

-- Run-out date = date given + (size x bottles / daily dose). Empty when size or dose isn't known.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_name = 'supplement_log' and column_name = 'run_out_date') then
    alter table supplement_log add column run_out_date date
      generated always as (given_on + floor(size * packages / nullif(daily_dose, 0))::int) stored;
  end if;
end $$;

alter table supplement_log drop constraint if exists supplement_refill_status;
alter table supplement_log add constraint supplement_refill_status
  check (refill_status is null or refill_status in ('refilled', 'stopped'));

-- Logging the same supplement again for the same patient closes the reminder on the earlier one.
create or replace function supplement_mark_refilled() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update supplement_log
     set refill_status = 'refilled', refill_updated_on = new.given_on
   where enrollment_id = new.enrollment_id
     and id <> new.id
     and lower(trim(item)) = lower(trim(new.item))
     and refill_status is null
     and given_on <= new.given_on;
  return null;
end $$;

drop trigger if exists supplement_mark_refilled on supplement_log;
create trigger supplement_mark_refilled
  after insert on supplement_log
  for each row execute function supplement_mark_refilled();

-- Refill reminders: open supplements for active programs, with the patient.
create or replace view v_supplement_supply with (security_invoker = true) as
select sl.id, sl.enrollment_id, e.patient_id, p.patient_code, pr.code as program_code, e.status as enrollment_status,
       sl.item, sl.size, sl.unit_form, sl.packages, sl.daily_dose, sl.given_on, sl.run_out_date,
       sl.refill_status, sl.refill_updated_on
from supplement_log sl
join enrollment e on e.id = sl.enrollment_id
join patient p    on p.id = e.patient_id
join program pr   on pr.id = e.program_id;

grant select on v_supplement_supply to authenticated;


-- ===== supabase/seed.sql =====
-- FFC Patient Tracker: FAKE data for testing. No real patients.
-- Dates are relative to today so the timeline always looks current.

insert into staff_user (name, role) values
  ('Admin Tester',       'admin'),
  ('Dr. Test Physician', 'physician'),
  ('Front Desk Tester',  'staff'),
  ('Clinical Tester',    'staff'),
  ('Intern Tester',      'staff');

insert into patient (patient_code) values
  ('ATES78'),
  ('BSAM85'),
  ('CDEM69'),
  ('DFAK91'),
  ('EMOC74'),
  ('FTES88'),
  ('GSAM63'),
  ('HDEM80'),
  ('IFAK95'),
  ('JMOC72'),
  ('KTES83'),
  ('LSAM90');

do $$
declare
  e uuid;
  pid uuid;
  fdesk uuid := (select id from staff_user where name = 'Front Desk Tester');
begin
  -- T-1001 FHE, just did Visit 1
  pid := (select id from patient where patient_code = 'ATES78');
  e := enroll_patient(pid, 'FHE', current_date - 3, 950, current_date - 3);
  update step set status = 'done', completed_on = due_date
   where enrollment_id = e and template_id in (select id from step_template where key like 'fhe_v1_%');

  -- T-1002 FHE, through Visit 2, Visit 2 happened 3 days late (timeline shifted)
  pid := (select id from patient where patient_code = 'BSAM85');
  e := enroll_patient(pid, 'FHE', current_date - 16, 950, current_date - 16);
  update step set status = 'done', completed_on = due_date
   where enrollment_id = e and template_id in (select id from step_template where key like 'fhe_v1_%');
  update step s set status = 'done', completed_on = s.due_date + 2
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'fhe_v2_bodycomp';
  update step s set status = 'done', completed_on = s.due_date + 2
    from step_template t where t.id = s.template_id and s.enrollment_id = e
     and t.key in ('fhe_v2_eeg_pickup', 'fhe_v2_grip');
  update step s set status = 'done', completed_on = s.due_date + 2
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'fhe_v2_bolt';

  -- T-1003 FHE, waiting on physician scores (overdue)
  pid := (select id from patient where patient_code = 'CDEM69');
  e := enroll_patient(pid, 'FHE', current_date - 26, 950, current_date - 26);
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e
     and t.key in ('fhe_v1_bloodwork','fhe_v1_metabolomics','fhe_v1_omegaquant',
                   'fhe_v2_eeg_pickup','fhe_v2_bodycomp');
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'fhe_v2_grip';
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'fhe_v2_bolt';
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e
     and t.key in ('fhe_eeg_returned', 'fhe_vitality_score');

  -- T-1004 P1, week 6
  pid := (select id from patient where patient_code = 'DFAK91');
  e := enroll_patient(pid, 'P1', current_date - 42, 3000, current_date - 42);
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e
     and t.key in ('p1_test1_ordered', 'p1_supp_started');
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'p1_test1_results';
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'p1_consult1';
  insert into test_cost_log (enrollment_id, test_name, cost, logged_on) values (e, 'GI-MAP', 450, current_date - 42);
  insert into supplement_log (enrollment_id, item, retail_price, given_on, given_by) values
    (e, 'Magnesium glycinate', 48, current_date - 42, fdesk),
    (e, 'Omega-3 1000mg',      62, current_date - 42, fdesk),
    (e, 'Probiotic 50B',       70, current_date - 14, fdesk);

  -- T-1005 P1, week 18, heavy supplement use (close to budget)
  pid := (select id from patient where patient_code = 'EMOC74');
  e := enroll_patient(pid, 'P1', current_date - 126, 3000, current_date - 126);
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e
     and t.key in ('p1_test1_ordered','p1_supp_started');
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'p1_test1_results';
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e
     and t.key in ('p1_consult1','p1_consult2','p1_test2_ordered');
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'p1_test2_results';
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'p1_consult3';
  insert into test_cost_log (enrollment_id, test_name, cost, logged_on) values
    (e, 'Organic acids test', 380, current_date - 126),
    (e, 'Organic acids test (repeat)', 380, current_date - 56);
  insert into supplement_log (enrollment_id, item, retail_price, given_on, given_by)
  select e, 'Supplement bundle ' || g, 210, current_date - 126 + g * 21, fdesk
  from generate_series(0, 4) g;

  -- T-1006 Two-Step, between sessions
  pid := (select id from patient where patient_code = 'FTES88');
  e := enroll_patient(pid, 'TS', current_date - 2, 495, current_date - 2);
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'ts_payment';
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'ts_session1';

  -- T-1007 Two-Step, starting next week, not paid yet
  pid := (select id from patient where patient_code = 'GSAM63');
  e := enroll_patient(pid, 'TS', current_date + 5, 0, null);

  -- T-1008 P2, month 4 (FHE done, consult 1 overdue)
  pid := (select id from patient where patient_code = 'HDEM80');
  e := enroll_patient(pid, 'P2', current_date - 100, 1650, current_date - 100);
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e
     and t.key in ('fhe_v1_bloodwork','fhe_v1_metabolomics','fhe_v1_omegaquant',
                   'fhe_v2_eeg_pickup','fhe_v2_bodycomp');
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'fhe_v2_grip';
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'fhe_v2_bolt';
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e
     and t.key in ('fhe_eeg_returned','fhe_vitality_score','fhe_lab_score');
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'fhe_sleep_score';
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'fhe_cover_sheet';
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key in ('fhe_packet','fhe_v3_consult');

  -- T-1009 P1 just started
  pid := (select id from patient where patient_code = 'IFAK95');
  e := enroll_patient(pid, 'P1', current_date - 1, 3000, current_date - 1);

  -- T-1010 FHE starting this week
  pid := (select id from patient where patient_code = 'JMOC72');
  e := enroll_patient(pid, 'FHE', current_date + 2, 950, current_date);

  -- Devices
  insert into device_rental (patient_id, device_type, device_label, out_date, due_back_date) values
    ((select id from patient where patient_code = 'KTES83'), 'Firstbeat monitor', 'FB-03', current_date - 40, current_date - 40 + 91),
    ((select id from patient where patient_code = 'LSAM90'), 'Firstbeat monitor', 'FB-01', current_date - 100, current_date - 100 + 91),
    ((select id from patient where patient_code = 'BSAM85'), 'Sleep EEG (SP40)',  'EEG-2', current_date - 5,  current_date - 1);
end $$;
