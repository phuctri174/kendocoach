import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AUGMENT_PICK_SECONDS } from "@/lib/versus/augments";
import type { DraftSide, DraftState, MatchGameRow } from "@/lib/versus/draft";

/**
 * Same auto-pick-on-timeout shape as draft/auto-pick, but scoped to the
 * caller's own side rather than a shared turn — augment picks aren't
 * turn-based, each side has its own 30s clock starting from when its offer
 * was rolled (augment_offers.created_at), so this only ever touches the
 * caller's own column. The server re-derives the deadline from that same
 * created_at rather than trusting anything the client sends, same principle
 * as draft/auto-pick re-checking turnDeadline itself.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;

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
    // A real pick already landed (e.g. it beat this timer by a hair) —
    // nothing to do, not an error.
    return NextResponse.json(game);
  }

  const { data: offer } = await admin
    .from("augment_offers")
    .select("offered, created_at")
    .eq("match_game_id", gameId)
    .eq("side", side)
    .single();
  if (!offer) {
    return NextResponse.json({ error: "Chưa có lựa chọn để tự động chọn." }, { status: 409 });
  }
  const deadline = new Date(offer.created_at).getTime() + AUGMENT_PICK_SECONDS * 1000;
  if (deadline > Date.now()) {
    return NextResponse.json({ error: "Chưa hết giờ." }, { status: 409 });
  }

  const offered = offer.offered as string[];
  const augmentId = offered[Math.floor(Math.random() * offered.length)];

  // Same own-column-null guard as the manual pick route.
  const { data: updated, error } = await admin
    .from("match_games")
    .update({ [column]: augmentId, augment_seq: game.augment_seq + 1 })
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
