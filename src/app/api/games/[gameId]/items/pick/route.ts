import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { DraftSide, DraftState, MatchGameRow } from "@/lib/versus/draft";

/**
 * Locks in one of the caller's own offered items for this round — but
 * unlike the old items/equip, picking no longer assigns a target. It just
 * adds the item to the side's permanent, non-consumable series inventory
 * (matches.inventory_a/b); which of that game's 5 drafted players (if any)
 * actually wears it is a separate choice made at lineup time, every game,
 * from the whole accumulated inventory (see lineup/confirm's `equips`).
 *
 * `item_pick_a`/`item_pick_b` keeps its old role as the per-game "have I
 * made this round's pick yet" gate, now holding just the itemId.
 */
export async function POST(request: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const body = await request.json().catch(() => null);
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  if (!itemId) {
    return NextResponse.json({ error: "Thiếu itemId." }, { status: 400 });
  }

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
  const draftState = game.draft_state as DraftState;
  if (draftState.status !== "complete") {
    return NextResponse.json({ error: "Vòng bốc thăm chưa xong." }, { status: 409 });
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

  const column = side === "A" ? "item_pick_a" : "item_pick_b";
  if (game[column]) {
    return NextResponse.json({ error: "Bạn đã chọn vật phẩm cho ván này rồi." }, { status: 409 });
  }

  const { data: offer } = await admin
    .from("item_offers")
    .select("offered")
    .eq("match_game_id", gameId)
    .eq("side", side)
    .single();
  if (!offer || !(offer.offered as string[]).includes(itemId)) {
    return NextResponse.json({ error: "Vật phẩm này không có trong danh sách được chọn." }, { status: 400 });
  }

  // Guarded on this side's own column still being null — not a shared
  // read-modify-write of one jsonb object (see 0010_pick_columns.sql). The
  // inventory append below only ever runs once this guard has actually
  // succeeded, so it can't race with a second concurrent pick attempt from
  // the same side either.
  const { data: updated, error } = await admin
    .from("match_games")
    .update({ [column]: itemId, item_seq: game.item_seq + 1 })
    .eq("id", gameId)
    .is(column, null)
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "Trạng thái đã thay đổi, thử lại." }, { status: 409 });
  }

  const inventoryColumn = side === "A" ? "inventory_a" : "inventory_b";
  const currentInventory = (side === "A" ? match.inventory_a : match.inventory_b) as string[];
  await admin
    .from("matches")
    .update({ [inventoryColumn]: [...currentInventory, itemId] })
    .eq("id", game.match_id);

  after(async () => {
    await admin.channel(`game:${gameId}`).httpSend("game_update", updated as MatchGameRow);
  });

  return NextResponse.json(updated);
}
