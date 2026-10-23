-- FFC Waypoint: supplements for every patient, and the supplement list from Square.
-- 1. A supplement belongs to the patient. It counts against the Protocol I budget only when it is
--    given while that patient's Protocol I is open (active or paused).
-- 2. Products and sizes are copied from Square (reporting category "Product"). Square stays the
--    source for names and prices; Waypoint adds units per bottle and lets admins hide products.
-- Safe to run more than once.

-------------------------------------------------------------------------------
-- 1. Supplements belong to the patient
-------------------------------------------------------------------------------
alter table supplement_log add column if not exists patient_id uuid references patient(id) on delete cascade;
update supplement_log sl set patient_id = e.patient_id
  from enrollment e where e.id = sl.enrollment_id and sl.patient_id is null;
alter table supplement_log alter column patient_id set not null;
create index if not exists supplement_log_patient_idx on supplement_log (patient_id);

-- The Protocol I link is now optional, and removing a program keeps the patient's supplements.
alter table supplement_log alter column enrollment_id drop not null;
alter table supplement_log drop constraint if exists supplement_log_enrollment_id_fkey;
alter table supplement_log add constraint supplement_log_enrollment_id_fkey
  foreign key (enrollment_id) references enrollment(id) on delete set null;

-- Fill in the patient, attach to an open Protocol I if there is one, and fill wholesale from retail.
create or replace function supplement_before_insert() returns trigger
language plpgsql set search_path = public as $$
declare
  v_rate numeric;
begin
  if new.patient_id is null and new.enrollment_id is not null then
    select patient_id into new.patient_id from enrollment where id = new.enrollment_id;
  end if;

  if new.enrollment_id is null then
    select e.id into new.enrollment_id
      from enrollment e join program p on p.id = e.program_id
     where e.patient_id = new.patient_id and p.code = 'P1' and e.status in ('active', 'paused')
     order by e.start_date desc
     limit 1;
  end if;

  if new.wholesale_cost is null then
    select p.wholesale_rate into v_rate
      from enrollment e join program p on p.id = e.program_id
     where e.id = new.enrollment_id;
    if v_rate is null then
      select wholesale_rate into v_rate from program where code = 'P1';
    end if;
    new.wholesale_cost := round(new.retail_price * coalesce(v_rate, 0.5), 2);
  end if;

  if new.given_by is null then
    new.given_by := current_staff_id();
  end if;
  return new;
end $$;

-- Logging the same supplement again for the same patient closes the reminder on the earlier one,
-- whichever program it was given under.
create or replace function supplement_mark_refilled() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update supplement_log
     set refill_status = 'refilled', refill_updated_on = new.given_on
   where patient_id = new.patient_id
     and id <> new.id
     and (lower(trim(item)) = lower(trim(new.item))
          or (new.size_id is not null and size_id is not null
              and (select product_id from supplement_size where id = size_id)
                = (select product_id from supplement_size where id = new.size_id)))
     and refill_status is null
     and given_on <= new.given_on;
  return null;
end $$;

-------------------------------------------------------------------------------
-- 2. Supplement list from Square
-------------------------------------------------------------------------------
create table if not exists supplement_product (
  id              uuid primary key default gen_random_uuid(),
  square_item_id  text unique,
  name            text not null,
  hidden          boolean not null default false,   -- admins hide non-supplements from the pick list
  in_square       boolean not null default true,    -- false once it's gone from Square or from Products
  updated_at      timestamptz not null default now()
);

create table if not exists supplement_size (
  id                   uuid primary key default gen_random_uuid(),
  product_id           uuid not null references supplement_product(id) on delete cascade,
  square_variation_id  text unique,
  name                 text not null,                -- Square's name for the size, e.g. "60 caps"
  retail_price         numeric(10,2),                -- per bottle; empty if Square has no set price
  size                 int check (size is null or size > 0),   -- units per bottle, entered in Waypoint
  unit_form            text check (unit_form is null or unit_form in
                         ('capsules', 'softgels', 'tablets', 'scoops', 'mL', 'drops', 'packets')),
  in_square            boolean not null default true,
  sort                 int not null default 0
);
create index if not exists supplement_size_product_idx on supplement_size (product_id);

-- When the list was last copied from Square.
create table if not exists catalog_sync (
  id          int primary key default 1 check (id = 1),
  synced_at   timestamptz,
  result      text,
  synced_by   uuid references staff_user(id)
);
insert into catalog_sync (id) values (1) on conflict do nothing;

alter table supplement_log add column if not exists size_id uuid references supplement_size(id) on delete set null;

