import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const anonKeyPrefix = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").slice(0, 20);
  const anonKeySuffix = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").slice(-10);
  const anonKeyLength = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").length;

  let signInError: unknown = null;
  try {
    const client = createClient(url ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "");
    const { error } = await client.auth.signInWithPassword({
      email: "test@toothtalk.local",
      password: "TestVerifica2026!",
    });
    signInError = error ? { message: error.message, status: error.status, name: error.name } : null;
  } catch (e) {
    signInError = { thrown: String(e) };
  }

  return NextResponse.json({ url, anonKeyPrefix, anonKeySuffix, anonKeyLength, signInError });
}
