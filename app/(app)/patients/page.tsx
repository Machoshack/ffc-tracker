import Link from 'next/link';
import { getCurrentStaff } from '@/lib/supabase/server';
import { longDate } from '@/lib/dates';

type Patient = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  date_of_birth: string | null;
};
type Enrollment = {
  patient_id: string;
  program_code: string;
  status: string;
  start_date: string;
  completed_on: string | null;
  current_stage: string | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-due/10 text-due' },
  paused: { label: 'Paused', cls: 'bg-paper text-muted' },
  completed: { label: 'Completed', cls: 'bg-done/10 text-done' },
  cancelled: { label: 'Cancelled', cls: 'bg-paper text-muted' },
  converted: { label: 'Upgraded', cls: 'bg-paper text-muted' },
};

// Accepts 1980-03-14, 3/14/1980 or 03-14-1980.
function asDate(q: string): string | null {
  const iso = q.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const us = q.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return null;
}

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const { supabase } = await getCurrentStaff();
  const query = q.trim();

  let pq = supabase
    .from('patient')
    .select('id, first_name, last_name, display_name, date_of_birth')
    .order('last_name').order('first_name')
    .limit(200);
  const dob = asDate(query);
  if (dob) {
    pq = pq.eq('date_of_birth', dob);
  } else if (query) {
    // Each word must match the first or last name, so "maria lop" finds Maria Lopez.
    for (const word of query.replace(/[,()%*\\]/g, ' ').split(/\s+/).filter(Boolean)) {
      pq = pq.or(`first_name.ilike.%${word}%,last_name.ilike.%${word}%`);
    }
  }
  const { data: patientRows, error } = await pq;
  const patients = (patientRows ?? []) as Patient[];

  const { data: enrollmentRows } = patients.length
    ? await supabase
        .from('v_enrollments')
        .select('patient_id, program_code, status, start_date, completed_on, current_stage')
        .in('patient_id', patients.map((p) => p.id))
        .order('start_date', { ascending: false })
    : { data: [] };
  const byPatient = new Map<string, Enrollment[]>();
  for (const e of (enrollmentRows ?? []) as Enrollment[]) {
    byPatient.set(e.patient_id, [...(byPatient.get(e.patient_id) ?? []), e]);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Patients</h1>
        <Link href="/patients/new" className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white">
          Add patient
        </Link>
      </div>

      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} autoComplete="off" placeholder="Search by name or date of birth"
          className="w-full rounded border border-line bg-white px-3 py-2 outline-none focus:border-brand" />
        <button className="rounded border border-line bg-white px-4 py-2 text-sm hover:border-brand">Search</button>
      </form>

      {error && <p className="mb-4 text-late">Could not load: {error.message}</p>}

      {patients.length === 0 ? (
        <p className="rounded border border-line bg-white p-6 text-muted">
          {query ? `No patients match "${query}".` : 'No patients yet.'}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded border border-line bg-white">
          {patients.map((p) => {
            const history = byPatient.get(p.id) ?? [];
            const current = history.find((e) => e.status === 'active' || e.status === 'paused') ?? history[0];
            const s = current ? STATUS[current.status] : null;
            return (
              <li key={p.id}>
                <Link href={`/patients/${p.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {p.last_name ? `${p.last_name}, ${p.first_name ?? ''}` : p.display_name}
                    </div>
                    <div className="text-sm text-muted">
                      {p.date_of_birth ? `Born ${longDate(p.date_of_birth)}` : 'No date of birth'}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    {current ? (
                      <>
                        <span className="font-medium">{current.program_code}</span>{' '}
                        <span className={`rounded px-1.5 py-0.5 text-xs ${s?.cls}`}>{s?.label}</span>
                        <div className="text-xs text-muted">
                          {current.status === 'active' && current.current_stage
                            ? current.current_stage
                            : `${history.length} program${history.length === 1 ? '' : 's'}`}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted">No program</span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
