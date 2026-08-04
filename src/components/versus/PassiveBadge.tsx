"use client";

import { createPortal } from "react-dom";
import { useTapReveal } from "@/components/versus/useTapReveal";
import { PASSIVE_DESCRIPTION_BY_ID } from "@/lib/versus/passives";

/**
 * Small "Nội tại" label under a character's name wherever they're shown —
 * draft roster, lineup, match viewer. Tap/click (mobile-primary) or hover
 * (desktop bonus) reveals the full passive text, same interaction as
 * EquipBadge/PlayerHoverCard. Renders nothing for a player with no passive,
 * so callers can drop it in unconditionally.
 */
export function PassiveBadge({ playerId }: { playerId: string }) {
  const { visible, pos, triggerRef, popoverRef, triggerProps } = useTapReveal<HTMLButtonElement>();
  const description = PASSIVE_DESCRIPTION_BY_ID[playerId];
  if (!description) return null;

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        {...triggerProps}
        className="mt-0.5 inline-block shrink-0 rounded bg-blood/70 px-1 py-0.5 text-[9px] text-paper sm:text-[10px]"
      >
        Nội tại
      </button>
      {visible &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            className="hex-tab pointer-events-none fixed z-50 w-56 -translate-x-1/2 bg-card px-3 py-2 text-left shadow-lg"
            style={{ top: pos.top, left: pos.left }}
          >
            <p className="display mb-1 text-xs text-brass-300">Nội tại</p>
            <p className="text-[11px] text-bone-faint">{description}</p>
          </div>,
          document.body,
        )}
    </>
  );
}
