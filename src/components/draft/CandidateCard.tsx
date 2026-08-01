"use client";

import { HexPanel } from "@/components/Hex";
import type { DraftCandidate } from "@/lib/kendo";

/**
 * A blind draft offer: name only, no stats. The coach is picking on
 * reputation, which is the whole tension of the draft.
 */
export function CandidateCard({
  candidate,
  onPick,
  disabled,
}: {
  candidate: DraftCandidate;
  onPick: () => void;
  disabled?: boolean;
}) {
  return (
    <HexPanel
      className="group h-full transition-transform duration-200 hover:-translate-y-1"
      frameClassName="bg-brass-600/40 group-hover:bg-brass-400 transition-colors"
      cut={26}
    >
      <div className="pine-watermark flex h-full flex-col items-center justify-between gap-2.5 px-4 py-3 text-center sm:gap-6 sm:px-6 sm:py-8">
        {/* Name only. What stances they can take is something the coach finds
            out by watching them fight, not before drafting. */}
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <h3 className="display text-lg leading-tight text-bone sm:text-2xl">
            {candidate.person.name}
          </h3>
        </div>

        <button
          type="button"
          onClick={onPick}
          disabled={disabled}
          className="hex-tab w-full bg-brass-400 px-6 py-2 text-forest-900 transition-colors hover:bg-brass-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass-600 disabled:cursor-not-allowed disabled:bg-paper-dim disabled:text-bone-faint sm:py-3"
        >
          <span className="display text-sm">Chọn</span>
        </button>
      </div>
    </HexPanel>
  );
}
