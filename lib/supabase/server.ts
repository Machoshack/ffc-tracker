import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Supabase client for server pages. Runs as the logged-in user, so access rules apply.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a server page: cookies are refreshed by proxy.ts instead.
          }
        },
      },
    },
  );
}

export type StaffUser = { id: string; name: string; role: 'admin' | 'staff' | 'physician' };

// The logged-in person's staff record, or null if their login isn't on the staff list.
export async function getCurrentStaff() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { supabase, userId: null, email: null, staff: null };
  const { data: staff } = await supabase
    .from('staff_user')
    .select('id, name, role')
    .eq('auth_user_id', userId)
    .eq('active', true)
    .maybeSingle<StaffUser>();
  return { supabase, userId, email: (claims?.claims?.email as string) ?? null, staff };
}
