"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HexPanel } from "@/components/Hex";
import {
  HANSOKU_GLYPH,
  TARGET_LETTER,
  type Bout,
  type CombatStyle,
  type MatchLogEvent,
  type RoundOutcome,
  type Side,
} from "@/lib/kendo";

/** How long between narrative beats while the log is playing, in ms. */
const BEAT_MS = 700;

/**
 * Stance colours, keyed by the stance itself so a bout-start announcement and
 * a mid-bout switch into the same stance always look identical.
 */
const STANCE_COLOR: Record<CombatStyle, string> = {
  Jodan: "text-blood",
  Nito: "text-steel-300",
  Chudan: "text-brass-300",
};

/** One glyph earned during a bout, in the order it happened. */
interface Mark {
  glyph: string;
  kind: "ippon" | "hansoku";
}

/**
 * Marks each side has earned up to and including `throughExchange`.
 * Ippons show as the technique letter; hansoku shows as a triangle against the
 * player who committed it.
 */
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

export function MatchViewer({
  outcome,
  onDone,
  replay = false,
}: {
  outcome: RoundOutcome;
  onDone: () => void;
  /** Reviewing a finished round shows the whole log immediately. */
  replay?: boolean;
}) {
  const log = outcome.match.log;
  const [shown, setShown] = useState(replay ? log.length : 0);
  const [playing, setPlaying] = useState(!replay);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing || shown >= log.length) return;
    const timer = setTimeout(() => setShown((n) => n + 1), BEAT_MS);
    return () => clearTimeout(timer);
  }, [playing, shown, log.length]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [shown]);

  const finished = shown >= log.length;
  const visible = useMemo(() => log.slice(0, shown), [log, shown]);

  /** How far the log has narrated into each bout, keyed by bout id. */
  const progress = useMemo(() => {
    const map = new Map<string, number>();
    for (const event of visible) {
      if (!event.boutId) continue;
      const at = event.exchangeIndex ?? -1;
      map.set(event.boutId, Math.max(map.get(event.boutId) ?? -1, at));
    }
    return map;
  }, [visible]);

  const all: Bout[] = outcome.match.tiebreak
    ? [...outcome.match.bouts, outcome.match.tiebreak]
    : outcome.match.bouts;

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col items-center gap-1 text-center">
        <p className="display text-xs text-brass-400">{outcome.round.label}</p>
        <h2 className="display text-lg text-bone sm:text-2xl">
          {outcome.match.teamA.name}
          <span className="px-2 text-brass-400 sm:px-3">gặp</span>
          {outcome.match.teamB.name}
        </h2>
      </header>

      {/* Below lg the two panes stack: scoreboard first, then the log. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-6">
        <Scoreboard bouts={all} progress={progress} showAll={finished} />

        <div className="flex flex-col gap-3">
          <HexPanel cut={18}>
            <div
              className="flex h-[236px] flex-col gap-1 overflow-y-auto px-3 py-3 sm:h-[420px] sm:px-5 sm:py-5"
              aria-live="polite"
            >
              {visible.map((event) => (
                <LogLine key={event.id} event={event} />
              ))}
              <div ref={endRef} />
            </div>
          </HexPanel>

          <div className="flex justify-center gap-3">
            {finished ? (
              <button
                type="button"
                onClick={onDone}
                className="hex-tab bg-brass-400 px-8 py-3 text-forest-900 transition-colors hover:bg-brass-300"
              >
                <span className="display text-sm">Tiếp tục</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setPlaying((p) => !p)}
                  className="hex-tab bg-forest-700 px-6 py-3 text-brass-300 transition-colors hover:bg-forest-600"
                >
                  <span className="display text-xs">{playing ? "Tạm dừng" : "Tiếp tục"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShown(log.length)}
                  className="hex-tab bg-forest-700 px-6 py-3 text-bone-dim transition-colors hover:bg-forest-600"
                >
                  <span className="display text-xs">Bỏ qua</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Two facing columns: coach 1-5 on the left, opponent 6-10 on the right. */
function Scoreboard({
  bouts,
  progress,
  showAll,
}: {
  bouts: Bout[];
  progress: Map<string, number>;
  showAll: boolean;
}) {
  return (
    <ol className="flex flex-col gap-2">
      {bouts.map((bout, row) => {
        const through = showAll
          ? bout.exchanges.length
          : (progress.get(bout.id) ?? -1);
        const started = through >= 0;
        const winner = bout.result.winner;
        const decided = showAll || progress.has(bout.id);

        return (
          <li key={bout.id} className="flex items-stretch gap-1 sm:gap-2">
            <SideBlock
              index={row + 1}
              bout={bout}
              side="A"
              through={through}
              started={started}
              highlight={decided && winner === "A"}
            />
            <div className="flex w-9 shrink-0 flex-col items-center justify-center sm:w-12">
              <span className="display text-[10px] text-brass-400 sm:text-[11px]">
                {bout.daihyosen ? "DH" : "VS"}
              </span>
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
}: {
  index: number;
  bout: Bout;
  side: Side;
  through: number;
  started: boolean;
  highlight: boolean;
  mirrored?: boolean;
}) {
  const player = side === "A" ? bout.playerA : bout.playerB;
  const marks = started ? marksFor(bout, side, through) : [];

  return (
    <HexPanel
      className="min-w-0 flex-1"
      cut={12}
      frameClassName={highlight ? "bg-brass-400/80" : "bg-brass-600/30"}
      bodyClassName={started ? "bg-forest-800" : "bg-forest-900"}
    >
      <div
        className={`flex h-full min-w-0 flex-col gap-0.5 px-2 py-1.5 sm:gap-1 sm:px-3 sm:py-2 ${
          mirrored ? "items-end text-right" : "items-start text-left"
        }`}
      >
        <div
          className={`flex w-full min-w-0 items-baseline gap-1.5 sm:gap-2 ${
            mirrored ? "flex-row-reverse" : ""
          }`}
        >
          <span className="display shrink-0 text-[10px] text-brass-400 sm:text-[11px]">
            {index}
          </span>
          {/* Wrapping beats an ellipsis here: a clipped name is unreadable in
              a narrow block, and rows size themselves independently. */}
          <span className="min-w-0 text-[13px] leading-tight text-bone sm:text-sm">
            {player.name}
          </span>
        </div>
        <div className={`flex min-h-5 flex-wrap gap-1 sm:min-h-6 ${mirrored ? "justify-end" : ""}`}>
          {marks.length === 0 ? (
            <span className="text-[10px] text-bone-faint sm:text-[11px]">
              {started ? "—" : "chưa đấu"}
            </span>
          ) : (
            marks.map((mark, i) => (
              <span
                key={i}
                className={`display flex h-4 w-4 items-center justify-center text-[10px] sm:h-5 sm:w-5 sm:text-[11px] ${
                  mark.kind === "hansoku"
                    ? "bg-blood/80 text-bone"
                    : "bg-brass-400 text-forest-900"
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

function LogLine({ event }: { event: MatchLogEvent }) {
  if (event.kind === "banner") {
    const tone =
      event.side === "A"
        ? "bg-brass-400 text-forest-900"
        : event.side === "B"
          ? "bg-blood text-bone"
          : "bg-forest-600 text-bone";
    return (
      <p className={`hex-tab display mt-3 px-4 py-2 text-center text-base ${tone}`}>
        {event.text}
      </p>
    );
  }

  if (event.kind === "match-header") {
    return (
      <p className="display border-b border-brass-600/30 pb-2 text-sm text-brass-300">
        {event.text}
      </p>
    );
  }

  if (event.kind === "bout-start") {
    return <p className="display mt-3 text-sm text-brass-400">{event.text}</p>;
  }

  // One source of truth for stance colour, shared by the bout-start
  // announcement and the mid-bout switch.
  if (event.kind === "stance" && event.stance) {
    const word = event.stance.toUpperCase();
    const [before] = event.text.split(word);
    return (
      <p className="pl-3 text-sm leading-relaxed text-bone-dim">
        <span className="text-brass-600">— </span>
        {before}
        <span className={`display font-bold ${STANCE_COLOR[event.stance]}`}>{word}</span>
      </p>
    );
  }

  if (event.kind === "bout-result") {
    const tone =
      event.side === "A" ? "text-brass-300" : event.side === "B" ? "text-blood" : "text-bone-dim";
    return <p className={`mt-1 mb-1 pl-3 text-sm font-semibold ${tone}`}>{event.text}</p>;
  }

  const tone =
    event.side === "A" ? "text-bone" : event.side === "B" ? "text-bone-dim" : "text-bone-faint";
  return (
    <p className={`pl-3 text-sm leading-relaxed ${tone}`}>
      <span className="text-brass-600">— </span>
      {event.text}
    </p>
  );
}
