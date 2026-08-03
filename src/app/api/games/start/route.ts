import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CLUB_ROSTER } from "@/data/club";
import { initialDraftState } from "@/lib/versus/draft";
import { GAME_TIME_LIMITS } from "@/lib/versus/config";

const ROSTER_IDS = CLUB_ROSTER.map((p) => p.id);

/**
 * Idempotent: creates the `match_games` row for the match's current game
 * number if it doesn't exist yet, otherwise just returns the existing one.
 * The unique(match_id, game_number) constraint is the actual race guard —
 * two simultaneous calls (one per player's client, both loading the match
 * page at once) resolve to one insert winning and the other falling back to
 * a plain read.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const matchId = typeof body?.matchId === "string" ? body.matchId : "";
  if (!matchId) {
    return NextResponse.json({ error: "Thiếu matchId." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) {
    return NextResponse.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: match } = await admin.from("matches").select("*").eq("id", matchId).single();
  if (!match) {
    return NextResponse.json({ error: "Không tìm thấy trận đấu." }, { status: 404 });
  }
  if (match.player_a !== uid && match.player_b !== uid) {
    return NextResponse.json({ error: "Bạn không phải người chơi trong trận này." }, { status: 403 });
  }

  const gameNumber = match.current_game_number;

  const { data: existing } = await admin
    .from("match_games")
    .select("*")
    .eq("match_id", matchId)
    .eq("game_number", gameNumber)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(existing);
  }

  const { data: created, error } = await admin
    .from("match_games")
    .insert({
      match_id: matchId,
      game_number: gameNumber,
      time_limit_seconds: GAME_TIME_LIMITS[gameNumber] ?? 120,
      draft_state: initialDraftState(ROSTER_IDS),
    })
    .select()
    .single();

  if (error || !created) {
    const { data: fallback } = await admin
      .from("match_games")
      .select("*")
      .eq("match_id", matchId)
      .eq("game_number", gameNumber)
      .single();
    if (fallback) return NextResponse.json(fallback);
    return NextResponse.json({ error: "Không thể bắt đầu ván đấu." }, { status: 500 });
  }

  return NextResponse.json(created);
}
