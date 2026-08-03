import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { DraftSide, DraftState, MatchGameRow } from "@/lib/versus/draft";

/**
 * Locks in the caller's own daihyosen representative — only reachable once
 * `bout_provisional` exists, i.e. only after both players already know the
 * 5 regular bouts tied. Nothing before this call ever left the client for
 * this pick, so — same reveal-on-individual-confirm timing as every other
 * pick in this mode — the opponent has no way to see your choice before you
 * commit it, and no way to know you're even being asked until they hit the
 * same tie themselves.
 */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body = await request.json().catch(() => null);
  const representativeId = typeof body?.representativeId === "string" ? body.representativeId : "";
  if (!representativeId) {
    return NextResponse.json({ error: "Thiếu representativeId." }, { status: 400 });
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  const [{ data: userData }, { data: game }] = await Promise.all([
    supabase.auth.getUser(),
    admin.from("match_games").select("*").eq("id", gameId).single(),
  ]);
  const uid = userData.user?.id;
  if (!uid) {
    return NextResponse.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  }
  if (!game) {
    return NextResponse.json({ error: "Không tìm thấy ván đấu." }, { status: 404 });
  }
  if (!game.bout_provisional || game.result) {
    return NextResponse.json({ error: "Chưa đến lúc chọn đại diện danh dự." }, { status: 409 });
  }

  const { data: match } = await admin
    .from("matches")
    .select("player_a, player_b")
    .eq("id", game.match_id)
    .single();
  if (!match) {
    return NextResponse.json({ error: "Không tìm thấy trận đấu." }, { status: 404 });
  }
  const side: DraftSide | null = match.player_a === uid ? "A" : match.player_b === uid ? "B" : null;
  if (!side) {
    return NextResponse.json({ error: "Bạn không phải người chơi trong trận này." }, { status: 403 });
  }

  const draftState = game.draft_state as DraftState;
  const myRoster = side === "A" ? draftState.pickedA : draftState.pickedB;
  if (!myRoster.includes(representativeId)) {
    return NextResponse.json(
      { error: "Đại diện danh dự phải là một vận động viên trong đội của bạn." },
      { status: 400 },
    );
  }

  const column = side === "A" ? "representative_a" : "representative_b";
  if (game[column]) {
    return NextResponse.json({ error: "Bạn đã chọn đại diện danh dự cho ván này rồi." }, { status: 409 });
  }

  // Guarded on this side's own column still being null — not on bout_seq,
  // for the same reason lineup_a/lineup_b are: A and B pick independently
  // and concurrently, so a shared counter would produce false conflicts.
  // bout_seq is bumped by the match_games_bump_seq trigger
  // (0013_atomic_bout_seq_bump.sql), not computed from this request's
  // pre-fetch — a JS-side increment here would race with the opponent's
  // concurrent representative pick and lose an increment, the same bug
  // 0012_atomic_seq_bump.sql fixed for lineup_seq/augment_seq/item_seq.
  const { data: updated, error } = await admin
    .from("match_games")
    .update({ [column]: representativeId })
    .eq("id", gameId)
    .is(column, null)
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "Trạng thái đã thay đổi, thử lại." }, { status: 409 });
  }

  after(async () => {
    await admin.channel(`game:${gameId}`).httpSend("game_update", updated as MatchGameRow);
  });

  return NextResponse.json(updated);
}
