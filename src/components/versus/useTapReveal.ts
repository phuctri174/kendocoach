"use client";

import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";

/**
 * Shared open/close + portal-position state for a tap-to-reveal detail
 * popover. Tap/click is the primary trigger — mobile has no hover state —
 * with hover as a bonus on top for desktop. Any outside click dismisses it,
 * the same way a native popover would, so it works as a plain toggle on
 * touch and a quick peek-on-hover on desktop. Used by PlayerHoverCard and
 * the augment/item detail badges so they all share one dismiss behavior.
 */
export function useTapReveal<T extends HTMLElement>() {
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<T>(null);

  const measure = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 });
  };

  useEffect(() => {
    if (!pinned) return;
    const onDocClick = () => setPinned(false);
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [pinned]);

  return {
    visible: pinned || hovering,
    pos,
    triggerRef,
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
