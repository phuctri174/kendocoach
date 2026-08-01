import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isValidPassword, isValidUsername, usernameToSyntheticEmail } from "@/lib/auth/username";

/**
 * Username+password sign-up. Runs entirely server-side with the service-role
 * client so the uniqueness check and account creation can't be raced or
 * spoofed from the browser — the client only ever gets back a profile or an
 * error message.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!isValidUsername(username)) {
    return NextResponse.json(
      { error: "Tên đăng nhập phải dài 3-20 ký tự, chỉ gồm chữ cái, số và dấu gạch dưới." },
      { status: 400 },
    );
  }
  if (!isValidPassword(password)) {
    return NextResponse.json(
      { error: "Mật khẩu phải có ít nhất 8 ký tự." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const usernameLower = username.toLowerCase();

  const { data: existing, error: lookupError } = await admin
    .from("profiles")
    .select("id")
    .eq("username_lower", usernameLower)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: "Không thể tạo tài khoản, thử lại sau." }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({ error: "Tên đăng nhập đã được sử dụng." }, { status: 409 });
  }

  const email = usernameToSyntheticEmail(username);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, display_name: username },
  });

  if (createError || !created.user) {
    // The pre-check above closes the common case; this catches the rare
    // race where two signups for the same username land concurrently.
    const duplicate = /already.*registered|duplicate|exists/i.test(createError?.message ?? "");
    return NextResponse.json(
      { error: duplicate ? "Tên đăng nhập đã được sử dụng." : "Không thể tạo tài khoản, thử lại sau." },
      { status: duplicate ? 409 : 500 },
    );
  }

  // Sign in through the cookie-aware client so this response carries the new
  // session straight to the browser — sign-up doubles as log-in.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    return NextResponse.json(
      { error: "Tạo tài khoản thành công nhưng đăng nhập thất bại — hãy thử đăng nhập lại." },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: created.user.id, username, display_name: username });
}
