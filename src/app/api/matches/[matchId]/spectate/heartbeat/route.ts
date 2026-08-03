import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Keeps a held slot from being treated as abandoned — see the claim route's
 *  staleness check. Only ever touches the caller's own row. */
export async function POST(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) {
    return NextResponse.json({ error: "Bạn cần đăng nhập hoặc chơi với tư cách khách trước." }, { status: 401 });
  }

  const admin = createAdminClient();
  await admin
    .from("match_spectators")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("match_id", matchId)
    .eq("user_id", uid);

  return NextResponse.json({ ok: true });
}
