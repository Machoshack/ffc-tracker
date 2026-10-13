-- FFC Waypoint: delete the fake staff accounts from the demo data.
-- Only removes the five test names that have no email. Real staff (added with an email) are not touched.
-- Records they're attached to (supplements given, step owners, audit history) stay, with the name cleared.
-- Safe to run more than once.

do $$
declare
  fake uuid[];
begin
  select array_agg(id) into fake
  from staff_user
  where email is null
    and name in ('Admin Tester', 'Alan (admin)', 'Dr. Test Physician', 'Front Desk Tester', 'Clinical Tester', 'Intern Tester');

  if fake is null then
    raise notice 'No demo staff found.';
    return;
  end if;

  update supplement_log set given_by = null where given_by = any (fake);
  update step set owner_id = null where owner_id = any (fake);
  update audit_log set staff_user_id = null where staff_user_id = any (fake);
  delete from staff_user where id = any (fake);
  raise notice 'Removed % demo staff.', array_length(fake, 1);
end $$;

-- Who's left:
select name, email, role, active from staff_user order by name;
