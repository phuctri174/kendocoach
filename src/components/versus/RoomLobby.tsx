"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HexPanel } from "@/components/Hex";
import { createClient } from "@/lib/supabase/client";
import type { RoomRow } from "@/lib/rooms/types";

interface ProfileLite {
  id: string;
  display_name: string;
}

const ROOM_IDS = [1, 2, 3, 4, 5, 6] as const;

async function postRoomAction(path: string, roomId: number): Promise<{ error?: string }> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId }),
  });
  const body = await res.json().catch(() => null);
  return res.ok ? {} : { error: body?.error ?? "Có lỗi xảy ra, thử lại." };
}

/** Six fixed rooms, live via Realtime — 3 locked to Bo5, 3 to Bo3, format
 *  fixed per room rather than chosen per-match. No create/configure step — ever. */
export function RoomLobby({ myUserId, myDisplayName }: { myUserId: string; myDisplayName: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [rooms, setRooms] = useState<RoomRow[] | null>(null);
  const [profiles, setProfiles] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [busyRoom, setBusyRoom] = useState<number | null>(null);
  // Bumped by the realtime subscription below; the fetch effect re-runs off
  // this instead of an imperative refetch call from inside an effect body.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: roomRows } = await supabase.from("rooms").select("*").order("id");
      if (cancelled || !roomRows) return;
      setRooms(roomRows as RoomRow[]);

      const ids = Array.from(
        new Set(
          roomRows.flatMap((r) => [r.occupant_a, r.occupant_b].filter((v): v is string => !!v)),
        ),
      );
      if (ids.length === 0) {
        setProfiles(new Map());
        return;
      }
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
      if (cancelled) return;
      setProfiles(new Map((profileRows as ProfileLite[] | null)?.map((p) => [p.id, p.display_name])));
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, tick]);

  useEffect(() => {
    const roomsChannel = supabase
      .channel("lobby-rooms")
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, () =>
        setTick((n) => n + 1),
      )
      .subscribe();

    // Two subscriptions because a Realtime filter is a single column
    // comparison — one for "I'm player_a", one for "I'm player_b".
    const matchAChannel = supabase
      .channel(`lobby-match-a-${myUserId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "matches", filter: `player_a=eq.${myUserId}` },
        (payload) => router.push(`/tran/${(payload.new as { id: string }).id}`),
      )
      .subscribe();
    const matchBChannel = supabase
      .channel(`lobby-match-b-${myUserId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "matches", filter: `player_b=eq.${myUserId}` },
        (payload) => router.push(`/tran/${(payload.new as { id: string }).id}`),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(roomsChannel);
      supabase.removeChannel(matchAChannel);
      supabase.removeChannel(matchBChannel);
    };
  }, [supabase, router, myUserId]);

  const myRoomId = rooms?.find((r) => r.occupant_a === myUserId || r.occupant_b === myUserId)?.id ?? null;

  // Whoever's ready-flip is the one that observes both flags true creates the
  // match and immediately frees the room (see ready/route.ts) — the OTHER
  // player's own request never carries a matchId back, so historically they
  // depended entirely on the matchAChannel/matchBChannel subscriptions above
  // to notice the new row and navigate. That's a single best-effort Realtime
  // delivery with no fallback: if it's ever slow or missed for one side while
  // the shared "rooms" row (which both sides watch) has already reset their
  // seat, that side sees an empty room and nothing ever routes them onward —
  // stuck looking "kicked out" even though a real match was created for them.
  // This ref lets us notice exactly that transition (seated → unseated,
  // without an explicit leave) and directly ask "was I actually just placed
  // into a match?" instead of only ever waiting on the one Realtime event.
  const wasSeatedRef = useRef(false);
  const explicitLeaveRef = useRef(false);

  const checkForActiveMatch = useCallback(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data } = await supabase
        .from("matches")
        .select("id")
        .or(`player_a.eq.${myUserId},player_b.eq.${myUserId}`)
        .neq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        router.push(`/tran/${data.id}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }, [supabase, router, myUserId]);

  useEffect(() => {
    const isSeated = myRoomId !== null;
    if (wasSeatedRef.current && !isSeated) {
      if (explicitLeaveRef.current) {
        // We asked to leave ourselves — the lobby view is already correct,
        // no need to go looking for a match that was never created.
        explicitLeaveRef.current = false;
      } else {
        checkForActiveMatch();
      }
    }
    wasSeatedRef.current = isSeated;
  }, [myRoomId, checkForActiveMatch]);

  const act = async (path: string, roomId: number) => {
    setBusyRoom(roomId);
    setError(null);
    const result = await postRoomAction(path, roomId);
    setBusyRoom(null);
    if (result.error) setError(result.error);
  };

  const leave = async (roomId: number) => {
    explicitLeaveRef.current = true;
    await act("/api/rooms/leave", roomId);
  };

  const ready = async (roomId: number) => {
    setBusyRoom(roomId);
    setError(null);
    const res = await fetch("/api/rooms/ready", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId }),
    });
    const body = await res.json().catch(() => null);
    setBusyRoom(null);
    if (!res.ok) {
      setError(body?.error ?? "Có lỗi xảy ra, thử lại.");
      return;
    }
    // If our own ready-flip was the one that observed both sides ready, the
    // match id comes straight back here — no need to wait on Realtime at all
    // for this side.
    if (body?.matchId) router.push(`/tran/${body.matchId}`);
  };

  if (!rooms) {
    return <p className="text-center text-sm text-bone-faint">Đang tải phòng chờ…</p>;
  }

  return (
    <section className="flex flex-col gap-4 sm:gap-6">
      <header className="flex flex-col items-center gap-1 text-center">
        <p className="display text-xs text-brass-600">Đấu đối kháng</p>
        <h2 className="display text-xl text-bone sm:text-2xl">Phòng chờ</h2>
        <p className="text-xs text-bone-faint">Bạn: {myDisplayName}</p>
      </header>

      {error && <p className="text-center text-xs text-blood">{error}</p>}

      <ol className="flex flex-col gap-2.5 sm:gap-3">
        {ROOM_IDS.map((id) => {
          const room = rooms.find((r) => r.id === id);
          if (!room) return null;
          return (
            <RoomCard
              key={id}
              room={room}
              myUserId={myUserId}
              nameOf={(uid) => profiles.get(uid) ?? "…"}
              blockedByOtherRoom={myRoomId !== null && myRoomId !== id}
              busy={busyRoom === id}
              onJoin={() => act("/api/rooms/join", id)}
              onLeave={() => leave(id)}
              onReady={() => ready(id)}
            />
          );
        })}
      </ol>
    </section>
  );
}

function RoomCard({
  room,
  myUserId,
  nameOf,
  blockedByOtherRoom,
  busy,
  onJoin,
  onLeave,
  onReady,
}: {
  room: RoomRow;
  myUserId: string;
  nameOf: (uid: string) => string;
  blockedByOtherRoom: boolean;
  busy: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onReady: () => void;
}) {
  const iAmA = room.occupant_a === myUserId;
  const iAmB = room.occupant_b === myUserId;
  const seated = iAmA || iAmB;
  const full = !!room.occupant_a && !!room.occupant_b;
  const myReady = iAmA ? room.ready_a : iAmB ? room.ready_b : false;
  const opponentReady = iAmA ? room.ready_b : iAmB ? room.ready_a : false;

  const seatLabel = (occupant: string | null, ready: boolean) => {
    if (!occupant) return <span className="text-bone-faint">Trống</span>;
    return (
      <span className={ready ? "text-brass-600" : "text-bone"}>
        {nameOf(occupant)}
        {ready && " ✓"}
      </span>
    );
  };

  return (
    <li>
      <HexPanel cut={14}>
        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
          <div className="flex items-center gap-3 text-sm">
            <span className="display text-xs text-brass-600">Phòng {room.id}</span>
            <span className="hex-tab display bg-forest-700 px-1.5 py-0.5 text-[10px] text-brass-300">
              {room.format === "bo3" ? "BO3" : "BO5"}
            </span>
            <span className="text-bone-faint">·</span>
            {seatLabel(room.occupant_a, room.ready_a)}
            <span className="text-bone-faint">vs</span>
            {seatLabel(room.occupant_b, room.ready_b)}
          </div>

          <div className="flex justify-end gap-2">
            {!seated && !full && (
              <button
                type="button"
                onClick={onJoin}
                disabled={busy || blockedByOtherRoom}
                className="hex-tab bg-brass-400 px-5 py-2 text-forest-900 transition-colors hover:bg-brass-300 disabled:cursor-not-allowed disabled:bg-paper-dim disabled:text-bone-faint"
              >
                <span className="display text-xs">Vào phòng</span>
              </button>
            )}
            {!seated && full && (
              <span className="display px-5 py-2 text-xs text-bone-faint">Đầy</span>
            )}
            {seated && !myReady && (
              <>
                <button
                  type="button"
                  onClick={onLeave}
                  disabled={busy}
                  className="hex-tab bg-forest-700 px-4 py-2 text-paper transition-colors hover:bg-forest-600 disabled:cursor-not-allowed disabled:bg-paper-dim disabled:text-bone-faint"
                >
                  <span className="display text-xs">Rời phòng</span>
                </button>
                <button
                  type="button"
                  onClick={onReady}
                  disabled={busy || !full}
                  className="hex-tab bg-brass-400 px-5 py-2 text-forest-900 transition-colors hover:bg-brass-300 disabled:cursor-not-allowed disabled:bg-paper-dim disabled:text-bone-faint"
                >
                  <span className="display text-xs">{full ? "Sẵn sàng" : "Chờ đối thủ…"}</span>
                </button>
              </>
            )}
            {seated && myReady && (
              <span className="display px-5 py-2 text-xs text-brass-600">
                {opponentReady ? "Đang bắt đầu…" : "Đã sẵn sàng, chờ đối thủ"}
              </span>
            )}
          </div>
        </div>
      </HexPanel>
    </li>
  );
}
