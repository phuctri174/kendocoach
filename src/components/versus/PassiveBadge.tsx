"use client";

import { createPortal } from "react-dom";
import { useTapReveal } from "@/components/versus/useTapReveal";
import { PASSIVE_BLOCKS_BY_CHARACTER_ID } from "@/lib/versus/passives";

/**
 * Small red square icon beside a character's name wherever they're shown —
 * draft roster, lineup, match viewer — deliberately NOT a text pill and NOT
 * placed below the name: that space is already spoken for (the ippon/
 * hansoku icon row in the match viewer, item/augment badges in the lineup
 * screen), so this sits inline right after the name instead. Tap/click
 * (mobile-primary) or hover (desktop bonus) reveals the full passive text,
 * same interaction as EquipBadge/PlayerHoverCard. Renders nothing for a
 * player with no passive, so callers can drop it in unconditionally.
 *
 * A character with several unrelated abilities (e.g. Phan Anh Minh's three)
 * gets one labeled block per distinct ability rather than one run-on
 * paragraph — see PASSIVE_BLOCKS_BY_CHARACTER_ID.
 */
export function PassiveBadge({ playerId, className = "" }: { playerId: string; className?: string }) {
  const { visible, pos, triggerRef, popoverRef, triggerProps } = useTapReveal<HTMLButtonElement>();
  const blocks = PASSIVE_BLOCKS_BY_CHARACTER_ID[playerId];
  if (!blocks || blocks.length === 0) return null;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        {...triggerProps}
        aria-label="Nội tại"
        title="Nội tại"
        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] bg-blood align-middle sm:h-3 sm:w-3 ${className}`}
      />
      {visible &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            className="hex-tab pointer-events-none fixed z-50 w-64 -translate-x-1/2 flex-col gap-2 bg-card px-3 py-2 text-left shadow-lg"
            style={{ top: pos.top, left: pos.left }}
          >
            {blocks.map((block, idx) => (
              <div key={block.name} className={idx > 0 ? "border-t border-brass-600/20 pt-2" : ""}>
                <p className="display mb-1 text-xs text-blood">{block.name}</p>
                <p className="text-[11px] text-bone-faint">{block.text}</p>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
