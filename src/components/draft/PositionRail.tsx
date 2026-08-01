import { HexBadge } from "@/components/Hex";
import { POSITIONS, type Position } from "@/lib/kendo";

/** The five draft steps, showing what's done, what's live, and what's ahead. */
export function PositionRail({
  currentIndex,
  picked,
}: {
  currentIndex: number;
  picked: Partial<Record<Position, string>>;
}) {
  return (
    <ol className="flex items-start justify-center gap-1 sm:gap-4">
      {POSITIONS.map((position, i) => {
        const state = i === currentIndex ? "active" : i < currentIndex ? "done" : "idle";
        return (
          <li
            key={position}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5 sm:w-32 sm:max-w-32 sm:flex-none sm:gap-2"
          >
            <HexBadge state={state} className="h-11 w-10 sm:h-14 sm:w-12">
              <span className="display text-xs sm:text-sm">{i + 1}</span>
            </HexBadge>
            <span
              className={`display text-center text-[10px] sm:text-xs ${
                state === "active"
                  ? "text-brass-600"
                  : state === "done"
                    ? "text-bone-dim"
                    : "text-bone-faint"
              }`}
            >
              {position}
            </span>
            {/* Names would wrap to unreadable slivers in a 70px column. */}
            <span className="hidden min-h-8 text-center text-[11px] leading-tight text-bone-faint sm:block">
              {picked[position] ?? (state === "active" ? "Đang chọn…" : "—")}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
