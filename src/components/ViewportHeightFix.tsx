"use client";

import { useEffect } from "react";

/**
 * In-app WebViews (Messenger, Instagram, TikTok) are the specific case this
 * exists for: their own persistent chrome eats into the viewport in ways
 * `100dvh` doesn't always account for correctly — support for `dvh` itself
 * is inconsistent across these embedded browsers, and unlike Safari/Chrome
 * their toolbar height isn't necessarily reflected in it at all. Result:
 * `body`'s CSS `h-dvh` can end up taller than what's actually visible, and
 * everything sized as a fraction of it (the match-viewer log panel most
 * visibly) renders with content escaping its container.
 *
 * `window.visualViewport` reports the actually-visible area directly and is
 * supported far more broadly than `dvh`, including in most of these
 * WebViews. This writes that measurement to a CSS custom property that
 * `body`'s height reads as an override — see `--app-vh` in layout.tsx —
 * with `100dvh` staying as the fallback for the (very first, pre-hydration)
 * moment before this effect has run, and for any environment where
 * `visualViewport` itself is unavailable.
 */
export function ViewportHeightFix() {
  useEffect(() => {
    const target = window.visualViewport ?? window;
    const setHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-vh", `${height}px`);
    };
    setHeight();
    target.addEventListener("resize", setHeight);
    return () => target.removeEventListener("resize", setHeight);
  }, []);

  return null;
}
