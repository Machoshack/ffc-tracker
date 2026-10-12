import 'server-only';
import { createClient } from '@supabase/supabase-js';

// Server-only client with the secret key. Used for one thing: sending staff login invites.
// Returns null when the secret key isn't set, and the app falls back to manual instructions.
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
