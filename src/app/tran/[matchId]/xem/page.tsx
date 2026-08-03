"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BoutResultBoard } from "@/components/versus/BoutResultBoard";
import type { MatchGameRow } from "@/lib/versus/draft";
import { toPlayers, type Player, type StatPath } from "@/lib/kendo";
import { activeAugmentIdsFor, dynamicAugments, qualifyingAugments, resolvePlayerBonuses } from "@/lib/versus/bout";
import type { Augment } from "@/lib/versus/augments";
import { CLUB_ROSTER } from "@/data/club";
import { SPECTATOR_HEARTBEAT_MS } from "@/lib/versus/spectate";

const PERSON_BY_ID = new Map(CLUB_ROSTER.map((p) => [p.id, p]));

interface AugmentHistoryRow {
  game_number: number;
  augment_pick_a: string | null;
  augment_pick_b: string | null;
}

interface MatchRow {
  id: string;
  player_a: string;
  player_b: string;
  series_score_a: number;
  series_score_b: number;
  current_game_number: number;
  status: string;
  format: "bo3" | "bo5";
}

type ClaimState =
  | { status: "pending" }
  | { status: "player" }
  | { status: "seated" }
  | { status: "full" }
  | { status: "error"; message: string };

/**
 * Read-only mirror of tran/[matchId]/page.tsx for anyone with the link — no
 * account required (a guest/anonymous session is enough), but a room-style
 * seat now IS required: one of the match's 4 spectator slots, claimed atomically
 * via /api/matches/[matchId]/spectate/claim before any match content renders.
 * Deliberately does not share tran/[matchId]/page.tsx's code (same "duplicate
 * rather than risk the working interactive page" reasoning as
 * BoutResultBoard/MatchViewer) and never calls /api/games/start (that route
 * 403s a non-participant anyway) — it only ever reads the row a real
 * player's own page load already created, same public columns, same reveal
 * timing, with zero write paths on this page besides the spectator-slot
 * claim/heartbeat/leave calls themselves.
 */
