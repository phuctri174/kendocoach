import { createBrowserClient } from "@supabase/ssr";
import { SESSION_COOKIE_MAX_AGE } from "./constants";

/** Browser-side client: runs under RLS as the signed-in (or guest) user. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: { maxAge: SESSION_COOKIE_MAX_AGE } },
  );
}
