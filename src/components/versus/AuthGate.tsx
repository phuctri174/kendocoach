"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const FIELD_FRAME = "hex-tab bg-brass-500 p-[2px] transition-colors focus-within:bg-brass-200";
const FIELD_INPUT =
  "hex-tab w-full bg-paper-dim px-4 py-2.5 text-sm text-bone placeholder:text-bone-faint focus:bg-card focus:outline-none";

/**
 * Gate in front of the room lobby: guest play needs no form at all, an
 * account only ever asks for a username + password — the synthetic email
 * that backs it in Supabase Auth never surfaces here.
 */
export function AuthGate({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const asGuest = async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: guestError } = await supabase.auth.signInAnonymously();
    setBusy(false);
    if (guestError) {
      setError("Không thể vào với tư cách khách, thử lại.");
      return;
    }
    onAuthed();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(body?.error ?? "Có lỗi xảy ra, thử lại.");
      return;
    }
    onAuthed();
  };

  return (
    <section className="mx-auto flex w-full max-w-sm flex-col items-center gap-5 sm:gap-6">
      <header className="flex flex-col items-center gap-1 text-center">
        <p className="display text-xs text-brass-600">Đấu đối kháng</p>
        <h2 className="display text-xl text-bone sm:text-2xl">Vào phòng chờ</h2>
      </header>

      <button
        type="button"
        onClick={asGuest}
        disabled={busy}
        className="hex-tab w-full bg-brass-400 px-8 py-3 text-forest-900 transition-colors hover:bg-brass-300 disabled:cursor-not-allowed disabled:bg-paper-dim disabled:text-bone-faint"
      >
        <span className="display text-sm">Chơi với tư cách khách</span>
      </button>

      <div className="flex w-full items-center gap-3 text-[10px] text-bone-faint">
        <span className="h-px flex-1 bg-brass-600/30" />
        hoặc dùng tài khoản
        <span className="h-px flex-1 bg-brass-600/30" />
      </div>

      <div className="flex gap-2">
        {(["login", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`hex-tab display px-4 py-1.5 text-[10px] transition-colors sm:text-[11px] ${
              mode === m
                ? "bg-brass-400 text-forest-900"
                : "bg-forest-700 text-paper hover:bg-forest-600"
            }`}
          >
            {m === "login" ? "Đăng nhập" : "Đăng ký"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="flex w-full flex-col gap-3">
        <div className={FIELD_FRAME}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Tên đăng nhập"
            aria-label="Tên đăng nhập"
            autoComplete="username"
            className={FIELD_INPUT}
          />
        </div>
        <div className={FIELD_FRAME}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mật khẩu"
            aria-label="Mật khẩu"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className={FIELD_INPUT}
          />
        </div>

        {error && <p className="text-center text-xs text-blood">{error}</p>}

        <button
          type="submit"
          disabled={busy || !username || !password}
          className="hex-tab bg-forest-700 px-6 py-3 text-brass-300 transition-colors hover:bg-forest-600 disabled:cursor-not-allowed disabled:bg-paper-dim disabled:text-bone-faint"
        >
          <span className="display text-xs">{mode === "login" ? "Đăng nhập" : "Tạo tài khoản"}</span>
        </button>
      </form>
    </section>
  );
}
