import type { StatPath } from "@/lib/kendo/types";

/**
 * Mirrors StatsGrid.tsx's exact stat labels — the Kendoka stats page is
 * where players already learned these names, so an augment/item's effects
 * read the same way here rather than introducing a second vocabulary for
 * the same numbers.
 */
export const STAT_LABELS: Record<StatPath, string> = {
  "technique.men": "Men (đòn đánh)",
  "technique.kote": "Kote (đòn đánh)",
  "technique.dou": "Dou (đòn đánh)",
  "technique.tsuki": "Tsuki (đòn đánh)",
  "defense.men": "Men (phòng thủ)",
  "defense.kote": "Kote (phòng thủ)",
  "defense.dou": "Dou (phòng thủ)",
  "defense.tsuki": "Tsuki (phòng thủ)",
  attack_rate: "Tấn công",
  defend_rate: "Đỡ đòn",
  hansoku_rate: "Phạm lỗi",
  stamina: "Thể lực",
};

/** Handles the `opp.<stat>` convention (see splitEffects in versus/bout.ts)
 *  on top of a plain StatPath — an augment/item's raw effects key may be
 *  either. */
export function statEffectLabel(path: string): string {
  if (path.startsWith("opp.")) {
    const bare = path.slice(4) as StatPath;
    return `${STAT_LABELS[bare] ?? bare} (đối phương)`;
  }
  return STAT_LABELS[path as StatPath] ?? path;
}

export function formatEffectDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}
