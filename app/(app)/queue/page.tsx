import Link from 'next/link';
import { getCurrentStaff } from '@/lib/supabase/server';
import { addDays, todayInNewYork, weekdayDate } from '@/lib/dates';
import { QuickDone } from './QuickDone';
import { NotRefilling } from './RefillActions';

type QueueStep = {
  step_id: string;
  patient_id: string;
  patient_code: string;
  display_name: string;
  program_code: string;
  stage_name: string;
  step_name: string;
  owner_role: string;
  owner_id: string | null;
  owner_name: string | null;
  due_date: string;
  status: string;
  is_blocked: boolean;
  optional: boolean;
};

const FILTERS = [
  { key: 'mine', label: 'Mine' },
  { key: 'staff', label: 'Staff' },
  { key: 'physician', label: 'Physician' },
  { key: 'all', label: 'Everyone' },
];

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const { supabase, staff } = await getCurrentStaff();
  const params = await searchParams;
  // Admins don't own steps, so they start on everyone's.
  const who = params.who ?? (staff?.role === 'admin' ? 'all' : 'mine');
  const today = todayInNewYork();
  const horizon = addDays(today, 14);

  let q = supabase
    .from('v_steps')
    .select('step_id, patient_id, patient_code, display_name, program_code, stage_name, step_name, owner_role, owner_id, owner_name, due_date, status, is_blocked, optional')
    .in('enrollment_status', ['active'])
    .in('status', ['not_started', 'in_progress'])
    .lte('due_date', horizon)
    .order('due_date')
    .order('display_name');

  if (who === 'mine' && staff) {
    q = q.or(`owner_id.eq.${staff.id},and(owner_id.is.null,owner_role.eq.${staff.role})`);
  } else if (who === 'staff' || who === 'physician') {
    q = q.eq('owner_role', who);
  }
  const { data, error } = await q;

  // Supplements running out within 14 days, for every patient, in a program or not (staff work, so not on the physician view).
  const showRefills = who === 'all' || who === 'staff' || (who === 'mine' && staff?.role !== 'physician');
  const { data: refillRows } = showRefills
    ? await supabase.from('v_supplement_supply')
        .select('id, patient_id, patient_code, item, size, unit_form, packages, daily_dose, run_out_date')
        .is('refill_status', null)
        .not('run_out_date', 'is', null)
        .lte('run_out_date', addDays(today, 14))
        .order('run_out_date')
    : { data: [] };
  const refills = (refillRows ?? []) as {
    id: string; patient_id: string; patient_code: string; item: string; size: number; unit_form: string;
    packages: number; daily_dose: number; run_out_date: string;
  }[];
  // Optional steps (like "bloodwork drawn") show while upcoming but never land in Overdue.
  const steps = ((data ?? []) as QueueStep[]).filter((s) => !s.optional || s.due_date >= today);

  const weekEnd = addDays(today, 7);
  const groups: { title: string; tone: string; items: QueueStep[] }[] = [
    { title: 'Overdue', tone: 'text-late', items: steps.filter((s) => s.due_date < today) },
    { title: 'Today', tone: 'text-ink', items: steps.filter((s) => s.due_date === today) },
    { title: 'Next 7 days', tone: 'text-ink', items: steps.filter((s) => s.due_date > today && s.due_date <= weekEnd) },
    { title: 'Week after', tone: 'text-muted', items: steps.filter((s) => s.due_date > weekEnd) },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Queue</h1>
          <p className="text-sm text-muted">
            {groups[0].items.length} overdue · {groups[1].items.length} due today
          </p>
        </div>
        <nav className="flex flex-wrap gap-1 text-sm">
          {FILTERS.map((f) => (
            <Link key={f.key} href={`/queue?who=${f.key}`}
              className={`rounded border px-3 py-1 ${who === f.key ? 'border-brand bg-brand text-white' : 'border-line bg-white hover:border-brand'}`}>
              {f.label}
            </Link>
          ))}
        </nav>
      </div>

      {error && <p className="mb-4 rounded border border-late bg-white p-3 text-late">Could not load: {error.message}</p>}

      <div className="space-y-5">
        {showRefills && (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">
              Refills due <span className="font-normal text-muted">({refills.length}) · supplements running out within 14 days</span>
            </h2>
            {refills.length === 0 ? (
              <p className="rounded border border-dashed border-line px-4 py-3 text-sm text-muted">Nothing running out.</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded border border-line bg-white">
                {refills.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{r.item}</div>
                      <div className="mt-0.5 text-sm">
                        <Link href={`/patients/${r.patient_id}`} className="text-brand underline-offset-2 hover:underline">
                          {r.patient_code}
                        </Link>
                        <span className="text-muted"> · {r.size} {r.unit_form}{r.packages > 1 ? ` × ${r.packages}` : ''} · {Number(r.daily_dose)} a day</span>
                      </div>
                      <div className={`mt-0.5 text-xs ${r.run_out_date < today ? 'font-medium text-late' : 'text-muted'}`}>
                        {r.run_out_date < today ? 'Ran out' : 'Runs out'} {weekdayDate(r.run_out_date)}
                      </div>
                    </div>
                    <NotRefilling id={r.id} patientId={r.patient_id} />
                  </li>
                ))}
              </ul>
            )}
            {refills.length > 0 && (
              <p className="mt-1 text-xs text-muted">Logging the same supplement again on the patient’s page clears it from this list.</p>
            )}
          </section>
        )}

        {groups.map((g) => (
          <section key={g.title}>
            <h2 className={`mb-2 text-sm font-semibold ${g.tone}`}>
              {g.title} <span className="font-normal text-muted">({g.items.length})</span>
            </h2>
            {g.items.length === 0 ? (
              <p className="rounded border border-dashed border-line px-4 py-3 text-sm text-muted">Nothing here.</p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded border border-line bg-white">
                {g.items.map((s) => (
                  <li key={s.step_id} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{s.step_name}</div>
                      <div className="mt-0.5 text-sm">
                        <Link href={`/patients/${s.patient_id}`} className="text-brand underline-offset-2 hover:underline">
                          {s.display_name}
                        </Link>
                        <span className="text-muted"> · {s.program_code} · {s.stage_name}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                        <span className={s.due_date < today ? 'font-medium text-late' : ''}>
                          {s.due_date < today ? 'Was due' : 'Due'} {weekdayDate(s.due_date)}
                        </span>
                        {who !== 'mine' && <span className="capitalize">{s.owner_name ?? s.owner_role}</span>}
                        {s.status === 'in_progress' && <span className="text-due">In progress</span>}
                        {s.optional && <span>Optional</span>}
                      </div>
                    </div>
                    {s.is_blocked ? (
                      <Link href={`/patients/${s.patient_id}`} className="shrink-0 rounded bg-paper px-2.5 py-1.5 text-xs text-muted">
                        Waiting on an earlier step
                      </Link>
                    ) : (
                      <QuickDone stepId={s.step_id} patientId={s.patient_id} today={today} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
