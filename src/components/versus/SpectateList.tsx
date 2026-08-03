"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HexPanel } from "@/components/Hex";
import { createClient } from "@/lib/supabase/client";
import { SPECTATOR_SLOTS } from "@/lib/versus/spectate";

interface MatchLite {
  id: string;
  player_a: string;
  player_b: string;
  series_score_a: number;
  series_score_b: number;
  format: "bo3" | "bo5";
  status: string;
}

interface ProfileLite {
  id: string;
  display_name: string;
}

/**
 * Browse-and-watch list for matches already underway — the room lobby itself
 * can't show this (a room is freed for a brand new pair the instant its
 * match is created, see rooms/ready/route.ts), so this queries `matches`
 * directly instead, same public read as the spectator page itself
 * (0014_spectator_read.sql). Purely a discovery aid: the shared match link
 * (`/tran/[matchId]/xem`) goes through the exact same slot-claim route
 * either way, so nothing here is a second path into a match.
 */
export function SpectateList() {
  const supabase = useMemo(() => createClient(), []);
  const [matches, setMatches] = useState<MatchLite[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [counts, setCounts] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const refetch = async () => {
      const { data: matchRows } = await supabase
        .from("matches")
        .select("id, player_a, player_b, series_score_a, series_score_b, format, status")
        .neq("status", "completed")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      const rows = (matchRows as MatchLite[] | null) ?? [];
      setMatches(rows);

      const playerIds = Array.from(new Set(rows.flatMap((m) => [m.player_a, m.player_b])));
      if (playerIds.length > 0) {
        const { data: profileRows } = await supabase.from("profiles").select("id, display_name").in("id", playerIds);
        if (!cancelled) {
          setNames(new Map((profileRows as ProfileLite[] | null ?? []).map((p) => [p.id, p.display_name])));
        }
      }

      if (rows.length > 0) {
        const { data: spectatorRows } = await supabase
          .from("match_spectators")
          .select("match_id")
          .in("match_id", rows.map((m) => m.id));
        if (!cancelled) {
          const next = new Map<string, number>();
          for (const row of (spectatorRows as { match_id: string }[] | null) ?? []) {
            next.set(row.match_id, (next.get(row.match_id) ?? 0) + 1);
          }
          setCounts(next);
        }
      }
    };
    refetch();

    const channel = supabase
      .channel("lobby-spectate-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "match_spectators" }, refetch)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  if (!matches || matches.length === 0) return null;

  return (
    <section className="flex flex-col gap-2.5 sm:gap-3">
      <p className="display text-center text-xs text-brass-600">Đang diễn ra</p>
      <ol className="flex flex-col gap-2.5 sm:gap-3">
        {matches.map((m) => {
          const count = counts.get(m.id) ?? 0;
          const full = count >= SPECTATOR_SLOTS;
          return (
            <li key={m.id}>
              <HexPanel cut={14}>
                <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="hex-tab display bg-forest-700 px-1.5 py-0.5 text-[10px] text-brass-300">
                      {m.format === "bo3" ? "BO3" : "BO5"}
                    </span>
                    <span className="text-bone">{names.get(m.player_a) ?? "…"}</span>
                    <span className="text-bone-faint">vs</span>
                    <span className="text-bone">{names.get(m.player_b) ?? "…"}</span>
                    <span className="text-bone-faint">·</span>
                    <span className="display text-xs text-bone-faint">
                      {m.series_score_a}-{m.series_score_b}
                    </span>
                    <span className="text-[11px] text-bone-faint">
                      {count}/{SPECTATOR_SLOTS} đang xem
                    </span>
                  </div>
                  {full ? (
                    <span className="display px-5 py-2 text-xs text-bone-faint">Phòng xem đã đầy</span>
                  ) : (
                    <Link
                      href={`/tran/${m.id}/xem`}
                      className="hex-tab bg-brass-400 px-5 py-2 text-center text-forest-900 transition-colors hover:bg-brass-300"
                    >
                      <span className="display text-xs">Xem trực tiếp</span>
                    </Link>
                  )}
                </div>
              </HexPanel>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
