import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isValidRoomId, type RoomRow } from "@/lib/rooms/types";

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

  const { data: leftA } = await admin
    .from("rooms")
    .update({ occupant_a: null, ready_a: false, status: "open", updated_at: new Date().toISOString() })
    .eq("id", roomId)
    .eq("occupant_a", uid)
    .select()
    .single<RoomRow>();

  const room =
    leftA ??
    (
      await admin
        .from("rooms")
        .update({ occupant_b: null, ready_b: false, status: "open", updated_at: new Date().toISOString() })
        .eq("id", roomId)
        .eq("occupant_b", uid)
        .select()
        .single<RoomRow>()
    ).data;

  if (!room) {
    return NextResponse.json({ error: "Bạn không ở trong phòng này." }, { status: 403 });
  }

  return NextResponse.json(room);
}
