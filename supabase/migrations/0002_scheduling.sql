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
