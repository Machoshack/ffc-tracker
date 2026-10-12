'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getCurrentStaff } from '@/lib/supabase/server';

export type FormState = { error?: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PROGRAMS = ['TS', 'FHE', 'P1', 'P2'];

function friendly(message: string): string {
  if (/one_open_enrollment_per_patient/.test(message))
    return 'This patient already has an active program. Finish, pause, or cancel it first.';
  if (/patient_patient_code_key/.test(message)) return 'That patient code is already in use.';
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
export async function createPatient(_prev: FormState, form: FormData): Promise<FormState> {
  const { supabase, staff } = await getCurrentStaff();
  if (!staff) return { error: 'You are not logged in as staff.' };

  const name = String(form.get('display_name') ?? '').trim();
  const code = String(form.get('patient_code') ?? '').trim().toUpperCase();
  if (!name) return { error: 'Enter a name.' };
  if (!code) return { error: 'Enter a patient code.' };
  const e = readEnrollment(form);
  if ('error' in e) return { error: e.error };

  const { data: patient, error } = await supabase
    .from('patient').insert({ display_name: name, patient_code: code }).select('id').single();
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
export async function enrollExisting(patientId: string, _prev: FormState, form: FormData): Promise<FormState> {
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
