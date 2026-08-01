import type { Metadata } from "next";
import Link from "next/link";
import { Manrope, Oswald } from "next/font/google";
import { Lockup } from "@/components/Crest";
import { MainNav } from "@/components/MainNav";
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
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        <header className="border-b border-forest-700/15 bg-paper/80 backdrop-blur">
          {/* No wrapping: a two-row header eats scarce vertical space on phone. */}
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-6 sm:py-4">
            <Link href="/" aria-label="Về trang chủ">
              <Lockup />
            </Link>
            <MainNav />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-3 sm:px-6 sm:py-10">
          {children}
        </main>
      </body>
    </html>
  );
}
