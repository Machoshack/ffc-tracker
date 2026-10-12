// Patient code: first initial + first 3 letters of last name + last 2 digits of birth year.
// Mike Smith, 1994 -> MSMI94. Built in the browser so full names never leave it.

function letters(name: string): string {
  return name.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase();
}

export function buildPatientCode(first: string, last: string, birthYear: string): string | null {
  const f = letters(first).slice(0, 1);
  const l = letters(last).slice(0, 3);
  const y = birthYear.trim();
  if (!f || !l || !/^(19|20)\d{2}$/.test(y)) return null;
  return `${f}${l}${y.slice(2)}`;
}

// MSMI94, or MSMI94-2 for a second person with the same code. Short last names give shorter codes (MLI94).
export const PATIENT_CODE_PATTERN = /^[A-Z]{2,4}\d{2}(-\d+)?$/;
