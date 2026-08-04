"use client";

import { createPortal } from "react-dom";
import { formatEffectDelta, statEffectLabel } from "@/lib/versus/statLabels";
import { useTapReveal } from "@/components/versus/useTapReveal";

/** Resolved augment or item info to show as one badge. Callers already know
 *  which player(s) a given badge applies to before constructing this — an
 *  augment badge is handed to every one of a side's 5 players (team-wide),
 *  an item badge only to the one player it's equipped to this game. */
export interface EquipDisplay {
  name: string;
  description: string;
  effects: Record<string, number>;
  icon?: string;
}

/** Full name + description + stat breakdown, positioned under whichever
 *  trigger opened it — shared by EquipBadge and EquipIcon so both reveal the
 *  same detail. */
function DetailPopover({
  equip,
  pos,
  popoverRef,
}: {
  equip: EquipDisplay;
  pos: { top: number; left: number };
  popoverRef: React.RefObject<HTMLDivElement | null>;
}) {
  return createPortal(
    <div
      ref={popoverRef}
      className="hex-tab pointer-events-none fixed z-50 w-56 -translate-x-1/2 bg-card px-3 py-2 text-left shadow-lg"
      style={{ top: pos.top, left: pos.left }}
    >
      <p className="display mb-1 text-xs text-brass-300">{equip.name}</p>
      <p className="text-[11px] text-bone-faint">{equip.description}</p>
      {Object.keys(equip.effects).length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {Object.entries(equip.effects).map(([path, delta]) => (
            <li key={path} className="text-[11px] tabular-nums text-bone">
              {formatEffectDelta(delta)} {statEffectLabel(path)}
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}

/** Small badge shown under a player's name wherever their equipped augment
 *  or item is known — the lineup screen. Icon + name, with the full
 *  description + stat breakdown behind a tap (mobile-primary) or hover
 *  (desktop bonus), same interaction as PlayerHoverCard rather than a native
 *  title tooltip, which mobile taps can't reliably surface. */
export function EquipBadge({ equip }: { equip: EquipDisplay }) {
  const { visible, pos, triggerRef, popoverRef, triggerProps } = useTapReveal<HTMLButtonElement>();
  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        {...triggerProps}
        className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate rounded bg-forest-700/60 px-1.5 py-0.5 text-[9px] text-brass-300 sm:text-[10px]"
      >
        {equip.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/items/${equip.icon}`} alt="" className="h-3 w-3 shrink-0" />
        ) : (
          <span className="shrink-0">✦</span>
        )}
        <span className="truncate">{equip.name}</span>
      </button>
      {visible && pos && <DetailPopover equip={equip} pos={pos} popoverRef={popoverRef} />}
    </>
  );
}

/** Icon-only version of the same badge — for spots where the full name pill
 *  would repeat the same text under every one of a side's 5 players
 *  (team-wide augments read as clutter there), namely the match viewer's
 *  position boxes. Tap/click or hover opens the exact same detail popover as
 *  EquipBadge, just from a smaller trigger. */
export function EquipIcon({ equip }: { equip: EquipDisplay }) {
  const { visible, pos, triggerRef, popoverRef, triggerProps } = useTapReveal<HTMLButtonElement>();
  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        {...triggerProps}
        title={equip.name}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded bg-forest-700/60 sm:h-5 sm:w-5"
      >
        {equip.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/items/${equip.icon}`} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[9px] text-brass-300 sm:text-[10px]">✦</span>
        )}
      </button>
      {visible && pos && <DetailPopover equip={equip} pos={pos} popoverRef={popoverRef} />}
    </>
  );
}
