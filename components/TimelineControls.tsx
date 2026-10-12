'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SCALES, shiftFrom, timelineHref, type Scale, type TimelineParams } from '@/lib/timelineWindow';

const btn = 'rounded border border-line bg-white px-3 py-1 hover:border-brand';
const on = 'rounded border border-brand bg-brand px-3 py-1 text-white';

export function TimelineControls({ params, mode, scale, start, year, years, today }: {
  params: TimelineParams;
  mode: 'active' | 'year';
  scale: Scale;
  start: string;
  year: number | null;
  years: number[];
  today: string;
}) {
  const router = useRouter();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <div className="flex gap-1">
        {mode === 'year' ? (
          <>
            <Link href={timelineHref(params, { year: String(year! - 1) })} className={btn}>← {year! - 1}</Link>
            <Link href={timelineHref(params, { year: String(year! + 1) })} className={btn}>{year! + 1} →</Link>
          </>
        ) : (
          <>
            <Link href={timelineHref(params, { from: shiftFrom(start, scale, -1) })} className={btn} aria-label="Earlier">← Earlier</Link>
            <Link href={timelineHref(params, { from: null })} className={btn}>Today</Link>
            <Link href={timelineHref(params, { from: shiftFrom(start, scale, 1) })} className={btn} aria-label="Later">Later →</Link>
          </>
        )}
      </div>

      {mode === 'active' && (
        <div className="flex gap-1" role="group" aria-label="Time scale">
          {SCALES.map((s) => (
            <Link key={s.key} href={timelineHref(params, { scale: s.key === '3m' ? null : s.key })}
              className={scale === s.key ? on : btn}>
              {s.label}
            </Link>
          ))}
        </div>
      )}

      {mode === 'active' && (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            const v = new FormData(e.currentTarget).get('from') as string;
            if (v) router.push(timelineHref(params, { from: v }));
          }}
        >
          <label className="text-muted" htmlFor="jump">Jump to</label>
          <input id="jump" name="from" type="date" defaultValue={params.from ?? today}
            className="rounded border border-line bg-white px-2 py-1" />
          <button className={btn}>Go</button>
        </form>
      )}

      <label className="flex items-center gap-1">
        <span className="text-muted">Show</span>
        <select
          value={year ? String(year) : ''}
          onChange={(e) => router.push(timelineHref(params, { year: e.target.value || null, from: null }))}
          className="rounded border border-line bg-white px-2 py-1"
        >
          <option value="">Active now</option>
          {years.map((y) => <option key={y} value={y}>Everyone in {y}</option>)}
        </select>
      </label>
    </div>
  );
}
