import { parseGuide, type Block, type Inline } from '@/lib/markdown';

function Inlines({ c }: { c: Inline[] }) {
  return (
    <>
      {c.map((x, i) => {
        if (x.t === 'text') return <span key={i}>{x.v}</span>;
        if (x.t === 'bold') return <strong key={i} className="font-semibold"><Inlines c={x.c} /></strong>;
        if (x.t === 'italic') return <em key={i}><Inlines c={x.c} /></em>;
        const external = x.href.startsWith('https://');
        return (
          <a key={i} href={x.href} className="text-brand underline underline-offset-2"
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            <Inlines c={x.c} />
          </a>
        );
      })}
    </>
  );
}

function ListItems({ items }: { items: Extract<Block, { t: 'ul' }>['items'] }) {
  return (
    <>
      {items.map((it, i) => (
        <li key={i} className={it.check !== undefined ? 'flex list-none gap-2' : ''}>
          {it.check !== undefined && (
            <span aria-hidden className={`mt-1 inline-block h-3.5 w-3.5 shrink-0 rounded-sm border ${it.check ? 'border-done bg-done' : 'border-ink/50'}`} />
          )}
          <span>
            <Inlines c={it.c} />
            {it.sub.length > 0 && (
              <ul className="mt-1 list-[circle] space-y-1 pl-5">
                {it.sub.map((s, k) => <li key={k}><Inlines c={s} /></li>)}
              </ul>
            )}
          </span>
        </li>
      ))}
    </>
  );
}

// Shows a guide written in the simple formatting described in lib/markdown.ts.
export function Markdown({ source }: { source: string }) {
  const blocks = parseGuide(source);
  return (
    <div className="space-y-3 text-[15px] leading-relaxed">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h':
            return b.level === 1
              ? <h2 key={i} id={b.id} className="scroll-mt-4 border-b border-line pt-3 pb-1 text-lg font-semibold"><Inlines c={b.c} /></h2>
              : b.level === 2
                ? <h3 key={i} id={b.id} className="scroll-mt-4 pt-2 text-base font-semibold"><Inlines c={b.c} /></h3>
                : <h4 key={i} id={b.id} className="scroll-mt-4 pt-1 text-sm font-semibold uppercase tracking-wide text-muted"><Inlines c={b.c} /></h4>;
          case 'p': return <p key={i}><Inlines c={b.c} /></p>;
          case 'ul': return <ul key={i} className="list-disc space-y-1 pl-5"><ListItems items={b.items} /></ul>;
          case 'ol': return <ol key={i} className="list-decimal space-y-1 pl-5"><ListItems items={b.items} /></ol>;
          case 'hr': return <hr key={i} className="border-line" />;
        }
      })}
    </div>
  );
}
