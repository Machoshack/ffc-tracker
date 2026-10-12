-- FFC Patient Tracker: FAKE data for testing. No real patients.
-- Dates are relative to today so the timeline always looks current.

insert into staff_user (name, role) values
  ('Admin Tester',       'admin'),
  ('Dr. Test Physician', 'physician'),
  ('Front Desk Tester',  'staff'),
  ('Clinical Tester',    'staff'),
  ('Intern Tester',      'staff');

insert into patient (patient_code, first_name, last_name, date_of_birth) values
  ('T-1001', 'Avery',   'Test',   '1978-03-14'), ('T-1002', 'Blake',  'Sample', '1985-07-02'),
  ('T-1003', 'Casey',   'Demo',   '1969-11-23'), ('T-1004', 'Drew',   'Fake',   '1991-01-30'),
  ('T-1005', 'Emery',   'Mock',   '1974-09-09'), ('T-1006', 'Finley', 'Test',   '1988-05-17'),
  ('T-1007', 'Gray',    'Sample', '1963-12-04'), ('T-1008', 'Harper', 'Demo',   '1980-08-21'),
  ('T-1009', 'Indy',    'Fake',   '1995-02-11'), ('T-1010', 'Jules',  'Mock',   '1972-06-28'),
  ('T-1011', 'Kai',     'Test',   '1983-10-15'), ('T-1012', 'Lane',   'Sample', '1990-04-06');

do $$
declare
  e uuid;
  pid uuid;
  fdesk uuid := (select id from staff_user where name = 'Front Desk Tester');
begin
  -- T-1001 FHE, just did Visit 1
  pid := (select id from patient where patient_code = 'T-1001');
  e := enroll_patient(pid, 'FHE', current_date - 3, 950, current_date - 3);
  update step set status = 'done', completed_on = due_date
   where enrollment_id = e and template_id in (select id from step_template where key like 'fhe_v1_%');

  -- T-1002 FHE, through Visit 2, Visit 2 happened 3 days late (timeline shifted)
  pid := (select id from patient where patient_code = 'T-1002');
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
  pid := (select id from patient where patient_code = 'T-1003');
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
  pid := (select id from patient where patient_code = 'T-1004');
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
  pid := (select id from patient where patient_code = 'T-1005');
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
  pid := (select id from patient where patient_code = 'T-1006');
  e := enroll_patient(pid, 'TS', current_date - 2, 495, current_date - 2);
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'ts_payment';
  update step s set status = 'done', completed_on = s.due_date
    from step_template t where t.id = s.template_id and s.enrollment_id = e and t.key = 'ts_session1';

  -- T-1007 Two-Step, starting next week, not paid yet
  pid := (select id from patient where patient_code = 'T-1007');
  e := enroll_patient(pid, 'TS', current_date + 5, 0, null);

  -- T-1008 P2, month 4 (FHE done, consult 1 overdue)
  pid := (select id from patient where patient_code = 'T-1008');
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
  pid := (select id from patient where patient_code = 'T-1009');
  e := enroll_patient(pid, 'P1', current_date - 1, 3000, current_date - 1);

  -- T-1010 FHE starting this week
  pid := (select id from patient where patient_code = 'T-1010');
  e := enroll_patient(pid, 'FHE', current_date + 2, 950, current_date);

  -- Devices
  insert into device_rental (patient_id, device_type, device_label, out_date, due_back_date) values
    ((select id from patient where patient_code = 'T-1011'), 'Firstbeat monitor', 'FB-03', current_date - 40, current_date - 40 + 91),
    ((select id from patient where patient_code = 'T-1012'), 'Firstbeat monitor', 'FB-01', current_date - 100, current_date - 100 + 91),
    ((select id from patient where patient_code = 'T-1002'), 'Sleep EEG (SP40)',  'EEG-2', current_date - 5,  current_date - 1);
end $$;
