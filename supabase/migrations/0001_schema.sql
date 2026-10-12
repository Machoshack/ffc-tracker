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
