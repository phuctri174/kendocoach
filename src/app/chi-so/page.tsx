import type { Metadata } from "next";
import { StatsGrid, type KendokaRow } from "@/components/stats/StatsGrid";
import { CLUB_ROSTER } from "@/data/club";
import { stylesFor } from "@/lib/kendo";

export const metadata: Metadata = {
  title: "Bảng Xếp Hạng Sức Mạnh theo Chỉ Số của các Kendoka — Đà Lạt Kendo Club",
  description:
    "Bảng chỉ số của toàn bộ thành viên câu lạc bộ, đọc trực tiếp từ players.seed.json.",
};

/**
 * Read-only stats viewer. Reads CLUB_ROSTER — the same load path the game
 * uses — so it can never drift from the seed file.
 *
 * styleModifiers and styleWeights are dropped here rather than in the table,
 * so the numbers behind a stance are not even sent to the browser. Only the
 * style *names* travel.
 */
export default function ChiSoPage() {
  const rows: KendokaRow[] = CLUB_ROSTER.map((person) => ({
    id: person.id,
    name: person.name,
    technique: person.baseStats.technique,
    defense: person.baseStats.defense,
    attack_rate: person.baseStats.attack_rate,
    defend_rate: person.baseStats.defend_rate,
    hansoku_rate: person.baseStats.hansoku_rate,
    stamina: person.baseStats.stamina,
    styles: stylesFor(person),
  }));

  return (
    <section className="flex flex-col gap-3 sm:gap-6">
      <header className="flex flex-col items-center gap-0.5 text-center sm:gap-2">
        <p className="display text-[10px] text-brass-600 sm:text-xs">
          Câu lạc bộ · {rows.length} thành viên
        </p>
        <h1 className="display text-2xl text-bone sm:text-4xl">Bảng Xếp Hạng Sức Mạnh theo Chỉ Số của các Kendoka</h1>
        {/* The sort bar right below explains itself; this is chrome on phone. */}
        <p className="hidden max-w-2xl text-sm text-bone-dim sm:block">
          Số liệu đọc thẳng từ hồ sơ câu lạc bộ, xếp theo Tổng lực mạnh nhất trước.
          Tìm theo tên, hoặc sắp xếp lại theo tên và Tổng lực.
        </p>
      </header>

      <StatsGrid rows={rows} />
    </section>
  );
}
