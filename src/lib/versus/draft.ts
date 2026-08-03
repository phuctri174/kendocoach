/**
 * Pure 3-phase snake draft state machine — no Supabase, no randomness source
 * baked in beyond `Math.random`, no I/O. Route handlers own persistence and
 * auth; this module only knows how to advance a `DraftState` forward. The
 * roster is passed in rather than imported, so tests can shrink it to make
 * pool-recycling deterministic instead of racing real randomness.
 *
 * Turn schedule per game (spec-fixed shape, not configurable):
 *   Phase 1 — first-picker picks 1, then the other picks 2   (3 of 5; 2 leftover)
 *   Phase 2 — other picks 1, then first-picker picks 2       (3 of 5; 2 leftover)
 *   Phase 3 — first-picker 1, other 2, first-picker 1        (4 of 5; 1 discarded)
 * End state: first-picker has 5 (1+2+1+1), the other has 5 (2+1+2) — the
 * fairness guarantee holds regardless of which literal side (A/B) is
 * seeded to go first (see `firstPicker` on DraftState — the comeback rule
 * in games/start/route.ts seeds the previous game's loser to go first from
 * game 2 onward; game 1 has no previous result, so it defaults to "A", same
 * as when this schedule was hardcoded to always start with A).
 *
 * Pool recycling: each phase's roll excludes only players actually DRAFTED
 * so far this game (pickedA ∪ pickedB) — never the previous phase's
 * unpicked leftovers, which are eligible to reappear. The full roster
 * resets between games; that reset is the caller's job (a fresh
 * initialDraftState per game), not this module's.
 */

import type { AugmentTier } from "./augments";
import type { Bout, Lineup, MatchLogEvent, TeamMatch } from "@/lib/kendo/types";

export type Phase = 1 | 2 | 3;
export type DraftSide = "A" | "B";

export interface ItemEquip {
  itemId: string;
  targetPlayerId: string;
}

/** Shape of a `match_games` row, shared by the route handlers' responses, the
 *  Realtime broadcast payload, and postgres_changes — all three deliver the
 *  same row shape to the client. `augment_pick_a`/`_b` and
 *  `item_pick_a`/`_b` are separate columns rather than one shared jsonb blob
 *  per side pair (see 0010_pick_columns.sql) — a read-modify-write on a
 *  shared object silently loses whichever side wrote second under real
 *  concurrency; separate columns can't collide since each write only ever
 *  touches its own column. */
export interface MatchGameRow {
  id: string;
  match_id: string;
  game_number: number;
  time_limit_seconds: number;
  draft_state: DraftState;
  draft_seq: number;
  augment_tier: AugmentTier | null;
  augment_pick_a: string | null;
  augment_pick_b: string | null;
  augment_seq: number;
  /** This game's new pick from the 3-offer, if any — just the itemId now;
   *  it lands in the match's inventory_a/b, not equipped to anyone by
   *  picking it (see 0011_persistent_inventory.sql). */
  item_pick_a: string | null;
  item_pick_b: string | null;
  item_seq: number;
  /** This game's actual equip assignments, chosen from the accumulated
   *  inventory at lineup time — one array entry per equipped player, at
   *  most one item per player. */
  item_equips_a: ItemEquip[];
  item_equips_b: ItemEquip[];
  lineup_a: Lineup | null;
  lineup_b: Lineup | null;
  lineup_seq: number;
  /** Set once the 5 regular bouts come back tied on both bout-wins and total
   *  ippons — the 5 real, reps-independent bouts plus their narration only
   *  (never the engine's auto-suggested-rep tiebreak from the probing call
   *  that revealed the tie — see 0009_daihyosen.sql). Present with `result`
   *  still null means "tied, waiting on both representatives". */
  bout_provisional: BoutProvisional | null;
  /** Picked only after bout_provisional appears — i.e. only once both
   *  players already know the match is tied, never guessed beforehand. */
  representative_a: string | null;
  representative_b: string | null;
  bout_seq: number;
  /** The engine's full, final TeamMatch (bouts, tiebreak if any, result,
   *  log) — not just the win/loss summary, since the result viewer replays
   *  the narration log. */
  result: TeamMatch | null;
}

