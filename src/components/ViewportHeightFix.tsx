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
 *
 * This can't be verified from a normal desktop browser — the actual failure
 * this guards against only shows up inside a real in-app WebView, whose
 * event dispatch for viewport changes is exactly the kind of thing that
 * varies unpredictably by engine/version. So rather than trust any single
 * signal to fire at the right moment, every plausible one is wired up, and
 * a short settle-in poll covers the case where none of them fire in time
 * (e.g. the WebView's own chrome finishes animating in slightly after
 * load). None of this is a substitute for the log panel's own min-height
 * floor (see MatchViewer.tsx/BoutResultBoard.tsx) — that's what actually
 * guarantees the log never collapses to a sliver even if every signal here
 * turns out to report something degenerate.
 */
export function ViewportHeightFix() {
  useEffect(() => {
    const setHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      if (height > 0) {
        document.documentElement.style.setProperty("--app-vh", `${height}px`);
      }
    };

    setHeight();

    window.addEventListener("resize", setHeight);
    window.addEventListener("orientationchange", setHeight);
    window.visualViewport?.addEventListener("resize", setHeight);
    window.visualViewport?.addEventListener("scroll", setHeight);

    // Covers a WebView whose chrome (toolbar, etc.) settles into its final
    // size a beat after load, without a resize event ever firing for it.
    const settleTimers = [100, 300, 800, 1500, 3000].map((delay) => setTimeout(setHeight, delay));

    return () => {
      window.removeEventListener("resize", setHeight);
      window.removeEventListener("orientationchange", setHeight);
      window.visualViewport?.removeEventListener("resize", setHeight);
      window.visualViewport?.removeEventListener("scroll", setHeight);
      settleTimers.forEach(clearTimeout);
    };
  }, []);

  return null;
}
