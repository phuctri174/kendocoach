import { availableStyles } from "./bout";
import { TARGET_LABEL } from "./config";
import { createRng, type Rng } from "./rng";
import type {
  Bout,
  CombatStyle,
  Exchange,
  MatchLogEvent,
  Side,
  Target,
  TeamMatch,
} from "./types";

/**
 * Flavour text only — this module reads a finished bout and narrates it. It
 * never decides anything; all outcomes are already fixed by the simulator.
 *
 * Copy is Vietnamese and deliberately terse: roughly one clause per line.
 * Kendo vocabulary (Men, Kote, Dou, Tsuki, ippon, hansoku, hikiwake, daihyosen,
 * the stance and position names) stays untranslated.
 */

const STRIKE_VERBS: Record<Target, string[]> = {
  men: ["bổ Men váng đầu", "dấn lên, vẩy Men", "phá trung tuyến, Men"],
  kote: ["lao vào đánh Kote", "chớp thời cơ, Kote", "gõ trúng cổ tay, Kote"],
  dou: ["luồn người chém Dou", "bước chéo, đánh Dou", "xoay người, Dou sạch"],
  tsuki: ["phóng Tsuki vào trung tuyến", "xuyên tới bằng Tsuki", "tìm yết hầu, Tsuki"],
};

const COUNTER_VERBS: Record<Target, string[]> = {
  men: ["đáp Men ở nhịp trả", "ăn Men trên đường lui"],
  kote: ["trừng phạt bằng debana-Kote", "đón đúng nhịp, Kote"],
  dou: ["ăn nuki-Dou", "né rồi xẻ Dou"],
  tsuki: ["phản đòn Tsuki", "chộp sơ hở, Tsuki"],
};

/** Stated as a fact when fatigue actually triggers — never a number. */
const FATIGUE_LINE = (name: string) => `${name} đã thấm mệt do trận đấu kéo dài`;

/**
 * Misses are the commonest thing that happens, so the long-form line is
 * rationed: at most a handful per bout and never back to back, with the rest
 * either shortened or left unsaid. Otherwise the log reads as one sentence
 * repeated twenty times.
 */
const MAX_DETAILED_MISSES = 3;
const MIN_DETAILED_MISS_GAP = 3;
/** Chance a non-featured miss gets a short mention at all. */
const SHORT_MISS_CHANCE = 0.45;

const DETAILED_MISS = (target: string, name: string) =>
  `Đòn ${target} khá nhạy cảm đến từ vị trí của ${name}, nhưng tiếc là trượt.`;

const SHORT_MISS = [
  "{p} vung {t} nhưng hụt",
  "{t} của {p} đi chệch",
  "{p} ra đòn {t}, không trúng",
  "{p} với {t} hơi ngắn tay",
];

const OPENING_LINES: Record<"aggressive" | "cagey" | "even", string[]> = {
  aggressive: ["{p} ép trận ngay từ đầu", "{p} chiếm trung tuyến tức thì"],
  cagey: ["Cả hai vào trận thận trọng", "Khởi đầu chậm, không ai vội"],
  even: ["{a} và {b} thăm dò nhau", "Khởi đầu cân bằng, cùng giữ chudan"],
};

/**
 * Stance wording. The stance name is always the last word and always in caps,
 * so the renderer can colour that token by `event.stance`.
 */
const STANCE_TAKEN: Record<CombatStyle, (name: string) => string> = {
  Jodan: (name) => `${name} đã lên JODAN`,
  Nito: (name) => `${name} đã chọn lối chơi NITO`,
  Chudan: (name) => `${name} đã vào thế CHUDAN`,
};

/** Switching back to Chudan is a retreat, and reads differently from opening in it. */
const STANCE_SWITCHED: Partial<Record<CombatStyle, (name: string) => string>> = {
  Chudan: (name) => `${name} đã về thủ CHUDAN`,
};

