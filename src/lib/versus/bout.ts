import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyStyleModifier,
  TARGETS,
  toPlayers,
  type LiveModifierHook,
  type Player,
  type Side,
  type StatPath,
  type StyleModifier,
  type Target,
  type Team,
} from "@/lib/kendo";
import type { SimulateTeamMatchOptions } from "@/lib/kendo/teamMatch";
import type { Lineup, MatchLogEvent, PersonRecord } from "@/lib/kendo/types";
import { CLUB_ROSTER } from "@/data/club";
import { AUGMENT_CATALOG } from "@/data/augments";
import { ITEM_CATALOG } from "@/data/items";
import type { Augment } from "./augments";
import type { DraftSide, DraftState, ItemEquip } from "./draft";
import { buildPassiveHookForBout, hasLivePassiveCandidates, resolvePassiveStaticEffects } from "./passives";

const PERSON_BY_ID = new Map(CLUB_ROSTER.map((p) => [p.id, p]));
const AUGMENT_BY_ID = new Map(AUGMENT_CATALOG.map((a) => [a.id, a]));
const ITEM_BY_ID = new Map(ITEM_CATALOG.map((i) => [i.id, i]));

/**
 * Augments gated on a specific named player being in the picker's drafted
 * roster — the one mechanic, reused for all of them rather than rebuilt per
 * augment. Names are resolved to ids once at module load, same fail-fast
 * philosophy as loadRoster/loadAugments — if a name here ever stops
 * matching players.seed.json (a rename, a typo fix), this throws
 * immediately on startup instead of the augment silently never triggering.
 */
const MEMBERSHIP_GATED_AUGMENT_NAMES: Record<string, string[]> = {
  dan_ami: ["Phan Anh Minh", "Nguyễn Kiều Hồng Nhung", "Phan Phúc Lâm"],
  rookie_37do: ["Nhi Nhi"],
  dan_kote: ["Nguyễn Thị Nhị Phương"],
  kyu_capulus: ["Võ Nguyệt Đức"],
};
const MEMBERSHIP_GATED_TRIGGER_IDS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(MEMBERSHIP_GATED_AUGMENT_NAMES).map(([augmentId, names]) => [
    augmentId,
    new Set(
      names.map((name) => {
        const person = CLUB_ROSTER.find((p) => p.name === name);
        if (!person) throw new Error(`${augmentId}: no player named "${name}" in the club roster`);
        return person.id;
      }),
    ),
  ]),
);

/**
 * Augment/item deltas are baked into a player's base stat fields before the
 * bout ever runs — not into `styleModifiers`, which the unmodified engine
 * applies conditionally per chosen stance. An augment/item boost is meant to
 * hold regardless of stance, so it has to already be part of the baseline
 * `statsForStance` starts from. Same clamping as styleModifiers: reuses
 * `applyStyleModifier` directly (0-100 clamp per field), since a `Player`
 * structurally has every `BaseStats` field `applyStyleModifier` reads/writes.
 */
export function withFlatModifier(player: Player, modifier: Partial<Record<StatPath, number>> | undefined): Player {
  if (!modifier || Object.keys(modifier).length === 0) return player;
  const modifiedBase = applyStyleModifier(player, modifier);
  return { ...player, ...modifiedBase };
}

/**
 * An `opp.<stat>` key in an augment's effects means "apply this delta to the
 * opposing team's 5 players instead of the picker's own" — splits a raw
 * effects dict authored that way into the part that stays on the picker's
 * own side (`own`) and the part that crosses over (`opp`, already stripped
 * of its prefix so it's a plain StatPath delta ready to hand to the other
 * side's `withFlatModifier`).
 */
export function splitEffects(
  effects: Partial<Record<string, number>>,
): { own: Partial<Record<StatPath, number>>; opp: Partial<Record<StatPath, number>> } {
  const own: Partial<Record<StatPath, number>> = {};
  const opp: Partial<Record<StatPath, number>> = {};
  for (const [path, delta] of Object.entries(effects)) {
    if (delta === undefined) continue;
    if (path.startsWith("opp.")) {
      opp[path.slice(4) as StatPath] = delta;
    } else {
      own[path as StatPath] = delta;
    }
  }
  return { own, opp };
}

/** Per-technique average across a full 5-player roster — the comparison
 *  basis for dan_dou_guard's gate (see resolveConditionalEffects). */
