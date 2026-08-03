"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DraftBoard } from "@/components/versus/DraftBoard";
import { AugmentBoard } from "@/components/versus/AugmentBoard";
import { ItemBoard } from "@/components/versus/ItemBoard";
import { LineupBoard } from "@/components/versus/LineupBoard";
import { BoutResultBoard } from "@/components/versus/BoutResultBoard";
import type { EquipDisplay } from "@/components/versus/EquipBadge";
import type { MatchGameRow } from "@/lib/versus/draft";
import { toPlayers, type Player, type StatPath } from "@/lib/kendo";
import {
  activeAugmentIdsFor,
  qualifyingAugments,
  resolvePlayerBonuses,
} from "@/lib/versus/bout";
import { CLUB_ROSTER } from "@/data/club";

const PERSON_BY_ID = new Map(CLUB_ROSTER.map((p) => [p.id, p]));

interface MyAugmentOffer {
  tier: string;
  offered: string[];
  pickDeadline: string;
}

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
  /** Each side's whole, permanent, non-consumable item inventory — every
   *  item ever picked in an even game, still available to equip every game
   *  after (see LineupBoard). */
  inventory_a: string[];
  inventory_b: string[];
}

/**
 * Loads the match, ensures the current game's row exists (server-created via
 * /api/games/start — idempotent, race-safe), then stays live on that one row
 * via two parallel channels: a Realtime `broadcast` the route handlers send
 * right after they write (low latency, no replication lag) and the game's
 * own fetch response for the player who just acted (so they never wait on
 * the network echo of their own action). `postgres_changes` stays wired up
 * too as a slower but guaranteed-eventual-consistency fallback in case a
 * broadcast is ever dropped. All the write paths are gated by their own seq
 * column so stale or duplicate deliveries can't roll the UI backwards. The
 * `matches` row (series score, current_game_number, status) gets the same
 * postgres_changes treatment — no broadcast for it, since a game concluding
 * isn't on the same latency budget as a draft pick.
 *
 * Draft, augments/items, lineup, and the bout itself are all wired up:
 * augments run in odd-numbered games (1, 3, 5), items in even-numbered ones
 * (2, 4). Once both lineups are confirmed, bout resolution runs in up to two
 * stages: /bout/run always fires first and reveals the 5 regular bouts
 * (`bout_provisional`) whenever they alone don't decide it; only THEN does
 * either player get asked (bout/representative) who represents them in the
 * daihyosen, now that they actually know it's tied, never pre-guessed
 * beforehand. Once both reps are in, /bout/daihyosen resolves it for real
 * and both `result`/`bout_provisional` collapse into the final `result`.
 * Either way, the winning route call also advances the series score / game
 * number / completion on `matches`. Moving from a finished game's result
 * screen to the next game is a deliberate "Tiếp tục" click (`goToNextGame`,
 * which just resets `game` to undefined) rather than automatic — the server
 * has already advanced match.current_game_number by the time the result is
 * showing, so the initial-fetch effect would otherwise yank the result out
 * from under whoever is still reading it.
 */
