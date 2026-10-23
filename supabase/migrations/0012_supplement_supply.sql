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
drop view if exists v_supplement_supply;
create view v_supplement_supply with (security_invoker = true) as
select sl.id, sl.enrollment_id, e.patient_id, p.patient_code, pr.code as program_code, e.status as enrollment_status,
       sl.item, sl.size, sl.unit_form, sl.packages, sl.daily_dose, sl.given_on, sl.run_out_date,
       sl.refill_status, sl.refill_updated_on
from supplement_log sl
join enrollment e on e.id = sl.enrollment_id
join patient p    on p.id = e.patient_id
join program pr   on pr.id = e.program_id;

grant select on v_supplement_supply to authenticated;