export default function SpectatePage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = use(params);
  const supabase = useMemo(() => createClient(), []);
  const [match, setMatch] = useState<MatchRow | null | undefined>(undefined);
  const [names, setNames] = useState<{ a: string; b: string } | null>(null);
  const [game, setGame] = useState<MatchGameRow | null | undefined>(undefined);
  const [claim, setClaim] = useState<ClaimState>({ status: "pending" });
  const [spectatorCount, setSpectatorCount] = useState<number | null>(null);
  // Which game's own BoutResultBoard has finished narrating, per game.id —
  // same reasoning as tran/[matchId]/page.tsx: the server writes `result`
  // and advances the series score/status the instant a game concludes,
  // independent of (and typically well before) this spectator's own
  // narration reaching the end of that game's log.
  const [revealedGameId, setRevealedGameId] = useState<string | undefined>(undefined);

  // Ensures at least a guest session before ever attempting a slot claim —
  // "no account required" still holds (signInAnonymously asks for nothing),
  // it just means a spectator now always has SOME auth.uid() to attribute a
  // slot to, same identity shape AuthGate's own guest button already
  // produces for room seats.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (user) return;
      await supabase.auth.signInAnonymously();
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Claims a slot once matchId is known. Retried every time matchId changes
  // (it never does within one page view) — a fresh mount always re-attempts,
  // which is also how a stale slot from a previous tab of the SAME user gets
  // re-touched (the claim route treats "already holds a slot" as idempotent).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // The auth-ensuring effect above may still be in flight the very first
      // time this runs; give it a moment rather than firing a claim with no
      // session yet and surfacing a spurious error.
      let uid: string | null = null;
      for (let attempt = 0; attempt < 25 && !uid; attempt++) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        uid = user?.id ?? null;
        if (!uid) await new Promise((r) => setTimeout(r, 200));
      }
      if (cancelled) return;
      if (!uid) {
        setClaim({ status: "error", message: "Không thể vào xem, thử tải lại trang." });
        return;
      }

      const res = await fetch(`/api/matches/${matchId}/spectate/claim`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (cancelled) return;
      if (!res.ok) {
        setClaim(res.status === 409 ? { status: "full" } : { status: "error", message: body?.error ?? "Có lỗi xảy ra, thử lại." });
        return;
      }
      setClaim(body?.role === "player" ? { status: "player" } : { status: "seated" });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, matchId]);

  // Heartbeat while seated, so this slot isn't reclaimed as abandoned — plus
  // a best-effort leave on tab close, and an explicit one from the "Rời
  // phòng" button. There's no reliable server-side disconnect signal here
  // (serverless, no persistent socket-owning process), so the heartbeat +
  // staleness window (see the claim route) is what actually reclaims a slot
  // after a hard crash/network loss; sendBeacon just makes the common case
  // (closing the tab normally) free the slot immediately instead of waiting
  // out the staleness window.
  const leftRef = useRef(false);
  const leaveNow = useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;
    navigator.sendBeacon(`/api/matches/${matchId}/spectate/leave`);
  }, [matchId]);

  useEffect(() => {
    if (claim.status !== "seated") return;
    const heartbeat = () => {
      fetch(`/api/matches/${matchId}/spectate/heartbeat`, { method: "POST" }).catch(() => {});
    };
    const interval = setInterval(heartbeat, SPECTATOR_HEARTBEAT_MS);
    const onPageHide = () => leaveNow();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(interval);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [claim.status, matchId, leaveNow]);

  // Client-side navigation away from this page unmounts it without ever
  // firing `pagehide`, so this needs its own cleanup — but an effect with an
  // empty dep array only ever closes over the claim state from its first
  // render, which would always read as "pending" here. claimStatusRef tracks
  // the latest value across renders so the (only-runs-once) cleanup below
  // sees what's actually true at unmount time, not what was true on mount.
  const claimStatusRef = useRef(claim.status);
  useEffect(() => {
    claimStatusRef.current = claim.status;
  }, [claim.status]);
  useEffect(() => {
    return () => {
      if (claimStatusRef.current === "seated") leaveNow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leaveManually = () => {
    leftRef.current = true;
    fetch(`/api/matches/${matchId}/spectate/leave`, { method: "POST" }).catch(() => {});
    setClaim({ status: "error", message: "Bạn đã rời khỏi trận xem." });
  };

  // Live "x/4 đang xem" count — read-only, same public policy as the rest of
  // this page (see 0016_spectator_slots.sql). Never gates rendering on its
  // own; the claim response above is the only thing that does that.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("match_spectators")
        .select("*", { count: "exact", head: true })
        .eq("match_id", matchId);
      if (!cancelled) setSpectatorCount(count ?? 0);
    })();
    const channel = supabase
      .channel(`match:${matchId}:spectator-count`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_spectators", filter: `match_id=eq.${matchId}` },
        async () => {
          const { count } = await supabase
            .from("match_spectators")
            .select("*", { count: "exact", head: true })
            .eq("match_id", matchId);
          if (!cancelled) setSpectatorCount(count ?? 0);
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase, matchId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: matchRow } = await supabase.from("matches").select("*").eq("id", matchId).single();
      if (cancelled) return;
      setMatch((matchRow as MatchRow | null) ?? null);
      if (!matchRow) return;

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", [matchRow.player_a, matchRow.player_b]);
      if (cancelled || !profiles) return;
      const byId = new Map(profiles.map((p) => [p.id, p.display_name as string]));
      setNames({ a: byId.get(matchRow.player_a) ?? "…", b: byId.get(matchRow.player_b) ?? "…" });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, matchId]);

  useEffect(() => {
    if (!matchId) return;
    const channel = supabase
      .channel(`match:${matchId}:spectate`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${matchId}` },
        (payload) => setMatch(payload.new as MatchRow),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, matchId]);

  const currentGameNumber = match?.current_game_number;

  // Reads whatever match_games row already exists for the current game
  // number — never creates one. A spectator has no reason to ever call
  // /api/games/start (it rejects non-participants regardless), so if the
  // row isn't there yet, this just waits; a real player's own page load
  // creates it, and the realtime subscription below picks it up from there.
  useEffect(() => {
    if (!match || currentGameNumber === undefined) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("match_games")
        .select("*")
        .eq("match_id", matchId)
        .eq("game_number", currentGameNumber)
        .maybeSingle();
      if (!cancelled) setGame((data as MatchGameRow | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, matchId, match, currentGameNumber]);

  const gameId = game?.id;
  const isOddGame = game != null && game.game_number % 2 === 1;
  const draftComplete = game?.draft_state.status === "complete";
  const priorPhaseDone =
    draftComplete &&
    game != null &&
    (isOddGame ? !!(game.augment_pick_a && game.augment_pick_b) : !!(game.item_pick_a && game.item_pick_b));
  const lineupsReady = priorPhaseDone && game != null && !!(game.lineup_a && game.lineup_b);

  // True only once THIS spectator's own BoutResultBoard has finished
  // narrating this game — see the onFullyRevealed callback below.
  const resultRevealed = revealedGameId === gameId;
  const scoreSpoiled = !!game?.result && !resultRevealed;
  const displaySeriesScore = match
    ? scoreSpoiled && game?.result
      ? {
          a: match.series_score_a - (game.result.result.winner === "A" ? 1 : 0),
          b: match.series_score_b - (game.result.result.winner === "B" ? 1 : 0),
        }
      : { a: match.series_score_a, b: match.series_score_b }
    : { a: 0, b: 0 };

  const [priorAugmentRows, setPriorAugmentRows] = useState<AugmentHistoryRow[]>([]);
  useEffect(() => {
    if (currentGameNumber === undefined) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("match_games")
        .select("game_number, augment_pick_a, augment_pick_b")
        .eq("match_id", matchId)
        .lt("game_number", currentGameNumber);
      if (!cancelled) setPriorAugmentRows((data as AugmentHistoryRow[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, matchId, currentGameNumber]);

  const pickedA = useMemo(() => game?.draft_state.pickedA ?? [], [game?.draft_state.pickedA]);
  const pickedB = useMemo(() => game?.draft_state.pickedB ?? [], [game?.draft_state.pickedB]);
  const rawPlayersA = useMemo(() => toPlayers(pickedA.map((id) => PERSON_BY_ID.get(id)).filter((p) => !!p)), [pickedA]);
  const rawPlayersB = useMemo(() => toPlayers(pickedB.map((id) => PERSON_BY_ID.get(id)).filter((p) => !!p)), [pickedB]);
  const basePlayerById = useMemo(() => {
    const map: Record<string, Player> = {};
    for (const p of rawPlayersA) map[p.id] = p;
    for (const p of rawPlayersB) map[p.id] = p;
    return map;
  }, [rawPlayersA, rawPlayersB]);

  const allAugmentRows: AugmentHistoryRow[] = game
    ? [...priorAugmentRows, { game_number: game.game_number, augment_pick_a: game.augment_pick_a, augment_pick_b: game.augment_pick_b }]
    : [];
  const activeAugmentIdsA = game ? activeAugmentIdsFor("A", allAugmentRows, game.game_number) : [];
  const activeAugmentIdsB = game ? activeAugmentIdsFor("B", allAugmentRows, game.game_number) : [];
  const toEquipDisplay = (a: Augment) => ({
    name: a.name,
    description: a.description,
    effects: a.effects,
  });
  // dan_nice/dan_fighting never show up via qualifyingAugments (their
  // condition depends on what happens live within a bout, not this game's
  // roster) — dynamicAugments badges them unconditionally so a picked one
  // isn't invisible everywhere in the UI.
  const augmentBadgesA = [
    ...qualifyingAugments(activeAugmentIdsA, pickedA, rawPlayersA, rawPlayersB),
    ...dynamicAugments(activeAugmentIdsA),
  ].map(toEquipDisplay);
  const augmentBadgesB = [
    ...qualifyingAugments(activeAugmentIdsB, pickedB, rawPlayersB, rawPlayersA),
    ...dynamicAugments(activeAugmentIdsB),
  ].map(toEquipDisplay);

  const fullBonusByPlayer = game
    ? resolvePlayerBonuses({
        pickedA,
        pickedB,
        rawPlayersA,
        rawPlayersB,
        activeAugmentIdsA,
        activeAugmentIdsB,
        itemEquipsA: game.item_equips_a,
        itemEquipsB: game.item_equips_b,
      })
    : new Map<string, Partial<Record<StatPath, number>>>();
  const bonusByPlayer = Object.fromEntries(fullBonusByPlayer);

  const applyGameUpdate = useCallback((next: MatchGameRow) => {
    setGame((current) =>
      current &&
      current.draft_seq >= next.draft_seq &&
      current.augment_seq >= next.augment_seq &&
      current.item_seq >= next.item_seq &&
      current.lineup_seq >= next.lineup_seq &&
      current.bout_seq >= next.bout_seq
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    if (!gameId) return;
    const channel = supabase
      .channel(`game:${gameId}`)
      .on("broadcast", { event: "game_update" }, (payload) => applyGameUpdate(payload.payload as MatchGameRow))
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "match_games", filter: `id=eq.${gameId}` },
        (payload) => applyGameUpdate(payload.new as MatchGameRow),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, gameId, applyGameUpdate]);

  const noop = () => {};

  if (match === undefined) {
    return <p className="text-center text-sm text-bone-faint">Đang tải trận đấu…</p>;
  }
  if (match === null) {
    return <p className="text-center text-sm text-bone-faint">Không tìm thấy trận đấu này.</p>;
  }
  if (claim.status === "player") {
    return (
      <p className="text-center text-sm text-bone-faint">
        Bạn là người chơi trong trận này —{" "}
        <Link href={`/tran/${matchId}`} className="text-brass-600 underline underline-offset-4">
          vào trận đấu
        </Link>
        .
      </p>
    );
  }
  if (claim.status === "full") {
    return <p className="text-center text-sm text-bone-faint">Phòng xem đã đầy.</p>;
  }
  if (claim.status === "error") {
    return <p className="text-center text-sm text-bone-faint">{claim.message}</p>;
  }
  if (claim.status === "pending") {
    return <p className="text-center text-sm text-bone-faint">Đang vào phòng xem…</p>;
  }

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col items-center gap-4 sm:gap-6">
      <header className="flex shrink-0 flex-col items-center gap-1 text-center">
        <p className="display text-xs text-brass-600">
          Đấu đối kháng · {match.format === "bo3" ? "Bo3" : "Bo5"} · Đang xem
        </p>
        <h2 className="display text-xl text-bone sm:text-2xl">
          {names?.a ?? "…"} <span className="px-2 text-brass-600">vs</span> {names?.b ?? "…"}
        </h2>
        <p className="display text-3xl text-bone">
          {displaySeriesScore.a} — {displaySeriesScore.b}
        </p>
        <p className="text-sm text-bone-faint">Ván {game?.game_number ?? match.current_game_number}</p>
        <div className="flex items-center gap-3">
          {spectatorCount !== null && (
            <span className="text-[11px] text-bone-faint">{spectatorCount}/4 đang xem</span>
          )}
          <button
            type="button"
            onClick={leaveManually}
            className="text-xs text-brass-600 underline underline-offset-4 hover:no-underline"
          >
            Rời phòng
          </button>
        </div>
      </header>

      {game === undefined && <p className="text-center text-sm text-bone-faint">Đang tải ván đấu…</p>}
      {game === null && (
        <p className="text-center text-sm text-bone-faint">Ván đấu chưa bắt đầu, chờ người chơi vào trận…</p>
      )}
      {game && !draftComplete && (
        <p className="text-center text-sm text-bone-faint">Đang bốc thăm đội hình…</p>
      )}
      {game && draftComplete && !priorPhaseDone && (
        <p className="text-center text-sm text-bone-faint">
          {isOddGame ? "Đang chọn bổ trợ…" : "Đang chọn trang bị…"}
        </p>
      )}
      {game && priorPhaseDone && !(game.lineup_a && game.lineup_b) && (
        <p className="text-center text-sm text-bone-faint">Đang xếp đội hình…</p>
      )}
      {game && lineupsReady && !game.result && !game.bout_provisional && (
        <p className="text-center text-sm text-bone-faint">Đang mô phỏng trận đấu…</p>
      )}

      {game && game.bout_provisional && !game.result && (
        <div className="flex min-h-0 w-full flex-1 flex-col gap-2">
          <BoutResultBoard
            key={game.id}
            match={game.bout_provisional}
            teamAName={names?.a ?? "Người chơi A"}
            teamBName={names?.b ?? "Người chơi B"}
            augmentBadgesA={augmentBadgesA}
            augmentBadgesB={augmentBadgesB}
            itemEquipsA={game.item_equips_a}
            itemEquipsB={game.item_equips_b}
            basePlayerById={basePlayerById}
            bonusByPlayer={bonusByPlayer}
            seriesDecided={false}
            onContinue={noop}
            hideActions
          />
          <p className="text-center text-xs text-bone-faint">Hòa — đang chờ cả hai chọn đại diện danh dự…</p>
        </div>
      )}
      {game && game.result && (
        <div className="flex min-h-0 w-full flex-1 flex-col">
          <BoutResultBoard
            key={game.id}
            match={game.result}
            teamAName={names?.a ?? "Người chơi A"}
            teamBName={names?.b ?? "Người chơi B"}
            augmentBadgesA={augmentBadgesA}
            augmentBadgesB={augmentBadgesB}
            itemEquipsA={game.item_equips_a}
            itemEquipsB={game.item_equips_b}
            basePlayerById={basePlayerById}
            bonusByPlayer={bonusByPlayer}
            seriesDecided={match.status === "completed"}
            onContinue={noop}
            hideActions
            onFullyRevealed={() => setRevealedGameId(game.id)}
          />
        </div>
      )}

      {match.status === "completed" && resultRevealed && (
        <p className="display text-center text-lg text-brass-600">
          {match.series_score_a > match.series_score_b ? (names?.a ?? "Người chơi A") : (names?.b ?? "Người chơi B")}{" "}
          thắng chung cuộc {Math.max(match.series_score_a, match.series_score_b)}-
          {Math.min(match.series_score_a, match.series_score_b)}!
        </p>
      )}
    </section>
  );
}
