import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CLUB_ROSTER } from "@/data/club";
import { applyPick, currentTurnSide, type DraftState } from "@/lib/versus/draft";

const ROSTER_IDS = CLUB_ROSTER.map((p) => p.id);

export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body = await request.json().catch(() => null);
  const candidateId = typeof body?.candidateId === "string" ? body.candidateId : "";
  if (!candidateId) {
    return NextResponse.json({ error: "Thiếu candidateId." }, { status: 400 });
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  // auth.getUser() always makes its own round trip to revalidate the JWT
  // against Supabase Auth — it doesn't depend on the game row, so run it
  // alongside that fetch instead of after it.
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

  const { data: match } = await admin
    .from("matches")
    .select("player_a, player_b")
    .eq("id", game.match_id)
    .single();
  if (!match) {
    return NextResponse.json({ error: "Không tìm thấy trận đấu." }, { status: 404 });
  }

  const side = match.player_a === uid ? "A" : match.player_b === uid ? "B" : null;
  if (!side) {
    return NextResponse.json({ error: "Bạn không phải người chơi trong trận này." }, { status: 403 });
  }

  const state = game.draft_state as DraftState;
  if (state.status !== "drafting") {
    return NextResponse.json({ error: "Vòng bốc thăm đã kết thúc." }, { status: 409 });
  }
  if (currentTurnSide(state) !== side) {
    return NextResponse.json({ error: "Chưa đến lượt của bạn." }, { status: 403 });
  }
  if (!state.pool.includes(candidateId)) {
    return NextResponse.json({ error: "Người này không có trong danh sách hiện tại." }, { status: 400 });
  }

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

  // Neither of these needs to block the response: the picker already has
  // `updated` right here, and the opponent only needs the broadcast, not
  // this request's HTTP response. Runs after the response is sent.
  after(async () => {
    await Promise.all([
      admin.channel(`game:${gameId}`).httpSend("game_update", updated),
      admin.from("draft_events").insert({
        match_game_id: gameId,
        phase: state.phase,
        turn_index: state.turnIndex,
        player: uid,
        candidate_id: candidateId,
      }),
    ]);
  });

  return NextResponse.json(updated);
}
