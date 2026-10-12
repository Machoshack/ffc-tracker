'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentStaff } from '@/lib/supabase/server';
import { PATIENT_CODE_PATTERN } from '@/lib/patientCode';

export type FormState = {
  error?: string;
  existingId?: string;
  suggestedCode?: string;
  values?: Record<string, string>;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PROGRAMS = ['TS', 'FHE', 'P1', 'P2'];

function friendly(message: string): string {
  if (/one_open_enrollment_per_patient/.test(message))
    return 'This patient already has an active program. Finish, pause, or cancel it first.';
  if (/patient_patient_code_key/.test(message)) return 'That patient code is already in use.';
  if (/patient_code_format/.test(message)) return 'The patient code is not in the right format.';
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

  // Only the code arrives here. Full names and birth year stay in the browser.
  const code = String(form.get('patient_code') ?? '').trim();
  if (!PATIENT_CODE_PATTERN.test(code)) return { error: 'Enter first name, last name and a four-digit birth year.' };
  const differentPerson = form.get('different_person') === '1';
  const e = readEnrollment(form);
  if ('error' in e) return { error: e.error };

  // Same code already used? Either it's a returning patient or a different person who shares it.
  const { data: taken } = await supabase
    .from('patient').select('id, patient_code')
    .or(`patient_code.eq.${code},patient_code.like.${code}-%`);
  let saveAs = code;
  if (taken?.length) {
    const used = new Set(taken.map((t) => t.patient_code));
    let n = 2;
    while (used.has(`${code}-${n}`)) n++;
    const nextFree = `${code}-${n}`;
    if (!differentPerson) {
      return {
        error: `${code} is already a patient.`,
        existingId: taken.find((t) => t.patient_code === code)?.id ?? taken[0].id,
        suggestedCode: nextFree,
      };
    }
    saveAs = nextFree;
  }

  const { data: patient, error } = await supabase
    .from('patient')
    .insert({ patient_code: saveAs, display_name: saveAs })
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
