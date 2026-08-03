import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { simulateTeamMatch } from "@/lib/kendo";
import { buildLiveModifierForGame, buildVersusTeamsForGame, advanceSeriesAfterGame } from "@/lib/versus/bout";
import type { MatchGameRow } from "@/lib/versus/draft";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stage 2: only reachable once both players have privately picked a
 * daihyosen representative (bout/representative). Calls simulateTeamMatch
 * (unmodified) again with the SAME seed as the stage-1 probe — since it's
 * fully deterministic, this reproduces the identical 5 regular bouts, but
 * now resolves the tiebreak with the real representatives instead of the
 * engine's auto-suggested ones. The result this produces is final.
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

  const { data: match } = await admin.from("matches").select("*").eq("id", game.match_id).single();
  if (!match) {
    return NextResponse.json({ error: "Không tìm thấy trận đấu." }, { status: 404 });
  }
  if (match.player_a !== uid && match.player_b !== uid) {
    return NextResponse.json({ error: "Bạn không phải người chơi trong trận này." }, { status: 403 });
  }

  if (game.result) {
    return NextResponse.json(game);
  }
  if (!game.bout_provisional || !game.representative_a || !game.representative_b) {
    return NextResponse.json({ error: "Chưa đủ hai đại diện danh dự." }, { status: 409 });
  }

  const [{ teamA, teamB }, buildLiveModifier] = await Promise.all([
    buildVersusTeamsForGame(admin, game, match),
    buildLiveModifierForGame(admin, game),
  ]);

  const final = simulateTeamMatch(teamA, teamB, {
    roundName: `Ván ${game.game_number}`,
    timeLimitSeconds: game.time_limit_seconds,
    seed: gameId,
    representatives: { a: game.representative_a, b: game.representative_b },
    buildLiveModifier,
  });

  // bout_seq is bumped by the match_games_bump_seq trigger
  // (0013_atomic_bout_seq_bump.sql), not computed here.
  const { data: updated, error } = await admin
    .from("match_games")
    .update({ result: final })
    .eq("id", gameId)
    .is("result", null)
    .select()
    .single();

  if (error || !updated) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const { data: current } = await admin.from("match_games").select("*").eq("id", gameId).single();
      if (current?.result) return NextResponse.json(current);
      await sleep(150);
    }
    return NextResponse.json({ error: "Không thể phân định trận đại diện, thử lại." }, { status: 500 });
  }

  await advanceSeriesAfterGame(admin, match, final.result.winner);

  after(async () => {
    await admin.channel(`game:${gameId}`).httpSend("game_update", updated as MatchGameRow);
  });

  return NextResponse.json(updated);
}
