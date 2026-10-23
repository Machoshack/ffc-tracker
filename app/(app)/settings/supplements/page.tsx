import { getCurrentStaff } from '@/lib/supabase/server';
import { SQUARE_CATEGORY } from '@/lib/square';
import { CatalogEditor, SyncButton, AutoSync, type CatalogProduct } from '@/components/CatalogEditor';

export default async function SupplementSettingsPage() {
  const { supabase } = await getCurrentStaff();
  const [{ data: products }, { data: sizes }, { data: sync }] = await Promise.all([
    supabase.from('supplement_product').select('id, name, hidden, in_square').order('name'),
    supabase.from('supplement_size').select('id, product_id, name, retail_price, size, unit_form, in_square, sort').order('sort'),
    supabase.from('catalog_sync').select('synced_at, result').maybeSingle(),
  ]);
  const connected = !!process.env.SQUARE_ACCESS_TOKEN;

  const list: CatalogProduct[] = (products ?? []).map((p) => ({
    ...p,
    sizes: (sizes ?? []).filter((s) => s.product_id === p.id).map((s) => ({
      ...s, retail_price: s.retail_price == null ? null : Number(s.retail_price),
    })),
  }));

  return <SupplementSettings list={list} connected={connected} syncedAt={sync?.synced_at ?? null} result={sync?.result ?? null} />;
}

function SupplementSettings({ list, connected, syncedAt, result }: {
  list: CatalogProduct[]; connected: boolean; syncedAt: string | null; result: string | null;
}) {
  const when = syncedAt
    ? new Date(syncedAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;
  return (
    <div className="space-y-4">
      {connected && <AutoSync />}
      <p className="text-sm text-muted">
        The supplement list comes from Square: every product in the “{SQUARE_CATEGORY}” reporting category. Names and
        prices always follow Square, so change those in Square. Here you can hide products that aren’t supplements, and
        fill in how many are in each bottle (staff can also do that when they log a supplement). The list updates by
        itself twice a day, or press the button.
      </p>
      {!connected && (
        <p className="rounded border border-[#c98a1b]/40 bg-[#c98a1b]/10 px-3 py-2 text-sm">
          Square isn’t connected yet. In Vercel, add SQUARE_ACCESS_TOKEN (Settings, Environment Variables), then redeploy.
          Until then, staff can still type supplements in by hand.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <SyncButton disabled={!connected} />
        <span className="text-muted">{when ? `Last updated ${when}${result ? ` · ${result}` : ''}` : 'Not updated from Square yet.'}</span>
      </div>
      <CatalogEditor list={list} />
    </div>
  );
}
