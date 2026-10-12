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
