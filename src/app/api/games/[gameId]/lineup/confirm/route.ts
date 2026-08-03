import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { POSITIONS, type Position } from "@/lib/kendo/types";
import type { DraftSide, DraftState, MatchGameRow } from "@/lib/versus/draft";

const LOWER_POSITIONS = POSITIONS.map((p) => p.toLowerCase() as Lowercase<Position>);

interface EquipInput {
  itemId: string;
  targetPlayerId: string;
}

/**
 * Locks in the caller's own lineup — one write, no partial state on the
 * server beforehand. The arranging itself (drag-and-drop) never touches this
 * route; only the final, complete assignment does, once. This is what makes
 * it private until confirmed: nothing before this call ever left the
 * client, so there was nothing for the opponent to see.
 *
 * Also locks in this game's item-equip choices (`equips`), made from the
 * side's whole accumulated, non-consumable inventory (matches.inventory_a/
 * b) — every game, not just even ones, since an item picked in an earlier
 * even game is still available to equip on an odd game's roster too.
 * Bundled into the same write as the lineup rather than its own route: both
 * are "arrange locally, commit once" the same way, and there's no reason
 * for them to have independent lock-in moments.
 *
 * The daihyosen representative is a separate phase (bout/representative),
 * not bundled in here — it's only asked for after both regular bouts run
 * and the match actually ties, never pre-guessed before that's known.
 */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body = await request.json().catch(() => null);
  const lineup = body?.lineup;
  const equipsInput: unknown = body?.equips ?? [];

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

  const draftState = game.draft_state as DraftState;
  const isOddGame = game.game_number % 2 === 1;
  const priorPhaseDone = isOddGame
    ? game.augment_pick_a && game.augment_pick_b
    : game.item_pick_a && game.item_pick_b;
  if (draftState.status !== "complete" || !priorPhaseDone) {
    return NextResponse.json({ error: "Chưa thể xếp đội hình lúc này." }, { status: 409 });
  }

  const { data: match } = await admin
    .from("matches")
    .select("player_a, player_b, inventory_a, inventory_b")
    .eq("id", game.match_id)
    .single();
  if (!match) {
    return NextResponse.json({ error: "Không tìm thấy trận đấu." }, { status: 404 });
  }
  const side: DraftSide | null = match.player_a === uid ? "A" : match.player_b === uid ? "B" : null;
  if (!side) {
    return NextResponse.json({ error: "Bạn không phải người chơi trong trận này." }, { status: 403 });
  }

  const column = side === "A" ? "lineup_a" : "lineup_b";
  if (game[column]) {
    return NextResponse.json({ error: "Bạn đã chốt đội hình cho ván này rồi." }, { status: 409 });
  }

  const myRoster: string[] = side === "A" ? draftState.pickedA : draftState.pickedB;
  if (!lineup || typeof lineup !== "object" || Array.isArray(lineup)) {
    return NextResponse.json({ error: "Đội hình không hợp lệ." }, { status: 400 });
  }
  const keys = Object.keys(lineup);
  const values = Object.values(lineup) as unknown[];
  const validShape =
    keys.length === LOWER_POSITIONS.length &&
    LOWER_POSITIONS.every((p) => typeof lineup[p] === "string") &&
    new Set(values).size === myRoster.length &&
    values.every((id) => myRoster.includes(id as string));
  if (!validShape) {
    return NextResponse.json(
      { error: "Đội hình phải xếp đủ 5 vị trí, mỗi vận động viên trong đội của bạn đúng một lần." },
      { status: 400 },
    );
  }

  // equips: every item must actually be in the side's accumulated
  // inventory (not consumed by using it — the same item can appear in a
  // future game's equips again), every target must be one of this game's
  // own drafted 5, and — same "max one item per player" rule as before,
  // now also "max one player per item" since each physical item can only
  // be in one place at once — no id repeats on either side of the pairing.
  if (!Array.isArray(equipsInput)) {
    return NextResponse.json({ error: "Danh sách trang bị không hợp lệ." }, { status: 400 });
  }
  const inventory = (side === "A" ? match.inventory_a : match.inventory_b) as string[];
  const equips: EquipInput[] = [];
  const seenItemIds = new Set<string>();
  const seenTargetIds = new Set<string>();
  for (const entry of equipsInput) {
    const itemId = typeof (entry as EquipInput)?.itemId === "string" ? (entry as EquipInput).itemId : "";
    const targetPlayerId =
      typeof (entry as EquipInput)?.targetPlayerId === "string" ? (entry as EquipInput).targetPlayerId : "";
    if (!itemId || !targetPlayerId) {
      return NextResponse.json({ error: "Trang bị không hợp lệ." }, { status: 400 });
    }
    if (!inventory.includes(itemId)) {
      return NextResponse.json({ error: "Vật phẩm này không có trong kho của bạn." }, { status: 400 });
    }
    if (!myRoster.includes(targetPlayerId)) {
      return NextResponse.json({ error: "Vận động viên này không thuộc đội của bạn ở ván này." }, { status: 400 });
    }
    if (seenItemIds.has(itemId) || seenTargetIds.has(targetPlayerId)) {
      return NextResponse.json(
        { error: "Mỗi vật phẩm và mỗi vận động viên chỉ được trang bị/nhận một lần." },
        { status: 400 },
      );
    }
    seenItemIds.add(itemId);
    seenTargetIds.add(targetPlayerId);
    equips.push({ itemId, targetPlayerId });
  }
  const equipsColumn = side === "A" ? "item_equips_a" : "item_equips_b";

  // Guarded on this side's own column still being null — not on lineup_seq,
  // which both sides would otherwise race over even though their writes
  // never actually touch the same column. A and B confirm independently
  // and concurrently (there's no turn order here, unlike draft picks), so a
  // shared optimistic-concurrency counter produces false conflicts: side B
  // confirming has no reason to make side A's confirm fail, but it would
  // under a shared `.eq("lineup_seq", ...)` guard. lineup_seq still gets
  // bumped for the client's own broadcast/postgres_changes staleness check.
  const { data: updated, error } = await admin
    .from("match_games")
    .update({ [column]: lineup, [equipsColumn]: equips, lineup_seq: game.lineup_seq + 1 })
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
