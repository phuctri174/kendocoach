"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/versus/AuthGate";
import { RoomLobby } from "@/components/versus/RoomLobby";
import { createClient } from "@/lib/supabase/client";

interface Session {
  id: string;
  displayName: string;
}

export function DoiKhangHome() {
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Bumped by the auth-state subscription below and by AuthGate's onAuthed —
  // the fetch effect re-runs off this instead of an imperative refetch call,
  // which is what a bare direct call would trip react-hooks/set-state-in-effect on.
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setSession(null);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .single();
      if (cancelled) return;
      setSession({ id: user.id, displayName: profile?.display_name ?? "Bạn" });
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, tick]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => setTick((n) => n + 1));
    return () => subscription.unsubscribe();
  }, [supabase]);

  if (session === undefined) {
    return <p className="text-center text-sm text-bone-faint">Đang tải…</p>;
  }

  if (session === null) {
    return <AuthGate onAuthed={() => setTick((n) => n + 1)} />;
  }

  return <RoomLobby myUserId={session.id} myDisplayName={session.displayName} />;
}
