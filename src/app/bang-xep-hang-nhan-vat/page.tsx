import type { Metadata } from "next";
import { HexPanel } from "@/components/Hex";
import { CLUB_ROSTER } from "@/data/club";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Tier List Nhân Vật — Đà Lạt Kendo Club",
  description: "Tỉ lệ chọn và tỉ lệ thắng của từng nhân vật trong đấu đối kháng, tính từ toàn bộ ván đã hoàn thành.",
};

// Recomputed from match_games on every load — this is a live leaderboard,
// not a cached snapshot, so it must never be statically generated.
export const dynamic = "force-dynamic";

interface GameRow {
  draft_state: { pickedA: string[]; pickedB: string[] };
  result: { result: { winner: "A" | "B" | "draw" } };
}

interface CharacterRow {
  id: string;
  name: string;
  picks: number;
  pickRate: number;
  wins: number;
  winRate: number | null;
  average: number;
}

/**
 * Character tier list — pick rate & win rate, versus mode only.
 *
 * Source: match_games (not the match_history table despite the name this
 * page's spec was given under — match_history is one row per completed
 * SERIES and has no per-character draft data at all; the draft, and thus
 * "was this character drafted", happens per individual GAME, which is
 * exactly what match_games rows are). Solo mode has no equivalent table, so
 * querying match_games is inherently versus-mode-only already.
 *
 * Pick rate = (completed games this character was drafted onto either side)
 * / (all completed games). "Completed" = result IS NOT NULL AND the game's
 * parent match reached status = 'completed' — a game can finish (have a
 * result) while its series is later abandoned mid-draft on the next game,
 * so filtering on the game's own result alone isn't enough; only games that
 * belong to a fully finished series count. Unfinished series don't linger
 * anyway — see migrations/0017, which auto-deletes non-completed matches
 * after 1 day.
 *
 * Win rate = (completed games this character was drafted AND their side
 * won) / (completed games this character was drafted). The denominator
 * doesn't need a separate "decisive game" filter: daihyosen is untimed
 * sudden death (first ippon wins, verified elsewhere in this codebase) and
 * can't itself end in a draw, so every completed match_games row already
 * has a definite "A" or "B" winner — result.result.winner is never "draw"
 * in practice by the time a game is complete. Handled defensively anyway
 * (a "draw" row just contributes to nobody's win count) rather than assumed.
 *
 * A character never drafted has an undefined win rate (0/0), shown as "—"
 * rather than 0%, so "never picked" doesn't read as "always loses".
 */
export default async function TierListPage() {
  const supabase = await createClient();
  const { data: gameRows } = await supabase
    .from("match_games")
    .select("draft_state, result, matches!inner(status)")
    .not("result", "is", null)
    .eq("matches.status", "completed");
  const games = (gameRows as GameRow[] | null) ?? [];
  const totalGames = games.length;

  const picks = new Map<string, number>();
  const wins = new Map<string, number>();
  for (const game of games) {
    const winner = game.result?.result?.winner;
    for (const id of game.draft_state?.pickedA ?? []) {
      picks.set(id, (picks.get(id) ?? 0) + 1);
      if (winner === "A") wins.set(id, (wins.get(id) ?? 0) + 1);
    }
    for (const id of game.draft_state?.pickedB ?? []) {
      picks.set(id, (picks.get(id) ?? 0) + 1);
      if (winner === "B") wins.set(id, (wins.get(id) ?? 0) + 1);
    }
  }

  const rows: CharacterRow[] = CLUB_ROSTER.map((person) => {
    const p = picks.get(person.id) ?? 0;
    const w = wins.get(person.id) ?? 0;
    const pickRate = totalGames > 0 ? (p / totalGames) * 100 : 0;
    const winRate = p > 0 ? (w / p) * 100 : null;
    return {
      id: person.id,
      name: person.name,
      picks: p,
      pickRate,
      wins: w,
      winRate,
      average: (pickRate + (winRate ?? 0)) / 2,
    };
  });
  rows.sort((a, b) => b.average - a.average || a.name.localeCompare(b.name, "vi"));

  return (
    <section className="flex flex-col gap-4 sm:gap-6">
      <header className="flex flex-col items-center gap-1 text-center">
        <p className="display text-xs text-brass-600">Đấu đối kháng · {totalGames} ván đã hoàn thành</p>
        <h1 className="display text-2xl text-bone sm:text-4xl">Tier List Nhân Vật</h1>
        <p className="max-w-2xl text-sm text-bone-dim">
          Xếp theo trung bình cộng của tỉ lệ chọn và tỉ lệ thắng, cao nhất trước. Cập nhật trực tiếp theo mỗi ván
          đấu đối kháng đã hoàn thành.
        </p>
      </header>

      {totalGames === 0 ? (
        <p className="pine-watermark py-16 text-center text-sm text-bone-faint">
          Chưa có ván đấu đối kháng nào hoàn thành để tính tỉ lệ.
        </p>
      ) : (
        <ol className="grid grid-cols-2 gap-2.5 sm:grid-cols-5 sm:gap-3">
          {rows.map((row, i) => (
            <li key={row.id} className="aspect-square">
              <HexPanel cut={12} className="h-full">
                <div className="flex h-full flex-col items-center justify-center gap-1.5 p-2 text-center">
                  <span className="display text-[10px] text-brass-600">#{i + 1}</span>
                  <span className="display min-w-0 truncate px-1 text-xs text-bone sm:text-sm">{row.name}</span>
                  <div className="mt-1 flex flex-col items-center gap-0.5">
                    <RateLine label="Chọn" value={row.pickRate} />
                    <RateLine label="Thắng" value={row.winRate} />
                  </div>
                </div>
              </HexPanel>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RateLine({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="text-[10px] tabular-nums text-bone-dim sm:text-[11px]">
      {label} <span className="text-bone">{value === null ? "—" : `${value.toFixed(1)}%`}</span>
    </span>
  );
}
