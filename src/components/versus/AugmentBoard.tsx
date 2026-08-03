"use client";

import { useEffect, useRef, useState } from "react";
import { HexPanel } from "@/components/Hex";
import { AUGMENT_CATALOG } from "@/data/augments";
import type { DraftSide, MatchGameRow } from "@/lib/versus/draft";
import { AUGMENT_PICK_SECONDS, type AugmentTier } from "@/lib/versus/augments";
import { formatEffectDelta, statEffectLabel } from "@/lib/versus/statLabels";

const AUGMENT_BY_ID = new Map(AUGMENT_CATALOG.map((a) => [a.id, a]));

/** One augment's stat breakdown, in the same vocabulary as the Kendoka
 *  stats page — shown right on the pick card so a player can weigh options
 *  without leaving this screen. */
function EffectBreakdown({ effects }: { effects: Record<string, number> }) {
  const entries = Object.entries(effects);
  if (entries.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] opacity-80">
      {entries.map(([path, delta]) => (
        <li key={path} className="whitespace-nowrap tabular-nums">
          {formatEffectDelta(delta)} {statEffectLabel(path)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Renders one game's augment round (games 1, 3, 5 only). Each side's 3
 * offered options are private — `myOffer` only ever holds the caller's own,
 * fetched once via /augments/start's response, never over Realtime.
 * `augmentPickA`/`augmentPickB` (public, part of the match_games row) is
 * read to decide whether to show the offer or "you already picked," but the
 * opponent's pick identity itself stays hidden here even after they lock
 * in — only "đã chọn" (locked, unnamed). It only becomes visible once the
 * match viewer actually starts (see augmentBadgesA/B in the match page),
 * not the moment they confirm during this pre-match phase.
 */
export function AugmentBoard({
  gameId,
  augmentTier,
  augmentPickA,
  augmentPickB,
  myOffer,
  mySide,
  opponentName,
  onGameUpdate,
}: {
  gameId: string;
  augmentTier: AugmentTier | null;
  augmentPickA: string | null;
  augmentPickB: string | null;
  myOffer: { tier: string; offered: string[]; pickDeadline: string } | null | undefined;
  mySide: DraftSide;
  opponentName: string;
  onGameUpdate: (row: MatchGameRow) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same clock-in-an-interval-callback pattern as DraftBoard — Date.now()
  // never gets read during render itself.
  const [remainingSeconds, setRemainingSeconds] = useState(AUGMENT_PICK_SECONDS);
  const autoPickInFlight = useRef(false);

  const myPickId = mySide === "A" ? augmentPickA : augmentPickB;
  const oppPickId = mySide === "A" ? augmentPickB : augmentPickA;

  useEffect(() => {
    if (!myOffer || myPickId) return;
    const computeRemaining = () =>
      Math.max(0, Math.ceil((new Date(myOffer.pickDeadline).getTime() - Date.now()) / 1000));
    // Same as DraftBoard's timer: the interval's first tick (1s later)
    // corrects the display to the real deadline rather than setting state
    // synchronously in the effect body.
    const interval = setInterval(() => setRemainingSeconds(computeRemaining()), 1000);
    return () => clearInterval(interval);
  }, [myOffer, myPickId]);

  useEffect(() => {
    if (!myOffer || myPickId || remainingSeconds > 0 || autoPickInFlight.current) return;
    autoPickInFlight.current = true;
    fetch(`/api/games/${gameId}/augments/auto-pick`, { method: "POST" })
      .then((res) => res.ok && res.json())
      .then((body) => body && onGameUpdate(body as MatchGameRow))
      .catch(() => {})
      .finally(() => {
        autoPickInFlight.current = false;
      });
  }, [myOffer, myPickId, remainingSeconds, gameId, onGameUpdate]);

  const pick = async (augmentId: string) => {
    if (busy || myPickId) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/games/${gameId}/augments/pick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ augmentId }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok && body) onGameUpdate(body as MatchGameRow);
    if (!res.ok) setError(body?.error ?? "Có lỗi xảy ra, thử lại.");
  };

  return (
    <section className="flex flex-col gap-4 sm:gap-6">
      <HexPanel cut={14}>
        <div className="flex flex-col items-center gap-1 px-4 py-3 text-center sm:py-4">
          <p className="display text-xs text-brass-600">Vòng bổ trợ</p>
          <p className="display text-base text-bone sm:text-lg">
            Bậc lõi của vòng này là: <span className="text-brass-300">{augmentTier ?? "…"}</span>
          </p>
        </div>
      </HexPanel>

      {error && <p className="text-center text-xs text-blood">{error}</p>}

      {myPickId ? (
        <HexPanel cut={12}>
          <div className="flex flex-col items-center gap-1 px-4 py-3 text-center">
            <p className="display text-xs text-brass-600">Bạn đã chọn</p>
            <p className="display text-sm text-bone">{AUGMENT_BY_ID.get(myPickId)?.name ?? myPickId}</p>
            {AUGMENT_BY_ID.get(myPickId) && (
              <EffectBreakdown effects={AUGMENT_BY_ID.get(myPickId)!.effects} />
            )}
          </div>
        </HexPanel>
      ) : myOffer && myOffer.offered.length > 0 ? (
        <>
          <p className={`display text-center text-sm ${remainingSeconds <= 5 ? "text-blood" : "text-bone-faint"}`}>
            Còn {remainingSeconds}s
          </p>
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
          {myOffer.offered.map((augmentId) => {
            const augment = AUGMENT_BY_ID.get(augmentId);
            return (
              <li key={augmentId}>
                <button
                  type="button"
                  onClick={() => pick(augmentId)}
                  disabled={busy}
                  className="hex-tab flex w-full flex-col gap-1 bg-brass-400 px-4 py-3 text-left text-forest-900 transition-colors hover:bg-brass-300 disabled:cursor-not-allowed disabled:bg-paper-dim disabled:text-bone-faint"
                >
                  <span className="display text-[10px] opacity-70">{augment?.tier ?? augmentTier}</span>
                  <span className="display text-sm">{augment?.name ?? augmentId}</span>
                  <span className="text-xs opacity-80">{augment?.description ?? ""}</span>
                  {augment && <EffectBreakdown effects={augment.effects} />}
                </button>
              </li>
            );
          })}
          </ul>
        </>
      ) : (
        <p className="text-center text-sm text-bone-faint">Đang tải lựa chọn…</p>
      )}

      <HexPanel cut={12}>
        <div className="flex flex-col items-center gap-1 px-4 py-3 text-center">
          <p className="display text-xs text-brass-600">{opponentName}</p>
          <p className="display text-sm text-bone">
            {oppPickId ? "Đã chọn" : <span className="text-bone-faint">Đang chọn…</span>}
          </p>
        </div>
      </HexPanel>
    </section>
  );
}
