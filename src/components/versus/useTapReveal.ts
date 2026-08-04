"use client";

import { useLayoutEffect, useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";

const VIEWPORT_MARGIN = 8;

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
 * wrong. Runs before paint, so there's no visible jump.
 */
export function useTapReveal<T extends HTMLElement>() {
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<T>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const measure = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 });
  };

  const visible = pinned || hovering;

  useLayoutEffect(() => {
    if (!visible || !pos || !popoverRef.current || !triggerRef.current) return;
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
    // Deliberately only re-checks when visibility flips (or the trigger
    // itself changes identity) — re-running off `pos` would just be
    // re-validating the position this same effect just set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!pinned) return;
    const onDocClick = () => setPinned(false);
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [pinned]);

  return {
    visible,
    pos,
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
