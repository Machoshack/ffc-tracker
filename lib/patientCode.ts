// Patient code: first 3 letters of first name . first 3 of last name . last 2 digits of birth year.
// Mike Smith, 1991 -> Mik.Smi.91. Built in the browser so full names never leave it.

function part(name: string): string {
  const letters = name.normalize('NFD').replace(/[^A-Za-z]/g, '');
  const three = letters.slice(0, 3);
  return three ? three[0].toUpperCase() + three.slice(1).toLowerCase() : '';
}

export function buildPatientCode(first: string, last: string, birthYear: string): string | null {
  const f = part(first);
  const l = part(last);
  const y = birthYear.trim();
  if (!f || !l || !/^(19|20)\d{2}$/.test(y)) return null;
  return `${f}.${l}.${y.slice(2)}`;
}

// Accepts Mik.Smi.91 or Mik.Smi.91-2 (a second person with the same code).
export const PATIENT_CODE_PATTERN = /^[A-Z][a-z]{0,2}\.[A-Z][a-z]{0,2}\.\d{2}(-\d+)?$/;
