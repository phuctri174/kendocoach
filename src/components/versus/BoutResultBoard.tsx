"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HexPanel } from "@/components/Hex";
import { CLUB_ROSTER } from "@/data/club";
import { ITEM_CATALOG } from "@/data/items";
import {
  HANSOKU_GLYPH,
  TARGET_LETTER,
  type Bout,
  type CombatStyle,
  type MatchLogEvent,
  type Player,
  type Side,
  type StatPath,
} from "@/lib/kendo";
import type { ItemEquip } from "@/lib/versus/draft";
import { EquipIcon, type EquipDisplay } from "@/components/versus/EquipBadge";
import { PlayerHoverCard } from "@/components/versus/PlayerHoverCard";
import { PassiveBadge } from "@/components/versus/PassiveBadge";
import { useTapReveal } from "@/components/versus/useTapReveal";
import { formatEffectDelta, statEffectLabel } from "@/lib/versus/statLabels";

const ITEM_BY_ID = new Map(ITEM_CATALOG.map((i) => [i.id, i]));

const NAME_BY_ID = new Map(CLUB_ROSTER.map((p) => [p.id, p.name]));

/** How long between narrative beats while the log is playing, in ms. */
const BEAT_MS = 700;

const STANCE_COLOR: Record<CombatStyle, string> = {
  Jodan: "text-blood",
  Nito: "text-steel-500",
  Chudan: "text-brass-600",
};

interface Mark {
  glyph: string;
  kind: "ippon" | "hansoku";
}

function marksFor(bout: Bout, side: Side, throughExchange: number): Mark[] {
  const marks: Mark[] = [];
  for (const exchange of bout.exchanges) {
    if (exchange.index > throughExchange) break;
    const defender: Side = exchange.initiator === "A" ? "B" : "A";

    if (exchange.outcome === "ippon" && exchange.initiator === side) {
      marks.push({ glyph: TARGET_LETTER[exchange.target], kind: "ippon" });
    }
    if (exchange.outcome === "counter" && defender === side && exchange.counterTarget) {
      marks.push({ glyph: TARGET_LETTER[exchange.counterTarget], kind: "ippon" });
    }
    if (exchange.hansoku === side) {
      marks.push({ glyph: HANSOKU_GLYPH, kind: "hansoku" });
    }
  }
  return marks;
}

/**
 * Adapted from src/components/tournament/MatchViewer.tsx for versus mode —
 * duplicated rather than sharing, since that component is wired to
 * `RoundOutcome` (solo-mode's AI-opponent framing: coachRepresentative,
 * counterPickEdge, etc.) and touching it risks the working solo-mode screen.
 * Same beat-by-beat narration playback, driven off the same `TeamMatch.log`
 * the unmodified engine already produces — nothing here re-simulates
 * anything, it only replays what the server already computed.
 */
/** Structurally compatible with both a final `TeamMatch` and the
 *  5-bouts-only `BoutProvisional` shown while a daihyosen rep is pending. */
interface DisplayMatch {
  bouts: Bout[];
  tiebreak?: Bout;
  log: MatchLogEvent[];
}

