import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
import type {Database} from '@/lib/types';

/** Server client for RSC, route handlers, and server actions. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const {name, value, options} of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component render, where cookies are
            // read-only. The middleware refreshes the session instead.
          }
        },
      },
    },
  );
}

/** The signed-in user, or null. */
export async function getUser() {
  const supabase = await createClient();
  const {
    data: {user},
  } = await supabase.auth.getUser();
  return user;
}
