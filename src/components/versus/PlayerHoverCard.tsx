"use client";

import { createPortal } from "react-dom";
import { STAT_PATHS, readStat, type Player } from "@/lib/kendo";
import type { StatPath } from "@/lib/kendo/types";
import { STAT_LABELS } from "@/lib/versus/statLabels";
import { useTapReveal } from "@/components/versus/useTapReveal";

/**
 * Wraps a player's displayed name with a detail card breaking down every
 * stat as base value + any augment/item bonus, colored green (helps them)
 * or red (hurts them) — e.g. "Men (đòn đánh) 92 +5" in green. `base` is the
 * player's raw, unmodified stats (before any augment/item); `bonus` is the
 * already-summed total delta for this one player this game (their own
 * side's qualifying augments, any opp. crossover landing on them, and their
 * own equipped item) — see resolvePlayerBonuses in versus/bout.ts. Lets a
 * player visually confirm the stacking/gating logic actually did what it
 * claims, not just trust the badge names.
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
  className = "",
}: {
  name: string;
  base: Player;
  bonus: Partial<Record<StatPath, number>>;
  className?: string;
}) {
  const { visible, pos, triggerRef, popoverRef, triggerProps } = useTapReveal<HTMLSpanElement>();

  const rows = STAT_PATHS.map((path) => ({
    path,
    label: STAT_LABELS[path],
    baseValue: readStat(base, path),
    delta: bonus[path] ?? 0,
  }));

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
            <p className="display mb-1 text-xs text-brass-600">{name}</p>
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
