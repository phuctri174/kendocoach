"use client";

import { createPortal } from "react-dom";
import { STAT_PATHS, readStat, type Player } from "@/lib/kendo";
import type { StatPath } from "@/lib/kendo/types";
import { STAT_LABELS } from "@/lib/versus/statLabels";
import { useTapReveal } from "@/components/versus/useTapReveal";

/**
 * Wraps a player's displayed name with a detail card breaking down every
 * stat as base value + any augment/item/passive bonus, colored green (helps
 * them) or red (hurts them) — e.g. "Men (đòn đánh) 92 +5" in green. `base` is
 * the player's raw, unmodified stats (before any augment/item/passive);
 * `bonus` is the already-summed STATIC total delta for this one player this
 * game (their own side's qualifying augments, any opp. crossover landing on
 * them, their own equipped item, and category-A passive effects — see
 * resolvePlayerBonuses in versus/bout.ts). `liveBonus`, separately, is
 * whatever a live/conditional passive hook (categories B-F) is CURRENTLY
 * contributing as of the narration's current point — e.g. Phan Anh Minh's
 * team-behind buff is only in `liveBonus` while his team is actually behind,
 * so it reads 0 otherwise and appears the moment that flips, exchange by
 * exchange, without this component doing any of that computation itself
 * (see SideBlock in BoutResultBoard, which derives it from the same
 * Exchange.liveModifierA/B the bout simulator itself rolled hits against).
 * The net total at the top sums bonus+liveBonus into one glanceable +N/-N,
 * so a buff/debuff is actually verifiable instead of just trusted by name.
 *
 * Tap/click is the primary trigger (mobile has no hover state); hover is a
 * bonus on top for desktop — see useTapReveal. Rendered through a portal —
 * every place this shows up sits inside a HexPanel, whose hexagonal cut is a
 * clip-path on that panel's own box, which clips any absolutely positioned
 * descendant no matter its z-index. A portal escapes it.
 */
export function PlayerHoverCard({
  name,
  base,
  bonus,
  liveBonus,
  className = "",
}: {
  name: string;
  base: Player;
  bonus: Partial<Record<StatPath, number>>;
  /** Currently-active live/conditional passive contribution, if any — see
   *  the component doc comment above. Omit entirely where there's no live
   *  hook machinery to read from (draft/lineup phases). */
  liveBonus?: Partial<Record<StatPath, number>>;
  className?: string;
}) {
  const { visible, pos, triggerRef, popoverRef, triggerProps } = useTapReveal<HTMLSpanElement>();

  const rows = STAT_PATHS.map((path) => ({
    path,
    label: STAT_LABELS[path],
    baseValue: readStat(base, path),
    delta: (bonus[path] ?? 0) + (liveBonus?.[path] ?? 0),
  }));
  const netTotal = rows.reduce((sum, r) => sum + r.delta, 0);
  const netTone = netTotal > 0 ? "text-forest-500" : netTotal < 0 ? "text-blood" : "text-bone-faint";

  return (
    <>
      <span
        ref={triggerRef}
        role="button"
        className={`inline-block cursor-pointer ${className}`}
        {...triggerProps}
      >
        {name}
      </span>
      {visible &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            className="hex-tab pointer-events-none fixed z-50 w-56 -translate-x-1/2 bg-card px-3 py-2 text-left shadow-lg"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="display text-xs text-brass-600">{name}</p>
              <p className={`display text-xs tabular-nums ${netTone}`}>
                {netTotal > 0 ? "+" : ""}
                {netTotal}
              </p>
            </div>
            <dl className="flex flex-col gap-0.5">
              {rows.map((r) => (
                <div key={r.path} className="flex items-center justify-between gap-2 text-[11px]">
                  <dt className="text-bone-faint">{r.label}</dt>
                  <dd className="tabular-nums text-bone">
                    {r.baseValue}
                    {r.delta !== 0 && (
                      <span className={r.delta > 0 ? "text-forest-500" : "text-blood"}>
                        {" "}
                        {r.delta > 0 ? "+" : ""}
                        {r.delta}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>,
          document.body,
        )}
    </>
  );
}
