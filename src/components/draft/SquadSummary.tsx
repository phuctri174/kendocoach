"use client";

import { HexPanel } from "@/components/Hex";
import { CrestMark } from "@/components/Crest";
import type { DraftPick } from "@/lib/kendo";

/** Shown once Taisho is picked, before the tournament begins. */
export function SquadSummary({
  picks,
  onStart,
  onRestart,
}: {
  picks: DraftPick[];
  onStart: () => void;
  onRestart: () => void;
}) {
  return (
    <section className="flex flex-col items-center gap-4 sm:gap-10">
      <div className="flex flex-col items-center gap-1.5 text-center sm:gap-3">
        <CrestMark className="h-11 w-11 sm:h-16 sm:w-16" />
        <h2 className="display text-xl text-brass-600 sm:text-3xl">Đã chốt đội hình</h2>
        <p className="max-w-lg text-xs text-bone-dim sm:text-sm">
          Năm người này gắn bó với bạn suốt giải đấu. Trước mỗi vòng, bạn vẫn
          được đổi vị trí thi đấu của họ.
        </p>
      </div>

      <ol className="grid w-full grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-5">
        {picks.map((pick, i) => (
          <li key={pick.person.id}>
            <HexPanel className="h-full" cut={14}>
              <div className="flex h-full flex-col gap-1 px-3 py-2.5 text-center sm:gap-2 sm:px-5 sm:py-6">
                <span className="display text-[10px] text-brass-600 sm:text-xs">
                  {i + 1} · {pick.position}
                </span>
                <span className="display text-sm leading-tight text-bone sm:text-lg">
                  {pick.person.name}
                </span>
              </div>
            </HexPanel>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
        <button
          type="button"
          onClick={onStart}
          className="hex-tab bg-brass-400 px-8 py-2.5 text-forest-900 transition-colors hover:bg-brass-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass-600 sm:px-10 sm:py-4"
        >
          <span className="display text-sm sm:text-base">Vào giải đấu</span>
        </button>
        <button
          type="button"
          onClick={onRestart}
          className="display text-xs text-bone-faint underline underline-offset-4 transition-colors hover:text-brass-600"
        >
          Tuyển chọn lại từ đầu
        </button>
      </div>
    </section>
  );
}
