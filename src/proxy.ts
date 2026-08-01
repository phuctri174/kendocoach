import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE_MAX_AGE } from "@/lib/supabase/constants";

/**
 * Refreshes the Supabase session cookie on every request. This is the
 * `middleware.ts` convention under its Next 16 name — see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
 * Without this, a session sitting past its access-token lifetime (~1h) would
 * read as logged-out in Server Components even inside the 30-day cookie
 * expiry, since nothing else touches the token in between.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
      cookieOptions: { maxAge: SESSION_COOKIE_MAX_AGE },
    },
  );

  // Touching the session is what makes the refresh actually happen.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
