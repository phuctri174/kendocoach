import { createRng, type Rng } from "./rng";
import { stylesFor } from "./draft";
import { POSITIONS, type CombatStyle, type PersonRecord, type Position } from "./types";

export const DEFAULT_CANDIDATE_COUNT = 3;
export const DEFAULT_REROLLS = 3;

/** A person offered for one draft slot, with the stances they can field. */
export interface DraftCandidate {
  person: PersonRecord;
  styles: CombatStyle[];
}

export interface DraftPick {
  position: Position;
  person: PersonRecord;
}

export interface DraftState {
  /** Personnel still available; picked people are removed with all their variants. */
  remaining: PersonRecord[];
  /** 0-4 — which position is being drafted. 5 means the draft is complete. */
  positionIndex: number;
  candidates: DraftCandidate[];
  rerollsLeft: number;
  picks: DraftPick[];
  rng: Rng;
  candidateCount: number;
}

export interface StartDraftOptions {
  seed?: string | number;
  rng?: Rng;
  candidateCount?: number;
  rerolls?: number;
}

function toCandidate(person: PersonRecord): DraftCandidate {
  return { person, styles: stylesFor(person) };
}

/** Draws N distinct people at random from the remaining pool. */
function drawCandidates(
  remaining: PersonRecord[],
  count: number,
  rng: Rng,
): DraftCandidate[] {
  const bag = [...remaining];
  const drawn: PersonRecord[] = [];
  while (drawn.length < count && bag.length > 0) {
    drawn.push(...bag.splice(Math.floor(rng.next() * bag.length), 1));
  }
  return drawn.map(toCandidate);
}

export function startDraft(
  people: PersonRecord[],
  options: StartDraftOptions = {},
): DraftState {
  const rng = options.rng ?? createRng(options.seed ?? "draft");
  const candidateCount = options.candidateCount ?? DEFAULT_CANDIDATE_COUNT;
  const remaining = [...people];

  return {
    remaining,
    positionIndex: 0,
    candidates: drawCandidates(remaining, candidateCount, rng),
    rerollsLeft: options.rerolls ?? DEFAULT_REROLLS,
    picks: [],
    rng,
    candidateCount,
  };
}

export function isDraftComplete(state: DraftState): boolean {
  return state.positionIndex >= POSITIONS.length;
}

/** The position currently being drafted, or undefined once the draft is done. */
export function currentPosition(state: DraftState): Position | undefined {
  return POSITIONS[state.positionIndex];
}

export function canReroll(state: DraftState): boolean {
  return (
    state.rerollsLeft > 0 &&
    !isDraftComplete(state) &&
    state.remaining.length > state.candidates.length
  );
}

/**
 * Spends one of the three rerolls — they are shared across all five picks, not
 * per position. Replaces the current offer with a fresh draw.
 */
export function rerollCandidates(state: DraftState): DraftState {
  if (!canReroll(state)) return state;
  return {
    ...state,
    candidates: drawCandidates(state.remaining, state.candidateCount, state.rng),
    rerollsLeft: state.rerollsLeft - 1,
  };
}

/**
 * Takes one of the offered people for the current position. They leave the
 * pool entirely — every stance variant of them included — so they can never be
 * offered again for a later position.
 */
export function pickCandidate(state: DraftState, personId: string): DraftState {
  if (isDraftComplete(state)) return state;

  const candidate = state.candidates.find((c) => c.person.id === personId);
  if (!candidate) {
    throw new Error(`${personId} is not among the current draft candidates`);
  }

  const position = POSITIONS[state.positionIndex];
  const remaining = state.remaining.filter((p) => p.id !== personId);
  const positionIndex = state.positionIndex + 1;
  const complete = positionIndex >= POSITIONS.length;

  return {
    ...state,
    remaining,
    positionIndex,
    picks: [...state.picks, { position, person: candidate.person }],
    candidates: complete
      ? []
      : drawCandidates(remaining, state.candidateCount, state.rng),
  };
}

/**
 * The drafted five, fixed for the whole tournament. Positions here are only
 * where each person was drafted — the coach reassigns positions and stances
 * freely between rounds.
 */
export function draftedSquad(state: DraftState): PersonRecord[] {
  return state.picks.map((pick) => pick.person);
}

/** Stances each drafted member can use — advisory display only. */
export function squadStyles(squad: PersonRecord[]) {
  return squad.map((person) => ({ person, styles: stylesFor(person) }));
}
