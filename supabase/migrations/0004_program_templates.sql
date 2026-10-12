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
  perform _stage(p, 1, 'Visit 1');
  perform _stage(p, 2, 'Visit 2');
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
