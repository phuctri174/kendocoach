"use client";

import { useState } from "react";
import { BoutResultBoard } from "@/components/versus/BoutResultBoard";
import type { EquipDisplay } from "@/components/versus/EquipBadge";
import type { ItemEquip, DraftSide } from "@/lib/versus/draft";
import type { Player, StatPath, TeamMatch } from "@/lib/kendo";

export interface HistoryGameEntry {
  gameNumber: number;
  winnerSide: DraftSide | null;
  match: TeamMatch;
  augmentBadgesA: EquipDisplay[];
  augmentBadgesB: EquipDisplay[];
  itemEquipsA: ItemEquip[];
  itemEquipsB: ItemEquip[];
  basePlayerById: Record<string, Player>;
  bonusByPlayer: Record<string, Partial<Record<StatPath, number>>>;
}

function noop() {}

/**
 * The list page is the "which round" step (same role as solo mode's bracket
 * path); this is the "detail" step — a tab per game in the series, each
 * replaying that game's full narration immediately (BoutResultBoard's
 * `replay` mode) rather than animating beat by beat, same reasoning as solo
 * mode's own "Xem lại" replay.
 */
export function MatchHistoryDetail({
  entries,
  teamAName,
  teamBName,
}: {
  entries: HistoryGameEntry[];
  teamAName: string;
  teamBName: string;
}) {
  const [selected, setSelected] = useState(entries[entries.length - 1]?.gameNumber ?? 1);
  const entry = entries.find((e) => e.gameNumber === selected) ?? entries[0];

  if (!entry) {
    return <p className="text-center text-sm text-bone-faint">Không có dữ liệu ván đấu nào.</p>;
  }

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <ol className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
        {entries.map((e) => {
          const active = e.gameNumber === selected;
          const label =
            e.winnerSide === null ? `Ván ${e.gameNumber}` : e.winnerSide === "A" ? `Ván ${e.gameNumber} · ${teamAName}` : `Ván ${e.gameNumber} · ${teamBName}`;
          return (
            <li key={e.gameNumber}>
              <button
                type="button"
                onClick={() => setSelected(e.gameNumber)}
                aria-pressed={active}
                className={`hex-tab display px-3 py-1.5 text-[10px] transition-colors sm:px-4 sm:text-[11px] ${
                  active
                    ? "bg-brass-400 text-forest-900"
                    : "bg-forest-700 text-paper hover:bg-forest-600 hover:text-brass-200"
                }`}
              >
                {label}
              </button>
            </li>
          );
        })}
      </ol>

      <BoutResultBoard
        key={entry.gameNumber}
        match={entry.match}
        teamAName={teamAName}
        teamBName={teamBName}
        augmentBadgesA={entry.augmentBadgesA}
        augmentBadgesB={entry.augmentBadgesB}
        itemEquipsA={entry.itemEquipsA}
        itemEquipsB={entry.itemEquipsB}
        basePlayerById={entry.basePlayerById}
        bonusByPlayer={entry.bonusByPlayer}
        seriesDecided
        onContinue={noop}
        replay
      />
    </div>
  );
}
