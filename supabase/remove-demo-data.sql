-- FFC Patient Tracker: remove the demo data.
-- Deletes the 12 fake patients and everything attached to them (programs, steps, supplements, tests, devices).
-- Deactivates the fake staff accounts (kept, not deleted, because the audit log refers to them).
-- Patients you added yourself are NOT touched. Safe to run more than once.

do $$
declare
  demo_codes text[] := array[
    'ATES78','BSAM85','CDEM69','DFAK91','EMOC74','FTES88','GSAM63','HDEM80','IFAK95','JMOC72','KTES83','LSAM90',
    'T-1001','T-1002','T-1003','T-1004','T-1005','T-1006','T-1007','T-1008','T-1009','T-1010','T-1011','T-1012'];
  demo_ids uuid[];
begin
  select array_agg(id) into demo_ids from patient where patient_code = any (demo_codes);
  if demo_ids is null then
    raise notice 'No demo patients found.';
  else
    -- Steps, supplements and test costs go with their enrollment.
    delete from enrollment where patient_id = any (demo_ids) and converted_from is not null;
    delete from enrollment where patient_id = any (demo_ids);
    delete from device_rental where patient_id = any (demo_ids);
    delete from patient where id = any (demo_ids);
    raise notice 'Removed % demo patients.', array_length(demo_ids, 1);
  end if;

  update staff_user set active = false
   where name in ('Admin Tester', 'Alan (admin)', 'Dr. Test Physician', 'Front Desk Tester', 'Clinical Tester', 'Intern Tester')
     and email is null;
end $$;

-- What's left: run to check.
select patient_code from patient order by patient_code;
