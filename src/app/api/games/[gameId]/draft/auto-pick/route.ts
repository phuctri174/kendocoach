import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CLUB_ROSTER } from "@/data/club";
import { applyPick, currentTurnSide, type DraftState } from "@/lib/versus/draft";

const ROSTER_IDS = CLUB_ROSTER.map((p) => p.id);

/**
 * Either connected client can call this once its own clock says the turn
 * deadline passed — whoever's UI notices first. The server re-checks the
 * deadline against its own clock before doing anything, so a client lying
 * about the time (or just running fast) can't force an early auto-pick.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;

  const supabase = await createClient();
  const admin = createAdminClient();

  const [{ data: userData }, { data: game }] = await Promise.all([
    supabase.auth.getUser(),
    admin.from("match_games").select("*").eq("id", gameId).single(),
  ]);
  if (!userData.user) {
    return NextResponse.json({ error: "Bạn cần đăng nhập." }, { status: 401 });
  }
  if (!game) {
    return NextResponse.json({ error: "Không tìm thấy ván đấu." }, { status: 404 });
  }

  const state = game.draft_state as DraftState;
  if (state.status !== "drafting") {
    return NextResponse.json({ error: "Vòng bốc thăm đã kết thúc." }, { status: 409 });
  }
  if (new Date(state.turnDeadline).getTime() > Date.now()) {
    return NextResponse.json({ error: "Chưa hết giờ." }, { status: 409 });
  }
  if (state.pool.length === 0) {
    return NextResponse.json({ error: "Không còn ứng viên để chọn ngẫu nhiên." }, { status: 409 });
  }

  const side = currentTurnSide(state);
  const candidateId = state.pool[Math.floor(Math.random() * state.pool.length)];
  const nextState = applyPick(state, side, candidateId, ROSTER_IDS);

  const { data: updated, error } = await admin
    .from("match_games")
    .update({ draft_state: nextState, draft_seq: game.draft_seq + 1 })
    .eq("id", gameId)
    .eq("draft_seq", game.draft_seq)
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "Trạng thái đã thay đổi, thử lại." }, { status: 409 });
  }

  after(async () => {
    const [{ data: match }] = await Promise.all([
      admin.from("matches").select("player_a, player_b").eq("id", game.match_id).single(),
      admin.channel(`game:${gameId}`).httpSend("game_update", updated),
    ]);
    const playerId = side === "A" ? match?.player_a : match?.player_b;
    if (playerId) {
      await admin.from("draft_events").insert({
        match_game_id: gameId,
        phase: state.phase,
        turn_index: state.turnIndex,
        player: playerId,
        candidate_id: candidateId,
      });
    }
  });

  return NextResponse.json(updated);
}
