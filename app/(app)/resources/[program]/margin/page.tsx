import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCurrentStaff } from '@/lib/supabase/server';
import { weekdayDate } from '@/lib/dates';

type Row = {
  enrollment_id: string;
  patient_code: string;
  status: string;
  start_date: string;
  fee: number;
  consult_cost: number;
  staff_time_cost: number;
  test_costs: number;
  supplement_cost: number;
  supplement_budget: number;
  supplement_remaining: number;
  margin: number;
  test_budget: number | null;
  test_remaining: number | null;
};

const usd = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;
const STATUS: Record<string, string> = { active: 'Active', paused: 'Paused', completed: 'Completed', converted: 'Upgraded' };

export default async function MarginPage({ params, searchParams }: {
  params: Promise<{ program: string }>; searchParams: Promise<{ show?: string }>;
}) {
  if ((await params).program !== 'P1') notFound();
  const { show = 'active' } = await searchParams;
  const { supabase } = await getCurrentStaff();

  let q = supabase
    .from('v_p1_margin')
    .select('enrollment_id, patient_code, status, start_date, fee, consult_cost, staff_time_cost, test_costs, supplement_cost, supplement_budget, supplement_remaining, margin, test_budget, test_remaining')
    .order('margin');
  if (show === 'active') q = q.in('status', ['active', 'paused']);
  const { data, error } = await q;
  const rows = ((data ?? []) as Row[]).map((r) => Object.fromEntries(
    Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]),
  ) as Row);

  // Patient ids for links
  const { data: links } = rows.length
    ? await supabase.from('enrollment').select('id, patient_id').in('id', rows.map((r) => r.enrollment_id))
    : { data: [] };
  const patientOf = new Map((links ?? []).map((l) => [l.id, l.patient_id]));

  const total = (k: keyof Row) => rows.reduce((n, r) => n + Number(r[k]), 0);
  const overBudget = rows.filter((r) => r.supplement_remaining < 0 || Number(r.test_remaining) < 0).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Protocol I Margin</h1>
          <p className="text-sm text-muted">
            Fee minus consults and staff, tests, and supplements (at wholesale). Lowest margin first.
          </p>
        </div>
        <nav className="flex gap-1 text-sm">
          {[['active', 'Active'], ['all', 'All']].map(([k, label]) => (
            <Link key={k} href={`/resources/P1/margin?show=${k}`}
              className={`rounded border px-3 py-1 ${show === k ? 'border-brand bg-brand text-white' : 'border-line bg-white hover:border-brand'}`}>
              {label}
            </Link>
          ))}
        </nav>
      </div>

      {error && <p className="mb-4 text-late">Could not load: {error.message}</p>}

      <section className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded border border-line bg-line text-sm sm:grid-cols-4">
        {[
          ['Patients', String(rows.length)],
          ['Total margin', usd(total('margin'))],
          ['Average margin', rows.length ? usd(total('margin') / rows.length) : '-'],
          ['Over a budget', String(overBudget)],
        ].map(([k, v]) => (
          <div key={k} className="bg-white px-3 py-2">
            <div className="text-xs text-muted">{k}</div>
            <div className={`text-lg font-semibold ${k === 'Over a budget' && overBudget ? 'text-late' : ''}`}>{v}</div>
          </div>
        ))}
      </section>

      {rows.length === 0 ? (
        <p className="rounded border border-line bg-white p-6 text-muted">No Protocol I patients.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-line bg-white">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="border-b border-line bg-paper text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Patient</th>
                <th className="px-3 py-2 font-medium">Started</th>
                <th className="px-3 py-2 text-right font-medium">Fee</th>
                <th className="px-3 py-2 text-right font-medium">Consults and staff</th>
                <th className="px-3 py-2 text-right font-medium">Tests</th>
                <th className="px-3 py-2 text-right font-medium">Testing left</th>
                <th className="px-3 py-2 text-right font-medium">Supplements</th>
                <th className="px-3 py-2 text-right font-medium">Supplements left</th>
                <th className="px-3 py-2 text-right font-medium">Margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.enrollment_id} className="hover:bg-paper">
                  <td className="px-3 py-2">
                    <Link href={`/patients/${patientOf.get(r.enrollment_id)}`} className="font-mono font-semibold text-brand hover:underline">
                      {r.patient_code}
                    </Link>
                    {r.status !== 'active' && <span className="ml-2 text-xs text-muted">{STATUS[r.status] ?? r.status}</span>}
                  </td>
                  <td className="px-3 py-2 text-muted">{weekdayDate(r.start_date)}</td>
                  <td className="px-3 py-2 text-right">{usd(r.fee)}</td>
                  <td className="px-3 py-2 text-right text-muted">{usd(r.consult_cost + r.staff_time_cost)}</td>
                  <td className="px-3 py-2 text-right">{usd(r.test_costs)}</td>
                  <td className={`px-3 py-2 text-right ${Number(r.test_remaining) < 0 ? 'font-medium text-late' : ''}`}>
                    {r.test_remaining == null ? '-' : usd(r.test_remaining)}
                  </td>
                  <td className="px-3 py-2 text-right">{usd(r.supplement_cost)}</td>
                  <td className={`px-3 py-2 text-right ${r.supplement_remaining < 0 ? 'font-medium text-late' : ''}`}>
                    {usd(r.supplement_remaining)}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${r.margin < 0 ? 'text-late' : ''}`}>{usd(r.margin)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line bg-paper font-medium">
              <tr>
                <td className="px-3 py-2" colSpan={2}>Total</td>
                <td className="px-3 py-2 text-right">{usd(total('fee'))}</td>
                <td className="px-3 py-2 text-right">{usd(total('consult_cost') + total('staff_time_cost'))}</td>
                <td className="px-3 py-2 text-right">{usd(total('test_costs'))}</td>
                <td className="px-3 py-2 text-right">{usd(total('test_remaining'))}</td>
                <td className="px-3 py-2 text-right">{usd(total('supplement_cost'))}</td>
                <td className="px-3 py-2 text-right">{usd(total('supplement_remaining'))}</td>
                <td className="px-3 py-2 text-right">{usd(total('margin'))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
