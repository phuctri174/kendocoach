import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE_MAX_AGE } from "./constants";

/**
 * Server Component / Route Handler client: still runs under RLS as the
 * requesting user, just reads the session from the request's cookies instead
 * of browser storage.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components can't set cookies mid-render; proxy.ts
            // refreshes the session on the next request instead.
          }
        },
      },
      cookieOptions: { maxAge: SESSION_COOKIE_MAX_AGE },
    },
  );
}
