"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface Session {
  displayName: string;
}

/** Nav-bar auth slot: "Đăng nhập" when signed out, name + logout when not. */
export function AuthNavItem() {
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
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
      setSession({ displayName: profile?.display_name ?? "Bạn" });
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

  // Skip the flash of "Đăng nhập" before the first session check resolves.
  if (session === undefined) return null;

  if (session === null) {
    return (
      <Link
        href="/"
        className="hex-tab display px-2.5 py-1.5 text-[10px] bg-forest-700 text-paper transition-colors hover:bg-forest-600 hover:text-brass-200 sm:px-4 sm:py-2 sm:text-[11px]"
      >
        Đăng nhập
      </Link>
    );
  }

  const logout = async () => {
    await supabase.auth.signOut();
    setTick((n) => n + 1);
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="hex-tab display px-2.5 py-1.5 text-[10px] bg-forest-800 text-brass-300 sm:px-4 sm:py-2 sm:text-[11px]">
        {session.displayName}
      </span>
      <button
        type="button"
        onClick={logout}
        className="hex-tab display px-2 py-1.5 text-[10px] bg-forest-700 text-paper transition-colors hover:bg-forest-600 hover:text-blood sm:px-3 sm:py-2 sm:text-[11px]"
      >
        Đăng xuất
      </button>
    </div>
  );
}