export function teamTechniqueAverages(players: readonly Player[]): Record<Target, number> {
  const sums = Object.fromEntries(TARGETS.map((t) => [t, 0])) as Record<Target, number>;
  for (const player of players) {
    for (const t of TARGETS) sums[t] += player.technique[t];
  }
  for (const t of TARGETS) sums[t] /= Math.max(1, players.length);
  return sums;
}

/**
 * Resolves what an augment actually contributes for its picking side, given
 * that side's own (unmodified) roster and the opponent's, and the picker's
 * drafted player ids:
 *
 * - dan_dou_guard: only its flat boost if every one of the picker's 4
 *   technique averages (across their 5 drafted players) is lower than the
 *   opponent's corresponding average — a team-wide comparison, not a
 *   per-player one, so it doesn't depend on lineup order.
 * - dan_ami, rookie_37do, dan_kote, kyu_capulus: only their flat boost if
 *   the picker's drafted roster includes at least one of that augment's
 *   named players (MEMBERSHIP_GATED_TRIGGER_IDS). The check runs on the
 *   augment's *whole* raw effects dict, before splitEffects ever separates
 *   an opp. delta out — so for dan_kote, its opp.attack_rate crossover and
 *   its own stamina/hansoku_rate deltas share the exact same gate and only
 *   ever fire together, never independently.
 * - dan_nice / dan_fighting: never contribute a static/flat effect at all —
 *   their entire contribution is the live per-exchange hook built by
 *   buildLiveModifierForGame below, so returning {} here keeps them out of
 *   the pre-bout baking pipeline entirely.
 * - everything else: passes its effects dict straight through unchanged.
 *
 * Exported (not just used internally) so the client can run the exact same
 * per-augment gate check for display purposes — the "does this stacked
 * augment from an earlier game actually apply to THIS game's roster" logic
 * behind the hover tooltip and the equip badges is identical to what the
 * server uses to actually resolve the bout, not a re-implementation of it.
 */
export function resolveConditionalEffects(
  augment: Augment | undefined,
  ownRosterIds: readonly string[],
  ownPlayers: readonly Player[],
  oppPlayers: readonly Player[],
): Partial<Record<string, number>> {
  if (!augment) return {};
  if (augment.id === "dan_dou_guard") {
    const own = teamTechniqueAverages(ownPlayers);
    const opp = teamTechniqueAverages(oppPlayers);
    const qualifies = TARGETS.every((t) => own[t] < opp[t]);
    return qualifies ? augment.effects : {};
  }
  const triggerIds = MEMBERSHIP_GATED_TRIGGER_IDS[augment.id];
  if (triggerIds) {
    const qualifies = ownRosterIds.some((id) => triggerIds.has(id));
    return qualifies ? augment.effects : {};
  }
  if (augment.id === "dan_nice" || augment.id === "dan_fighting") {
    return {};
  }
  return augment.effects;
}

/** Sums however many effects dicts together, key by key — how multiple
 *  stacked augments' contributions combine (see activeAugmentIdsFor). */
export function sumEffects(effectsList: readonly Partial<Record<string, number>>[]): Partial<Record<string, number>> {
  const sum: Partial<Record<string, number>> = {};
  for (const effects of effectsList) {
    for (const [path, delta] of Object.entries(effects)) {
      if (delta === undefined) continue;
      sum[path] = (sum[path] ?? 0) + delta;
    }
  }
  return sum;
}

/**
 * Every augment a side has picked in an odd game up to and including
 * `uptoGameNumber` — augments persist and stack for the rest of the series
 * once picked, rather than applying only to the game they were picked in.
 * Pure function over already-fetched rows (not itself a query) so the exact
 * same "which augments are active entering game N" logic can run
 * server-side (fed by an admin query in buildVersusTeamsForGame /
 * buildLiveModifierForGame) and client-side (fed by the browser's own
 * RLS-scoped read of the match's match_games rows, for the equip badges and
 * hover tooltips) without drifting apart.
 */
export function activeAugmentIdsFor(
  side: DraftSide,
  rows: readonly { game_number: number; augment_pick_a: string | null; augment_pick_b: string | null }[],
  uptoGameNumber: number,
): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.game_number > uptoGameNumber) continue;
    if (row.game_number % 2 !== 1) continue;
    const pick = side === "A" ? row.augment_pick_a : row.augment_pick_b;
    if (pick) ids.push(pick);
  }
  return ids;
}

