import type { Metadata } from "next";
import Link from "next/link";
import { HexPanel } from "@/components/Hex";
import { AuthGateRefresh } from "@/components/versus/AuthGateRefresh";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Lịch Sử Đấu Đối Kháng — Đà Lạt Kendo Club",
  description: "Danh sách các trận đấu đối kháng Bo5 đã hoàn thành của bạn.",
};

interface MatchHistoryRow {
  match_id: string;
  player_a: string;
  player_b: string;
  winner: string | null;
  series_score_a: number;
  series_score_b: number;
  completed_at: string;
}

interface ProfileLite {
  id: string;
  display_name: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Read-only list, same click-through-to-detail interaction as solo mode's
 * bracket "Xem lại" — one row per completed series, each linking to
 * /lich-su/[matchId] for the full per-game replay.
 */
export default async function LichSuPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <AuthGateRefresh />;
  }

  const { data: historyRows } = await supabase
    .from("match_history")
    .select("*")
    .or(`player_a.eq.${user.id},player_b.eq.${user.id}`)
    .order("completed_at", { ascending: false });
  const rows = (historyRows as MatchHistoryRow[] | null) ?? [];

  const opponentIds = Array.from(
    new Set(rows.map((r) => (r.player_a === user.id ? r.player_b : r.player_a))),
  );
  const { data: profileRows } =
    opponentIds.length > 0
      ? await supabase.from("profiles").select("id, display_name").in("id", opponentIds)
      : { data: [] as ProfileLite[] };
  const nameById = new Map((profileRows as ProfileLite[] | null ?? []).map((p) => [p.id, p.display_name]));

  return (
    <section className="flex flex-col gap-4 sm:gap-6">
      <header className="flex flex-col items-center gap-1 text-center">
        <p className="display text-xs text-brass-600">Đấu đối kháng · Bo5</p>
        <h2 className="display text-xl text-bone sm:text-2xl">Lịch sử đấu</h2>
      </header>

      {rows.length === 0 ? (
        <p className="pine-watermark py-16 text-center text-sm text-bone-faint">
          Bạn chưa hoàn thành trận đấu đối kháng nào.
        </p>
      ) : (
        <ol className="flex flex-col gap-2.5 sm:gap-3">
          {rows.map((row) => {
            const iAmA = row.player_a === user.id;
            const myScore = iAmA ? row.series_score_a : row.series_score_b;
            const opponentScore = iAmA ? row.series_score_b : row.series_score_a;
            const opponentId = iAmA ? row.player_b : row.player_a;
            const won = row.winner === user.id;
            return (
              <li key={row.match_id}>
                <Link href={`/lich-su/${row.match_id}`} className="block">
                  <HexPanel cut={14} className="transition-colors hover:brightness-105">
                    <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
                      <div className="flex items-center gap-3 text-sm">
                        <span
                          className={`display text-xs ${won ? "text-brass-600" : "text-blood"}`}
                        >
                          {row.winner ? (won ? "Thắng" : "Thua") : "—"}
                        </span>
                        <span className="text-bone-faint">·</span>
                        <span className="text-bone">
                          vs {nameById.get(opponentId) ?? "…"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="display text-sm text-bone">
                          {myScore}-{opponentScore}
                        </span>
                        <span className="text-[11px] text-bone-faint">{formatDate(row.completed_at)}</span>
                      </div>
                    </div>
                  </HexPanel>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
