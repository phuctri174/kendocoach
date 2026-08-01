import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidUsername, usernameToSyntheticEmail } from "@/lib/auth/username";

/** Username+password log-in: same synthetic-email derivation as sign-up. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!isValidUsername(username) || !password) {
    return NextResponse.json(
      { error: "Tên đăng nhập hoặc mật khẩu không đúng." },
      { status: 401 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToSyntheticEmail(username),
    password,
  });

  if (error || !data.user) {
    return NextResponse.json(
      { error: "Tên đăng nhập hoặc mật khẩu không đúng." },
      { status: 401 },
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .eq("id", data.user.id)
    .single();

  return NextResponse.json(profile ?? { id: data.user.id, username, display_name: username });
}
