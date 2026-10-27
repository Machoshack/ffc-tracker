'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { Markdown } from '@/components/Markdown';
import { parseGuide, inlineText } from '@/lib/markdown';
import { addLink, removeLink, saveGuide, type ResourceState } from '@/lib/actions/resources';

export type ProgramLink = { id: string; label: string; url: string; note: string | null };

const HELP = '# Heading   ## Smaller heading   - bullet   1. numbered   - [ ] checklist   **bold**   [link text](https://...)';

export function GuideSection({ code, programName, body, isAdmin, updated }: {
  code: string; programName: string; body: string; isAdmin: boolean; updated: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(body);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!editing) setDraft(body); }, [body, editing]);

  const headings = parseGuide(body).filter((b) => b.t === 'h' && b.level <= 2) as { t: 'h'; id: string; c: never[]; level: number }[];

  return (
    <section className="overflow-hidden rounded border border-line bg-white">
      <h2 className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-paper px-4 py-2 text-sm font-semibold">
        {programName}: execution guide
        <span className="flex items-baseline gap-3 text-xs font-normal text-muted">
          {updated}
          {isAdmin && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="rounded border border-line bg-white px-2.5 py-1 text-ink hover:border-brand">
              {body.trim() ? 'Edit guide' : 'Write the guide'}
            </button>
          )}
        </span>
      </h2>

      {editing ? (
        <div className="p-4">
          <p className="mb-2 text-xs text-muted">Formatting: <span className="font-mono">{HELP}</span></p>
          <div className="grid gap-4 lg:grid-cols-2">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck
              className="min-h-[28rem] w-full rounded border border-line bg-white p-3 font-mono text-sm leading-relaxed outline-none focus:border-brand"
              placeholder={'# Before Session 1\n\n- Confirm payment\n- ...'} />
            <div className="min-h-[28rem] overflow-auto rounded border border-dashed border-line p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-muted">Preview</p>
              {draft.trim() ? <Markdown source={draft} /> : <p className="text-sm text-muted">Nothing yet.</p>}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" disabled={pending}
              onClick={() => start(async () => { const r = await saveGuide(code, draft); setError(r.error ?? null); if (!r.error) setEditing(false); })}
              className="rounded bg-brand px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60">{pending ? 'Saving...' : 'Save guide'}</button>
            <button type="button" className="text-sm text-muted underline"
              onClick={() => { if (draft === body || confirm('Discard your changes?')) { setDraft(body); setEditing(false); } }}>Cancel</button>
            {error && <span className="text-sm text-late">{error}</span>}
          </div>
        </div>
      ) : body.trim() ? (
        <div className="px-4 py-4 sm:px-6">
          {headings.length >= 3 && (
            <nav className="mb-4 rounded bg-paper px-3 py-2 text-sm">
              <div className="mb-1 text-xs uppercase tracking-wide text-muted">On this page</div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {headings.map((h) => (
                  <li key={h.id}><a href={`#${h.id}`} className="text-brand hover:underline">{inlineText(h.c)}</a></li>
                ))}
              </ul>
            </nav>
          )}
          <Markdown source={body} />
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-muted">No guide written yet.{isAdmin ? ' Use “Write the guide” to add one.' : ''}</p>
      )}
    </section>
  );
}

export function LinksSection({ code, links, isAdmin, hasTools }: { code: string; links: ProgramLink[]; isAdmin: boolean; hasTools: boolean }) {
  const [state, action, pending] = useActionState<ResourceState, FormData>(addLink.bind(null, code), {});
  const [adding, setAdding] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.ok) { ref.current?.reset(); setAdding(false); } }, [state.ok]);
  const input = 'w-full rounded border border-line bg-white px-2 py-1.5 outline-none focus:border-brand';

  return (
    <>
      {links.length > 0 && (
        <ul className={`divide-y divide-line ${hasTools ? 'border-t border-line' : ''} ${busy ? 'opacity-60' : ''}`}>
          {links.map((l) => (
            <li key={l.id} className="flex items-start gap-2 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">{l.label} ↗</a>
                {l.note && <p className="mt-0.5 text-xs text-muted">{l.note}</p>}
              </div>
              {isAdmin && (
                <button type="button" title="Remove link" className="text-xs text-muted hover:text-late"
                  onClick={() => { if (confirm(`Remove "${l.label}"?`)) start(async () => { const r = await removeLink(code, l.id); setError(r.error ?? null); }); }}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!hasTools && links.length === 0 && <p className="px-4 py-3 text-sm text-muted">None yet.</p>}
      {error && <p className="px-4 pb-2 text-xs text-late">{error}</p>}
      {isAdmin && (
        <div className="border-t border-line px-4 py-3">
          {adding ? (
            <form ref={ref} action={action} className="space-y-2 text-sm">
              <input name="label" placeholder="Name (e.g. Intake form)" required className={input} />
              <input name="url" placeholder="https://..." required inputMode="url" className={input} />
              <input name="note" placeholder="Note (optional)" className={input} />
              <div className="flex items-center gap-3">
                <button disabled={pending} className="rounded bg-brand px-3 py-1.5 font-medium text-white disabled:opacity-60">{pending ? 'Adding...' : 'Add link'}</button>
                <button type="button" className="text-muted underline" onClick={() => setAdding(false)}>Cancel</button>
              </div>
              {state.error && <p className="text-late">{state.error}</p>}
            </form>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="text-xs text-brand underline">+ Add a link</button>
          )}
        </div>
      )}
    </>
  );
}
