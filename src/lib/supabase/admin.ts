import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Full-privilege client for Route Handlers only: bypasses RLS entirely, so
 * this is the one place server-authoritative writes are allowed to happen —
 * candidate/augment/item rolls, pick validation, room seat claims, game and
 * series resolution. Never call this from a Server Component or anywhere its
 * result could reach the client bundle; the `server-only` import throws at
 * build time if that ever happens by mistake.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