/**
 * Which of a side's active (stacked) augments actually qualify against this
 * game's roster right now — the same per-augment gate as
 * resolveConditionalEffects, just reporting *which* augments passed rather
 * than their summed effects. Powers the equip badges (one per currently-
 * qualifying augment, shown under every one of that side's 5 players, since
 * augments are team-wide) without needing a second gating implementation.
 */
export function qualifyingAugments(
  activeAugmentIds: readonly string[],
  ownRosterIds: readonly string[],
  ownPlayers: readonly Player[],
  oppPlayers: readonly Player[],
): Augment[] {
  const result: Augment[] = [];
  for (const id of activeAugmentIds) {
    const augment = AUGMENT_BY_ID.get(id);
    if (!augment) continue;
    const effects = resolveConditionalEffects(augment, ownRosterIds, ownPlayers, oppPlayers);
    if (Object.keys(effects).length > 0) result.push(augment);
  }
  return result;
}

const DYNAMIC_AUGMENT_IDS = new Set(["dan_nice", "dan_fighting"]);

/**
 * dan_nice/dan_fighting deliberately return {} from resolveConditionalEffects
 * (see its own doc comment) — their entire contribution is the live
 * per-exchange hook in buildLiveModifierForGame, which means qualifyingAugments
 * never surfaces them, and a picked-and-active dan_nice/dan_fighting has
 * historically shown up nowhere in the UI at all: no badge, no log mention,
 * nothing — even though its effect on stats when it does fire is large (see
 * augments_catalog.json), a player has no way to even know it's equipped.
 * This is a second, parallel badge list specifically for those two — same
 * Augment shape as qualifyingAugments' output, unconditional on this game's
 * roster (their condition is "did this side land an ippon *during* the bout
 * being watched right now", which isn't something a static per-game gate can
 * evaluate), just "picked and still active for the series" like any other
 * badge. Callers show both lists.
 */
export function dynamicAugments(activeAugmentIds: readonly string[]): Augment[] {
  const result: Augment[] = [];
  for (const id of activeAugmentIds) {
    if (!DYNAMIC_AUGMENT_IDS.has(id)) continue;
    const augment = AUGMENT_BY_ID.get(id);
    if (augment) result.push(augment);
  }
  return result;
}

/**
 * Every drafted player's total stat bonus for this game — their own side's
 * qualifying augments, whatever opp. crossover the *other* side's augments
 * are landing on them, and their own equipped item, all summed together.
 * Reuses the exact same resolveConditionalEffects/sumEffects/splitEffects
 * building blocks buildVersusTeamsForGame itself resolves the bout with, so
 * this can't silently drift from what the bout actually applies — this is
 * purely for display (the hover breakdown, "OG stats + bonuses"), never fed
 * back into the simulation.
 */
export function resolvePlayerBonuses(options: {
  pickedA: readonly string[];
  pickedB: readonly string[];
  rawPlayersA: readonly Player[];
  rawPlayersB: readonly Player[];
  activeAugmentIdsA: readonly string[];
  activeAugmentIdsB: readonly string[];
  itemEquipsA: readonly ItemEquip[];
  itemEquipsB: readonly ItemEquip[];
  /** Category-A (static) passive effects only get folded in once both
   *  lineups are known — undefined during the draft/augment/item phases,
   *  when there's nothing to pass yet. */
  lineupA?: Lineup | null;
  lineupB?: Lineup | null;
}): Map<string, Partial<Record<StatPath, number>>> {
  const {
    pickedA,
    pickedB,
    rawPlayersA,
    rawPlayersB,
    activeAugmentIdsA,
    activeAugmentIdsB,
    itemEquipsA,
    itemEquipsB,
    lineupA,
    lineupB,
  } = options;

  const resolvedA = sumEffects(
    activeAugmentIdsA.map((id) => resolveConditionalEffects(AUGMENT_BY_ID.get(id), pickedA, rawPlayersA, rawPlayersB)),
  );
  const resolvedB = sumEffects(
    activeAugmentIdsB.map((id) => resolveConditionalEffects(AUGMENT_BY_ID.get(id), pickedB, rawPlayersB, rawPlayersA)),
  );
  const { own: ownA, opp: oppFromA } = splitEffects(resolvedA);
  const { own: ownB, opp: oppFromB } = splitEffects(resolvedB);

  const map = new Map<string, Partial<Record<StatPath, number>>>();
  for (const id of pickedA) map.set(id, sumEffects([ownA, oppFromB]));
  for (const id of pickedB) map.set(id, sumEffects([ownB, oppFromA]));

  for (const eq of [...itemEquipsA, ...itemEquipsB]) {
    const item = ITEM_BY_ID.get(eq.itemId);
    if (!item) continue;
    map.set(eq.targetPlayerId, sumEffects([map.get(eq.targetPlayerId) ?? {}, item.effects]));
  }

  if (lineupA && lineupB) {
    const passiveEffects = resolvePassiveStaticEffects({ pickedA, pickedB, lineupA, lineupB, rawPlayersA, rawPlayersB });
    for (const [id, effects] of passiveEffects) {
      map.set(id, sumEffects([map.get(id) ?? {}, effects]));
    }
  }

  return map;
}

