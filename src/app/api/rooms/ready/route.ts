import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isValidRoomId, type RoomRow } from "@/lib/rooms/types";

/**
 * Flips the caller's own ready flag. Whichever of the two ready-flips lands
 * second is the one that observes both flags true (Postgres serializes the
 * two single-row UPDATEs on the row lock), so exactly one request creates the
 * match — see join/route.ts for the same pattern applied to seat claims.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const roomId = Number(body?.roomId);
  if (!isValidRoomId(roomId)) {
    return NextResponse.json({ error: "Phòng không hợp lệ." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) {
    return NextResponse.json(
      { error: "Bạn cần đăng nhập hoặc chơi với tư cách khách trước." },
      { status: 401 },
    );
  }

  const admin = createAdminClient();

  const { data: seatA } = await admin
    .from("rooms")
    .update({ ready_a: true, updated_at: new Date().toISOString() })
    .eq("id", roomId)
    .eq("occupant_a", uid)
    .select()
    .single<RoomRow>();

  const room =
    seatA ??
    (
      await admin
        .from("rooms")
        .update({ ready_b: true, updated_at: new Date().toISOString() })
        .eq("id", roomId)
        .eq("occupant_b", uid)
        .select()
        .single<RoomRow>()
    ).data;

  if (!room) {
    return NextResponse.json({ error: "Bạn không ở trong phòng này." }, { status: 403 });
  }

  if (!(room.ready_a && room.ready_b)) {
    return NextResponse.json(room);
  }

  const { data: match, error: matchError } = await admin
    .from("matches")
    .insert({ room_id: roomId, player_a: room.occupant_a, player_b: room.occupant_b, format: room.format })
    .select()
    .single();

  if (matchError || !match) {
    return NextResponse.json({ error: "Không thể tạo trận đấu, thử lại." }, { status: 500 });
  }

  // Free the room immediately — the match now lives on its own route.
  await admin
    .from("rooms")
    .update({
      occupant_a: null,
      occupant_b: null,
      ready_a: false,
      ready_b: false,
      status: "open",
      updated_at: new Date().toISOString(),
    })
    .eq("id", roomId);

  return NextResponse.json({ ...room, matchId: match.id });
}
