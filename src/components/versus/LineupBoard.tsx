"use client";

import { useState } from "react";
import { HexPanel } from "@/components/Hex";
import { CLUB_ROSTER } from "@/data/club";
import { ITEM_CATALOG } from "@/data/items";
import { POSITIONS, type Position, type Lineup } from "@/lib/kendo/types";
import type { Player, StatPath } from "@/lib/kendo";
import type { DraftSide, ItemEquip, MatchGameRow } from "@/lib/versus/draft";
import { DndBoard, DraggableCard, DropZone } from "@/components/versus/dnd";
import { EquipBadge, type EquipDisplay } from "@/components/versus/EquipBadge";
import { PlayerHoverCard } from "@/components/versus/PlayerHoverCard";

const NAME_BY_ID = new Map(CLUB_ROSTER.map((p) => [p.id, p.name]));
const ITEM_BY_ID = new Map(ITEM_CATALOG.map((i) => [i.id, i]));

function toLineup(assignment: Record<Position, string>): Lineup {
  return POSITIONS.reduce((acc, position) => {
    acc[position.toLowerCase() as Lowercase<Position>] = assignment[position];
    return acc;
  }, {} as Lineup);
}

function itemEquipDisplay(itemId: string): EquipDisplay | null {
  const item = ITEM_BY_ID.get(itemId);
  return item ? { name: item.name, description: item.description, effects: item.effects, icon: item.icon } : null;
}

/**
 * Renders one game's position assignment. Unlike the draft/augment/item
 * boards, arranging here never hits the server — dragging is pure local
 * state, so there's nothing for the opponent to see until "Chốt đội hình"
 * sends the whole thing at once. No AI counter-pick exists in versus mode
 * (real player vs. real player), so unlike solo mode this is just each side
 * freely arranging their own five, independently.
 *
 * Also where items get (re-)equipped every game: drag any item from the
 * side's whole accumulated, non-consumable inventory onto one of this
 * game's 5 position cards — nothing is spent, the same item is just as
 * available again next game. Submitted together with the lineup on
 * "Chốt đội hình", one combined write, same lock-in moment for both.
 */
