"use client";

import { useLayoutEffect, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";

const VIEWPORT_MARGIN = 8;

/** Matches the app's own `sm:` breakpoint — below this, a trigger-anchored
 *  popover is abandoned entirely in favor of a centered overlay (see
 *  `mobile` below), rather than trying to keep refining the anchored
 *  math for narrow screens. */
const MOBILE_BREAKPOINT = 640;

/**
 * Shared open/close + portal-position state for a tap-to-reveal detail
 * popover. Tap/click is the primary trigger — mobile has no hover state —
 * with hover as a bonus on top for desktop. Any outside click dismisses it,
 * the same way a native popover would, so it works as a plain toggle on
 * touch and a quick peek-on-hover on desktop. Used by PlayerHoverCard and
 * the augment/item/passive detail badges so they all share one dismiss
 * behavior.
 *
 * `pos` starts as a naive "centered under the trigger, opens downward"
 * guess (matches the trigger's own rect). Once the popover itself actually
 * mounts, `popoverRef` (attach it to the popover's own root element) lets a
 * layout effect measure its REAL size and nudge `pos` back on-screen if that
 * guess would have clipped off any edge — a player in the last column/row
 * (Taisho, either side) is exactly the case a fixed-guess position gets
 * wrong. Runs before paint, so there's no visible jump. This whole
 * trigger-anchored scheme is desktop-only now (see `mobile` below) — on
 * narrow screens a caller renders a centered overlay instead, which needs
 * none of this math and so can't reproduce any of its edge cases.
 *
 * `measureSeq` exists because `measure()` doesn't only run once per open —
 * it re-fires on every `onMouseEnter`/`onClick`/`onFocus`, including while
 * already visible: touch browsers synthesize a `mouseenter` immediately
 * before the `click` for a plain tap (there's no real hover on touch), so a
 * mobile tap runs `measure()` twice in a row without `visible` ever toggling
 * false in between. Clamping off `[visible]` alone caught only the first,
 * already-superseded raw position; the second `measure()` call's fresh
 * unclamped guess silently overwrote it and nothing ever re-clamped that
 * one. Bumping this on every `measure()` call, independent of whether
 * visibility changed, makes the effect re-clamp after every fresh raw
 * guess. Depending on `pos` itself instead would risk a loop (the clamp's
 * own `setPos` would re-trigger it); `measureSeq` only ever changes from
 * `measure()`, never from the clamp, so it can't self-trigger. Left in
 * place (rather than ripped out now that mobile uses `mobile` instead) as
 * the correctness fix for the desktop hover-then-click case, which is real
 * independent of the mobile overlay switch.
 *
 * `mobile` is read once per `measure()` call (i.e. once per open), not
 * live-tracked — this only needs to be right at the moment the popover
 * opens, and re-deriving it continuously would just be extra work for a
 * case (resizing/rotating while a popover happens to be open) nobody hits
 * in practice.
 */
export function useTapReveal<T extends HTMLElement>() {
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [measureSeq, setMeasureSeq] = useState(0);
  const [mobile, setMobile] = useState(false);
  const triggerRef = useRef<T>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const measure = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 });
    if (typeof window !== "undefined") setMobile(window.innerWidth < MOBILE_BREAKPOINT);
    setMeasureSeq((n) => n + 1);
  };

  const visible = pinned || hovering;

  useLayoutEffect(() => {
    if (mobile || !visible || !pos || !popoverRef.current || !triggerRef.current) return;
    const popRect = popoverRef.current.getBoundingClientRect();
    const triggerRect = triggerRef.current.getBoundingClientRect();

    let nextLeft = pos.left;
    const halfWidth = popRect.width / 2;
    if (pos.left - halfWidth < VIEWPORT_MARGIN) {
      nextLeft = halfWidth + VIEWPORT_MARGIN;
    } else if (pos.left + halfWidth > window.innerWidth - VIEWPORT_MARGIN) {
      nextLeft = window.innerWidth - VIEWPORT_MARGIN - halfWidth;
    }

    // Opens downward by default; flips above the trigger only when there's
    // genuinely no room below, so a popover near the bottom edge (or inside
    // a short in-app WebView viewport) never renders partly off-screen.
    let nextTop = pos.top;
    if (triggerRect.bottom + 4 + popRect.height > window.innerHeight - VIEWPORT_MARGIN) {
      nextTop = Math.max(VIEWPORT_MARGIN, triggerRect.top - popRect.height - 4);
    }

    if (nextLeft !== pos.left || nextTop !== pos.top) {
      setPos({ top: nextTop, left: nextLeft });
    }
    // Re-checks on every fresh measure() (see measureSeq's own doc above),
    // not just when visibility flips — deliberately excludes `pos` itself
    // from these deps to avoid re-running off the clamp's own setPos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, measureSeq]);

  useEffect(() => {
    if (!pinned) return;
    const onDocClick = () => setPinned(false);
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [pinned]);

  return {
    visible,
    pos,
    /** True when the popover should render as a centered viewport overlay
     *  instead of anchored to `pos`/`triggerRef` — see this hook's own doc
     *  comment. Callers branch their JSX on this rather than the hook doing
     *  it itself, since the two layouts need different markup/backdrop, not
     *  just different inline styles. */
    mobile,
    triggerRef,
    popoverRef,
    triggerProps: {
      onClick: (e: MouseEvent) => {
        e.stopPropagation();
        measure();
        setPinned((p) => !p);
      },
      onMouseEnter: () => {
        measure();
        setHovering(true);
      },
      onMouseLeave: () => setHovering(false),
      onFocus: () => {
        measure();
        setHovering(true);
      },
      onBlur: () => setHovering(false),
      tabIndex: 0,
    },
  };
}
