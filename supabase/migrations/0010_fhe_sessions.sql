-- FFC Waypoint: FHE Visit 1 and Visit 2 are staff sessions, not physician visits.
-- Renames them in FHE and in Protocol II (which includes the FHE). Safe to run more than once.

update program_stage s
   set name = case s.name when 'Visit 1' then 'Session 1' when 'Visit 2' then 'Session 2' end
  from program p
 where p.id = s.program_id
   and p.code in ('FHE', 'P2')
   and s.name in ('Visit 1', 'Visit 2');