export function LineupBoard({
  gameId,
  myRoster,
  myLineup,
  opponentRoster,
  opponentLineup,
  augmentBadges,
  inventory,
  confirmedEquips,
  basePlayerById,
  augmentBonusByPlayer,
  opponentName,
  onGameUpdate,
}: {
  gameId: string;
  myRoster: string[];
  myLineup: Lineup | null;
  opponentRoster: string[];
  opponentLineup: Lineup | null;
  /** Every currently-qualifying stacked augment for this side — team-wide,
   *  so the same list shows under all 5 players. */
  augmentBadges: EquipDisplay[];
  /** This side's whole accumulated, non-consumable item inventory. */
  inventory: string[];
  /** This game's locked-in equip choices, once confirmed — empty before. */
  confirmedEquips: ItemEquip[];
  /** Raw (pre-bonus) stats, keyed by player id, for the hover breakdown. */
  basePlayerById: Record<string, Player>;
  /** This side's augment-only bonus per player (items layer on top locally
   *  while still arranging, since they aren't committed yet). */
  augmentBonusByPlayer: Record<string, Partial<Record<StatPath, number>>>;
  mySide: DraftSide;
  opponentName: string;
  onGameUpdate: (row: MatchGameRow) => void;
}) {
  const [assignment, setAssignment] = useState<Record<Position, string>>(() => {
    const initial = {} as Record<Position, string>;
    POSITIONS.forEach((position, i) => {
      initial[position] = myRoster[i];
    });
    return initial;
  });
  // playerId -> itemId, local until "Chốt đội hình" — mirrors how position
  // assignment itself stays local until confirm.
  const [equips, setEquips] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDrop = (draggedId: string, targetPositionId: string) => {
    const toPosition = targetPositionId as Position;
    if (myRoster.includes(draggedId)) {
      setAssignment((current) => {
        const fromPosition = POSITIONS.find((position) => current[position] === draggedId);
        if (!fromPosition || fromPosition === toPosition) return current;
        return { ...current, [fromPosition]: current[toPosition], [toPosition]: draggedId };
      });
      return;
    }
    if (inventory.includes(draggedId)) {
      const targetPlayerId = assignment[toPosition];
      setEquips((current) => {
        const next: Record<string, string> = {};
        // Each physical item can only be in one place at once — drop the
        // old assignment if this same item was equipped elsewhere.
        for (const [playerId, itemId] of Object.entries(current)) {
          if (itemId !== draggedId) next[playerId] = itemId;
        }
        next[targetPlayerId] = draggedId; // max one item per player — overwrites
        return next;
      });
    }
  };

  const unequip = (playerId: string) => {
    setEquips((current) => {
      const next = { ...current };
      delete next[playerId];
      return next;
    });
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/games/${gameId}/lineup/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lineup: toLineup(assignment),
        equips: Object.entries(equips).map(([targetPlayerId, itemId]) => ({ itemId, targetPlayerId })),
      }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok && body) onGameUpdate(body as MatchGameRow);
    if (!res.ok) setError(body?.error ?? "Có lỗi xảy ra, thử lại.");
  };

  function badgesFor(playerId: string, itemId: string | undefined): EquipDisplay[] {
    const badges = [...augmentBadges];
    if (itemId) {
      const item = itemEquipDisplay(itemId);
      if (item) badges.push(item);
    }
    return badges;
  }

  function bonusFor(playerId: string, itemId: string | undefined): Partial<Record<StatPath, number>> {
    const bonus = { ...(augmentBonusByPlayer[playerId] ?? {}) };
    if (itemId) {
      const item = ITEM_BY_ID.get(itemId);
      if (item) {
        for (const [path, delta] of Object.entries(item.effects)) {
          bonus[path as StatPath] = (bonus[path as StatPath] ?? 0) + (delta ?? 0);
        }
      }
    }
    return bonus;
  }

  if (myLineup) {
    return (
      <section className="flex flex-col gap-4 sm:gap-6">
        <HexPanel cut={14}>
          <div className="px-4 py-3 text-center">
            <p className="display text-xs text-brass-600">Đội hình</p>
            <p className="text-sm text-bone-faint">Bạn đã chốt đội hình.</p>
          </div>
        </HexPanel>
        <ol className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-5">
          {POSITIONS.map((position, i) => {
            const playerId = myLineup[position.toLowerCase() as Lowercase<Position>];
            const equipped = confirmedEquips.find((eq) => eq.targetPlayerId === playerId)?.itemId;
            const base = basePlayerById[playerId];
            return (
              <li key={position}>
                <HexPanel cut={14}>
                  <div className="flex flex-col items-center gap-1 px-2 py-2.5 text-center sm:px-4 sm:py-6">
                    <span className="display text-[10px] text-brass-600 sm:text-xs">
                      {i + 1} · {position}
                    </span>
                    {base ? (
                      <PlayerHoverCard
                        className="display text-xs text-bone sm:text-base"
                        name={NAME_BY_ID.get(playerId) ?? playerId}
                        base={base}
                        bonus={bonusFor(playerId, equipped)}
                      />
                    ) : (
                      <span className="display text-xs text-bone sm:text-base">{NAME_BY_ID.get(playerId) ?? playerId}</span>
                    )}
                    <div className="flex flex-wrap justify-center gap-0.5">
                      {badgesFor(playerId, equipped).map((b, idx) => (
                        <EquipBadge key={idx} equip={b} />
                      ))}
                    </div>
                  </div>
                </HexPanel>
              </li>
            );
          })}
        </ol>
        <HexPanel cut={12}>
          <div className="px-4 py-3 text-center">
            <p className="display text-xs text-brass-600">{opponentName}</p>
            <p className="text-sm text-bone-faint">
              {opponentLineup ? "Đã chốt đội hình." : "Đang xếp đội hình…"}
            </p>
            <OpponentRosterList roster={opponentRoster} />
          </div>
        </HexPanel>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 sm:gap-6">
      <HexPanel cut={14}>
        <div className="px-4 py-3 text-center">
          <p className="display text-xs text-brass-600">Xếp đội hình</p>
          <p className="text-sm text-bone-faint">
            Kéo thả để đổi vị trí, hoặc kéo vật phẩm từ kho đồ vào vận động viên, rồi chốt đội hình.
          </p>
        </div>
      </HexPanel>

      {error && <p className="text-center text-xs text-blood">{error}</p>}

      <DndBoard disabled={busy} onDrop={handleDrop}>
        <ol className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-5">
          {POSITIONS.map((position, i) => {
            const playerId = assignment[position];
            const equipped = equips[playerId];
            const base = basePlayerById[playerId];
            return (
              <li key={position}>
                <DropZone id={position} activeClassName="ring-2 ring-brass-300">
                  <DraggableCard id={playerId} label={NAME_BY_ID.get(playerId) ?? playerId} disabled={busy}>
                    <HexPanel cut={14}>
                      <div className="flex flex-col items-center gap-1 px-2 py-2.5 text-center sm:px-4 sm:py-6">
                        <span className="display text-[10px] text-brass-600 sm:text-xs">
                          {i + 1} · {position}
                        </span>
                        {base ? (
                          <PlayerHoverCard
                            className="display text-xs text-bone sm:text-base"
                            name={NAME_BY_ID.get(playerId) ?? playerId}
                            base={base}
                            bonus={bonusFor(playerId, equipped)}
                          />
                        ) : (
                          <span className="display text-xs text-bone sm:text-base">{NAME_BY_ID.get(playerId) ?? playerId}</span>
                        )}
                        <div className="flex flex-wrap justify-center gap-0.5">
                          {augmentBadges.map((b, idx) => (
                            <EquipBadge key={`aug-${idx}`} equip={b} />
                          ))}
                          {equipped &&
                            (() => {
                              const itemBadge = itemEquipDisplay(equipped);
                              return (
                                itemBadge && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      unequip(playerId);
                                    }}
                                    title="Bỏ trang bị"
                                  >
                                    <EquipBadge equip={itemBadge} />
                                  </button>
                                )
                              );
                            })()}
                        </div>
                      </div>
                    </HexPanel>
                  </DraggableCard>
                </DropZone>
              </li>
            );
          })}
        </ol>

        {inventory.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            <p className="display text-center text-[11px] text-brass-600">Kho đồ (kéo thả để trang bị)</p>
            <ul className="flex flex-wrap justify-center gap-2">
              {inventory.map((itemId) => {
                const item = ITEM_BY_ID.get(itemId);
                const equippedTo = Object.entries(equips).find(([, id]) => id === itemId)?.[0];
                return (
                  <li key={itemId}>
                    <DraggableCard id={itemId} label={item?.name ?? itemId} disabled={busy}>
                      <div className="hex-tab flex items-center gap-1.5 bg-brass-400 px-2.5 py-1.5 text-forest-900">
                        {item && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/items/${item.icon}`} alt="" className="h-5 w-5 shrink-0" />
                        )}
                        <span className="text-xs">{item?.name ?? itemId}</span>
                        {equippedTo && (
                          <span className="text-[10px] opacity-70">→ {NAME_BY_ID.get(equippedTo) ?? equippedTo}</span>
                        )}
                      </div>
                    </DraggableCard>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </DndBoard>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={confirm}
          disabled={busy}
          className="hex-tab bg-brass-400 px-8 py-3 text-forest-900 transition-colors hover:bg-brass-300 disabled:cursor-not-allowed disabled:bg-paper-dim disabled:text-bone-faint"
        >
          <span className="display text-sm">Chốt đội hình</span>
        </button>
      </div>

      <HexPanel cut={12}>
        <div className="px-4 py-3 text-center">
          <p className="display text-xs text-brass-600">{opponentName}</p>
          <p className="text-sm text-bone-faint">
            {opponentLineup ? "Đã chốt đội hình." : "Đang xếp đội hình…"}
          </p>
          <OpponentRosterList roster={opponentRoster} />
        </div>
      </HexPanel>
    </section>
  );
}

/** The draft itself is fully public — both players watch every pick happen
 *  live — so the opponent's 5 drafted names are already common knowledge by
 *  the time this screen shows. Plain, unsorted, no position info: position
 *  assignment is what's still private until they confirm. */
function OpponentRosterList({ roster }: { roster: string[] }) {
  if (roster.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-xs text-bone-dim">
      {roster.map((playerId) => (
        <li key={playerId}>{NAME_BY_ID.get(playerId) ?? playerId}</li>
      ))}
    </ul>
  );
}
