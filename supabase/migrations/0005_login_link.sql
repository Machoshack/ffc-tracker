-- FFC Patient Tracker: connect Supabase logins to the staff list
-- A staff row is added with an email. When that person accepts their invite and logs in,
-- their login is linked to the staff row automatically. A login whose email is not on
-- the staff list can sign in but sees nothing and can do nothing.

alter table staff_user add column email text unique;

create or replace function link_staff_login() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update staff_user
     set auth_user_id = new.id
   where lower(email) = lower(new.email)
     and (auth_user_id is null or auth_user_id = new.id);
  return new;
end $$;

create trigger link_staff_login
  after insert or update of email on auth.users
  for each row execute function link_staff_login();

-- When an admin adds a staff row for someone who already has a login, link it right away.
create or replace function staff_link_existing_login() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if new.auth_user_id is null and new.email is not null then
    select id into new.auth_user_id from auth.users where lower(email) = lower(new.email);
  end if;
  return new;
end $$;

create trigger staff_link_existing_login
  before insert or update of email on staff_user
  for each row execute function staff_link_existing_login();

-- First real admin.
insert into staff_user (name, role, email) values ('Alan', 'admin', 'alan.macioszek@gmail.com');

-- "Today" and "overdue" should follow the practice's clock, not UTC.
do $$ begin
  execute format('alter database %I set timezone to %L', current_database(), 'America/New_York');
end $$;
