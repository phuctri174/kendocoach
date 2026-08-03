import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { DraftSide, DraftState, MatchGameRow } from "@/lib/versus/draft";

/**
 * Locks in one of the caller's own offered augments. Once this succeeds,
 * `augment_pick_a`/`augment_pick_b` — the only public trace of the round —
 * holds it, and everything else about the offer (the other two options)
 * stays confined to the private augment_offers row forever.
 */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body = await request.json().catch(() => null);
  const augmentId = typeof body?.augmentId === "string" ? body.augmentId : "";
  if (!augmentId) {
    return NextResponse.json({ error: "Thiếu augmentId." }, { status: 400 });
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
  if (game.game_number % 2 === 0) {
    return NextResponse.json({ error: "Ván này không có vòng bổ trợ." }, { status: 400 });
  }
  if ((game.draft_state as DraftState).status !== "complete" || !game.augment_tier) {
    return NextResponse.json({ error: "Vòng bổ trợ chưa bắt đầu." }, { status: 409 });
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

  const column = side === "A" ? "augment_pick_a" : "augment_pick_b";
  if (game[column]) {
    return NextResponse.json({ error: "Bạn đã chọn bổ trợ cho ván này rồi." }, { status: 409 });
  }

  const { data: offer } = await admin
    .from("augment_offers")
    .select("offered")
    .eq("match_game_id", gameId)
    .eq("side", side)
    .single();
  if (!offer || !(offer.offered as string[]).includes(augmentId)) {
    return NextResponse.json({ error: "Bổ trợ này không có trong danh sách được chọn." }, { status: 400 });
  }

  // Guarded on this side's own column still being null — not a shared
  // read-modify-write of one jsonb object, which under real concurrency lets
  // whichever side's write lands second silently overwrite the other side's
  // just-written pick with its own stale copy (see 0010_pick_columns.sql).
  // augment_seq is bumped by the match_games_bump_seq trigger
  // (0012_atomic_seq_bump.sql), not computed from this request's pre-fetch
  // — see that migration for why a JS-side increment here would race with
  // the opponent's concurrent pick and lose an increment.
  const { data: updated, error } = await admin
    .from("match_games")
    .update({ [column]: augmentId })
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
