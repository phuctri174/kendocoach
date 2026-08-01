"use client";

import { use, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface MatchRow {
  id: string;
  player_a: string;
  player_b: string;
  series_score_a: number;
  series_score_b: number;
  current_game_number: number;
  status: string;
}

/**
 * Placeholder landing spot once both lobby players ready up — proves the
 * room → match hand-off works end to end. The draft/augment/item/bout loop
 * that actually plays Game 1 is later build-order phases, not this one.
 */
export default function MatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = use(params);
  const supabase = useMemo(() => createClient(), []);
  const [match, setMatch] = useState<MatchRow | null | undefined>(undefined);
  const [names, setNames] = useState<{ a: string; b: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: matchRow } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .single();
      if (cancelled) return;
      setMatch((matchRow as MatchRow | null) ?? null);
      if (!matchRow) return;

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", [matchRow.player_a, matchRow.player_b]);
      if (cancelled || !profiles) return;
      const byId = new Map(profiles.map((p) => [p.id, p.display_name as string]));
      setNames({
        a: byId.get(matchRow.player_a) ?? "…",
        b: byId.get(matchRow.player_b) ?? "…",
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, matchId]);

  if (match === undefined) {
    return <p className="text-center text-sm text-bone-faint">Đang tải trận đấu…</p>;
  }
  if (match === null) {
    return (
      <p className="text-center text-sm text-bone-faint">
        Không tìm thấy trận đấu này, hoặc bạn không phải người chơi trong trận.
      </p>
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-md flex-col items-center gap-4 text-center">
      <p className="display text-xs text-brass-600">Đấu đối kháng · Bo5</p>
      <h2 className="display text-xl text-bone sm:text-2xl">
        {names?.a ?? "…"} <span className="px-2 text-brass-600">vs</span> {names?.b ?? "…"}
      </h2>
      <p className="display text-3xl text-bone">
        {match.series_score_a} — {match.series_score_b}
      </p>
      <p className="text-sm text-bone-faint">
        Ván {match.current_game_number} · Bốc thăm đội hình (sắp ra mắt)
      </p>
    </section>
  );
}
