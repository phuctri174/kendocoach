/**
 * Shared shell for both match-viewer screens under this route (the live
 * player page and its xem/ spectator sibling) — the only two screens in the
 * app that opt into the root layout's bounded `<main>` height (see
 * layout.tsx's own comment: `h-[var(--app-vh)] overflow-hidden` on `<body>`
 * turns `<main>` into the app's one scroll container) so their own chrome
 * stays fully visible and only the log panel scrolls internally.
 *
 * That bounded-height opt-in is exactly why `<main>`'s own `sm:pb-16`
 * stopped showing up as visible space here: each page's own top-level
 * `<section>` is sized to `h-full` of `<main>`'s content box, which already
 * excludes `<main>`'s padding — so the padding never had anywhere left to
 * show. This got hand-patched onto the live page's own section once, then
 * had to be re-patched again when the spectator page turned out to need the
 * identical fix and hadn't gotten it. Fixing it once here, in the ONE
 * layout both pages already share by being nested under this route, means
 * any third screen added later under /tran/[matchId]/* inherits it for
 * free instead of needing its own copy-pasted padding classes.
 */
export default function MatchLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-full pb-4 sm:pb-16">{children}</div>;
}
