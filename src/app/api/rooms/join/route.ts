import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isValidRoomId, type RoomRow } from "@/lib/rooms/types";

/**
 * Claims an open seat in a room. Each seat-claim is a single UPDATE whose
 * WHERE clause only matches while that seat is genuinely still free, so two
 * simultaneous joins race at the database row lock, not in application code —
 * exactly one wins per seat, the other's update simply matches zero rows.
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

  const { data: current } = await admin
    .from("rooms")
    .select("*")
    .eq("id", roomId)
    .single<RoomRow>();
  if (!current) {
    return NextResponse.json({ error: "Phòng không tồn tại." }, { status: 404 });
  }
  if (current.occupant_a === uid || current.occupant_b === uid) {
    return NextResponse.json(current);
  }

  const { data: elsewhere } = await admin
    .from("rooms")
    .select("id")
    .or(`occupant_a.eq.${uid},occupant_b.eq.${uid}`)
    .neq("id", roomId)
    .maybeSingle();
  if (elsewhere) {
    return NextResponse.json({ error: "Bạn đang ở một phòng khác." }, { status: 409 });
  }

  const { data: claimedA } = await admin
    .from("rooms")
    .update({ occupant_a: uid, updated_at: new Date().toISOString() })
    .eq("id", roomId)
    .is("occupant_a", null)
    .select()
    .single<RoomRow>();

  const claimed =
    claimedA ??
    (
      await admin
        .from("rooms")
        .update({ occupant_b: uid, updated_at: new Date().toISOString() })
        .eq("id", roomId)
        .is("occupant_b", null)
        .neq("occupant_a", uid)
        .select()
        .single<RoomRow>()
    ).data;

  if (!claimed) {
    return NextResponse.json({ error: "Phòng đã đầy." }, { status: 409 });
  }

  if (claimed.occupant_a && claimed.occupant_b && claimed.status !== "full") {
    const { data: fixed } = await admin
      .from("rooms")
      .update({ status: "full" })
      .eq("id", roomId)
      .select()
      .single<RoomRow>();
    return NextResponse.json(fixed ?? claimed);
  }

  return NextResponse.json(claimed);
}
