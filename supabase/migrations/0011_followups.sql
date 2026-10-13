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
