// Reads the supplement list from Square. Server only: the Square token never reaches the browser.
// Square is read, never changed. Only products and prices are read, no customer or sales data.

export const SQUARE_CATEGORY = process.env.SQUARE_CATEGORY || 'Product';
export const UNIT_FORMS = ['capsules', 'softgels', 'tablets', 'scoops', 'mL', 'drops', 'packets'] as const;

export type CatalogSize = {
  variation_id: string; name: string; price: number | null; sort: number;
  guess_size: number | null; guess_form: string | null;
};
export type CatalogItem = { item_id: string; name: string; sizes: CatalogSize[] };

type SquareObject = {
  type: string; id: string; is_deleted?: boolean;
  category_data?: { name?: string };
  item_data?: {
    name?: string; is_archived?: boolean; category_id?: string;
    reporting_category?: { id?: string }; categories?: { id?: string }[];
    variations?: SquareObject[];
  };
  item_variation_data?: {
    name?: string; ordinal?: number; pricing_type?: string; price_money?: { amount?: number };
  };
};

// "60 caps", "180 Capsules", "30 servings" -> 60 capsules, 180 capsules, 30 scoops.
const FORM_WORDS: [RegExp, string][] = [
  [/^(caps?|capsules?|vcaps?|veg ?caps?)$/i, 'capsules'],
  [/^(softgels?|gels?)$/i, 'softgels'],
  [/^(tabs?|tablets?|chewables?)$/i, 'tablets'],
  [/^(scoops?|servings?)$/i, 'scoops'],
  [/^(ml)$/i, 'mL'],
  [/^(drops?)$/i, 'drops'],
  [/^(packets?|sachets?|sticks?)$/i, 'packets'],
];
export function guessSize(text: string): { size: number; form: string } | null {
  for (const m of text.matchAll(/(\d{1,4})\s*(?:ct\.?\s*|count\s*)?([a-z]+)/gi)) {
    const form = FORM_WORDS.find(([re]) => re.test(m[2]))?.[1];
    const size = Number(m[1]);
    if (form && size > 0) return { size, form };
  }
  return null;
}

// Turns Square's catalog into the product list Waypoint keeps. Pure, so it can be tested without Square.
export function toCatalogItems(objects: SquareObject[], categoryName = SQUARE_CATEGORY): { items: CatalogItem[]; categoryFound: boolean } {
  // "Product" and "Products" both match, ignoring capitals.
  const norm = (t: string) => t.trim().toLowerCase().replace(/s$/, '');
  const category = objects.find(
    (o) => o.type === 'CATEGORY' && !o.is_deleted && norm(o.category_data?.name ?? '') === norm(categoryName),
  );
  if (!category) return { items: [], categoryFound: false };

  const items: CatalogItem[] = [];
  for (const o of objects) {
    const d = o.item_data;
    if (o.type !== 'ITEM' || o.is_deleted || !d || d.is_archived) continue;
    const inCategory = d.reporting_category?.id === category.id || d.category_id === category.id
      || (d.categories ?? []).some((c) => c.id === category.id);
    if (!inCategory) continue;

    const sizes = (d.variations ?? [])
      .filter((v) => !v.is_deleted && v.item_variation_data)
      .map((v, i) => {
        const vd = v.item_variation_data!;
        const name = (vd.name ?? '').trim() || 'Regular';
        const amount = vd.pricing_type === 'VARIABLE_PRICING' ? undefined : vd.price_money?.amount;
        const guess = guessSize(name) ?? guessSize(d.name ?? '');
        return {
          variation_id: v.id, name, price: amount != null ? amount / 100 : null, sort: vd.ordinal ?? i,
          guess_size: guess?.size ?? null, guess_form: guess?.form ?? null,
        };
      });
    if (sizes.length) items.push({ item_id: o.id, name: (d.name ?? '').trim() || 'Unnamed product', sizes });
  }
  return { items, categoryFound: true };
}

// Pages through Square's whole catalog (items and categories).
export async function fetchSquareCatalog(token: string): Promise<SquareObject[]> {
  const out: SquareObject[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const url = new URL('https://connect.squareup.com/v2/catalog/list');
    url.searchParams.set('types', 'ITEM,CATEGORY');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (res.status === 401) throw new Error('Square did not accept the access token. Check SQUARE_ACCESS_TOKEN in Vercel (use the Production token).');
    if (!res.ok) throw new Error(`Square returned an error (${res.status}). Try again in a few minutes.`);
    const body = (await res.json()) as { objects?: SquareObject[]; cursor?: string };
    out.push(...(body.objects ?? []));
    cursor = body.cursor;
    if (!cursor) break;
  }
  return out;
}

// What staff see in the pick list: "Vitamin D Supreme, 60 caps", or just the name when Square calls the size "Regular".
export function choiceLabel(product: string, size: string) {
  return /^regular$/i.test(size.trim()) ? product : `${product}, ${size}`;
}
