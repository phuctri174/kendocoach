"use client";

import dynamic from "next/dynamic";
import { Splash } from "@/components/Splash";

/**
 * The draft seeds itself randomly and the whole run lives in client state, so
 * this must never render on the server — SSR would produce different
 * candidates than hydration. Loading it client-side only removes the mismatch
 * at the source, and the splash covers the gap.
 */
const GameShell = dynamic(
  () => import("@/components/GameShell").then((m) => m.GameShell),
  { ssr: false, loading: () => <Splash /> },
);

export function DraftEntry() {
  return <GameShell />;
}