export function buildVersusTeam(options: {
  id: "A" | "B";
  name: string;
  people: PersonRecord[];
  lineup: Lineup;
  augmentEffects: Partial<Record<StatPath, number>> | null;
  /** The opposing side's augment(s), if any declared `opp.<stat>` deltas —
   *  already summed across every stacked augment, applied to this whole
   *  roster same as augmentEffects. */
  incomingEffects: Partial<Record<StatPath, number>> | null;
  /** This game's equipped items — one entry per equipped player (at most
   *  one item per player), each applied only to its own target. */
  itemEffects: { targetPlayerId: string; effects: Partial<Record<StatPath, number>> }[];
}): Team {
  const { id, name, people, lineup, augmentEffects, incomingEffects, itemEffects } = options;
  let roster: Player[] = toPlayers(people);

  if (augmentEffects) {
    roster = roster.map((player) => withFlatModifier(player, augmentEffects));
  }
  if (incomingEffects) {
    roster = roster.map((player) => withFlatModifier(player, incomingEffects));
  }
  for (const item of itemEffects) {
    roster = roster.map((player) =>
      player.id === item.targetPlayerId ? withFlatModifier(player, item.effects) : player,
    );
  }

  return { id, name, roster, lineup };
}

interface GameForTeams {
  id: string;
  match_id: string;
  game_number: number;
  draft_state: DraftState;
  lineup_a: Lineup;
  lineup_b: Lineup;
  item_equips_a: ItemEquip[];
  item_equips_b: ItemEquip[];
}

interface MatchForTeams {
  player_a: string;
  player_b: string;
}

/** Every augment_pick row across this match, up to and including the given
 *  game — the shared query behind both buildVersusTeamsForGame's and
 *  buildLiveModifierForGame's stacking logic, so they can't read different
 *  histories for the same game. */
async function fetchAugmentHistory(
  admin: SupabaseClient,
  matchId: string,
  uptoGameNumber: number,
): Promise<{ a: string[]; b: string[] }> {
  const { data: rows } = await admin
    .from("match_games")
    .select("game_number, augment_pick_a, augment_pick_b")
    .eq("match_id", matchId)
    .lte("game_number", uptoGameNumber);
  return {
    a: activeAugmentIdsFor("A", rows ?? [], uptoGameNumber),
    b: activeAugmentIdsFor("B", rows ?? [], uptoGameNumber),
  };
}

/**
 * Builds both sides' `Team`s for a game — shared by every route that needs
 * to run (or re-run) the bout simulation, so they can't drift apart on how
 * augment/item effects get applied or how display names get looked up.
 *
 * Augments picked in *any* earlier odd game of this series are still active
 * here (see fetchAugmentHistory) and each independently re-checks its own
 * condition against this game's actual roster — a stacked augment from an
 * earlier game never gets grandfathered in if this game's draft doesn't
 * satisfy it. All qualifying augments' effects are summed together
 * (sumEffects) before being baked into the roster.
 */
