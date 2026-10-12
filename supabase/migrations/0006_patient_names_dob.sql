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
