import type { Metadata } from "next";
import Link from "next/link";
import { Manrope, Oswald } from "next/font/google";
import { Lockup } from "@/components/Crest";
import { MainNav } from "@/components/MainNav";
import { ViewportHeightFix } from "@/components/ViewportHeightFix";
import { InAppBrowserBanner } from "@/components/InAppBrowserBanner";
import "./globals.css";

// Bold condensed caps for headers.
const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["latin", "vietnamese"],
  weight: ["500", "600", "700"],
});

// Clean geometric sans for body copy.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Đà Lạt Kendo Club",
  description: "Mô phỏng huấn luyện viên và đấu đối kháng trực tuyến của Đà Lạt Kendo Club.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${oswald.variable} ${manrope.variable} h-full antialiased`}
    >
      {/*
        Browser extensions inject attributes onto <body> before React hydrates
        (e.g. __processed_<uuid>__), which React flags as a dev-only warning.
        Suppressing is safe while this className stays a static literal — the
        flag only covers this element's own attributes and text, not the tree
        below it. Drop it if <body> ever gets a dynamic class.
      */}
      {/*
        h-[var(--app-vh,100dvh)] + overflow-hidden turns <main> below into the
        app's one scroll container instead of the document — every other
        page's content already fits inside it (nothing else on the site
        relies on document-level scroll, see the grep in the commit that
        added this), so this is invisible everywhere except the match-viewer
        screens, which use the now-bounded height of <main> to keep their own
        chrome fully visible and let only their log panel scroll internally.

        `--app-vh` (set by ViewportHeightFix from window.visualViewport,
        which reports the actually-visible area far more reliably than the
        `dvh` unit inside in-app WebViews like Messenger/Zalo) overrides the
        `100dvh` fallback once mounted — see that component for why plain
        `dvh` alone broke the log panel specifically inside those WebViews.
      */}
      <body
        className="flex h-[var(--app-vh,100dvh)] min-h-0 flex-col overflow-hidden"
        suppressHydrationWarning
      >
        <ViewportHeightFix />
        <InAppBrowserBanner />
        <header className="shrink-0 border-b border-forest-700/15 bg-paper/80 backdrop-blur">
          {/* No wrapping: a two-row header eats scarce vertical space on phone. */}
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-6 sm:py-4">
            <Link href="/" aria-label="Về trang chủ">
              <Lockup />
            </Link>
            <MainNav />
          </div>
        </header>
        <main className="mx-auto w-full min-h-0 max-w-6xl flex-1 overflow-y-auto px-3 py-3 sm:px-6 sm:pt-10 sm:pb-16">
          {children}
        </main>
      </body>
    </html>
  );
}