export async function buildVersusTeamsForGame(
  admin: SupabaseClient,
  game: GameForTeams,
  match: MatchForTeams,
): Promise<{ teamA: Team; teamB: Team }> {
  const [{ data: profiles }, { a: augmentIdsA, b: augmentIdsB }] = await Promise.all([
    admin.from("profiles").select("id, display_name").in("id", [match.player_a, match.player_b]),
    fetchAugmentHistory(admin, game.match_id, game.game_number),
  ]);
  const nameByUid = new Map(profiles?.map((p) => [p.id, p.display_name as string]) ?? []);

  function peopleFor(ids: string[]): PersonRecord[] {
    return ids.map((id) => {
      const person = PERSON_BY_ID.get(id);
      if (!person) throw new Error(`Unknown player id ${id} in roster`);
      return person;
    });
  }

  const pickedA = game.draft_state.pickedA;
  const pickedB = game.draft_state.pickedB;

  // Conditional gates (dan_dou_guard, dan_ami, ...) compare against each
  // side's raw, unmodified technique — computed before any augment/item
  // deltas exist, so the check can't be influenced by the very augment it's
  // gating, or by which side happens to get built first.
  const rawPlayersA = toPlayers(peopleFor(pickedA));
  const rawPlayersB = toPlayers(peopleFor(pickedB));

  const resolvedA = sumEffects(
    augmentIdsA.map((id) => resolveConditionalEffects(AUGMENT_BY_ID.get(id), pickedA, rawPlayersA, rawPlayersB)),
  );
  const resolvedB = sumEffects(
    augmentIdsB.map((id) => resolveConditionalEffects(AUGMENT_BY_ID.get(id), pickedB, rawPlayersB, rawPlayersA)),
  );

  const { own: ownEffectsA, opp: oppEffectsFromA } = splitEffects(resolvedA);
  const { own: ownEffectsB, opp: oppEffectsFromB } = splitEffects(resolvedB);

  function itemEffectsFor(equips: ItemEquip[]): { targetPlayerId: string; effects: Partial<Record<StatPath, number>> }[] {
    return equips.map((eq) => ({ targetPlayerId: eq.targetPlayerId, effects: ITEM_BY_ID.get(eq.itemId)?.effects ?? {} }));
  }

  const teamA = buildVersusTeam({
    id: "A",
    name: nameByUid.get(match.player_a) ?? "Người chơi A",
    people: peopleFor(pickedA),
    lineup: game.lineup_a,
    augmentEffects: Object.keys(ownEffectsA).length ? ownEffectsA : null,
    incomingEffects: Object.keys(oppEffectsFromB).length ? oppEffectsFromB : null,
    itemEffects: itemEffectsFor(game.item_equips_a),
  });
  const teamB = buildVersusTeam({
    id: "B",
    name: nameByUid.get(match.player_b) ?? "Người chơi B",
    people: peopleFor(pickedB),
    lineup: game.lineup_b,
    augmentEffects: Object.keys(ownEffectsB).length ? ownEffectsB : null,
    incomingEffects: Object.keys(oppEffectsFromA).length ? oppEffectsFromA : null,
    itemEffects: itemEffectsFor(game.item_equips_b),
  });

  // Character passives (category A, see versus/passives.ts) layer on top of
  // augments/items — per-player rather than team-wide, resolved the instant
  // both lineups lock in (team/position/opponent membership is fully known
  // here, same as the conditional gates above, just keyed by individual
  // player id instead of whole-team effects).
  const passiveEffects = resolvePassiveStaticEffects({
    pickedA,
    pickedB,
    lineupA: game.lineup_a,
    lineupB: game.lineup_b,
    rawPlayersA,
    rawPlayersB,
  });
  teamA.roster = teamA.roster.map((p) => withFlatModifier(p, passiveEffects.get(p.id)));
  teamB.roster = teamB.roster.map((p) => withFlatModifier(p, passiveEffects.get(p.id)));

  return { teamA, teamB };
}

/**
 * Nai Xừ (dan_nice): once the picker's side lands its first ippon in a
 * bout, its buff applies from the next exchange onward for the rest of that
 * same bout. `triggered` lives in this closure, so it's fresh per bout (a
 * new hook is built for every bout — see buildLiveModifierForGame) and
 * never leaks across bouts.
 */
function makeDanNiceHook(side: DraftSide, effects: Partial<Record<StatPath, number>>): LiveModifierHook {
  let triggered = false;
  return (state) => {
    if (!triggered) {
      const scored = side === "A" ? state.ipponsA > 0 : state.ipponsB > 0;
      if (scored) triggered = true;
    }
    if (!triggered) return undefined;
    return side === "A" ? { a: effects } : { b: effects };
  };
}