export interface BoutProvisional {
  bouts: Bout[];
  log: MatchLogEvent[];
  teamAWins: number;
  teamBWins: number;
  teamAIppons: number;
  teamBIppons: number;
}

export interface DraftState {
  phase: Phase;
  turnIndex: number;
  picksRemainingInTurn: number;
  pool: string[];
  pickedA: string[];
  pickedB: string[];
  turnDeadline: string;
  status: "drafting" | "complete";
  /** Which literal side (A/B) the PHASE_TURNS schedule below is anchored
   *  to — "A" means the schedule runs exactly as written; "B" means every
   *  scheduled side is mirrored (see currentTurnSide). Doesn't change what
   *  pickedA/pickedB mean (still literally "picked by DB player_a/_b") —
   *  only which side's turn comes first/second at each step. */
  firstPicker: DraftSide;
}

interface TurnSpec {
  side: DraftSide;
  count: number;
}

export const PHASE_TURNS: Record<Phase, TurnSpec[]> = {
  1: [
    { side: "A", count: 1 },
    { side: "B", count: 2 },
  ],
  2: [
    { side: "B", count: 1 },
    { side: "A", count: 2 },
  ],
  3: [
    { side: "A", count: 1 },
    { side: "B", count: 2 },
    { side: "A", count: 1 },
  ],
};

export const TURN_SECONDS = 18;

export function currentTurnSide(state: DraftState): DraftSide {
  const scheduled = PHASE_TURNS[state.phase][state.turnIndex].side;
  if (state.firstPicker === "A") return scheduled;
  return scheduled === "A" ? "B" : "A";
}

function turnDeadline(now: number = Date.now()): string {
  return new Date(now + TURN_SECONDS * 1000).toISOString();
}

/** Fisher-Yates so every eligible player has equal odds, not just the head of the array. */
export function rollPool(allIds: readonly string[], excludeIds: ReadonlySet<string>, count = 5): string[] {
  const eligible = allIds.filter((id) => !excludeIds.has(id));
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  return eligible.slice(0, Math.min(count, eligible.length));
}

export function initialDraftState(allIds: readonly string[], firstPicker: DraftSide = "A"): DraftState {
  return {
    phase: 1,
    turnIndex: 0,
    picksRemainingInTurn: PHASE_TURNS[1][0].count,
    pool: rollPool(allIds, new Set()),
    pickedA: [],
    pickedB: [],
    turnDeadline: turnDeadline(),
    status: "drafting",
    firstPicker,
  };
}

/**
 * Applies one pick. Caller must already have validated it's `side`'s turn
 * and `candidateId` is in `state.pool` — this function trusts its inputs,
 * same division of labor as the bout simulator trusts its callers.
 */
export function applyPick(state: DraftState, side: DraftSide, candidateId: string, allIds: readonly string[]): DraftState {
  const pool = state.pool.filter((id) => id !== candidateId);
  const pickedA = side === "A" ? [...state.pickedA, candidateId] : state.pickedA;
  const pickedB = side === "B" ? [...state.pickedB, candidateId] : state.pickedB;

  const { phase } = state;
  const picksRemainingInTurn = state.picksRemainingInTurn - 1;

  if (picksRemainingInTurn > 0) {
    return { ...state, pool, pickedA, pickedB, picksRemainingInTurn, turnDeadline: turnDeadline() };
  }

  const turns = PHASE_TURNS[phase];
  const nextTurnIndex = state.turnIndex + 1;
  if (nextTurnIndex < turns.length) {
    return {
      ...state,
      turnIndex: nextTurnIndex,
      picksRemainingInTurn: turns[nextTurnIndex].count,
      pool,
      pickedA,
      pickedB,
      turnDeadline: turnDeadline(),
    };
  }

  if (phase < 3) {
    const nextPhase = (phase + 1) as Phase;
    const drafted = new Set([...pickedA, ...pickedB]);
    return {
      phase: nextPhase,
      turnIndex: 0,
      picksRemainingInTurn: PHASE_TURNS[nextPhase][0].count,
      pool: rollPool(allIds, drafted),
      pickedA,
      pickedB,
      turnDeadline: turnDeadline(),
      status: "drafting",
      firstPicker: state.firstPicker,
    };
  }

  return { ...state, pool: [], pickedA, pickedB, status: "complete" };
}
