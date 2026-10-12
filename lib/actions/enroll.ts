'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentStaff } from '@/lib/supabase/server';

export type FormState = { error?: string; existingId?: string; values?: Record<string, string> };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PROGRAMS = ['TS', 'FHE', 'P1', 'P2'];

function friendly(message: string): string {
  if (/one_open_enrollment_per_patient/.test(message))
    return 'This patient already has an active program. Finish, pause, or cancel it first.';
  if (/patient_same_person/.test(message)) return 'A patient with this name and date of birth already exists.';
  if (/Upgrade window closed on (\S+)/.test(message))
    return `The one-month upgrade window closed on ${message.match(/closed on (\S+)/)![1]}.`;
  if (/Not an active staff account|Login required/.test(message)) return 'You are not logged in as staff.';
  return `Could not save: ${message}`;
}

function readEnrollment(form: FormData) {
  const program = String(form.get('program') ?? '');
  const start = String(form.get('start_date') ?? '');
  const paid = Number(String(form.get('amount_paid') ?? '0').replace(/[$,]/g, ''));
  const paidDate = String(form.get('paid_date') ?? '');
  if (!PROGRAMS.includes(program)) return { error: 'Pick a program.' } as const;
  if (!ISO_DATE.test(start)) return { error: 'Pick a start date.' } as const;
  if (!Number.isFinite(paid) || paid < 0) return { error: 'Amount paid must be a number.' } as const;
  return {
    program,
    start,
    paid,
    paidDate: paid > 0 && ISO_DATE.test(paidDate) ? paidDate : null,
  } as const;
}

// New patient + first program in one go.
export async function createPatient(prev: FormState, form: FormData): Promise<FormState> {
  const r = await createPatientInner(form);
  return { ...r, values: Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])) };
}

async function createPatientInner(form: FormData): Promise<FormState> {
  const { supabase, staff } = await getCurrentStaff();
  if (!staff) return { error: 'You are not logged in as staff.' };

  const first = String(form.get('first_name') ?? '').trim();
  const last = String(form.get('last_name') ?? '').trim();
  const dob = String(form.get('date_of_birth') ?? '');
  if (!first || !last) return { error: 'Enter first and last name.' };
  if (!ISO_DATE.test(dob)) return { error: 'Enter a date of birth.' };
  const e = readEnrollment(form);
  if ('error' in e) return { error: e.error };

  // Returning patient? Point to their existing record instead of making a second one.
  const { data: match } = await supabase
    .from('patient').select('id')
    .ilike('first_name', first).ilike('last_name', last).eq('date_of_birth', dob)
    .maybeSingle();
  if (match) {
    return {
      error: `${first} ${last} with this date of birth is already a patient. Open their page and use Start a program.`,
      existingId: match.id,
    };
  }

  const { data: patient, error } = await supabase
    .from('patient')
    .insert({ first_name: first, last_name: last, date_of_birth: dob, display_name: `${first} ${last}` })
    .select('id').single();
  if (error) return { error: friendly(error.message) };

  const { error: enrollError } = await supabase.rpc('enroll_patient', {
    p_patient_id: patient.id, p_program_code: e.program, p_start_date: e.start,
    p_amount_paid: e.paid, p_paid_date: e.paidDate,
  });
  if (enrollError) {
    // Patient is saved; send them to the start-a-program form to fix and retry.
    redirect(`/patients/new?patient=${patient.id}&retry=${encodeURIComponent(friendly(enrollError.message))}`);
  }

  revalidatePath('/');
  redirect(`/patients/${patient.id}`);
}

// Existing patient starting a new program.
export async function enrollExisting(patientId: string, prev: FormState, form: FormData): Promise<FormState> {
  const r = await enrollExistingInner(patientId, form);
  return { ...r, values: Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])) };
}

async function enrollExistingInner(patientId: string, form: FormData): Promise<FormState> {
  const { supabase, staff } = await getCurrentStaff();
  if (!staff) return { error: 'You are not logged in as staff.' };
  const e = readEnrollment(form);
  if ('error' in e) return { error: e.error };

  const { error } = await supabase.rpc('enroll_patient', {
    p_patient_id: patientId, p_program_code: e.program, p_start_date: e.start,
    p_amount_paid: e.paid, p_paid_date: e.paidDate,
  });
  if (error) return { error: friendly(error.message) };

  revalidatePath('/');
  redirect(`/patients/${patientId}`);
}

// FHE to Protocol II. Finished FHE steps carry over and the FHE payment is credited.
export async function upgradeToP2(enrollmentId: string, patientId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await getCurrentStaff();
  if (!staff) return { error: 'You are not logged in as staff.' };
  const extra = Number(String(form.get('extra_paid') ?? '0').replace(/[$,]/g, ''));
  if (!Number.isFinite(extra) || extra < 0) return { error: 'Additional payment must be a number.' };

  const { data, error } = await supabase.rpc('convert_enrollment', { p_from: enrollmentId, p_extra_paid: extra });
  if (error) return { error: friendly(error.message) };

  revalidatePath('/');
  redirect(`/patients/${patientId}?enrollment=${data}`);
}