/**
 * FAITOOO !!! (dan_fighting): active while the picker's side is behind —
 * either on the game's running team-bout-win tally entering this bout (that
 * part is fixed for the whole bout, since the tally can't change mid-bout)
 * or on ippons within this bout specifically (re-checked live every
 * exchange, since that can flip back and forth as the bout plays out).
 */
function makeDanFightingHook(
  side: DraftSide,
  effects: Partial<Record<StatPath, number>>,
  teamAWinsSoFar: number,
  teamBWinsSoFar: number,
): LiveModifierHook {
  const behindOnTeam = side === "A" ? teamAWinsSoFar < teamBWinsSoFar : teamBWinsSoFar < teamAWinsSoFar;
  return (state) => {
    const behindOnBout = side === "A" ? state.ipponsA < state.ipponsB : state.ipponsB < state.ipponsA;
    if (!behindOnTeam && !behindOnBout) return undefined;
    return side === "A" ? { a: effects } : { b: effects };
  };
}

/**
 * Merges any number of hooks into one, summing whatever each contributes for
 * a given exchange — generalized over dan_nice/dan_fighting's old per-side
 * split (each of those still only ever returns `.a` or `.b`, never both) to
 * also cover passive hooks that can touch both sides from the same call
 * (e.g. Liên Toàn's mutual defend_rate hit — see versus/passives.ts) and
 * that can attach narration notes.
 */
function combineLiveModifiers(hooks: LiveModifierHook[]): LiveModifierHook | undefined {
  if (hooks.length === 0) return undefined;
  return (state) => {
    const results = hooks
      .map((h) => h(state))
      .filter((r): r is { a?: StyleModifier; b?: StyleModifier; notes?: { side: Side; text: string }[] } => !!r);
    if (results.length === 0) return undefined;
    const aParts = results.map((r) => r.a).filter((m): m is NonNullable<typeof m> => !!m);
    const bParts = results.map((r) => r.b).filter((m): m is NonNullable<typeof m> => !!m);
    const notes = results.flatMap((r) => r.notes ?? []);
    return {
      a: aParts.length ? sumEffects(aParts) : undefined,
      b: bParts.length ? sumEffects(bParts) : undefined,
      notes: notes.length ? notes : undefined,
    };
  };
}

/**
 * Builds simulateTeamMatch's buildLiveModifier for a game — the counterpart
 * to the static effects resolved in buildVersusTeamsForGame, for whatever
 * can't be pre-baked because it depends on what happens *during* a bout:
 * the two live augments (dan_nice, dan_fighting, odd games only, since
 * augments only exist in odd games) and every live character passive
 * (categories B/C/D/E/F in versus/passives.ts — these are NOT gated to odd
 * games, since a drafted roster exists every game regardless of whether
 * it's an augment or item round). Async: like buildVersusTeamsForGame, it
 * has to scan this match's augment history (fetchAugmentHistory) rather
 * than just this game's own pick, since a side could be running dan_nice
 * from game 1 and dan_fighting from game 3 simultaneously by game 5.
 * Returns undefined when nothing dynamic applies at all, so the two
 * probing/final simulateTeamMatch calls stay cheap and inert for every
 * game that has neither.
 */
export async function buildLiveModifierForGame(
  admin: SupabaseClient,
  game: { match_id: string; game_number: number; draft_state: DraftState },
): Promise<SimulateTeamMatchOptions["buildLiveModifier"]> {
  const isOddGame = game.game_number % 2 === 1;
  const pickedA = game.draft_state.pickedA;
  const pickedB = game.draft_state.pickedB;

  let dynamicA: string[] = [];
  let dynamicB: string[] = [];
  if (isOddGame) {
    const { a: augmentIdsA, b: augmentIdsB } = await fetchAugmentHistory(admin, game.match_id, game.game_number);
    const dynamicIds = new Set(["dan_nice", "dan_fighting"]);
    dynamicA = augmentIdsA.filter((id) => dynamicIds.has(id));
    dynamicB = augmentIdsB.filter((id) => dynamicIds.has(id));
  }

  if (dynamicA.length === 0 && dynamicB.length === 0 && !hasLivePassiveCandidates(pickedA, pickedB)) {
    return undefined;
  }

  return ({ teamAWinsSoFar, teamBWinsSoFar, playerA, playerB, boutsSoFar, isDaihyosen }) => {
    const hookFor = (side: DraftSide, id: string): LiveModifierHook | undefined => {
      const augment = AUGMENT_BY_ID.get(id);
      if (!augment) return undefined;
      if (id === "dan_nice") return makeDanNiceHook(side, augment.effects);
      if (id === "dan_fighting") return makeDanFightingHook(side, augment.effects, teamAWinsSoFar, teamBWinsSoFar);
      return undefined;
    };
    const augmentHooksA = dynamicA.map((id) => hookFor("A", id)).filter((h): h is LiveModifierHook => !!h);
    const augmentHooksB = dynamicB.map((id) => hookFor("B", id)).filter((h): h is LiveModifierHook => !!h);
    const passiveHook = buildPassiveHookForBout({
      pickedA,
      pickedB,
      playerA,
      playerB,
      teamAWinsSoFar,
      teamBWinsSoFar,
      boutsSoFar,
      isDaihyosen,
    });
    return combineLiveModifiers([...augmentHooksA, ...augmentHooksB, ...(passiveHook ? [passiveHook] : [])]);
  };
}

