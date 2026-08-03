import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AUGMENT_CATALOG } from "@/data/augments";
import { AUGMENT_PICK_SECONDS, rollAugmentOffer, rollTier } from "@/lib/versus/augments";
import type { DraftState, DraftSide, MatchGameRow } from "@/lib/versus/draft";

interface MyAugmentOffer {
  tier: string;
  offered: string[];
  /** ISO timestamp — when the auto-pick-on-timeout fires for this offer.
   *  Computed from the offer row's own `created_at` so both the client's
   *  countdown and the server's own deadline check (augments/auto-pick)
   *  agree on the same moment regardless of when the client happened to
   *  fetch it. */
  pickDeadline: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Idempotent, same shape as /api/games/start: rolls the round's tier and
 * both sides' private 3-augment offers on first call, or just returns the
 * current state on every call after. Either player's client can call this
 * once the draft completes — the guarded `augment_tier is null` update below
 * is the actual race guard, same pattern as draft_seq elsewhere.
 *
 * The response includes `myOffer`: the CALLER's own offered augments, straight
 * from the private augment_offers row this route just wrote. That's the only
 * copy of it that ever leaves the server for this caller — the client never
 * needs to subscribe to augment_offers over Realtime, and RLS on that table
 * means even a client that bypassed the app couldn't read the opponent's.
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
  if (game.game_number % 2 === 0) {
    return NextResponse.json({ error: "Ván này không có vòng bổ trợ." }, { status: 400 });
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

  async function myOfferFor(row: MatchGameRow): Promise<MyAugmentOffer | null> {
    const myPick = mySide === "A" ? row.augment_pick_a : row.augment_pick_b;
    if (myPick) return null; // already locked in
    const { data: offer } = await admin
      .from("augment_offers")
      .select("offered, created_at")
      .eq("match_game_id", gameId)
      .eq("side", mySide)
      .maybeSingle();
    if (!offer) return null;
    const pickDeadline = new Date(new Date(offer.created_at).getTime() + AUGMENT_PICK_SECONDS * 1000).toISOString();
    return { tier: row.augment_tier as string, offered: offer.offered as string[], pickDeadline };
  }

  if (game.augment_tier) {
    return NextResponse.json({ ...game, myOffer: await myOfferFor(game as MatchGameRow) });
  }

  const tier = rollTier();
  const offerA = rollAugmentOffer(AUGMENT_CATALOG, tier);
  const offerB = rollAugmentOffer(AUGMENT_CATALOG, tier);

  // augment_seq bumps here too, not just on a pick — otherwise a client that
  // was already on this page when the tier rolled never sees augment_tier
  // update: applyGameUpdate's staleness guard treats "no seq counter moved"
  // as "not newer" and drops the response, leaving the "…" placeholder
  // showing forever instead of the real tier.
  const { data: won } = await admin
    .from("match_games")
    .update({ augment_tier: tier, augment_seq: game.augment_seq + 1 })
    .eq("id", gameId)
    .is("augment_tier", null)
    .select()
    .single();

  if (won) {
    await admin.from("augment_offers").insert([
      { match_game_id: gameId, side: "A", player: match.player_a, offered: offerA },
      { match_game_id: gameId, side: "B", player: match.player_b, offered: offerB },
    ]);
    return NextResponse.json({ ...won, myOffer: await myOfferFor(won as MatchGameRow) });
  }

  // Lost the race — someone else is rolling right now. Re-read until their
  // write lands; the contention window here is one insert on a two-player
  // match, so this settles in well under a second.
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data: current } = await admin.from("match_games").select("*").eq("id", gameId).single();
    if (current?.augment_tier) {
      return NextResponse.json({ ...current, myOffer: await myOfferFor(current as MatchGameRow) });
    }
    await sleep(150);
  }
  return NextResponse.json({ error: "Không thể bắt đầu vòng bổ trợ, thử lại." }, { status: 500 });
}
