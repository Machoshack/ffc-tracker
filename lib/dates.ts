// Dates are kept as 'YYYY-MM-DD' strings and handled in UTC so time zones never shift a day.

export function todayInNewYork(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

export function toDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);
}

export function mondayOf(iso: string): string {
  const dow = toDate(iso).getUTCDay(); // 0 Sun .. 6 Sat
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

export function shortDate(iso: string): string {
  return toDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function weekdayDate(iso: string): string {
  return toDate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
