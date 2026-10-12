import { addDays, mondayOf } from '@/lib/dates';

// The timeline's visible window, worked out from the address bar so links and the back button just work.

export type Scale = '1m' | '3m' | '6m' | '1y';
export const SCALES: { key: Scale; label: string; days: number; lead: number }[] = [
  { key: '1m', label: '1 month', days: 35, lead: 7 },
  { key: '3m', label: '3 months', days: 98, lead: 21 },
  { key: '6m', label: '6 months', days: 182, lead: 28 },
  { key: '1y', label: '1 year', days: 364, lead: 56 },
];

export type TimelineParams = { program?: string; scale?: string; from?: string; year?: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function resolveWindow(p: TimelineParams, today: string) {
  const year = p.year && /^\d{4}$/.test(p.year) ? Number(p.year) : null;
  if (year) {
    return {
      mode: 'year' as const, year, scale: '1y' as Scale,
      start: `${year}-01-01`, end: `${year + 1}-01-01`,
    };
  }
  const scale = (SCALES.find((s) => s.key === p.scale) ?? SCALES[1]);
  const anchor = p.from && ISO.test(p.from) ? p.from : null;
  const start = anchor ? mondayOf(anchor) : addDays(mondayOf(today), -scale.lead);
  return { mode: 'active' as const, year: null, scale: scale.key, start, end: addDays(start, scale.days), anchored: !!anchor };
}

// Builds a link that changes some settings and keeps the rest.
export function timelineHref(current: TimelineParams, change: Partial<Record<keyof TimelineParams, string | null>>) {
  const merged: Record<string, string | undefined> = { ...current };
  for (const [k, v] of Object.entries(change)) merged[k] = v ?? undefined;
  const qs = new URLSearchParams();
  for (const k of ['program', 'scale', 'from', 'year'] as const) {
    const v = merged[k];
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `/?${s}` : '/';
}

export function shiftFrom(start: string, scaleKey: Scale, direction: 1 | -1) {
  const scale = SCALES.find((s) => s.key === scaleKey)!;
  return addDays(start, direction * Math.round(scale.days / 2 / 7) * 7);
}
