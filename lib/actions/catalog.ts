'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentStaff } from '@/lib/supabase/server';
import { fetchSquareCatalog, toCatalogItems, SQUARE_CATEGORY, UNIT_FORMS } from '@/lib/square';

export type CatalogState = { error?: string; message?: string; ok?: number };

const STALE_HOURS = 12;

function refresh() {
  revalidatePath('/settings/supplements');
  revalidatePath('/patients', 'layout');
}

// Copies the supplement list from Square. Any staff member can run it.
export async function syncFromSquare(): Promise<CatalogState> {
  const { supabase, staff } = await getCurrentStaff();
  if (!staff) return { error: 'You are not logged in as staff.' };
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) return { error: 'Square isn’t connected yet. Add SQUARE_ACCESS_TOKEN in Vercel, then redeploy.' };

  let items;
  try {
    const { items: list, categoryFound } = toCatalogItems(await fetchSquareCatalog(token));
    if (!categoryFound) return { error: `Square has no category called “${SQUARE_CATEGORY}”.` };
    items = list;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not reach Square.' };
  }

  const { data, error } = await supabase.rpc('sync_supplement_catalog', { p_items: items });
  if (error) return { error: `Could not save the list: ${error.message}` };
  const r = data as { products: number; new_products: number; removed: number };
  refresh();
  return {
    ok: Date.now(),
    message: `Updated from Square: ${r.products} products` +
      (r.new_products ? `, ${r.new_products} new` : '') + (r.removed ? `, ${r.removed} no longer in Square` : '') + '.',
  };
}

// Runs the sync in the background when the list is more than 12 hours old, so it stays current
// without anyone pressing the button. Quietly does nothing if Square isn't connected.
export async function syncIfStale(): Promise<CatalogState> {
  if (!process.env.SQUARE_ACCESS_TOKEN) return {};
  const { supabase, staff } = await getCurrentStaff();
  if (!staff) return {};
  const { data } = await supabase.from('catalog_sync').select('synced_at').maybeSingle();
  const last = data?.synced_at ? new Date(data.synced_at).getTime() : 0;
  if (Date.now() - last < STALE_HOURS * 3_600_000) return {};
  return syncFromSquare();
}

// Admins only: show or hide a product in the pick list.
export async function setProductHidden(productId: string, hidden: boolean): Promise<CatalogState> {
  const { supabase, staff } = await getCurrentStaff();
  if (staff?.role !== 'admin') return { error: 'Only admins can hide products.' };
  const { data, error } = await supabase.from('supplement_product').update({ hidden }).eq('id', productId).select('id');
  if (error) return { error: `Could not save: ${error.message}` };
  if (!data?.length) return { error: 'Nothing was changed.' };
  refresh();
  return { ok: Date.now() };
}

// Any staff member: units per bottle and form for one size.
export async function setSizeUnits(sizeId: string, size: number, unitForm: string): Promise<CatalogState> {
  const { supabase, staff } = await getCurrentStaff();
  if (!staff) return { error: 'You are not logged in as staff.' };
  if (!Number.isInteger(size) || size <= 0 || size > 5000) return { error: 'Enter how many per bottle.' };
  if (!(UNIT_FORMS as readonly string[]).includes(unitForm)) return { error: 'Pick the form.' };
  const { data, error } = await supabase.from('supplement_size').update({ size, unit_form: unitForm }).eq('id', sizeId).select('id');
  if (error) return { error: `Could not save: ${error.message}` };
  if (!data?.length) return { error: 'Nothing was changed.' };
  refresh();
  return { ok: Date.now() };
}
