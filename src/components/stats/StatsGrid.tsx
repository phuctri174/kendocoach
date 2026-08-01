"use client";

import { useMemo, useState } from "react";
import { HexPanel } from "@/components/Hex";
import { overallStrength, type CombatStyle, type Technique } from "@/lib/kendo";

/** Exactly what the viewer shows — no modifiers or weights. */
export interface KendokaRow {
  id: string;
  name: string;
  technique: Technique;
  defense: Technique;
  attack_rate: number;
  defend_rate: number;
  hansoku_rate: number;
  stamina: number;
  styles: CombatStyle[];
}

type ScalarKey = "attack_rate" | "defend_rate" | "hansoku_rate" | "stamina";
type StatKey = `technique.${keyof Technique}` | `defense.${keyof Technique}` | ScalarKey;
/**
 * Only two orderings are offered. Individual stats still show on every card,
 * but sorting by them buried the two people actually reach for.
 * "overall" is the shared strength score, derived rather than stored.
 */
type SortKey = "name" | "overall";

interface StatGroup {
  label: string;
  stats: { key: StatKey; label: string }[];
}

const GROUPS: StatGroup[] = [
  {
    label: "Đòn đánh",
    stats: [
      { key: "technique.men", label: "Men" },
      { key: "technique.kote", label: "Kote" },
      { key: "technique.dou", label: "Đô" },
      { key: "technique.tsuki", label: "Tsuki" },
    ],
  },
  {
    label: "Phòng thủ",
    stats: [
      { key: "defense.men", label: "Men" },
      { key: "defense.kote", label: "Kote" },
      { key: "defense.dou", label: "Đô" },
      { key: "defense.tsuki", label: "Tsuki" },
    ],
  },
  {
    label: "Tổng quát",
    stats: [
      { key: "attack_rate", label: "Tấn công" },
      { key: "defend_rate", label: "Đỡ đòn" },
      { key: "hansoku_rate", label: "Phạm lỗi" },
      { key: "stamina", label: "Thể lực" },
    ],
  },
];

function statValue(row: KendokaRow, key: StatKey): number {
  if (key.startsWith("technique.")) {
    return row.technique[key.slice("technique.".length) as keyof Technique];
  }
  if (key.startsWith("defense.")) {
    return row.defense[key.slice("defense.".length) as keyof Technique];
  }
  return row[key as ScalarKey];
}

export function StatsGrid({ rows }: { rows: KendokaRow[] }) {
  // Tổng lực descending is the permanent default view — strongest kendoka
  // first, no sort step required on load.
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [descending, setDescending] = useState(true);

  // Tổng lực is a real calculation now, not an average — work it out once per
  // player rather than on every sort comparison and every card render.
  const strength = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.id, overallStrength(row));
    return map;
  }, [rows]);

  const sorted = useMemo(() => {
    const out = [...rows];
    if (sortKey === "name") {
      out.sort((a, b) => a.name.localeCompare(b.name, "vi"));
    } else {
      out.sort((a, b) => {
        const diff = (strength.get(a.id) ?? 0) - (strength.get(b.id) ?? 0);
        // Ties fall back to name so the order is never arbitrary.
        return diff !== 0 ? diff : a.name.localeCompare(b.name, "vi");
      });
    }
    return descending ? out.reverse() : out;
  }, [rows, sortKey, descending, strength]);

  const select = (key: SortKey) => {
    if (key === sortKey) {
      setDescending((d) => !d);
      return;
    }
    setSortKey(key);
    // Tổng lực opens on the strongest; names read naturally A → Z.
    setDescending(key === "overall");
  };

  const chip = (key: SortKey, label: string) => {
    const active = key === sortKey;
    return (
      <button
        key={key}
        type="button"
        onClick={() => select(key)}
        aria-pressed={active}
        className={`hex-tab display px-2 py-1 text-[10px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass-600 sm:px-3 sm:py-1.5 sm:text-[11px] ${
          active
            ? "bg-brass-400 text-forest-900"
            : "bg-forest-700 text-paper hover:bg-forest-600 hover:text-brass-200"
        }`}
      >
        {label}
        {active ? (descending ? " ↓" : " ↑") : ""}
      </button>
    );
  };

  const activeLabel = sortKey === "name" ? "tên" : "Tổng lực";

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-col items-center gap-2 sm:gap-3">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="display text-[11px] text-bone-faint">Sắp xếp</span>
          {chip("name", "Tên")}
          {chip("overall", "Tổng lực")}
        </div>

        <p className="text-xs text-bone-faint">
          Đang sắp theo {activeLabel} ·{" "}
          {sortKey === "name"
            ? descending ? "Z → A" : "A → Z"
            : descending
              ? "cao nhất trước"
              : "thấp nhất trước"}{" "}
          · bấm lại để đảo chiều
        </p>
      </div>

      {sorted.length === 0 ? (
        <p className="pine-watermark py-16 text-center text-sm text-bone-faint">Chưa có kendoka nào.</p>
      ) : (
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sorted.map((row, i) => (
            <li key={row.id}>
              <KendokaCard
                row={row}
                highlight={sortKey}
                rank={sortKey === "name" ? null : i + 1}
                strength={strength.get(row.id) ?? 0}
              />
            </li>
          ))}
        </ol>
      )}

      <p className="text-center text-xs text-bone-faint">
        Mọi chỉ số từ 0 đến 100. Riêng “Phạm lỗi” thì càng thấp càng tốt.
      </p>
    </div>
  );
}

function KendokaCard({
  row,
  highlight,
  rank,
  strength,
}: {
  row: KendokaRow;
  highlight: SortKey;
  rank: number | null;
  strength: number;
}) {
  return (
    <HexPanel className="h-full" cut={16}>
      <div className="flex h-full flex-col gap-2 px-3 py-3 sm:gap-3 sm:px-4 sm:py-4">
        <header className="flex items-start justify-between gap-2 border-b border-brass-600/25 pb-2">
          <div className="min-w-0">
            <h2 className="display text-base leading-tight text-bone">{row.name}</h2>
            {row.styles.length > 1 && (
              <p className="text-[11px] text-brass-600">Có thể: {row.styles.join(", ")}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            {rank !== null && (
              <span className="display text-[11px] text-bone-faint">#{rank}</span>
            )}
            <span
              className={`display text-[11px] ${
                highlight === "overall"
                  ? "bg-brass-400/20 px-1.5 text-brass-600"
                  : "text-bone-faint"
              }`}
              title="Tổng lực — tỉ lệ thắng ước tính trước một đối thủ trung bình"
            >
              TL {Math.round(strength)}
            </span>
          </div>
        </header>

        {GROUPS.map((group) => (
          <section key={group.label} className="flex flex-col gap-1">
            <h3 className="display text-[10px] text-brass-600">{group.label}</h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              {group.stats.map((stat) => (
                <StatCell
                  key={stat.key}
                  label={stat.label}
                  value={statValue(row, stat.key)}
                />
              ))}
            </dl>
          </section>
        ))}
      </div>
    </HexPanel>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 px-1 py-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <dt className="text-[11px] text-bone-faint">{label}</dt>
        <dd className="text-sm tabular-nums text-bone-dim">{value}</dd>
      </div>
      {/* Thin track so a card can be scanned at a glance, not read digit by digit. */}
      <div className="h-1 w-full bg-paper-dim">
        <div
          className="h-full bg-forest-500"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}
