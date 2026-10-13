import Link from 'next/link';
import { getCurrentStaff } from '@/lib/supabase/server';
import { addDays, todayInNewYork, toDate } from '@/lib/dates';
import { NewPatientForm } from './NewPatientForm';
import type { ProgramOption } from '@/components/EnrollFields';

const ORDER = ['TS', 'FHE', 'P1', 'P2', 'LAB', 'FT'];

function nextClinicDay(iso: string) {
  let d = iso;
  while (![1, 3, 5].includes(toDate(d).getUTCDay())) d = addDays(d, 1);
  return d;
}

export default async function NewPatientPage({ searchParams }: { searchParams: Promise<{ patient?: string; retry?: string; followup?: string }> }) {
  const { patient: patientId, retry, followup } = await searchParams;
  const { supabase } = await getCurrentStaff();

  const { data: programRows } = await supabase.from('program').select('code, name, price, kind').eq('active', true);
  const programs = ((programRows ?? []) as ProgramOption[]).sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code));

  const { data: existing } = patientId
    ? await supabase.from('patient').select('id, patient_code').eq('id', patientId).maybeSingle()
    : { data: null };

  const today = todayInNewYork();

  // Is this patient in Protocol II right now? Then only follow-ups can be added.
  const { data: openP2 } = existing
    ? await supabase.from('v_enrollments').select('enrollment_id').eq('patient_id', existing.id)
        .eq('program_code', 'P2').in('status', ['active', 'paused']).maybeSingle()
    : { data: null };
  const choices = followup || openP2 ? programs.filter((p) => p.kind === 'followup') : programs;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={existing ? `/patients/${existing.id}` : '/patients'} className="text-sm text-muted hover:text-brand">
        ← {existing ? existing.patient_code : 'Patients'}
      </Link>
      <h1 className="mt-2 mb-1 text-xl font-semibold">{existing ? (openP2 ? 'Add a follow-up' : 'Start a program') : 'Add patient'}</h1>
      <p className="mb-4 text-sm text-muted">
        {existing
          ? 'Pick the next program for this patient.'
          : 'Enter the name and birth year to build the patient code. Clinical details stay in the chart.'}
      </p>
      {retry && (
        <p className="mb-4 rounded bg-late/10 px-3 py-2 text-sm text-late">
          The patient was saved, but the program didn't start: {retry}
        </p>
      )}
      <NewPatientForm programs={choices} inProtocolII={!!openP2} defaultStart={nextClinicDay(today)} today={today}
        existing={existing ? { id: existing.id, code: existing.patient_code } : undefined} />
    </div>
  );
}
