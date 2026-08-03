import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SPECTATOR_SLOTS, SPECTATOR_STALE_MS } from "@/lib/versus/spectate";

interface MatchSpectatorRow {
  match_id: string;
  slot: number;
  user_id: string;
  joined_at: string;
  last_seen_at: string;
}

/**
 * Claims one of a match's 4 spectator slots. Each attempt is a plain INSERT
 * guarded by the (match_id, slot) primary key — two people racing for the
 * same slot number both fire the insert, only one lands, the loser's insert
 * just errors and this falls through to try the next slot, so no seat is
 * ever double-booked from a stale read. Same "let the constraint decide, not
 * a read-then-write" shape as rooms/join's occupant_a/occupant_b claim.
 */
export async function POST(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;

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

  const { data: match } = await admin
    .from("matches")
    .select("id, player_a, player_b")
    .eq("id", matchId)
    .maybeSingle();
  if (!match) {
    return NextResponse.json({ error: "Không tìm thấy trận đấu này." }, { status: 404 });
  }
  // A player opening their own match's spectator link already has a seat —
  // never one of these 4, and never displaced by anything below. The two
  // player seats (matches.player_a/player_b) are untouched by this whole
  // feature; this is the one place that has to actively guard against a
  // player accidentally taking a spectator slot on their own match.
  if (match.player_a === uid || match.player_b === uid) {
    return NextResponse.json({ role: "player" as const });
  }

  const { data: existing } = await admin
    .from("match_spectators")
    .select("*")
    .eq("match_id", matchId)
    .eq("user_id", uid)
    .maybeSingle<MatchSpectatorRow>();
  if (existing) {
    const { data: touched } = await admin
      .from("match_spectators")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("match_id", matchId)
      .eq("user_id", uid)
      .select()
      .single<MatchSpectatorRow>();
    return NextResponse.json({ role: "spectator" as const, slot: touched ?? existing });
  }

  const staleBefore = new Date(Date.now() - SPECTATOR_STALE_MS).toISOString();
  for (let slot = 1; slot <= SPECTATOR_SLOTS; slot++) {
    // No-op unless slot is genuinely stale (last_seen_at old) — frees it up
    // for the insert attempt right below without ever touching a slot that's
    // still actively held.
    await admin
      .from("match_spectators")
      .delete()
      .eq("match_id", matchId)
      .eq("slot", slot)
      .lt("last_seen_at", staleBefore);

    const { data: claimed } = await admin
      .from("match_spectators")
      .insert({ match_id: matchId, slot, user_id: uid })
      .select()
      .single<MatchSpectatorRow>();
    if (claimed) {
      return NextResponse.json({ role: "spectator" as const, slot: claimed });
    }
  }

  return NextResponse.json({ error: "Phòng xem đã đầy." }, { status: 409 });
}