-- Copies the Square list in. The app reads Square and passes the products here as JSON:
-- [{ "item_id", "name", "sizes": [{ "variation_id", "name", "price", "sort", "guess_size", "guess_form" }] }]
-- Names and prices always follow Square. Units per bottle are only guessed for new sizes; once
-- someone has entered them, the sync leaves them alone.
create or replace function sync_supplement_catalog(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_item jsonb;
  v_size jsonb;
  v_product uuid;
  v_new_products int := 0;
  v_products int := 0;
  v_sizes int := 0;
  v_item_ids text[] := '{}';
  v_variation_ids text[] := '{}';
  v_removed int;
begin
  if current_staff_role() is null then
    raise exception 'not_staff: only staff can update the supplement list';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_products := v_products + 1;
    v_item_ids := v_item_ids || (v_item->>'item_id');

    select id into v_product from supplement_product where square_item_id = v_item->>'item_id';
    if v_product is null then
      insert into supplement_product (square_item_id, name)
      values (v_item->>'item_id', trim(v_item->>'name'))
      returning id into v_product;
      v_new_products := v_new_products + 1;
    else
      update supplement_product
         set name = trim(v_item->>'name'), in_square = true, updated_at = now()
       where id = v_product
         and (name is distinct from trim(v_item->>'name') or not in_square);
    end if;

    for v_size in select * from jsonb_array_elements(coalesce(v_item->'sizes', '[]'::jsonb)) loop
      v_sizes := v_sizes + 1;
      v_variation_ids := v_variation_ids || (v_size->>'variation_id');
      insert into supplement_size (product_id, square_variation_id, name, retail_price, sort, size, unit_form)
      values (v_product, v_size->>'variation_id', trim(v_size->>'name'), (v_size->>'price')::numeric,
              coalesce((v_size->>'sort')::int, 0), (v_size->>'guess_size')::int, v_size->>'guess_form')
      on conflict (square_variation_id) do update
         set product_id   = excluded.product_id,
             name         = excluded.name,
             retail_price = excluded.retail_price,
             sort         = excluded.sort,
             in_square    = true,
             size         = coalesce(supplement_size.size, excluded.size),
             unit_form    = coalesce(supplement_size.unit_form, excluded.unit_form)
       where (supplement_size.product_id, supplement_size.name, supplement_size.retail_price, supplement_size.sort, supplement_size.in_square)
             is distinct from (excluded.product_id, excluded.name, excluded.retail_price, excluded.sort, true)
          or (supplement_size.size is null and excluded.size is not null)
          or (supplement_size.unit_form is null and excluded.unit_form is not null);
    end loop;
  end loop;

  -- Anything no longer in Square's Products category drops off the pick list (kept for history).
  update supplement_product set in_square = false, updated_at = now()
   where in_square and square_item_id is not null and not (square_item_id = any (v_item_ids));
  get diagnostics v_removed = row_count;
  update supplement_size set in_square = false
   where in_square and square_variation_id is not null and not (square_variation_id = any (v_variation_ids));

  update catalog_sync
     set synced_at = now(),
         synced_by = current_staff_id(),
         result = format('%s products, %s sizes, %s new, %s removed', v_products, v_sizes, v_new_products, v_removed)
   where id = 1;

  return jsonb_build_object('products', v_products, 'sizes', v_sizes, 'new_products', v_new_products, 'removed', v_removed);
end $$;

-------------------------------------------------------------------------------
-- What the screens read
-------------------------------------------------------------------------------
-- Refill reminders: every patient's open supplements, whether or not they're in a program.
drop view if exists v_supplement_supply;
create view v_supplement_supply with (security_invoker = true) as
select sl.id, sl.enrollment_id, sl.patient_id, p.patient_code, pr.code as program_code, e.status as enrollment_status,
       sl.item, sl.size, sl.unit_form, sl.packages, sl.daily_dose, sl.given_on, sl.run_out_date,
       sl.refill_status, sl.refill_updated_on, (pr.code = 'P1') is true as counts_toward_p1
from supplement_log sl
join patient p         on p.id = sl.patient_id
left join enrollment e on e.id = sl.enrollment_id
left join program pr   on pr.id = e.program_id;

-- The pick list: products shown to staff, one row per size.
create or replace view v_supplement_choices with (security_invoker = true) as
select s.id as size_id, sp.id as product_id, sp.name as product_name, s.name as size_name,
       s.retail_price, s.size, s.unit_form, s.sort
from supplement_size s
join supplement_product sp on sp.id = s.product_id
where sp.in_square and not sp.hidden and s.in_square;

-------------------------------------------------------------------------------
-- Access
-------------------------------------------------------------------------------
alter table supplement_product enable row level security;
alter table supplement_size    enable row level security;
alter table catalog_sync       enable row level security;

drop policy if exists supplement_product_read on supplement_product;
create policy supplement_product_read on supplement_product for select to authenticated
  using (current_staff_role() is not null);
drop policy if exists supplement_product_admin on supplement_product;
create policy supplement_product_admin on supplement_product for update to authenticated
  using (current_staff_role() = 'admin') with check (current_staff_role() = 'admin');

drop policy if exists supplement_size_read on supplement_size;
create policy supplement_size_read on supplement_size for select to authenticated
  using (current_staff_role() is not null);
drop policy if exists supplement_size_update on supplement_size;
create policy supplement_size_update on supplement_size for update to authenticated
  using (current_staff_role() is not null) with check (current_staff_role() is not null);

drop policy if exists catalog_sync_read on catalog_sync;
create policy catalog_sync_read on catalog_sync for select to authenticated
  using (current_staff_role() is not null);

-- New tables start with no rights; give back only what's needed.
-- Any staff member: units per bottle and form. Admins: hide or show a product.
revoke all on supplement_product, supplement_size, catalog_sync from anon, authenticated;
grant select on supplement_product, supplement_size, catalog_sync to authenticated;
grant update (size, unit_form) on supplement_size to authenticated;
grant update (hidden) on supplement_product to authenticated;
grant select on v_supplement_supply, v_supplement_choices to authenticated;
revoke execute on function sync_supplement_catalog(jsonb) from public, anon;
grant execute on function sync_supplement_catalog(jsonb) to authenticated;

-- Changes to the list are logged like everything else.
drop trigger if exists audit_supplement_product on supplement_product;
create trigger audit_supplement_product after insert or update or delete on supplement_product
  for each row execute function write_audit();
drop trigger if exists audit_supplement_size on supplement_size;
create trigger audit_supplement_size after insert or update or delete on supplement_size
  for each row execute function write_audit();
