"use client";

import { useEffect, useRef, useState } from "react";
import { HexPanel } from "@/components/Hex";
import { CLUB_ROSTER } from "@/data/club";
import { currentTurnSide, TURN_SECONDS, type DraftState, type MatchGameRow } from "@/lib/versus/draft";
import { PassiveBadge } from "@/components/versus/PassiveBadge";

const NAME_BY_ID = new Map(CLUB_ROSTER.map((p) => [p.id, p.name]));

/**
 * Renders one game's live 3-phase draft. All state comes from the parent's
 * `draftState` prop (kept in sync via the parent's own Realtime subscription
 * to the match_games row) — this component only ever proposes actions
 * (pick, auto-pick-on-timeout) to the server; it never advances the turn
 * itself, matching the server-authority principle everywhere else in versus
 * mode.
 */
export function DraftBoard({
  gameId,
  draftState,
  mySide,
  myName,
  opponentName,
  onGameUpdate,
}: {
  gameId: string;
  draftState: DraftState;
  mySide: "A" | "B";
  myName: string;
  opponentName: string;
  onGameUpdate: (row: MatchGameRow) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The clock is read only from inside this interval's own callback, never
  // during render — Date.now() in the render body would make the component
  // non-idempotent (React Compiler's purity rule flags it).
  const [remainingSeconds, setRemainingSeconds] = useState(TURN_SECONDS);
  const autoPickInFlight = useRef(false);

  useEffect(() => {
    const computeRemaining = () =>
      Math.max(0, Math.ceil((new Date(draftState.turnDeadline).getTime() - Date.now()) / 1000));
    const interval = setInterval(() => setRemainingSeconds(computeRemaining()), 1000);
    return () => clearInterval(interval);
  }, [draftState.turnDeadline]);

  const isMyTurn = currentTurnSide(draftState) === mySide;

  useEffect(() => {
    if (remainingSeconds > 0 || autoPickInFlight.current) return;
    autoPickInFlight.current = true;
    fetch(`/api/games/${gameId}/draft/auto-pick`, { method: "POST" })
      .then((res) => res.ok && res.json())
      .then((body) => body && onGameUpdate(body as MatchGameRow))
      .catch(() => {})
      .finally(() => {
        autoPickInFlight.current = false;
      });
  }, [remainingSeconds, gameId, onGameUpdate]);

  const pick = async (candidateId: string) => {
    if (!isMyTurn || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/games/${gameId}/draft/pick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    // Apply our own pick immediately rather than waiting for it to echo back
    // over Realtime — we already have the authoritative next state right here.
    if (res.ok && body) onGameUpdate(body as MatchGameRow);
    if (!res.ok) setError(body?.error ?? "Có lỗi xảy ra, thử lại.");
  };

  return (
    <section className="flex flex-col gap-4 sm:gap-6">
      <HexPanel cut={14}>
        <div className="flex flex-col items-center gap-1 px-4 py-3 text-center sm:py-4">
          <p className="display text-xs text-brass-600">Giai đoạn {draftState.phase} / 3</p>
          <p className="display text-base text-bone sm:text-lg">
            {isMyTurn
              ? `Lượt của bạn — chọn ${draftState.picksRemainingInTurn}`
              : `Đang chờ ${opponentName} chọn…`}
          </p>
          <p className={`display text-sm ${remainingSeconds <= 5 ? "text-blood" : "text-bone-faint"}`}>
            Còn {remainingSeconds}s
          </p>
        </div>
      </HexPanel>

      {error && <p className="text-center text-xs text-blood">{error}</p>}

      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-5 sm:gap-3">
        {draftState.pool.map((candidateId) => (
          <li key={candidateId} className="flex flex-col items-center">
            <button
              type="button"
              onClick={() => pick(candidateId)}
              disabled={!isMyTurn || busy}
              className="hex-tab w-full bg-brass-400 px-3 py-3 text-sm text-forest-900 transition-colors hover:bg-brass-300 disabled:cursor-not-allowed disabled:bg-paper-dim disabled:text-bone-faint"
            >
              <span className="display">{NAME_BY_ID.get(candidateId) ?? candidateId}</span>
            </button>
            <PassiveBadge playerId={candidateId} />
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <RosterColumn
          label={`${myName} (bạn)`}
          picked={mySide === "A" ? draftState.pickedA : draftState.pickedB}
        />
        <RosterColumn label={opponentName} picked={mySide === "A" ? draftState.pickedB : draftState.pickedA} />
      </div>
    </section>
  );
}

function RosterColumn({ label, picked }: { label: string; picked: string[] }) {
  return (
    <HexPanel cut={12}>
      <div className="flex flex-col gap-1.5 px-3 py-3 sm:px-4">
        <p className="display truncate text-xs text-brass-600">{label}</p>
        <ol className="flex flex-col gap-1">
          {Array.from({ length: 5 }, (_, i) => picked[i]).map((id, i) => (
            <li key={i} className="truncate text-sm text-bone">
              {id ? (NAME_BY_ID.get(id) ?? id) : <span className="text-bone-faint">—</span>}
              {id && <PassiveBadge playerId={id} />}
            </li>
          ))}
        </ol>
      </div>
    </HexPanel>
  );
}
