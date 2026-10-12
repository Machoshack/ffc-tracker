-- FFC Patient Tracker: give the fake test patients proper codes (MSMI94 style)
-- if they still have their placeholder IDs (T-1001...). Safe to run more than once.

update patient p
   set patient_code = v.code
  from (values
    ('T-1001', 'ATES78'), ('T-1002', 'BSAM85'), ('T-1003', 'CDEM69'), ('T-1004', 'DFAK91'),
    ('T-1005', 'EMOC74'), ('T-1006', 'FTES88'), ('T-1007', 'GSAM63'), ('T-1008', 'HDEM80'),
    ('T-1009', 'IFAK95'), ('T-1010', 'JMOC72'), ('T-1011', 'KTES83'), ('T-1012', 'LSAM90')
  ) as v(old_code, code)
 where p.patient_code = v.old_code
   and not exists (select 1 from patient x where x.patient_code = v.code);