export function BoutResultBoard({
  match,
  teamAName,
  teamBName,
  augmentBadgesA,
  augmentBadgesB,
  itemEquipsA,
  itemEquipsB,
  basePlayerById,
  bonusByPlayer,
  seriesDecided,
  onContinue,
  daihyosenPending,
  replay = false,
  hideActions = false,
  continueConfirmed = false,
  onFullyRevealed,
  mySide,
  gameWinnerSide,
  rosterANames,
  rosterBNames,
}: {
  match: DisplayMatch;
  teamAName: string;
  teamBName: string;
  /** Every drafted character's name for each side, in the log's OWN
   *  vocabulary (bout.playerA/playerB.name) — used to color-code names as
   *  they appear in the narration text, not the two real players' own
   *  display names (teamAName/teamBName), which never appear in the log at
   *  all. */
  rosterANames: readonly string[];
  rosterBNames: readonly string[];
  /** Every currently-qualifying stacked augment for each side — team-wide,
   *  so the same list shows under all 5 of that side's players. */
  augmentBadgesA: EquipDisplay[];
  augmentBadgesB: EquipDisplay[];
  /** This game's locked-in equip choices, one entry per equipped player. */
  itemEquipsA: ItemEquip[];
  itemEquipsB: ItemEquip[];
  /** Raw (pre-bonus) stats and each player's total resolved bonus this
   *  game, keyed by player id — the hover breakdown's "OG stats + bonuses". */
  basePlayerById: Record<string, Player>;
  bonusByPlayer: Record<string, Partial<Record<StatPath, number>>>;
  seriesDecided: boolean;
  onContinue: () => void;
  /** Present only while the 5 regular bouts came back tied and at least one
   *  side hasn't yet picked who represents them in the decider. */
  daihyosenPending?: {
    myRoster: string[];
    myRepresentative: string | null;
    opponentRepresentative: string | null;
    onPickRepresentative: (id: string) => void;
    busy: boolean;
  };
  /** Reviewing an already-decided game (history) shows the whole log
   *  immediately instead of animating it beat by beat — same meaning as
   *  MatchViewer's own `replay` prop in solo mode. */
  replay?: boolean;
  /** Spectators get pure display: no play/pause/skip, no "Tiếp tục", no
   *  daihyosen representative picker (that's a real player's own roster
   *  choice, meaningless for someone with no side in the match) — the log
   *  just narrates on its own regardless of whether anyone's watching the
   *  controls. */
  hideActions?: boolean;
  /** This side's own "Tiếp tục" click already landed (continue_a/b on the
   *  match_games row) — swaps the button for a "waiting on the other side"
   *  message, same UX as the room lobby's own "Đã sẵn sàng, chờ đối thủ"
   *  once you've readied up but the opponent hasn't yet. The actual
   *  transition to the next game only fires once BOTH sides show true — see
   *  tran/[matchId]/page.tsx's effect watching continue_a && continue_b. */
  continueConfirmed?: boolean;
  /** Fires once the beat-by-beat narration actually reaches the end of
   *  `match.log` (not when the underlying `result`/series data becomes
   *  available in the DB — those two are NOT the same moment: the server
   *  writes the result and advances the series score the instant a game
   *  concludes, well before this component has finished revealing that
   *  game's own log to whoever's watching). A parent page showing its OWN
   *  series score or "match over" banner alongside this component must gate
   *  on this callback, not on raw match/series state, or it'll spoil the
   *  ending mid-narration — see tran/[matchId]/page.tsx and xem/page.tsx. */
  onFullyRevealed?: () => void;
  /** This viewer's own side, if they have one — undefined/null for a
   *  spectator, who has no "you" to speak of. Drives whether the outcome
   *  label below reads as a personalized "Bạn đã thắng/thua" or the neutral,
   *  side-naming form. */
  mySide?: Side | null;
  /** This GAME's own winner (not necessarily the series') — always the
   *  literal side that actually won, straight off `result.winner`, never
   *  inferred from which side is "A" or which client is asking. `null` for a
   *  draw (shouldn't happen for a resolved game, daihyosen always breaks
   *  ties, but kept optional defensively) or while undecided. */
  gameWinnerSide?: Side | null;
}) {
  const log = match.log;
  const [shown, setShown] = useState(replay ? log.length : 0);
  const [playing, setPlaying] = useState(!replay);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing || shown >= log.length) return;
    const timer = setTimeout(() => setShown((n) => n + 1), BEAT_MS);
    return () => clearTimeout(timer);
  }, [playing, shown, log.length]);

  useEffect(() => {
    if (shown >= log.length) onFullyRevealed?.();
  }, [shown, log.length, onFullyRevealed]);

  // Sets scrollTop directly on the log's own scroll container rather than
  // scrollIntoView on a sentinel — scrollIntoView can walk up and move any
  // scrollable ancestor into view, which must NOT happen now that the rest
  // of the page is deliberately non-scrolling: this must only ever move the
  // log panel's own scrollbar.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);

  const finished = shown >= log.length;
  const visible = useMemo(() => log.slice(0, shown), [log, shown]);

  const progress = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of visible) {
      if (!event.boutId) continue;
      const at = event.exchangeIndex ?? -1;
      map.set(event.boutId, Math.max(map.get(event.boutId) ?? -1, at));
    }
    return map;
  }, [visible]);

  const resolved = useMemo(() => {
    const set = new Set<string>();
    for (const event of visible) {
      if (event.kind === "bout-result" && event.boutId) set.add(event.boutId);
    }
    return set;
  }, [visible]);

  const all: Bout[] = match.tiebreak ? [...match.bouts, match.tiebreak] : match.bouts;

  const latestScore = visible.length ? (visible[visible.length - 1].score ?? { a: 0, b: 0 }) : { a: 0, b: 0 };

  return (
    <section className="flex h-full min-h-0 flex-col gap-2 sm:gap-6">
      <div className="shrink-0">
        <MatchSummary
          teamAName={teamAName}
          teamBName={teamBName}
          bouts={all}
          resolved={resolved}
          showAll={finished}
          latestScore={latestScore}
          augmentsA={augmentBadgesA}
          augmentsB={augmentBadgesB}
        />
      </div>

      {/* Everything above this row fits the viewport like the rest of the
          app — this row alone is the exception, and even within it, only
          the log panel scrolls. min-h-0 on the row/column lets THEM shrink
          below natural content height; the log panel itself instead gets a
          hard min-h floor (below) rather than min-h-0, so on a viewport
          that's genuinely too short for everything to fit (seen inside some
          in-app WebViews, where the truly available height can come in
          smaller than expected), the log never gets squeezed down to an
          unreadable sliver — the page falls back to scrolling past that
          floor instead, via main's own overflow-y-auto. */}
      <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] gap-2 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-none lg:gap-6">
        <Scoreboard
          bouts={all}
          progress={progress}
          resolved={resolved}
          showAll={finished}
          itemEquipsA={itemEquipsA}
          itemEquipsB={itemEquipsB}
          basePlayerById={basePlayerById}
          bonusByPlayer={bonusByPlayer}
        />

        <div className="flex min-h-0 flex-col gap-1.5 sm:gap-3">
          <HexPanel cut={18} className="min-h-[220px] flex-1">
            <div
              ref={logRef}
              className="flex h-full flex-col gap-1 overflow-y-auto px-3 py-2 sm:px-5 sm:py-5"
              aria-live="polite"
            >
              {visible.map((event) => (
                <LogLine key={event.id} event={event} rosterANames={rosterANames} rosterBNames={rosterBNames} />
              ))}
            </div>
          </HexPanel>

          <div className="flex shrink-0 flex-col items-center gap-2 sm:gap-3">
            {finished && gameWinnerSide && <GameOutcomeLabel mySide={mySide} gameWinnerSide={gameWinnerSide} teamAName={teamAName} teamBName={teamBName} />}
            {hideActions ? (
              finished && seriesDecided ? (
                <p className="display text-sm text-brass-600">Trận đấu đã kết thúc!</p>
              ) : null
            ) : finished ? (
              daihyosenPending ? (
                <DaihyosenPicker {...daihyosenPending} />
              ) : seriesDecided ? (
                <p className="display text-sm text-brass-600">Trận đấu đã kết thúc!</p>
              ) : continueConfirmed ? (
                <p className="display text-sm text-brass-600">Đã sẵn sàng, chờ đối thủ</p>
              ) : (
                <button
                  type="button"
                  onClick={onContinue}
                  className="hex-tab bg-brass-400 px-8 py-2 text-forest-900 transition-colors hover:bg-brass-300 sm:py-3"
                >
                  <span className="display text-sm">Tiếp tục</span>
                </button>
              )
            ) : (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setPlaying((p) => !p)}
                  className="hex-tab bg-forest-700 px-6 py-2 text-brass-300 transition-colors hover:bg-forest-600 sm:py-3"
                >
                  <span className="display text-xs">{playing ? "Tạm dừng" : "Tiếp tục"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShown(log.length)}
                  className="hex-tab bg-forest-700 px-6 py-2 text-paper transition-colors hover:bg-forest-600 sm:py-3"
                >
                  <span className="display text-xs">Bỏ qua</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * This game's own outcome, always computed from the literal winning side
 * (never hardcoded to "A") and rendered relative to whoever's actually
 * looking: a real player sees their OWN result ("Bạn đã thắng/thua ván
 * này"), independently correct on each side's own client since it compares
 * gameWinnerSide against THAT client's own mySide, not against whatever the
 * other side's screen happens to show. A spectator has no "mySide" at all,
 * so they get the neutral, absolute form instead — naming which team won,
 * no personalized Thắng/Thua wording.
 */
function GameOutcomeLabel({
  mySide,
  gameWinnerSide,
  teamAName,
  teamBName,
}: {
  mySide?: Side | null;
  gameWinnerSide: Side;
  teamAName: string;
  teamBName: string;
}) {
  if (!mySide) {
    const winnerName = gameWinnerSide === "A" ? teamAName : teamBName;
    return <p className="display text-sm text-brass-600">{winnerName} thắng ván này</p>;
  }
  const won = gameWinnerSide === mySide;
  return (
    <p className={`display text-sm ${won ? "text-brass-600" : "text-blood"}`}>
      {won ? "Bạn đã thắng ván này!" : "Bạn đã thua ván này."}
    </p>
  );
}

function DaihyosenPicker({
  myRoster,
  myRepresentative,
  opponentRepresentative,
  onPickRepresentative,
  busy,
}: {
  myRoster: string[];
  myRepresentative: string | null;
  opponentRepresentative: string | null;
  onPickRepresentative: (id: string) => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="display text-sm text-brass-600">Hòa tuyệt đối! Cần đấu đại diện quyết định.</p>
      {myRepresentative ? (
        <p className="text-xs text-bone-faint">
          Bạn đã chọn: {NAME_BY_ID.get(myRepresentative) ?? myRepresentative}
          {opponentRepresentative ? "" : " — đang chờ đối thủ chọn…"}
        </p>
      ) : (
        <>
          <p className="text-xs text-bone-faint">Chọn đại diện danh dự của bạn:</p>
          <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
            {myRoster.map((playerId) => (
              <button
                key={playerId}
                type="button"
                onClick={() => onPickRepresentative(playerId)}
                disabled={busy}
                className="hex-tab bg-brass-400 px-3 py-1.5 text-xs text-forest-900 transition-colors hover:bg-brass-300 disabled:cursor-not-allowed disabled:bg-paper-dim disabled:text-bone-faint"
              >
                {NAME_BY_ID.get(playerId) ?? playerId}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function MatchSummary({
  teamAName,
  teamBName,
  bouts,
  resolved,
  showAll,
  latestScore,
  augmentsA,
  augmentsB,
}: {
  teamAName: string;
  teamBName: string;
  bouts: Bout[];
  resolved: Set<string>;
  showAll: boolean;
  latestScore: { a: number; b: number };
  /** Every currently-qualifying stacked augment for each side — team-wide,
   *  shown once next to that side's name rather than repeated under all 5
   *  of their players (see TeamAugmentBadge). */
  augmentsA: EquipDisplay[];
  augmentsB: EquipDisplay[];
}) {
  // Gated on `resolved` (a bout-result beat actually revealed), not on how
  // far the log has narrated into a bout's exchanges — a bout's own final
  // ippon count is already fixed the instant its last SCORING exchange is
  // revealed, often several beats before its bout-result line (misses,
  // fatigue lines, hansoku warnings can still follow), so gating on
  // exchange progress let the header show a bout's outcome early. Same fix
  // shape as the win-highlight below, which already gates on `resolved`.
  const ippons = useMemo(() => {
    let a = 0;
    let b = 0;
    for (const bout of bouts) {
      if (!showAll && !resolved.has(bout.id)) continue;
      a += bout.result.ipponsA;
      b += bout.result.ipponsB;
    }
    return { a, b };
  }, [bouts, resolved, showAll]);

  return (
    <HexPanel cut={14}>
      <div className="flex items-center justify-between gap-3 px-4 py-1.5 sm:px-6 sm:py-3">
        <TeamTally name={teamAName} wins={latestScore.a} ippons={ippons.a} align="left" augments={augmentsA} />
        <span className="display shrink-0 text-xs text-brass-600 sm:text-sm">—</span>
        <TeamTally name={teamBName} wins={latestScore.b} ippons={ippons.b} align="right" augments={augmentsB} />
      </div>
    </HexPanel>
  );
}

function TeamTally({
  name,
  wins,
  ippons,
  align,
  augments,
}: {
  name: string;
  wins: number;
  ippons: number;
  align: "left" | "right";
  augments: EquipDisplay[];
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${align === "right" ? "items-end text-right" : "items-start text-left"}`}>
      <div className={`flex min-w-0 items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span className="min-w-0 truncate text-sm text-bone sm:text-base">{name}</span>
        <TeamAugmentBadge augments={augments} />
      </div>
      <span className="display text-lg text-brass-600 sm:text-xl">{wins}</span>
      <span className="text-[10px] text-bone-faint sm:text-[11px]">{ippons} ippon</span>
    </div>
  );
}

/**
 * One small clickable badge per side, next to the team name, standing in for
 * every currently-qualifying stacked augment that side has active this game
 * — team-wide, so it belongs beside the name once, not repeated under all 5
 * position boxes below. The badge's own label is the augment's name (the
 * reveal moment is right here, once the match viewer starts — see
 * AugmentBoard/ItemBoard, which keep the opponent's pick unnamed through the
 * rest of the pre-match flow); tap/click (mobile-primary) or hover opens the
 * full description + effects, same interaction as EquipBadge/EquipIcon and
 * PlayerHoverCard elsewhere on this screen. The same augment can be picked
 * more than once across the series (it stacks each time — see sumEffects in
 * versus/bout.ts), so repeats are grouped into one "×N" entry instead of
 * being listed twice.
 */
function TeamAugmentBadge({ augments }: { augments: EquipDisplay[] }) {
  const { visible, pos, triggerRef, popoverRef, triggerProps } = useTapReveal<HTMLButtonElement>();

  const grouped = useMemo(() => {
    const byName = new Map<string, { augment: EquipDisplay; count: number }>();
    for (const a of augments) {
      const existing = byName.get(a.name);
      if (existing) existing.count += 1;
      else byName.set(a.name, { augment: a, count: 1 });
    }
    return Array.from(byName.values());
  }, [augments]);

  if (grouped.length === 0) return null;

  const label = grouped.map(({ augment, count }) => (count > 1 ? `${augment.name} ×${count}` : augment.name)).join(", ");

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        {...triggerProps}
        className="max-w-[5rem] shrink truncate rounded bg-forest-700/60 px-1 py-0.5 text-[9px] text-brass-300 sm:max-w-[8rem] sm:text-[10px]"
      >
        {label}
      </button>
      {visible &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            className="hex-tab pointer-events-none fixed z-50 w-56 -translate-x-1/2 flex-col gap-1.5 bg-card px-3 py-2 text-left shadow-lg"
            style={{ top: pos.top, left: pos.left }}
          >
            {grouped.map(({ augment, count }, idx) => (
              <div key={idx} className={idx > 0 ? "mt-1.5 border-t border-brass-600/20 pt-1.5" : ""}>
                <p className="display text-xs text-brass-300">
                  {augment.name}
                  {count > 1 ? ` ×${count}` : ""}
                </p>
                <p className="text-[11px] text-bone-faint">{augment.description}</p>
                {Object.keys(augment.effects).length > 0 && (
                  <ul className="mt-0.5 flex flex-col gap-0.5">
                    {Object.entries(augment.effects).map(([path, delta]) => (
                      <li key={path} className="text-[11px] tabular-nums text-bone">
                        {formatEffectDelta(delta)} {statEffectLabel(path)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

function Scoreboard({
  bouts,
  progress,
  resolved,
  showAll,
  itemEquipsA,
  itemEquipsB,
  basePlayerById,
  bonusByPlayer,
}: {
  bouts: Bout[];
  progress: Map<string, number>;
  resolved: Set<string>;
  showAll: boolean;
  itemEquipsA: ItemEquip[];
  itemEquipsB: ItemEquip[];
  basePlayerById: Record<string, Player>;
  bonusByPlayer: Record<string, Partial<Record<StatPath, number>>>;
}) {
  return (
    <ol className="flex flex-col gap-1 sm:gap-2">
      {bouts.map((bout, row) => {
        const through = showAll ? bout.exchanges.length : (progress.get(bout.id) ?? -1);
        const started = through >= 0;
        const winner = bout.result.winner;
        const decided = showAll || resolved.has(bout.id);

        return (
          <li key={bout.id} className="flex items-stretch gap-1 sm:gap-2">
            {/* Aka/shiro (red/white) sash markers, real-kendo convention —
                purely decorative side identifiers, one per position box, so
                they sit outside the box rather than stretching with it. */}
            <span
              aria-hidden
              className="h-3 w-1.5 shrink-0 self-center rounded-full bg-blood sm:h-3.5 sm:w-2"
            />
            <SideBlock
              index={row + 1}
              bout={bout}
              side="A"
              through={through}
              started={started}
              highlight={decided && winner === "A"}
              itemEquips={itemEquipsA}
              basePlayerById={basePlayerById}
              bonusByPlayer={bonusByPlayer}
            />
            <div className="flex w-9 shrink-0 flex-col items-center justify-center sm:w-12">
              <span className="display text-[10px] text-brass-600 sm:text-[11px]">{bout.daihyosen ? "DH" : "VS"}</span>
              <span className="text-[9px] leading-tight text-bone-faint sm:text-[10px]">
                {bout.daihyosen ? "" : bout.position}
              </span>
            </div>
            <SideBlock
              index={row + 6}
              bout={bout}
              side="B"
              through={through}
              started={started}
              highlight={decided && winner === "B"}
              mirrored
              itemEquips={itemEquipsB}
              basePlayerById={basePlayerById}
              bonusByPlayer={bonusByPlayer}
            />
            <span
              aria-hidden
              className="h-3 w-1.5 shrink-0 self-center rounded-full border-2 border-forest-900 bg-[#ffffff] sm:h-3.5 sm:w-2"
            />
          </li>
        );
      })}
    </ol>
  );
}

function SideBlock({
  index,
  bout,
  side,
  through,
  started,
  highlight,
  mirrored = false,
  itemEquips,
  basePlayerById,
  bonusByPlayer,
}: {
  index: number;
  bout: Bout;
  side: Side;
  through: number;
  started: boolean;
  highlight: boolean;
  mirrored?: boolean;
  itemEquips: ItemEquip[];
  basePlayerById: Record<string, Player>;
  bonusByPlayer: Record<string, Partial<Record<StatPath, number>>>;
}) {
  const player = side === "A" ? bout.playerA : bout.playerB;
  const marks = started ? marksFor(bout, side, through) : [];
  const equippedItem = itemEquips.find((eq) => eq.targetPlayerId === player.id);
  const itemBadge = equippedItem ? ITEM_BY_ID.get(equippedItem.itemId) : undefined;
  const badges: EquipDisplay[] = itemBadge
    ? [{ name: itemBadge.name, description: itemBadge.description, effects: itemBadge.effects, icon: itemBadge.icon }]
    : [];
  const base = basePlayerById[player.id];

  return (
    <HexPanel
      className="min-w-0 flex-1"
      cut={12}
      frameClassName={highlight ? "bg-brass-400/80" : "bg-forest-700/30"}
      bodyClassName={started ? "bg-card" : "bg-paper-dim"}
    >
      <div
        className={`flex h-full min-w-0 flex-col gap-0.5 px-2 py-0.5 sm:gap-1 sm:px-3 sm:py-2 ${
          mirrored ? "items-end text-right" : "items-start text-left"
        }`}
      >
        <div className={`flex w-full min-w-0 items-baseline gap-1.5 sm:gap-2 ${mirrored ? "flex-row-reverse" : ""}`}>
          <span className="display shrink-0 text-[10px] text-brass-600 sm:text-[11px]">{index}</span>
          {base ? (
            <PlayerHoverCard
              className="min-w-0 text-[13px] leading-tight text-bone sm:text-sm"
              name={player.name}
              base={base}
              bonus={bonusByPlayer[player.id] ?? {}}
            />
          ) : (
            <span className="min-w-0 text-[13px] leading-tight text-bone sm:text-sm">{player.name}</span>
          )}
          <PassiveBadge playerId={player.id} />
        </div>
        <div className={`flex min-h-4 flex-wrap items-center gap-1 sm:min-h-6 ${mirrored ? "justify-end" : ""}`}>
          {badges.map((b, idx) => (
            <EquipIcon key={idx} equip={b} />
          ))}
          {marks.length === 0 ? (
            <span className="text-[10px] text-bone-faint sm:text-[11px]">{started ? "—" : "chưa đấu"}</span>
          ) : (
            marks.map((mark, i) => (
              <span
                key={i}
                className={`display flex h-4 w-4 items-center justify-center text-[10px] sm:h-5 sm:w-5 sm:text-[11px] ${
                  mark.kind === "hansoku" ? "bg-blood/80 text-paper" : "bg-brass-400 text-forest-900"
                }`}
                title={mark.kind === "hansoku" ? "Hansoku" : "Ippon"}
              >
                {mark.glyph}
              </span>
            ))
          )}
        </div>
      </div>
    </HexPanel>
  );
}

/** Escapes a name for safe use inside a RegExp alternation. */
function escapeForRegex(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Colors each drafted character's name wherever it appears in a log line —
 * green for side A's roster, red for side B's — so a line naming both an
 * attacker and a defender (e.g. a counter-ippon beat) still reads correctly
 * at a glance regardless of which side the line's own overall `tone` favors.
 * Longest names are matched first so one name can never accidentally
 * swallow a shorter one that happens to be a substring of it.
 */
function highlightNames(text: string, rosterANames: readonly string[], rosterBNames: readonly string[]) {
  const aSet = new Set(rosterANames);
  const bSet = new Set(rosterBNames);
  const all = Array.from(new Set([...rosterANames, ...rosterBNames])).sort((a, b) => b.length - a.length);
  if (all.length === 0) return text;

  const regex = new RegExp(`(${all.map(escapeForRegex).join("|")})`, "g");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    aSet.has(part) ? (
      <span key={i} className="text-forest-500 font-medium">
        {part}
      </span>
    ) : bSet.has(part) ? (
      <span key={i} className="text-blood font-medium">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function LogLine({
  event,
  rosterANames,
  rosterBNames,
}: {
  event: MatchLogEvent;
  rosterANames: readonly string[];
  rosterBNames: readonly string[];
}) {
  const hl = (text: string) => highlightNames(text, rosterANames, rosterBNames);

  if (event.kind === "banner") {
    const tone =
      event.side === "A" ? "bg-brass-400 text-forest-900" : event.side === "B" ? "bg-blood text-paper" : "bg-forest-600 text-paper";
    return <p className={`hex-tab display mt-3 px-4 py-2 text-center text-base ${tone}`}>{hl(event.text)}</p>;
  }

  if (event.kind === "match-header") {
    return <p className="display border-b border-brass-600/30 pb-2 text-sm text-brass-600">{hl(event.text)}</p>;
  }

  if (event.kind === "bout-start") {
    return <p className="display mt-3 text-sm text-brass-600">{hl(event.text)}</p>;
  }

  if (event.kind === "stance" && event.stance) {
    const word = event.stance.toUpperCase();
    const [before] = event.text.split(word);
    return (
      <p className="pl-3 text-sm leading-relaxed text-bone-dim">
        <span className="text-brass-600">— </span>
        {hl(before)}
        <span className={`display font-bold ${STANCE_COLOR[event.stance]}`}>{word}</span>
      </p>
    );
  }

  if (event.kind === "passive") {
    return (
      <p className="hex-tab display mt-1 mb-1 ml-3 w-fit bg-brass-300 px-2 py-0.5 text-xs text-forest-900">
        {event.text}
      </p>
    );
  }

  if (event.kind === "bout-result") {
    const tone = event.side === "A" ? "text-brass-600" : event.side === "B" ? "text-blood" : "text-bone-dim";
    return <p className={`mt-1 mb-1 pl-3 text-sm font-semibold ${tone}`}>{hl(event.text)}</p>;
  }

  const tone = event.side === "A" ? "text-bone" : event.side === "B" ? "text-bone-dim" : "text-bone-faint";
  return (
    <p className={`pl-3 text-sm leading-relaxed ${tone}`}>
      <span className="text-brass-600">— </span>
      {hl(event.text)}
    </p>
  );
}
