"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Client Supabase per il browser. Serve soprattutto all'upload diretto su
 * Storage: i video grezzi non devono attraversare il server Next.
 */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
