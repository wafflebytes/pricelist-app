'use client';

import {createBrowserClient} from '@supabase/ssr';
import type {Database} from '@/lib/types';

/**
 * Browser client. Only ever sees the publishable key — the secret key is
 * confined to scripts (PRD §8).
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}

let browserClient: ReturnType<typeof createClient> | undefined;

/** Singleton, so Realtime channels aren't duplicated across components. */
export function getClient() {
  if (!browserClient) browserClient = createClient();
  return browserClient;
}
