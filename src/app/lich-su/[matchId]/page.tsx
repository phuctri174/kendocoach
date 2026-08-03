import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AuthGateRefresh } from "@/components/versus/AuthGateRefresh";
import { MatchHistoryDetail, type HistoryGameEntry } from "@/components/versus/MatchHistoryDetail";
import type { EquipDisplay } from "@/components/versus/EquipBadge";
import type { ItemEquip } from "@/lib/versus/draft";
import { createClient } from "@/lib/supabase/server";
import { CLUB_ROSTER } from "@/data/club";
import { toPlayers, type Player, type StatPath } from "@/lib/kendo";
import { activeAugmentIdsFor, qualifyingAugments, resolvePlayerBonuses } from "@/lib/versus/bout";
import type { TeamMatch } from "@/lib/kendo/types";

export const metadata: Metadata = {
  title: "Chi Tiết Trận Đấu — Đà Lạt Kendo Club",
  description: "Xem lại từng ván của một trận đấu đối kháng Bo5 đã hoàn thành.",
};

const PERSON_BY_ID = new Map(CLUB_ROSTER.map((p) => [p.id, p]));

interface MatchRow {
  id: string;
  player_a: string;
  player_b: string;
  series_score_a: number;
  series_score_b: number;
  status: string;
}

interface GameRow {
  game_number: number;
  result: TeamMatch | null;
  item_equips_a: ItemEquip[];
  item_equips_b: ItemEquip[];
  augment_pick_a: string | null;
  augment_pick_b: string | null;
  draft_state: { pickedA: string[]; pickedB: string[] };
}

export default async function LichSuMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <AuthGateRefresh />;
  }

  // RLS already scopes this to participants — a non-participant (or a
  // nonexistent id) just gets no row back, same as "not found".
  const { data: match } = await supabase.from("matches").select("*").eq("id", matchId).single();
  const matchRow = match as MatchRow | null;
  if (!matchRow) {
    return (
      <section className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-bone-faint">Không tìm thấy trận đấu này.</p>
        <Link href="/lich-su" className="text-xs text-brass-600 underline underline-offset-4">
          Quay lại lịch sử đấu
        </Link>
      </section>
    );
  }
  // A still-ongoing match belongs on its live page, not the read-only
  // history view — that page already handles every in-progress phase.
  if (matchRow.status !== "completed") {
    redirect(`/tran/${matchId}`);
  }

  const { data: profileRows } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", [matchRow.player_a, matchRow.player_b]);
  const nameById = new Map(
    (profileRows as { id: string; display_name: string }[] | null ?? []).map((p) => [p.id, p.display_name]),
  );
  const teamAName = nameById.get(matchRow.player_a) ?? "Người chơi A";
  const teamBName = nameById.get(matchRow.player_b) ?? "Người chơi B";

  const { data: gameRows } = await supabase
    .from("match_games")
    .select("game_number, result, item_equips_a, item_equips_b, augment_pick_a, augment_pick_b, draft_state")
    .eq("match_id", matchId)
    .order("game_number", { ascending: true });
  const games = (gameRows as GameRow[] | null ?? []).filter((g) => g.result !== null);

  const entries: HistoryGameEntry[] = games.map((game) => {
    const pickedA = game.draft_state.pickedA;
    const pickedB = game.draft_state.pickedB;
    const rawPlayersA = toPlayers(pickedA.map((id) => PERSON_BY_ID.get(id)).filter((p) => !!p));
    const rawPlayersB = toPlayers(pickedB.map((id) => PERSON_BY_ID.get(id)).filter((p) => !!p));
    const basePlayerById: Record<string, Player> = {};
    for (const p of rawPlayersA) basePlayerById[p.id] = p;
    for (const p of rawPlayersB) basePlayerById[p.id] = p;

    // Augments stack across the series (see tran/[matchId]/page.tsx) — the
    // "active as of this game" set considers every game up to and including
    // this one, same rule the live page applies with priorAugmentRows.
    const augmentRowsSoFar = games
      .filter((g) => g.game_number <= game.game_number)
      .map((g) => ({
        game_number: g.game_number,
        augment_pick_a: g.augment_pick_a,
        augment_pick_b: g.augment_pick_b,
      }));
    const activeAugmentIdsA = activeAugmentIdsFor("A", augmentRowsSoFar, game.game_number);
    const activeAugmentIdsB = activeAugmentIdsFor("B", augmentRowsSoFar, game.game_number);

    const augmentBadgesA: EquipDisplay[] = qualifyingAugments(activeAugmentIdsA, pickedA, rawPlayersA, rawPlayersB).map(
      (a) => ({ name: a.name, description: a.description, effects: a.effects }),
    );
    const augmentBadgesB: EquipDisplay[] = qualifyingAugments(activeAugmentIdsB, pickedB, rawPlayersB, rawPlayersA).map(
      (a) => ({ name: a.name, description: a.description, effects: a.effects }),
    );

    const bonusByPlayerMap = resolvePlayerBonuses({
      pickedA,
      pickedB,
      rawPlayersA,
      rawPlayersB,
      activeAugmentIdsA,
      activeAugmentIdsB,
      itemEquipsA: game.item_equips_a,
      itemEquipsB: game.item_equips_b,
    });
    const bonusByPlayer: Record<string, Partial<Record<StatPath, number>>> = Object.fromEntries(bonusByPlayerMap);

    return {
      gameNumber: game.game_number,
      winnerSide: game.result!.result.winner === "draw" ? null : game.result!.result.winner,
      match: game.result!,
      augmentBadgesA,
      augmentBadgesB,
      itemEquipsA: game.item_equips_a,
      itemEquipsB: game.item_equips_b,
      basePlayerById,
      bonusByPlayer,
    };
  });

  return (
    <section className="flex flex-col gap-4 sm:gap-6">
      <header className="flex flex-col items-center gap-1 text-center">
        <p className="display text-xs text-brass-600">Đấu đối kháng · Bo5</p>
        <h2 className="display text-xl text-bone sm:text-2xl">
          {teamAName} <span className="px-2 text-brass-600">vs</span> {teamBName}
        </h2>
        <p className="display text-2xl text-bone">
          {matchRow.series_score_a} — {matchRow.series_score_b}
        </p>
        <Link href="/lich-su" className="text-xs text-brass-600 underline underline-offset-4">
          Quay lại lịch sử đấu
        </Link>
      </header>

      <MatchHistoryDetail entries={entries} teamAName={teamAName} teamBName={teamBName} />
    </section>
  );
}
