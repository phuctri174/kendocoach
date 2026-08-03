import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ITEM_CATALOG } from "@/data/items";
import { rollItemOffer } from "@/lib/versus/items";
import type { DraftState, DraftSide } from "@/lib/versus/draft";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Idempotent, same shape as /api/games/[gameId]/augments/start (items are
 * the even-game counterpart to augments), but the race guard is different:
 * there's no tier column to gate on, so the guard is the primary key on
 * item_offers itself — a single batched insert of both sides' rows either
 * fully commits (winner) or fully fails on a unique-constraint conflict
 * (loser), since a multi-row insert with no ON CONFLICT clause is all-or-
 * nothing in Postgres.
 *
 * Response includes `myOffer`: the CALLER's own offered items, same
 * never-leaves-the-server-for-anyone-else privacy shape as augments.
 */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
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
  if (game.game_number % 2 !== 0) {
    return NextResponse.json({ error: "Ván này không có vòng trang bị." }, { status: 400 });
  }
  if ((game.draft_state as DraftState).status !== "complete") {
    return NextResponse.json({ error: "Vòng bốc thăm chưa xong." }, { status: 409 });
  }

  const { data: match } = await admin
    .from("matches")
    .select("player_a, player_b")
    .eq("id", game.match_id)
    .single();
  if (!match) {
    return NextResponse.json({ error: "Không tìm thấy trận đấu." }, { status: 404 });
  }
  const mySide: DraftSide | null = match.player_a === uid ? "A" : match.player_b === uid ? "B" : null;
  if (!mySide) {
    return NextResponse.json({ error: "Bạn không phải người chơi trong trận này." }, { status: 403 });
  }

  const myPick = mySide === "A" ? game.item_pick_a : game.item_pick_b;
  if (myPick) {
    return NextResponse.json({ ...game, myOffer: null });
  }

  const offerA = rollItemOffer(ITEM_CATALOG);
  const offerB = rollItemOffer(ITEM_CATALOG);

  const { error: insertError } = await admin.from("item_offers").insert([
    { match_game_id: gameId, side: "A", player: match.player_a, offered: offerA },
    { match_game_id: gameId, side: "B", player: match.player_b, offered: offerB },
  ]);

  if (!insertError) {
    const mine = mySide === "A" ? offerA : offerB;
    return NextResponse.json({ ...game, myOffer: mine });
  }

  // Lost the race (or the round was already rolled by an earlier call) —
  // re-read my own offer. Contention window is one insert on a two-player
  // match, so this settles in well under a second.
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data: offer } = await admin
      .from("item_offers")
      .select("offered")
      .eq("match_game_id", gameId)
      .eq("side", mySide)
      .maybeSingle();
    if (offer) return NextResponse.json({ ...game, myOffer: offer.offered as string[] });
    await sleep(150);
  }
  return NextResponse.json({ error: "Không thể bắt đầu vòng trang bị, thử lại." }, { status: 500 });
}
