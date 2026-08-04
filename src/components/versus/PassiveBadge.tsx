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
 * The two roster-browsing pages (Bảng Xếp Hạng Sức Mạnh, Tier List Nhân Vật)
 * use `variant="label"` instead — a "Nội tại" text pill with a red frame,
 * rather than the bare square — since those pages have no other icon row
 * competing for the same space the way the match viewer/lineup screens do,
 * so a self-explanatory label reads better there than an unlabeled square
 * would. Bảng Xếp Hạng Sức Mạnh stacks the label below the name (its cards
 * are narrow and names get truncated) rather than placing it inline.
 *
 * A character with several unrelated abilities (e.g. Phan Anh Minh's three)
 * gets one labeled block per distinct ability rather than one run-on
 * paragraph — see PASSIVE_BLOCKS_BY_CHARACTER_ID.
 */
export function PassiveBadge({
  playerId,
  variant = "icon",
  className = "",
}: {
  playerId: string;
  variant?: "icon" | "label";
  className?: string;
}) {
  const { visible, pos, mobile, triggerRef, popoverRef, triggerProps } = useTapReveal<HTMLButtonElement>();
  const blocks = PASSIVE_BLOCKS_BY_CHARACTER_ID[playerId];
  if (!blocks || blocks.length === 0) return null;

  const content = blocks.map((block, idx) => (
    <div key={block.name} className={idx > 0 ? "border-t border-brass-600/20 pt-2" : ""}>
      <p className="display mb-1 text-xs text-blood">{block.name}</p>
      <p className="text-[11px] text-bone-faint">{block.text}</p>
    </div>
  ));

  return (
    <>
      {variant === "label" ? (
        <button
          type="button"
          ref={triggerRef}
          {...triggerProps}
          aria-label="Nội tại"
          title="Nội tại"
          className={`display inline-flex shrink-0 items-center rounded border border-blood px-1 py-px text-[9px] leading-tight text-blood align-middle sm:px-1.5 sm:text-[10px] ${className}`}
        >
          Nội tại
        </button>
      ) : (
        <button
          type="button"
          ref={triggerRef}
          {...triggerProps}
          aria-label="Nội tại"
          title="Nội tại"
          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] bg-blood align-middle sm:h-3 sm:w-3 ${className}`}
        />
      )}
      {visible &&
        (mobile ? (
          // See PlayerHoverCard's identical branch / useTapReveal's own doc
          // comment — anchored positioning is desktop-only now.
          createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-900/70 p-6">
              <div
                ref={popoverRef}
                onClick={(e) => e.stopPropagation()}
                className="hex-tab w-full max-w-xs flex-col gap-2 bg-card px-4 py-3 text-left shadow-lg"
              >
                {content}
              </div>
            </div>,
            document.body,
          )
        ) : (
          pos &&
          createPortal(
            <div
              ref={popoverRef}
              className="hex-tab pointer-events-none fixed z-50 w-64 -translate-x-1/2 flex-col gap-2 bg-card px-3 py-2 text-left shadow-lg"
              style={{ top: pos.top, left: pos.left }}
            >
              {content}
            </div>,
            document.body,
          )
        ))}
    </>
  );
}
