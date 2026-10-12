import Link from 'next/link';
import { getCurrentStaff } from '@/lib/supabase/server';
import { buildPatientCode } from '@/lib/patientCode';

type Patient = { id: string; patient_code: string };
type Enrollment = {
  patient_id: string;
  program_code: string;
  status: string;
  start_date: string;
  current_stage: string | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: 'Active', cls: 'bg-due/10 text-due' },
  paused: { label: 'Paused', cls: 'bg-paper text-muted' },
  completed: { label: 'Completed', cls: 'bg-done/10 text-done' },
  cancelled: { label: 'Cancelled', cls: 'bg-paper text-muted' },
  converted: { label: 'Upgraded', cls: 'bg-paper text-muted' },
};

// Search by code (msmi94, msmi) or by name and birth year (Mike Smith 1994), which is turned into the code.
function codeSearch(q: string): string {
  const parts = q.trim().split(/\s+/);
  if (parts.length === 3) {
    const code = buildPatientCode(parts[0], parts[1], parts[2]);
    if (code) return code;
  }
  return q.toUpperCase().replace(/[^A-Z0-9-]/g, '');
}

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const { supabase } = await getCurrentStaff();
  const term = codeSearch(q);

  let pq = supabase.from('patient').select('id, patient_code').order('patient_code').limit(300);
  if (term) pq = pq.ilike('patient_code', `%${term}%`);
  const { data: patientRows, error } = await pq;
  const patients = (patientRows ?? []) as Patient[];

  const { data: enrollmentRows } = patients.length
    ? await supabase
        .from('v_enrollments')
        .select('patient_id, program_code, status, start_date, current_stage')
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

      <form className="mb-1 flex gap-2">
        <input name="q" defaultValue={q} autoComplete="off" placeholder="MSMI94, or Mike Smith 1994"
          className="w-full rounded border border-line bg-white px-3 py-2 outline-none focus:border-brand" />
        <button className="rounded border border-line bg-white px-4 py-2 text-sm hover:border-brand">Search</button>
      </form>
      <p className="mb-4 text-xs text-muted">Search by code, or type first name, last name and birth year to find their code.</p>

      {error && <p className="mb-4 text-late">Could not load: {error.message}</p>}

      {patients.length === 0 ? (
        <p className="rounded border border-line bg-white p-6 text-muted">
          {q ? `No patients match ${term || q}.` : 'No patients yet.'}
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
                  <div className="min-w-0 flex-1 font-mono text-base font-semibold tracking-wide">{p.patient_code}</div>
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
