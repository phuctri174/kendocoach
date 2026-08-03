"use client";

import { HexPanel } from "@/components/Hex";
import { CLUB_ROSTER } from "@/data/club";
import { currentTurnSide, type DraftState } from "@/lib/versus/draft";

const NAME_BY_ID = new Map(CLUB_ROSTER.map((p) => [p.id, p.name]));

/**
 * Read-only counterparts to DraftBoard/AugmentBoard/ItemBoard/LineupBoard for
 * the spectator route — same phase-by-phase reveal rules the two real
 * players already apply to EACH OTHER (see each board's own privacy
 * comments), just with no "mine" side and no write paths at all: no pick
 * buttons, no auto-pick timers (those belong to a participant's own client
 * hitting their own auto-pick route, meaningless — and wrong — for someone
 * with no seat in the match).
 */

/** The draft itself is fully public in real time — both players already
 *  watch every pick land as it happens — so this is the one phase that's a
 *  straight mirror of DraftBoard, just without the "your turn" framing or
 *  any pick buttons. */
export function DraftBoardSpectator({
  draftState,
  nameA,
  nameB,
}: {
  draftState: DraftState;
  nameA: string;
  nameB: string;
}) {
  const turnSide = currentTurnSide(draftState);
  return (
    <section className="flex flex-col gap-4 sm:gap-6">
      <HexPanel cut={14}>
        <div className="flex flex-col items-center gap-1 px-4 py-3 text-center sm:py-4">
          <p className="display text-xs text-brass-600">Giai đoạn {draftState.phase} / 3</p>
          <p className="display text-base text-bone sm:text-lg">
            Đang chờ {turnSide === "A" ? nameA : nameB} chọn…
          </p>
        </div>
      </HexPanel>

      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-5 sm:gap-3">
        {draftState.pool.map((candidateId) => (
          <li key={candidateId}>
            <span className="hex-tab block w-full bg-forest-700 px-3 py-3 text-center text-paper">
              <span className="display text-sm">{NAME_BY_ID.get(candidateId) ?? candidateId}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <RosterColumn label={nameA} picked={draftState.pickedA} />
        <RosterColumn label={nameB} picked={draftState.pickedB} />
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
            </li>
          ))}
        </ol>
      </div>
    </HexPanel>
  );
}

/** Augment and item rounds share the exact same privacy shape: each side's 3
 *  offered options — and even their own pick's identity — stay hidden from
 *  everyone but themselves until the bout viewer starts (see AugmentBoard/
 *  ItemBoard's own comments); a spectator never has "themselves" here, so
 *  this only ever shows presence ("đã chọn" / "đang chọn"), symmetric for
 *  both sides, never a name. */
export function PickStatusBoard({
  title,
  subtitle,
  nameA,
  nameB,
  pickedA,
  pickedB,
}: {
  title: string;
  subtitle?: string;
  nameA: string;
  nameB: string;
  pickedA: boolean;
  pickedB: boolean;
}) {
  return (
    <section className="flex flex-col gap-4 sm:gap-6">
      <HexPanel cut={14}>
        <div className="flex flex-col items-center gap-1 px-4 py-3 text-center sm:py-4">
          <p className="display text-xs text-brass-600">{title}</p>
          {subtitle && <p className="text-sm text-bone-faint">{subtitle}</p>}
        </div>
      </HexPanel>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <StatusPanel name={nameA} done={pickedA} />
        <StatusPanel name={nameB} done={pickedB} />
      </div>
    </section>
  );
}

function StatusPanel({ name, done }: { name: string; done: boolean }) {
  return (
    <HexPanel cut={12}>
      <div className="flex flex-col items-center gap-1 px-4 py-3 text-center">
        <p className="display truncate text-xs text-brass-600">{name}</p>
        <p className="display text-sm text-bone">
          {done ? "Đã chọn" : <span className="text-bone-faint">Đang chọn…</span>}
        </p>
      </div>
    </HexPanel>
  );
}

/** Lineup phase: rosters are already public (draft), so both sides' full
 *  5-name comps show unsorted throughout — but WHO plays WHERE stays private
 *  from everyone (including the opponent) until the bout itself runs, so
 *  this never renders lineup_a/lineup_b's actual position assignments, only
 *  "đã chốt / đang xếp" presence — same as LineupBoard shows of the
 *  opponent. */
export function LineupStatusBoard({
  nameA,
  nameB,
  rosterA,
  rosterB,
  lockedA,
  lockedB,
}: {
  nameA: string;
  nameB: string;
  rosterA: string[];
  rosterB: string[];
  lockedA: boolean;
  lockedB: boolean;
}) {
  return (
    <section className="flex flex-col gap-4 sm:gap-6">
      <HexPanel cut={14}>
        <div className="px-4 py-3 text-center">
          <p className="display text-xs text-brass-600">Xếp đội hình</p>
        </div>
      </HexPanel>
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <RosterStatusPanel name={nameA} roster={rosterA} locked={lockedA} />
        <RosterStatusPanel name={nameB} roster={rosterB} locked={lockedB} />
      </div>
    </section>
  );
}

function RosterStatusPanel({ name, roster, locked }: { name: string; roster: string[]; locked: boolean }) {
  return (
    <HexPanel cut={12}>
      <div className="px-4 py-3 text-center">
        <p className="display truncate text-xs text-brass-600">{name}</p>
        <p className="text-sm text-bone-faint">{locked ? "Đã chốt đội hình." : "Đang xếp đội hình…"}</p>
        <ul className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-xs text-bone-dim">
          {roster.map((playerId) => (
            <li key={playerId}>{NAME_BY_ID.get(playerId) ?? playerId}</li>
          ))}
        </ul>
      </div>
    </HexPanel>
  );
}
