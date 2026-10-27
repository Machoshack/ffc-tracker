-- FFC Waypoint: Resources tab. Each program gets an execution guide and a list of links (forms, tools).
-- Everyone on staff can read them; only admins can change them. Changes are logged.
-- Safe to run more than once.

create table if not exists program_guide (
  program_id  uuid primary key references program(id) on delete cascade,
  id          uuid not null default gen_random_uuid() unique,   -- for the audit log
  body        text not null default '',                          -- the guide, in simple formatting (# heading, - bullet)
  updated_at  timestamptz not null default now(),
  updated_by  uuid references staff_user(id)
);

create table if not exists program_link (
  id          uuid primary key default gen_random_uuid(),
  program_id  uuid not null references program(id) on delete cascade,
  label       text not null check (length(trim(label)) > 0),
  url         text not null check (url ~ '^https://'),
  note        text,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists program_link_program_idx on program_link (program_id, sort);

-- Who saved the guide, filled in automatically.
create or replace function program_guide_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(current_staff_id(), new.updated_by);
  return new;
end $$;
drop trigger if exists program_guide_stamp on program_guide;
create trigger program_guide_stamp before insert or update on program_guide
  for each row execute function program_guide_stamp();

-- Starting links.
insert into program_link (program_id, label, url, note, sort)
select p.id, v.label, v.url, v.note, v.sort
from (values
  ('FHE', 'FHE scoring matrix', 'https://form.jotform.com/251804748704158', 'JotForm', 1),
  ('FHE', 'Bloodwork slip', 'https://form.jotform.com/251805506276155', 'JotForm. Print and give to the patient at Session 1.', 2),
  ('TS',  'Next step form', 'https://form.jotform.com/252463726199164', 'JotForm. Used in every Two-Step Assessment.', 1)
) as v(code, label, url, note, sort)
join program p on p.code = v.code
where not exists (select 1 from program_link l where l.program_id = p.id and l.url = v.url);

-- Access
alter table program_guide enable row level security;
alter table program_link  enable row level security;

drop policy if exists program_guide_read on program_guide;
create policy program_guide_read on program_guide for select to authenticated using (current_staff_role() is not null);
drop policy if exists program_guide_admin on program_guide;
create policy program_guide_admin on program_guide for all to authenticated
  using (current_staff_role() = 'admin') with check (current_staff_role() = 'admin');

drop policy if exists program_link_read on program_link;
create policy program_link_read on program_link for select to authenticated using (current_staff_role() is not null);
drop policy if exists program_link_admin on program_link;
create policy program_link_admin on program_link for all to authenticated
  using (current_staff_role() = 'admin') with check (current_staff_role() = 'admin');

revoke all on program_guide, program_link from anon, authenticated;
grant select, insert, update, delete on program_guide, program_link to authenticated;
revoke execute on function program_guide_stamp() from public, anon;

drop trigger if exists audit_program_guide on program_guide;
create trigger audit_program_guide after insert or update or delete on program_guide
  for each row execute function write_audit();
drop trigger if exists audit_program_link on program_link;
create trigger audit_program_link after insert or update or delete on program_link
  for each row execute function write_audit();
