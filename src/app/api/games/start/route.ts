import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CLUB_ROSTER } from "@/data/club";
import { initialDraftState, type DraftSide } from "@/lib/versus/draft";
import { GAME_TIME_LIMITS } from "@/lib/versus/config";
import type { TeamMatch } from "@/lib/kendo/types";

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

  // Comeback seeding: from game 2 onward, whoever lost the previous game
  // picks first in this game's draft (see DraftState.firstPicker). Game 1
  // has no previous result, so it falls through to the "A" default — same
  // as whatever currently assigns that seat (room join/ready order),
  // unchanged. The previous game's own `result` is read directly rather
  // than tracked via any new column on `matches` — it's already the
  // authoritative record of who won, and can't drift out of sync with
  // itself the way a duplicated column could under a race/retry.
  let firstPicker: DraftSide = "A";
  // Bo3's draft pool stays exclusive for the whole series (unlike Bo5, which
  // resets it every game) — every id drafted in an earlier game of this
  // match gets excluded from game 2/3's roll too. Both this and the comeback
  // seed below only need earlier games' own rows, so one fetch covers both.
  let seriesExcluded: string[] = [];
  if (gameNumber > 1) {
    const { data: priorGames } = await admin
      .from("match_games")
      .select("game_number, result, draft_state")
      .eq("match_id", matchId)
      .lt("game_number", gameNumber)
      .order("game_number", { ascending: true });

    const prevGame = priorGames?.find((g) => g.game_number === gameNumber - 1);
    const prevWinner = (prevGame?.result as TeamMatch | null)?.result.winner;
    // A prior draw shouldn't really happen (see advanceSeriesAfterGame) —
    // falls through to the "A" default same as game 1, rather than seeding
    // anything from an outcome that isn't really a clean win/loss.
    if (prevWinner === "A") firstPicker = "B";
    else if (prevWinner === "B") firstPicker = "A";

    if (match.format === "bo3") {
      seriesExcluded = (priorGames ?? []).flatMap((g) => {
        const state = g.draft_state as { pickedA?: string[]; pickedB?: string[] } | null;
        return [...(state?.pickedA ?? []), ...(state?.pickedB ?? [])];
      });
    }
  }

  const { data: created, error } = await admin
    .from("match_games")
    .insert({
      match_id: matchId,
      game_number: gameNumber,
      time_limit_seconds: GAME_TIME_LIMITS[gameNumber] ?? 120,
      draft_state: initialDraftState(ROSTER_IDS, firstPicker, seriesExcluded),
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