/**
 * Isolates the 5 regular bouts' narration from a probing simulateTeamMatch
 * call that turned out tied — everything from the "vào trận đại diện"
 * transition line onward belongs to the engine's auto-suggested-rep
 * tiebreak, which gets discarded (see 0009_daihyosen.sql: the real
 * daihyosen is a second, separate simulateTeamMatch call once both players
 * have actually picked). buildMatchLog always narrates the 5 real bouts, in
 * Senpo-Taisho order, before any tiebreak content, so slicing through the
 * 5th "bout-result" event is exact regardless of what follows it.
 */
export function regularBoutsLog(log: MatchLogEvent[]): MatchLogEvent[] {
  let boutResults = 0;
  for (let i = 0; i < log.length; i++) {
    if (log[i].kind === "bout-result") {
      boutResults++;
      if (boutResults === 5) return log.slice(0, i + 1);
    }
  }
  return log;
}

interface MatchRowForSeries {
  id: string;
  player_a: string;
  player_b: string;
  series_score_a: number;
  series_score_b: number;
  current_game_number: number;
  format: "bo3" | "bo5";
}

/** Wins needed to decide the series — the only thing that actually differs
 *  between the two formats at this layer; everything else (odd/even
 *  augment/item alternation, per-game draft) already generalizes on its own. */
const WINS_TO_DECIDE: Record<"bo3" | "bo5", number> = { bo3: 2, bo5: 3 };

/**
 * Advances the series after a game concludes — shared by the route that
 * decides it in the 5 regular bouts and the one that decides it via
 * daihyosen, so the two paths can't drift apart. A "draw" team-match outcome
 * is a documented bug signal in the engine (sudden-death daihyosen should
 * always produce a decisive winner once invoked), not a real path — if it
 * somehow happens, the game number still advances but neither side gets a
 * series point.
 */
export async function advanceSeriesAfterGame(
  admin: SupabaseClient,
  match: MatchRowForSeries,
  winner: "A" | "B" | "draw",
): Promise<void> {
  if (winner !== "A" && winner !== "B") {
    await admin
      .from("matches")
      .update({ current_game_number: match.current_game_number + 1, status: "in_progress" })
      .eq("id", match.id);
    return;
  }

  const winnerUid = winner === "A" ? match.player_a : match.player_b;
  const scoreField = winner === "A" ? "series_score_a" : "series_score_b";
  const newScore = (winner === "A" ? match.series_score_a : match.series_score_b) + 1;
  const seriesDecided = newScore >= WINS_TO_DECIDE[match.format];

  await admin
    .from("matches")
    .update({
      [scoreField]: newScore,
      status: seriesDecided ? "completed" : "in_progress",
      current_game_number: seriesDecided ? match.current_game_number : match.current_game_number + 1,
      completed_at: seriesDecided ? new Date().toISOString() : null,
    })
    .eq("id", match.id);

  if (seriesDecided) {
    await admin.from("match_history").insert({
      match_id: match.id,
      player_a: match.player_a,
      player_b: match.player_b,
      winner: winnerUid,
      series_score_a: winner === "A" ? newScore : match.series_score_a,
      series_score_b: winner === "B" ? newScore : match.series_score_b,
      format: match.format,
    });
  }
}
