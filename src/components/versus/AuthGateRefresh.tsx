"use client";

import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/versus/AuthGate";

/**
 * AuthGate wired for Server Component pages (which have no client state to
 * flip on sign-in) — router.refresh() just re-runs the server fetch for the
 * current route instead.
 */
export function AuthGateRefresh() {
  const router = useRouter();
  return <AuthGate onAuthed={() => router.refresh()} />;
}
