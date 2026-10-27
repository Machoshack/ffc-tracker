// A small, safe reader for the simple formatting used in execution guides.
// Supports: # / ## / ### headings, paragraphs, - or * bullets, 1. numbered lists, [ ] checklists,
// **bold**, *italic*, [link text](https://...), and --- for a dividing line. No raw HTML is ever passed through.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'bold'; c: Inline[] }
  | { t: 'italic'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'h'; level: 1 | 2 | 3; c: Inline[]; id: string }
  | { t: 'p'; c: Inline[] }
  | { t: 'ul'; items: { c: Inline[]; check?: boolean; sub: Inline[][] }[] }
  | { t: 'ol'; items: { c: Inline[]; check?: boolean; sub: Inline[][] }[] }
  | { t: 'hr' };

export function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\*\*(.+?)\*\*/))) { flush(); out.push({ t: 'bold', c: parseInline(m[1]) }); i += m[0].length; continue; }
    if ((m = rest.match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+|\/[^\s)]*|mailto:[^\s)]+)\)/))) {
      flush(); out.push({ t: 'link', href: m[2], c: parseInline(m[1]) }); i += m[0].length; continue;
    }
    if ((m = rest.match(/^\*([^*\s][^*]*?)\*/))) { flush(); out.push({ t: 'italic', c: parseInline(m[1]) }); i += m[0].length; continue; }
    buf += src[i]; i++;
  }
  flush();
  return out;
}

const LIST = /^(\s*)([-*]|\d+[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/;

export function parseGuide(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => { if (para.length) { blocks.push({ t: 'p', c: parseInline(para.join(' ')) }); para = []; } };
  const used = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { endPara(); continue; }

    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      endPara();
      let id = slug(h[2]) || 'section';
      const n = used.get(id) ?? 0; used.set(id, n + 1); if (n) id = `${id}-${n + 1}`;
      blocks.push({ t: 'h', level: h[1].length as 1 | 2 | 3, c: parseInline(h[2].trim()), id });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { endPara(); blocks.push({ t: 'hr' }); continue; }

    const li = line.match(LIST);
    if (li && li[1].length < 2) {
      endPara();
      const ordered = /\d/.test(li[2]);
      const items: { c: Inline[]; check?: boolean; sub: Inline[][] }[] = [];
      let j = i;
      while (j < lines.length) {
        const m = lines[j].match(LIST);
        if (!m) {
          // A plain indented line continues the previous item.
          if (items.length && /^\s{2,}\S/.test(lines[j])) {
            const last = items[items.length - 1];
            last.c = [...last.c, { t: 'text', v: ' ' }, ...parseInline(lines[j].trim())];
            j++; continue;
          }
          break;
        }
        if (m[1].length >= 2 && items.length) { items[items.length - 1].sub.push(parseInline(m[4])); j++; continue; }
        if (/\d/.test(m[2]) !== ordered) break;
        items.push({ c: parseInline(m[4]), check: m[3] === undefined ? undefined : m[3] !== ' ', sub: [] });
        j++;
      }
      blocks.push({ t: ordered ? 'ol' : 'ul', items });
      i = j - 1;
      continue;
    }
    para.push(line.trim());
  }
  endPara();
  return blocks;
}

// Plain text of a heading, for the "On this page" list.
export function inlineText(c: Inline[]): string {
  return c.map((x) => (x.t === 'text' ? x.v : inlineText(x.c))).join('');
}