export default function MatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = use(params);
  const supabase = useMemo(() => createClient(), []);
  const [myUserId, setMyUserId] = useState<string | null | undefined>(undefined);
  const [match, setMatch] = useState<MatchRow | null | undefined>(undefined);
  const [names, setNames] = useState<{ a: string; b: string } | null>(null);
  const [game, setGame] = useState<MatchGameRow | null | undefined>(undefined);
  // Undefined until fetched, null once fetched with nothing to show (already
  // locked in, or this game has no augment round). Never touched by
  // Realtime — it only ever comes from this player's own /augments/start
  // response, the same "my own action, direct response" shape as draft picks.
  const [myOffer, setMyOffer] = useState<MyAugmentOffer | null | undefined>(undefined);
  // Same shape and rules as myOffer, for the items round (even games).
  const [myItemOffer, setMyItemOffer] = useState<string[] | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      setMyUserId(user?.id ?? null);

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
      setNames({
        a: byId.get(matchRow.player_a) ?? "…",
        b: byId.get(matchRow.player_b) ?? "…",
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, matchId]);

  // Fetches/creates the row for match.current_game_number exactly once —
  // guarded on `game === undefined` rather than re-running whenever `match`
  // changes (its series score / current_game_number update via Realtime
  // every time a bout concludes). Moving to the next game is a deliberate
  // user action (see goToNextGame below), not something this effect should
  // do on its own the instant the server advances the match row — otherwise
  // the still-finished game's result screen would get yanked out from under
  // whoever is still reading it.
  useEffect(() => {
    if (!match || game !== undefined) return;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/games/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const body = await res.json().catch(() => null);
      if (cancelled) return;
      setGame(res.ok ? (body as MatchGameRow) : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [match, matchId, game]);

  useEffect(() => {
    if (!matchId) return;
    const channel = supabase
      .channel(`match:${matchId}`)
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

  /** Dismisses the just-finished game's result and moves on to whatever
   *  match.current_game_number is now — already advanced server-side by
   *  /bout/run the moment the game concluded. */
  const goToNextGame = () => setGame(undefined);

  const gameId = game?.id;
  const isOddGame = game != null && game.game_number % 2 === 1;
  const draftComplete = game?.draft_state.status === "complete";
  // The augment or item round (whichever applies to this game number) is
  // done, for both sides — the gate for moving on to position assignment.
  const priorPhaseDone =
    draftComplete &&
    game != null &&
    (isOddGame ? !!(game.augment_pick_a && game.augment_pick_b) : !!(game.item_pick_a && game.item_pick_b));
  // Both sides confirmed a lineup (and, bundled into that same write, a
  // daihyosen representative) — the gate for running the bout.
  const lineupsReady = priorPhaseDone && game != null && !!(game.lineup_a && game.lineup_b);

  // Augments persist and stack for the rest of the series once picked —
  // this side's own current game_number doesn't carry that history on its
  // own, so it's fetched separately (RLS already lets a participant read
  // every match_games row for their own match, not just the current one).
  // Refetches whenever the current game_number changes (moving to a new
  // game); the current game's own picks are read live off `game` itself,
  // not this snapshot, so an in-flight pick this round is never stale here.
  const [priorAugmentRows, setPriorAugmentRows] = useState<AugmentHistoryRow[]>([]);
  const currentGameNumber = game?.game_number;
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

  // Everything derived from "what's actually active/equipped for each side
  // right now" — the equip badges (task 3, now stacking-aware) and the
  // hover breakdown's bonus numbers (task: OG stats + bonuses). Reuses the
  // exact resolveConditionalEffects/sumEffects/splitEffects building blocks
  // the server resolves the bout with (see versus/bout.ts), so this is a
  // faithful preview, not a re-implementation that could silently drift.
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
  const augmentBadgesA: EquipDisplay[] = qualifyingAugments(activeAugmentIdsA, pickedA, rawPlayersA, rawPlayersB).map((a) => ({
    name: a.name,
    description: a.description,
    effects: a.effects,
  }));
  const augmentBadgesB: EquipDisplay[] = qualifyingAugments(activeAugmentIdsB, pickedB, rawPlayersB, rawPlayersA).map((a) => ({
    name: a.name,
    description: a.description,
    effects: a.effects,
  }));

  // Augments-only bonus (no items) — for LineupBoard, which still needs to
  // layer its own locally-arranged (not yet confirmed) equip choices on top
  // itself, so it can't use the fully-resolved version below.
  const augmentBonusByPlayer = game
    ? resolvePlayerBonuses({
        pickedA,
        pickedB,
        rawPlayersA,
        rawPlayersB,
        activeAugmentIdsA,
        activeAugmentIdsB,
        itemEquipsA: [],
        itemEquipsB: [],
      })
    : new Map<string, Partial<Record<StatPath, number>>>();
  // Fully resolved (augments + this game's confirmed item equips) — for the
  // match viewer, where item_equips_a/b are already locked in by the time
  // any bout result is showing.
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
  const mapToRecord = (m: Map<string, Partial<Record<StatPath, number>>>) => Object.fromEntries(m);

  // Ignores anything behind the currently-shown draft_seq/augment_seq/
  // item_seq/lineup_seq/bout_seq, so an optimistic update from this player's
  // own fetch response, a broadcast, and the slower postgres_changes echo can
  // all arrive in any order for the same pick — draft, augment, item,
  // lineup, or the bout's own lifecycle — without ever regressing the UI.
  // The five counters are independent, so a next state only wins if it
  // isn't behind on any of them.
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

  // Resets when the game changes (e.g. moving to game 3's augment round)
  // rather than carrying game 1's offer over — adjusted during render, not
  // in an effect, same "you might not need an effect" pattern React docs
  // recommend for state that depends on a prop changing.
  const [myOfferGameId, setMyOfferGameId] = useState<string | undefined>(undefined);
  if (gameId !== myOfferGameId) {
    setMyOfferGameId(gameId);
    setMyOffer(undefined);
    setMyItemOffer(undefined);
  }

  useEffect(() => {
    if (!gameId || !draftComplete || !isOddGame || myOffer !== undefined) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/games/${gameId}/augments/start`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (cancelled) return;
      if (res.ok) {
        applyGameUpdate(body as MatchGameRow);
        setMyOffer((body.myOffer as MyAugmentOffer | null) ?? null);
      } else {
        setMyOffer(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId, draftComplete, isOddGame, myOffer, applyGameUpdate]);

  useEffect(() => {
    if (!gameId || !draftComplete || isOddGame || myItemOffer !== undefined) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/games/${gameId}/items/start`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (cancelled) return;
      if (res.ok) {
        applyGameUpdate(body as MatchGameRow);
        setMyItemOffer((body.myOffer as string[] | null) ?? null);
      } else {
        setMyItemOffer(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId, draftComplete, isOddGame, myItemOffer, applyGameUpdate]);

  // Stage 1: runs (or probes) the bout the moment both lineups are
  // confirmed. Both clients attempt this independently; on the server,
  // "result is null and bout_provisional is null" is the actual race guard,
  // so whichever call lands first is the one that simulates, the other just
  // gets the same row back. No separate "already attempted" flag needed —
  // `game.result`/`game.bout_provisional` themselves are the gate, same
  // pattern as `myOffer`/`myItemOffer` above.
  useEffect(() => {
    if (!gameId || !lineupsReady || (game && (game.result || game.bout_provisional))) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/games/${gameId}/bout/run`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (cancelled) return;
      if (res.ok) applyGameUpdate(body as MatchGameRow);
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId, lineupsReady, game, applyGameUpdate]);

  // Stage 2: once the 5 regular bouts came back tied AND both sides have
  // privately picked a daihyosen representative, resolve it for real. Same
  // idempotent, both-clients-attempt-it pattern as stage 1.
  useEffect(() => {
    if (!gameId || !game?.bout_provisional || game.result || !game.representative_a || !game.representative_b) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/games/${gameId}/bout/daihyosen`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (cancelled) return;
      if (res.ok) applyGameUpdate(body as MatchGameRow);
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId, game, applyGameUpdate]);

  const [pickingRepresentative, setPickingRepresentative] = useState(false);
  const pickRepresentative = async (representativeId: string) => {
    if (!gameId) return;
    setPickingRepresentative(true);
    const res = await fetch(`/api/games/${gameId}/bout/representative`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ representativeId }),
    });
    const body = await res.json().catch(() => null);
    setPickingRepresentative(false);
    if (res.ok && body) applyGameUpdate(body as MatchGameRow);
  };

  if (match === undefined || myUserId === undefined) {
    return <p className="text-center text-sm text-bone-faint">Đang tải trận đấu…</p>;
  }
  if (match === null || myUserId === null) {
    return (
      <p className="text-center text-sm text-bone-faint">
        Không tìm thấy trận đấu này, hoặc bạn không phải người chơi trong trận.
      </p>
    );
  }

  const mySide = match.player_a === myUserId ? "A" : match.player_b === myUserId ? "B" : null;
  if (!mySide) {
    return (
      <p className="text-center text-sm text-bone-faint">
        Không tìm thấy trận đấu này, hoặc bạn không phải người chơi trong trận.
      </p>
    );
  }

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col items-center gap-4 sm:gap-6">
      <header className="shrink-0 flex flex-col items-center gap-1 text-center">
        <p className="display text-xs text-brass-600">Đấu đối kháng · Bo5</p>
        <h2 className="display text-xl text-bone sm:text-2xl">
          {names?.a ?? "…"} <span className="px-2 text-brass-600">vs</span> {names?.b ?? "…"}
        </h2>
        <p className="display text-3xl text-bone">
          {match.series_score_a} — {match.series_score_b}
        </p>
        <p className="text-sm text-bone-faint">Ván {game?.game_number ?? match.current_game_number}</p>
      </header>

      {game === undefined && (
        <p className="text-center text-sm text-bone-faint">Đang chuẩn bị bốc thăm…</p>
      )}
      {game === null && (
        <p className="text-center text-sm text-bone-faint">Không thể bắt đầu ván đấu, thử tải lại trang.</p>
      )}
      {game && game.draft_state.status === "drafting" && (
        <DraftBoard
          key={game.id}
          gameId={game.id}
          draftState={game.draft_state}
          mySide={mySide}
          myName={mySide === "A" ? (names?.a ?? "Bạn") : (names?.b ?? "Bạn")}
          opponentName={mySide === "A" ? (names?.b ?? "…") : (names?.a ?? "…")}
          onGameUpdate={applyGameUpdate}
        />
      )}
      {game && draftComplete && isOddGame && !priorPhaseDone && (
        <AugmentBoard
          key={game.id}
          gameId={game.id}
          augmentTier={game.augment_tier}
          augmentPickA={game.augment_pick_a}
          augmentPickB={game.augment_pick_b}
          myOffer={myOffer}
          mySide={mySide}
          opponentName={mySide === "A" ? (names?.b ?? "…") : (names?.a ?? "…")}
          onGameUpdate={applyGameUpdate}
        />
      )}
      {game && draftComplete && !isOddGame && !priorPhaseDone && (
        <ItemBoard
          key={game.id}
          gameId={game.id}
          itemPickA={game.item_pick_a}
          itemPickB={game.item_pick_b}
          myOffer={myItemOffer}
          mySide={mySide}
          opponentName={mySide === "A" ? (names?.b ?? "…") : (names?.a ?? "…")}
          onGameUpdate={applyGameUpdate}
        />
      )}
      {game && priorPhaseDone && !(game.lineup_a && game.lineup_b) && (
        <LineupBoard
          key={game.id}
          gameId={game.id}
          myRoster={mySide === "A" ? game.draft_state.pickedA : game.draft_state.pickedB}
          myLineup={mySide === "A" ? game.lineup_a : game.lineup_b}
          opponentRoster={mySide === "A" ? game.draft_state.pickedB : game.draft_state.pickedA}
          opponentLineup={mySide === "A" ? game.lineup_b : game.lineup_a}
          augmentBadges={mySide === "A" ? augmentBadgesA : augmentBadgesB}
          inventory={mySide === "A" ? match.inventory_a : match.inventory_b}
          confirmedEquips={mySide === "A" ? game.item_equips_a : game.item_equips_b}
          basePlayerById={basePlayerById}
          augmentBonusByPlayer={mapToRecord(augmentBonusByPlayer)}
          mySide={mySide}
          opponentName={mySide === "A" ? (names?.b ?? "…") : (names?.a ?? "…")}
          onGameUpdate={applyGameUpdate}
        />
      )}
      {game && lineupsReady && !game.result && !game.bout_provisional && (
        <p className="text-center text-sm text-bone-faint">Đang mô phỏng trận đấu…</p>
      )}
      {game && game.bout_provisional && !game.result && (
        <div className="flex min-h-0 w-full flex-1 flex-col">
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
            bonusByPlayer={mapToRecord(fullBonusByPlayer)}
            seriesDecided={false}
            onContinue={goToNextGame}
            daihyosenPending={{
              myRoster: mySide === "A" ? game.draft_state.pickedA : game.draft_state.pickedB,
              myRepresentative: (mySide === "A" ? game.representative_a : game.representative_b) ?? null,
              opponentRepresentative: (mySide === "A" ? game.representative_b : game.representative_a) ?? null,
              onPickRepresentative: pickRepresentative,
              busy: pickingRepresentative,
            }}
          />
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
            bonusByPlayer={mapToRecord(fullBonusByPlayer)}
            seriesDecided={match.status === "completed"}
            onContinue={goToNextGame}
          />
        </div>
      )}
      {match.status === "completed" && (
        <p className="display text-center text-lg text-brass-600">
          {match.series_score_a > match.series_score_b ? (names?.a ?? "Người chơi A") : (names?.b ?? "Người chơi B")}{" "}
          thắng chung cuộc {Math.max(match.series_score_a, match.series_score_b)}-
          {Math.min(match.series_score_a, match.series_score_b)}!
        </p>
      )}
    </section>
  );
}
