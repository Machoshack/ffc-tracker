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
