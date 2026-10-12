'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentStaff } from '@/lib/supabase/server';
import { todayInNewYork } from '@/lib/dates';

export type ActionResult = { error?: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Turn database messages into something staff can act on.
function friendly(message: string): string {
  const blocked = message.match(/BLOCKED: finish these first: (.*)/);
  if (blocked) return `Can't do this yet. Finish these first: ${blocked[1]}.`;
  if (/row-level security|permission denied/i.test(message)) return "Your account isn't allowed to make this change.";
  return `Could not save: ${message}`;
}

async function updateStep(stepId: string, patientId: string, values: Record<string, unknown>): Promise<ActionResult> {
  const { supabase, staff } = await getCurrentStaff();
  if (!staff) return { error: 'You are not logged in as staff.' };

  const { data, error } = await supabase.from('step').update(values).eq('id', stepId).select('id');
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "Your account isn't allowed to make this change." };

  revalidatePath(`/patients/${patientId}`);
  revalidatePath('/');
  revalidatePath('/queue');
  return {};
}

export async function markDone(stepId: string, patientId: string, completedOn: string): Promise<ActionResult> {
  const date = ISO_DATE.test(completedOn) ? completedOn : todayInNewYork();
  if (date > todayInNewYork()) return { error: "The done date can't be in the future." };
  return updateStep(stepId, patientId, { status: 'done', completed_on: date });
}

export async function markStarted(stepId: string, patientId: string): Promise<ActionResult> {
  return updateStep(stepId, patientId, { status: 'in_progress' });
}

export async function undoStep(stepId: string, patientId: string): Promise<ActionResult> {
  return updateStep(stepId, patientId, { status: 'not_started' });
}

export async function skipStep(stepId: string, patientId: string, reason: string): Promise<ActionResult> {
  if (!reason.trim()) return { error: 'Add a note saying why this step is skipped.' };
  return updateStep(stepId, patientId, { status: 'skipped', notes: reason.trim() });
}

export async function rebook(stepId: string, patientId: string, dueDate: string): Promise<ActionResult> {
  if (!ISO_DATE.test(dueDate)) return { error: 'Pick a date.' };
  return updateStep(stepId, patientId, { due_date: dueDate });
}

export async function saveNote(stepId: string, patientId: string, notes: string): Promise<ActionResult> {
  return updateStep(stepId, patientId, { notes: notes.trim() || null });
}