interface Ctx {
  rng: Rng;
  push(event: Omit<MatchLogEvent, "id">): void;
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

function nameOf(bout: Bout, side: Side): string {
  return (side === "A" ? bout.playerA : bout.playerB).name;
}

function openingMood(bout: Bout): "aggressive" | "cagey" | "even" {
  const spread = bout.playerA.attack_rate - bout.playerB.attack_rate;
  if (Math.abs(spread) >= 15) return "aggressive";
  if (bout.playerA.attack_rate < 45 && bout.playerB.attack_rate < 45) return "cagey";
  return "even";
}

function scoreFlavour(exchange: Exchange, scorer: Side): string {
  const { a, b } = exchange.scoreAfter;
  const mine = scorer === "A" ? a : b;
  const theirs = scorer === "A" ? b : a;
  if (mine === 1 && theirs === 0) return "mở tỉ số";
  if (mine === theirs) return "gỡ hòa";
  if (mine === 2) return "xong trận";
  return "vượt lên";
}

function narrateBout(bout: Bout, ctx: Ctx): void {
  const { rng } = ctx;
  const aName = bout.playerA.name;
  const bName = bout.playerB.name;
  const base = { position: bout.position, boutId: bout.id };

  const stanceOf = (side: Side) =>
    side === "A" ? bout.openingStance.a : bout.openingStance.b;

  ctx.push({
    ...base,
    kind: "bout-start",
    side: "neutral",
    text: bout.daihyosen
      ? `DAIHYOSEN — ${aName} (${stanceOf("A")}) gặp ${bName} (${stanceOf("B")})`
      : `${bout.position.toUpperCase()} — ${aName} (${stanceOf("A")}) gặp ${bName} (${stanceOf("B")})`,
  });

  // Only announce an opening stance where there was actually a choice to make.
  for (const side of ["A", "B"] as const) {
    const player = side === "A" ? bout.playerA : bout.playerB;
    if (availableStyles(player).length < 2) continue;
    const stance = side === "A" ? bout.openingStance.a : bout.openingStance.b;
    ctx.push({
      ...base,
      kind: "stance",
      side,
      stance,
      exchangeIndex: 0,
      text: STANCE_TAKEN[stance](player.name),
    });
  }

  const mood = openingMood(bout);
  const aggressor = bout.playerA.attack_rate >= bout.playerB.attack_rate ? aName : bName;
  ctx.push({
    ...base,
    kind: "event",
    side: "neutral",
    exchangeIndex: 0,
    text: fill(rng.pick(OPENING_LINES[mood]), { p: aggressor, a: aName, b: bName }),
  });

  // Per bout, not per match: each 1v1 gets its own small allowance.
  const detailedMissBudget = rng.int(2, MAX_DETAILED_MISSES);
  let detailedMisses = 0;
  let lastDetailedMiss = -MIN_DETAILED_MISS_GAP;

  for (const exchange of bout.exchanges) {
    const attacker = exchange.initiator;
    const defender: Side = attacker === "A" ? "B" : "A";
    const attackerName = nameOf(bout, attacker);
    const defenderName = nameOf(bout, defender);
    const at = { ...base, exchangeIndex: exchange.index };

    if (exchange.outcome === "ippon") {
      ctx.push({
        ...at,
        kind: "event",
        side: attacker,
        text: `${attackerName} ${rng.pick(STRIKE_VERBS[exchange.target])} — ${scoreFlavour(exchange, attacker)}. (${exchange.scoreAfter.a}-${exchange.scoreAfter.b})`,
      });
    } else if (exchange.outcome === "counter" && exchange.counterTarget) {
      ctx.push({
        ...at,
        kind: "event",
        side: defender,
        text: `${attackerName} lỡ đà; ${defenderName} ${rng.pick(COUNTER_VERBS[exchange.counterTarget])} — ${scoreFlavour(exchange, defender)}. (${exchange.scoreAfter.a}-${exchange.scoreAfter.b})`,
      });
    } else {
      const target = TARGET_LABEL[exchange.target];
      const spacedOut = exchange.index - lastDetailedMiss >= MIN_DETAILED_MISS_GAP;
      if (detailedMisses < detailedMissBudget && spacedOut) {
        detailedMisses++;
        lastDetailedMiss = exchange.index;
        ctx.push({
          ...at,
          kind: "event",
          side: "neutral",
          text: DETAILED_MISS(target, attackerName),
        });
      } else if (rng.chance(SHORT_MISS_CHANCE)) {
        ctx.push({
          ...at,
          kind: "event",
          side: "neutral",
          text: fill(rng.pick(SHORT_MISS), { p: attackerName, t: target }),
        });
      }
    }

    if (exchange.hansoku) {
      const offender = nameOf(bout, exchange.hansoku);
      ctx.push({
        ...at,
        kind: "event",
        side: exchange.hansoku === "A" ? "B" : "A",
        text: exchange.hansokuIppon
          ? `HANSOKU: ${offender} — lỗi thứ hai, ${nameOf(bout, exchange.hansokuIppon)} được ippon. (${exchange.scoreAfter.a}-${exchange.scoreAfter.b})`
          : `HANSOKU: ${offender} — cảnh cáo.`,
      });
    }

    for (const side of exchange.fatigueTriggers ?? []) {
      ctx.push({
        ...at,
        kind: "event",
        // Tiring is a setback for that fencer, so it reads as the other side's beat.
        side: side === "A" ? "B" : "A",
        text: FATIGUE_LINE(nameOf(bout, side)),
      });
    }

    for (const change of exchange.stanceSwitches ?? []) {
      const who = nameOf(bout, change.side);
      const phrase = STANCE_SWITCHED[change.to] ?? STANCE_TAKEN[change.to];
      ctx.push({
        ...at,
        kind: "stance",
        side: change.side,
        stance: change.to,
        text: phrase(who),
      });
    }

    for (const note of exchange.passiveEvents ?? []) {
      ctx.push({ ...at, kind: "passive", side: note.side, text: note.text });
    }
  }

  const { winner, ipponsA, ipponsB } = bout.result;
  const label = bout.daihyosen ? "Daihyosen" : bout.position;
  const resultText =
    winner === "draw"
      ? `${label}: HIKIWAKE ${ipponsA}-${ipponsB}.`
      : `${nameOf(bout, winner)} thắng ${label} ${Math.max(ipponsA, ipponsB)}-${Math.min(ipponsA, ipponsB)}.`;

  ctx.push({
    ...base,
    kind: "bout-result",
    exchangeIndex: Math.max(0, bout.exchanges.length - 1),
    side: winner === "draw" ? "neutral" : winner,
    text: resultText,
  });
}

export function buildMatchLog(match: TeamMatch, rng: Rng = createRng(match.id)): MatchLogEvent[] {
  const events: MatchLogEvent[] = [];
  let seq = 0;
  let aWins = 0;
  let bWins = 0;

  const ctx: Ctx = {
    rng,
    push: (event) => {
      const score = { a: aWins, b: bWins };
      events.push({ id: `${match.id}-${seq++}`, score, ...event });
    },
  };

  ctx.push({
    kind: "match-header",
    side: "neutral",
    text: `${match.roundName}: ${match.teamA.name} gặp ${match.teamB.name}`,
  });

  for (const bout of match.bouts) {
    narrateBout(bout, ctx);
    if (bout.result.winner === "A") aWins++;
    else if (bout.result.winner === "B") bWins++;
    events[events.length - 1].score = { a: aWins, b: bWins };
  }

  if (match.tiebreak) {
    ctx.push({
      kind: "event",
      side: "neutral",
      text: `Hòa ${aWins}-${bWins}, ippon cũng hòa — vào trận đại diện.`,
    });
    narrateBout(match.tiebreak, ctx);
  } else if (match.result.decidedBy === "ippons") {
    ctx.push({
      kind: "event",
      side: match.result.winner === "draw" ? "neutral" : match.result.winner,
      text: `Hòa ${aWins}-${bWins} — phân định bằng tổng ippon ${match.result.teamAIppons}-${match.result.teamBIppons}.`,
    });
  }

  const { winner, teamAWins, teamBWins, decidedBy } = match.result;
  // A 2-2 scoreline with "won 2-2" after it reads as nonsense, so say how.
  const how =
    decidedBy === "daihyosen"
      ? ` sau khi hòa ${teamAWins}-${teamBWins}, thắng ở trận đại diện`
      : decidedBy === "ippons"
        ? ` sau khi hòa ${teamAWins}-${teamBWins}, hơn ở tổng ippon`
        : "";
  const bannerText =
    winner === "draw"
      ? `HÒA — ${teamAWins}-${teamBWins}.`
      : winner === "A"
        ? how
          ? `THẮNG — ${match.teamA.name} đi tiếp${how}.`
          : `THẮNG — ${match.teamA.name} vượt qua ${teamAWins}-${teamBWins}.`
        : how
          ? `THUA — ${match.teamB.name} đi tiếp${how}.`
          : `THUA — ${match.teamB.name} thắng ${teamBWins}-${teamAWins}.`;

  ctx.push({ kind: "banner", side: winner === "draw" ? "neutral" : winner, text: bannerText });

  return events;
}
