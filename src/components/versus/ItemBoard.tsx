"use client";

import { useState } from "react";
import { HexPanel } from "@/components/Hex";
import { ITEM_CATALOG } from "@/data/items";
import type { DraftSide, MatchGameRow } from "@/lib/versus/draft";
import { formatEffectDelta, statEffectLabel } from "@/lib/versus/statLabels";

const ITEM_BY_ID = new Map(ITEM_CATALOG.map((i) => [i.id, i]));

/** Mirrors AugmentBoard's EffectBreakdown — same vocabulary as the Kendoka
 *  stats page, shown right on the pick card. */
function EffectBreakdown({ effects }: { effects: Record<string, number> }) {
  const entries = Object.entries(effects);
  if (entries.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] opacity-80">
      {entries.map(([path, delta]) => (
        <li key={path} className="whitespace-nowrap tabular-nums">
          {formatEffectDelta(delta)} {statEffectLabel(path)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Renders one game's item round (games 2, 4 only) — choosing one of 3
 * offered items to add to the side's permanent, non-consumable inventory.
 * Picking no longer equips anyone: which of the accumulated inventory (this
 * pick included, once locked in) actually goes on which of this game's 5
 * drafted players is a separate choice made at lineup time, every game (see
 * LineupBoard's equip drag zone) — so this screen is now just a plain
 * offer-and-pick, the same shape as AugmentBoard, not a drag-and-drop one.
 * Same reveal timing as AugmentBoard too: the opponent's pick identity stays
 * hidden here even after they lock in (just "đã chọn"), only becoming
 * visible once the match viewer itself starts.
 */
export function ItemBoard({
  gameId,
  itemPickA,
  itemPickB,
  myOffer,
  mySide,
  opponentName,
  onGameUpdate,
}: {
  gameId: string;
  itemPickA: string | null;
  itemPickB: string | null;
  myOffer: string[] | null | undefined;
  mySide: DraftSide;
  opponentName: string;
  onGameUpdate: (row: MatchGameRow) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const myPickId = mySide === "A" ? itemPickA : itemPickB;
  const oppPickId = mySide === "A" ? itemPickB : itemPickA;

  const pick = async (itemId: string) => {
    if (busy || myPickId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/games/${gameId}/items/pick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok && body) onGameUpdate(body as MatchGameRow);
    if (!res.ok) setError(body?.error ?? "Có lỗi xảy ra, thử lại.");
  };

  return (
    <section className="flex flex-col gap-4 sm:gap-6">
      <HexPanel cut={14}>
        <div className="flex flex-col items-center gap-1 px-4 py-3 text-center sm:py-4">
          <p className="display text-xs text-brass-600">Vòng trang bị</p>
          <p className="text-xs text-bone-faint">Vật phẩm chọn ở đây sẽ vào kho đồ, dùng được mọi ván sau này.</p>
        </div>
      </HexPanel>

      {error && <p className="text-center text-xs text-blood">{error}</p>}

      {myPickId ? (
        <HexPanel cut={12}>
          <div className="flex flex-col items-center gap-1 px-4 py-3 text-center">
            <p className="display text-xs text-brass-600">Bạn đã chọn</p>
            <p className="display text-sm text-bone">{ITEM_BY_ID.get(myPickId)?.name ?? myPickId}</p>
            {ITEM_BY_ID.get(myPickId) && <EffectBreakdown effects={ITEM_BY_ID.get(myPickId)!.effects} />}
          </div>
        </HexPanel>
      ) : myOffer && myOffer.length > 0 ? (
        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
          {myOffer.map((itemId) => {
            const item = ITEM_BY_ID.get(itemId);
            return (
              <li key={itemId}>
                <button
                  type="button"
                  onClick={() => pick(itemId)}
                  disabled={busy}
                  className="hex-tab flex w-full items-center gap-3 bg-brass-400 px-4 py-3 text-left text-forest-900 transition-colors hover:bg-brass-300 disabled:cursor-not-allowed disabled:bg-paper-dim disabled:text-bone-faint"
                >
                  {item && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/items/${item.icon}`} alt="" className="h-8 w-8 shrink-0" />
                  )}
                  <span className="flex flex-col gap-1">
                    <span className="display text-sm">{item?.name ?? itemId}</span>
                    <span className="text-xs opacity-80">{item?.description ?? ""}</span>
                    {item && <EffectBreakdown effects={item.effects} />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-center text-sm text-bone-faint">Đang tải lựa chọn…</p>
      )}

      <HexPanel cut={12}>
        <div className="flex flex-col items-center gap-1 px-4 py-3 text-center">
          <p className="display text-xs text-brass-600">{opponentName}</p>
          <p className="display text-sm text-bone">
            {oppPickId ? "Đã chọn" : <span className="text-bone-faint">Đang chọn…</span>}
          </p>
        </div>
      </HexPanel>
    </section>
  );
}
