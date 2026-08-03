import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { DraftSide, MatchGameRow } from "@/lib/versus/draft";

/**
 * Locks in the caller's own readiness to move past this game's result screen
 * — only reachable once the game actually has a result. The client only
 * moves on (resets its local `game` to undefined, picking up the next game
 * number) once it observes BOTH continue_a and continue_b true, same
 * "wait for both" shape as lineup confirm and augment/item picks: one side
 * clicking "Tiếp tục" must not advance them alone while the other is still
 * looking at the previous screen.
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
  if (!game.result) {
    return NextResponse.json({ error: "Ván đấu chưa kết thúc." }, { status: 409 });
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

  const column = side === "A" ? "continue_a" : "continue_b";
  if (game[column]) {
    // Already confirmed — idempotent no-op, not an error (e.g. a retried
    // request after a dropped response).
    return NextResponse.json(game);
  }

  // Guarded on this side's own column still being false — not on bout_seq,
  // for the same reason lineup_a/lineup_b are: A and B confirm independently
  // and concurrently. bout_seq is bumped by the match_games_bump_seq trigger
  // (0015_bo3_format_and_continue_gate.sql), not computed here — a JS-side
  // increment would race with the opponent's concurrent click and lose an
  // increment, the same bug 0012/0013 fixed for the other per-side columns.
  const { data: updated, error } = await admin
    .from("match_games")
    .update({ [column]: true })
    .eq("id", gameId)
    .eq(column, false)
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
