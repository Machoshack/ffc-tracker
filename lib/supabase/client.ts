import { createBrowserClient } from '@supabase/ssr';

// Supabase client for screens that run in the browser (login, set password).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
