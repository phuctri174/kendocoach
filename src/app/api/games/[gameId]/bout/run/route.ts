import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { simulateTeamMatch } from "@/lib/kendo";
import {
  buildLiveModifierForGame,
  buildVersusTeamsForGame,
  regularBoutsLog,
  advanceSeriesAfterGame,
} from "@/lib/versus/bout";
import type { BoutProvisional, MatchGameRow } from "@/lib/versus/draft";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Idempotent, same shape as every other "run this once" route. This is
 * stage 1 of bout resolution: simulateTeamMatch (unmodified) is called
 * WITHOUT representatives to see whether the 5 regular bouts decide the
 * game outright. Because it's fully deterministic given the same seed, this
 * is safe to call again later — see 0009_daihyosen.sql for why.
 *
 * - Not tied (`decidedBy` is "bouts" or "ippons"): this result is already
 *   final — representatives were never consulted for it. Store it as
 *   `result` and advance the series immediately.
 * - Tied (`decidedBy` is "daihyosen"): the 5 bouts are correct (reps don't
 *   affect them) but this call's own tiebreak used the engine's
 *   auto-suggested rep, not a real pick, so it's discarded. Only the 5
 *   bouts + their narration are kept, as `bout_provisional` — the client
 *   then asks both players who represents them, now that they know it's
 *   actually tied, and bout/daihyosen resolves it for real.
 *
 * Either client can call this; `result is null and bout_provisional is
 * null` is the race guard, same pattern as augment_tier.
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

  if (game.result || game.bout_provisional) {
    return NextResponse.json(game);
  }
  if (!game.lineup_a || !game.lineup_b) {
    return NextResponse.json({ error: "Chưa xếp xong đội hình cả hai bên." }, { status: 409 });
  }

  const [{ teamA, teamB }, buildLiveModifier] = await Promise.all([
    buildVersusTeamsForGame(admin, game, match),
    buildLiveModifierForGame(admin, game),
  ]);

  const probe = simulateTeamMatch(teamA, teamB, {
    roundName: `Ván ${game.game_number}`,
    timeLimitSeconds: game.time_limit_seconds,
    seed: gameId,
    buildLiveModifier,
  });

  const tied = probe.result.decidedBy === "daihyosen";

  const writePayload: Record<string, unknown> = tied
    ? {
        bout_provisional: {
          bouts: probe.bouts,
          log: regularBoutsLog(probe.log),
          teamAWins: probe.result.teamAWins,
          teamBWins: probe.result.teamBWins,
          teamAIppons: probe.bouts.reduce((sum, b) => sum + b.result.ipponsA, 0),
          teamBIppons: probe.bouts.reduce((sum, b) => sum + b.result.ipponsB, 0),
        } satisfies BoutProvisional,
        bout_seq: game.bout_seq + 1,
      }
    : { result: probe, bout_seq: game.bout_seq + 1 };

  const { data: updated, error } = await admin
    .from("match_games")
    .update(writePayload)
    .eq("id", gameId)
    .is("result", null)
    .is("bout_provisional", null)
    .select()
    .single();

  if (error || !updated) {
    // Lost the race, or a previous call already resolved this — read back
    // whatever landed. Contention window is one write on a two-player
    // match, so this settles in well under a second.
    for (let attempt = 0; attempt < 10; attempt++) {
      const { data: current } = await admin.from("match_games").select("*").eq("id", gameId).single();
      if (current?.result || current?.bout_provisional) return NextResponse.json(current);
      await sleep(150);
    }
    return NextResponse.json({ error: "Không thể mô phỏng trận đấu, thử lại." }, { status: 500 });
  }

  if (!tied) {
    await advanceSeriesAfterGame(admin, match, probe.result.winner);
  }

  after(async () => {
    await admin.channel(`game:${gameId}`).httpSend("game_update", updated as MatchGameRow);
  });

  return NextResponse.json(updated);
}
