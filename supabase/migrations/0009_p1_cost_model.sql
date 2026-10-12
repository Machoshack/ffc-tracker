-- FFC Patient Tracker: Protocol I cost model
-- Consults and staff are one $1,500 line. Testing has a $900 budget. Supplements stay at $600.
-- Safe to run more than once.

alter table program add column if not exists test_budget numeric(10,2);

update program
   set consult_cost = 1500,      -- consults and staff time together
       staff_time_cost = 0,
       test_budget = 900,
       supplement_budget = 600
 where code = 'P1';

-- Margin view: adds the testing budget and what's left of it.
create or replace view v_p1_margin with (security_invoker = true) as
select e.id as enrollment_id, p.patient_code, p.display_name, e.status, e.start_date,
       e.amount_paid                                   as fee,
       pr.consult_cost,
       pr.staff_time_cost,
       coalesce(t.test_costs, 0)                       as test_costs,
       coalesce(sl.supplement_cost, 0)                 as supplement_cost,
       pr.supplement_budget,
       pr.supplement_budget - coalesce(sl.supplement_cost, 0) as supplement_remaining,
       e.amount_paid - pr.consult_cost - pr.staff_time_cost
         - coalesce(t.test_costs, 0) - coalesce(sl.supplement_cost, 0) as margin,
       pr.test_budget,
       pr.test_budget - coalesce(t.test_costs, 0)      as test_remaining
from enrollment e
join program pr on pr.id = e.program_id and pr.code = 'P1'
join patient p  on p.id = e.patient_id
left join (select enrollment_id, sum(cost) as test_costs from test_cost_log group by 1) t
       on t.enrollment_id = e.id
left join (select enrollment_id, sum(wholesale_cost) as supplement_cost from supplement_log group by 1) sl
       on sl.enrollment_id = e.id
where e.status <> 'cancelled';

grant select on v_p1_margin to authenticated;
