"use client";

import { useMemo, useState } from "react";
import { CandidateCard } from "./CandidateCard";
import { PositionRail } from "./PositionRail";
import { SquadSummary } from "./SquadSummary";
import { CLUB_ROSTER } from "@/data/club";
import {
  canReroll,
  currentPosition,
  isDraftComplete,
  pickCandidate,
  rerollCandidates,
  startDraft,
  type DraftState,
  type PersonRecord,
  type Position,
} from "@/lib/kendo";

/** Chỉ mang tính gợi ý — engine không bao giờ ép kiểu người cho vị trí nào. */
const POSITION_HINT: Record<Position, string> = {
  Senpo: "Người mở trận. Khởi đầu tốt sẽ định đoạt nhịp của cả trận đấu.",
  Jiho: "Người thứ hai. Giữ nhịp sau khởi đầu xấu, hoặc dồn ép khi đang thuận lợi.",
  Chuken: "Trụ cột ở giữa, và thường là người phải giữ cho được trận hòa.",
  Fukusho: "Người thứ tư. Dọn đường cho đội trưởng, hoặc tự mình cứu cả trận.",
  Taisho: "Đội trưởng. Ra sân cuối cùng, và thường là người quyết định.",
};

function newDraft() {
  // A fresh seed per draft so each playthrough offers a different pool order.
  return startDraft(CLUB_ROSTER, { seed: `draft-${Date.now()}-${Math.random()}` });
}

/** Loaded client-side only by DraftEntry — see the note there on seeding. */
export function DraftScreen({
  onStart,
}: {
  onStart: (squad: PersonRecord[]) => void;
}) {
  const [draft, setDraft] = useState<DraftState>(newDraft);

  const pickedByPosition = useMemo(
    () =>
      draft.picks.reduce<Partial<Record<Position, string>>>((acc, pick) => {
        acc[pick.position] = pick.person.name;
        return acc;
      }, {}),
    [draft.picks],
  );

  const position = currentPosition(draft);
  const complete = isDraftComplete(draft);
  const rerollAvailable = canReroll(draft);

  if (complete) {
    return (
      <SquadSummary
        picks={draft.picks}
        onStart={() => onStart(draft.picks.map((pick) => pick.person))}
        onRestart={() => setDraft(newDraft())}
      />
    );
  }

  return (
    // Tight vertical rhythm on phone so the whole step fits one screen.
    <section className="flex flex-col gap-4 sm:gap-10">
      <PositionRail currentIndex={draft.positionIndex} picked={pickedByPosition} />

      <header className="flex flex-col items-center gap-0.5 text-center sm:gap-2">
        <p className="display text-[10px] text-brass-600 sm:text-xs">
          Lượt {draft.positionIndex + 1} / 5
        </p>
        <h2 className="display text-2xl text-bone sm:text-4xl">{position}</h2>
        <p className="max-w-xl text-xs text-bone-dim sm:text-sm">
          {position && POSITION_HINT[position]}
        </p>
      </header>

      <ul className="grid gap-2.5 sm:gap-6 md:grid-cols-3">
        {draft.candidates.map((candidate) => (
          <li key={candidate.person.id}>
            <CandidateCard
              candidate={candidate}
              onPick={() => setDraft(pickCandidate(draft, candidate.person.id))}
            />
          </li>
        ))}
      </ul>

      <footer className="flex flex-col items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => setDraft(rerollCandidates(draft))}
          disabled={!rerollAvailable}
          className="hex-tab bg-forest-700 px-8 py-3 text-brass-300 transition-colors hover:bg-forest-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass-600 disabled:cursor-not-allowed disabled:bg-paper-dim disabled:text-bone-faint"
        >
          <span className="display text-sm">
            Đổi cả ba · còn {draft.rerollsLeft} lượt
          </span>
        </button>
        {/* The button already shows the reroll count, so this explanation is
            the first thing to drop when vertical space is scarce. */}
        <p className="hidden text-xs text-bone-faint sm:block">
          {rerollAvailable
            ? "Lượt đổi dùng chung cho cả năm vị trí, và thay toàn bộ ba ứng viên."
            : "Hết lượt đổi — hãy chọn trong ba người trước mặt."}
        </p>
        <p className="text-center text-[11px] text-bone-faint sm:text-xs">
          Còn {draft.remaining.length} thành viên · đã chọn là không đổi lại được
        </p>
      </footer>
    </section>
  );
}
