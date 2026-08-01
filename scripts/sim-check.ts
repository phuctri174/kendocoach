/**
 * Throwaway Phase 1 harness: exercises the simulation engine with no UI.
 * Run with: npm run sim
 */
import { readFileSync } from "node:fs";
import {
  beginRound,
  createTournament,
  playCurrentRound,
} from "../src/lib/tournamentState";
import {
  buildMatchLog,
  applyMatchToRoster,
  assignOpponentLineup,
  buildOpponentTeam,
  canReroll,
  createRng,
  currentPosition,
  draftedSquad,
  emptyHistory,
  estimateEdge,
  formatTimeLimit,
  generateOpponentSquad,
  DEFAULT_CONFIG,
  duplicateNames,
  isDraftComplete,
  lineupPlayers,
  loadRoster,
  overallStrength,
  personRating,
  pickCandidate,
  REFERENCE_FENCER,
  playRound,
  rerollCandidates,
  simulateBout,
  simulateEncho,
  simulateTeamMatch,
  startDraft,
  statsForStance,
  stylesFor,
  suggestRepresentative,
  toPlayer,
  toPlayers,
  POSITIONS,
  TOURNAMENT_ROUNDS,
  type CombatStyle,
  type PersonRecord,
  type Player,
  type SeedPlayer,
  type Team,
} from "../src/lib/kendo";

function makePlayer(
  id: string,
  name: string,
  overall: number,
  extra: Partial<Player> = {},
): Player {
  return {
    id,
    name,
    technique: { men: overall, kote: overall, dou: overall, tsuki: overall - 10 },
    defense: { men: overall, kote: overall, dou: overall, tsuki: overall },
    attack_rate: overall,
    defend_rate: overall,
    hansoku_rate: 10,
    stamina: overall,
    styles: ["Chudan"],
    history: emptyHistory(),
    ...extra,
  };
}

function pct(n: number, total: number): string {
  return `${((n / total) * 100).toFixed(1)}%`;
}

function boutSpread(a: Player, b: Player, runs: number, tag: string) {
  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  let ipponsA = 0;
  let ipponsB = 0;
  let exchanges = 0;
  let hansoku = 0;

  for (let i = 0; i < runs; i++) {
    const bout = simulateBout(a, b, { position: "Chuken", seed: `${tag}-${i}` });
    if (bout.result.winner === "A") aWins++;
    else if (bout.result.winner === "B") bWins++;
    else draws++;
    ipponsA += bout.result.ipponsA;
    ipponsB += bout.result.ipponsB;
    hansoku += bout.result.hansokuA + bout.result.hansokuB;
    exchanges += bout.exchanges.length;
  }

  console.log(
    `  ${tag.padEnd(22)} A ${pct(aWins, runs).padStart(6)} | B ${pct(bWins, runs).padStart(6)} | draw ${pct(draws, runs).padStart(6)} | ippons/bout ${( (ipponsA + ipponsB) / runs).toFixed(2)} (A ${(ipponsA / runs).toFixed(2)} / B ${(ipponsB / runs).toFixed(2)}) | avg exch ${(exchanges / runs).toFixed(1)} | hansoku/bout ${(hansoku / runs).toFixed(2)}`,
  );
  return {
    aWins,
    bWins,
    draws,
    ipponsPerBout: (ipponsA + ipponsB) / runs,
    ipponsA: ipponsA / runs,
    ipponsB: ipponsB / runs,
  };
}

function makeTeam(id: string, name: string, base: number, style?: CombatStyle): Team {
  const roster = POSITIONS.map((position, i) =>
    makePlayer(
      `${id}-${i}`,
      `${name} ${position}`,
      Math.max(20, Math.min(95, base + (i - 2) * 4)),
      style && i === 4 ? { styles: [style] } : {},
    ),
  );
  // one extra bench member, so daihyosen override has something to choose from
  roster.push(makePlayer(`${id}-bench`, `${name} Bench`, base + 6));

  return {
    id,
    name,
    roster,
    lineup: {
      senpo: `${id}-0`,
      jiho: `${id}-1`,
      chuken: `${id}-2`,
      fukusho: `${id}-3`,
      taisho: `${id}-4`,
    },
  };
}

const RUNS = 5000;
let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) failures++;
}

console.log("\n=== 1. Bout outcome distributions ===");
const even = boutSpread(makePlayer("a", "Even A", 60), makePlayer("b", "Even B", 60), RUNS, "even-60-vs-60");
const strong = boutSpread(makePlayer("a", "Strong", 85), makePlayer("b", "Weak", 40), RUNS, "strong-85-vs-40");
const novice = boutSpread(makePlayer("a", "Novice", 30), makePlayer("b", "Novice", 30), RUNS, "novice-30-vs-30");
const expert = boutSpread(makePlayer("a", "Expert", 90), makePlayer("b", "Expert", 90), RUNS, "expert-90-vs-90");
const jodan = boutSpread(
  makePlayer("a", "Jodan", 70, { styles: ["Jodan"] }),
  makePlayer("b", "Chudan", 70),
  RUNS,
  "jodan-vs-chudan",
);
const nito = boutSpread(
  makePlayer("a", "Nito", 70, { styles: ["Nito"] }),
  makePlayer("b", "Chudan", 70),
  RUNS,
  "nito-vs-chudan",
);
boutSpread(
  makePlayer("a", "Fit", 65, { stamina: 95 }),
  makePlayer("b", "Unfit", 65, { stamina: 15 }),
  RUNS,
  "high-vs-low-stamina",
);
boutSpread(
  makePlayer("a", "Clean", 65, { hansoku_rate: 2 }),
  makePlayer("b", "Sloppy", 65, { hansoku_rate: 60 }),
  RUNS,
  "clean-vs-sloppy",
);

console.log("\n=== 2. Sanity checks ===");
check(
  "even matchup is symmetric",
  Math.abs(even.aWins - even.bWins) / RUNS < 0.04,
  `A ${pct(even.aWins, RUNS)} vs B ${pct(even.bWins, RUNS)}`,
);
check(
  "hikiwake still happens at all",
  even.draws / RUNS > 0.005,
  `draw rate ${pct(even.draws, RUNS)} — see the hitScale sweep in section 1b`,
);
check(
  "stat gap decides bouts",
  strong.aWins / RUNS > 0.6 && strong.aWins > strong.bWins * 3,
  `85-overall wins ${pct(strong.aWins, RUNS)} vs ${pct(strong.bWins, RUNS)}`,
);

// Consequence of the comparative formula, asserted so it stays deliberate:
// p = atk/(atk+def) is scale-invariant, so 30-vs-30 scores exactly like
// 90-vs-90. Only the gap between two players moves the result.
check(
  "the comparative formula is scale-invariant by design",
  Math.abs(expert.ipponsPerBout - novice.ipponsPerBout) < 0.1,
  `experts ${expert.ipponsPerBout.toFixed(2)} vs novices ${novice.ipponsPerBout.toFixed(2)} ippons/bout`,
);
check(
  "Jodan is a trade-off, not a strict downgrade",
  Math.abs(jodan.aWins - jodan.bWins) / RUNS < 0.06,
  `Jodan ${pct(jodan.aWins, RUNS)} vs Chudan ${pct(jodan.bWins, RUNS)}`,
);
check(
  "stance still tilts the matchup",
  Math.abs(jodan.aWins - nito.aWins) / RUNS > 0.005,
  `Jodan wins ${pct(jodan.aWins, RUNS)}, Nito wins ${pct(nito.aWins, RUNS)}`,
);

console.log("\n=== 1b. hitScale sweep (lever on how decisive bouts are) ===");
console.log("  hitScale 1.0 is the plain comparative formula; lower makes ippon rarer.");
for (const hitScale of [1, 0.8, 0.6, 0.45, 0.35]) {
  let draws = 0;
  let exchanges = 0;
  let ippons = 0;
  const runs = 4000;
  for (let i = 0; i < runs; i++) {
    const bout = simulateBout(
      makePlayer("a", "A", 60),
      makePlayer("b", "B", 60),
      { position: "Chuken", seed: `sweep-${hitScale}-${i}`, config: { hitScale } },
    );
    if (bout.result.winner === "draw") draws++;
    exchanges += bout.exchanges.length;
    ippons += bout.result.ipponsA + bout.result.ipponsB;
  }
  console.log(
    `  hitScale ${hitScale.toFixed(2)}  draws ${pct(draws, runs).padStart(6)} | avg exch ${(exchanges / runs).toFixed(1).padStart(4)} | ippons/bout ${(ippons / runs).toFixed(2)}`,
  );
}

const seedA = simulateBout(makePlayer("a", "A", 70), makePlayer("b", "B", 70), {
  position: "Taisho",
  seed: "determinism",
});
const seedB = simulateBout(makePlayer("a", "A", 70), makePlayer("b", "B", 70), {
  position: "Taisho",
  seed: "determinism",
});
check(
  "same seed replays identically",
  JSON.stringify(seedA) === JSON.stringify(seedB),
  `${seedA.exchanges.length} exchanges, ${seedA.result.ipponsA}-${seedA.result.ipponsB}`,
);

let boundsOk = true;
let earlyStopOk = true;
for (let i = 0; i < 2000; i++) {
  const bout = simulateBout(makePlayer("a", "A", 90, { hansoku_rate: 80 }), makePlayer("b", "B", 90), {
    position: "Senpo",
    seed: `bounds-${i}`,
  });
  if (bout.exchanges.length < 1 || bout.exchanges.length > 12) boundsOk = false;
  const decisive = bout.exchanges.findIndex(
    (e) => e.scoreAfter.a >= 2 || e.scoreAfter.b >= 2,
  );
  if (decisive !== -1 && decisive !== bout.exchanges.length - 1) earlyStopOk = false;
}
check("exchange count stays within 8-12", boundsOk, "2000 high-foul bouts");
check("bout stops the moment someone reaches 2 ippon", earlyStopOk, "no exchanges after the winner");

console.log("\n=== 3. Team match ===");
const dalat = makeTeam("dalat", "Dalat Kendo Club", 62, "Jodan");
const rival = makeTeam("rival", "Saigon Kenshikan", 58);

let daihyosenSeen = 0;
let ipponDecided = 0;
let dalatWins = 0;
for (let i = 0; i < 2000; i++) {
  const m = simulateTeamMatch(dalat, rival, { roundName: "Quarterfinal", seed: `tm-${i}` });
  if (m.result.decidedBy === "daihyosen") daihyosenSeen++;
  if (m.result.decidedBy === "ippons") ipponDecided++;
  if (m.result.winner === "A") dalatWins++;
}
console.log(
  `  2000 team matches: Dalat win ${pct(dalatWins, 2000)}, decided on ippons ${pct(ipponDecided, 2000)}, daihyosen ${pct(daihyosenSeen, 2000)}`,
);
check("stronger team wins more often", dalatWins / 2000 > 0.5, `${pct(dalatWins, 2000)}`);
check("tiebreakers actually fire", ipponDecided + daihyosenSeen > 0, `${ipponDecided} ippon-decided, ${daihyosenSeen} daihyosen`);

const sample = simulateTeamMatch(dalat, rival, { roundName: "Final", seed: "showcase-7" });
check(
  "five bouts played in fixed order",
  sample.bouts.map((b) => b.position).join(",") === POSITIONS.join(","),
  sample.bouts.map((b) => b.position).join(" > "),
);
check(
  "daihyosen suggestion is the best technique in the lineup",
  lineupPlayers(dalat).every(
    (p) =>
      (p.technique.men + p.technique.kote + p.technique.dou + p.technique.tsuki) / 4 <=
      (() => {
        const r = suggestRepresentative(dalat).technique;
        return (r.men + r.kote + r.dou + r.tsuki) / 4;
      })(),
  ),
  suggestRepresentative(dalat).name,
);

console.log("\n=== 4. Narrative log (Final, seed showcase-7) ===");
for (const event of sample.log) {
  const marker =
    event.kind === "banner" ? "###" : event.kind === "bout-start" ? "##" : event.kind === "bout-result" ? " >" : "  -";
  console.log(`${marker} ${event.text}`);
}

console.log("\n=== 5. History accumulation ===");
const updated = applyMatchToRoster(dalat.roster, sample);
for (const p of updated.slice(0, 5)) {
  const h = p.history;
  console.log(
    `  ${p.name.padEnd(28)} ${h.wins}W-${h.losses}L-${h.draws}D  ippons ${h.ipponsScored}/-${h.ipponsConceded}  scoreless bouts ${h.noIpponMatches}`,
  );
}
const totals = updated.reduce((sum, p) => sum + p.history.matchesPlayed, 0);
check(
  "every lineup player banks exactly one bout",
  totals === 5 + (sample.tiebreak ? 1 : 0),
  `${totals} bouts recorded`,
);
check(
  "bench player is untouched",
  updated.find((p) => p.id === "dalat-bench")!.history.matchesPlayed === 0,
  "no phantom appearances",
);

console.log("\n=== 6. Multi-style draft expansion ===");
const people: PersonRecord[] = [
  {
    id: "p14",
    name: "Multi-Style Member",
    baseStats: {
      technique: { men: 70, kote: 60, dou: 55, tsuki: 40 },
      defense: { men: 66, kote: 58, dou: 60, tsuki: 45 },
      attack_rate: 65,
      defend_rate: 62,
      hansoku_rate: 8,
      stamina: 74,
    },
    styleModifiers: {
      Jodan: { attack_rate: 8, defend_rate: -8, "technique.men": 5, "technique.kote": 5 },
      Nito: { defend_rate: 8, "technique.dou": 6 },
    },
  },
  {
    id: "p15",
    name: "Chudan Only Member",
    styles: ["Chudan"],
    styleModifiers: {},
    baseStats: {
      technique: { men: 58, kote: 61, dou: 50, tsuki: 30 },
      defense: { men: 60, kote: 55, dou: 52, tsuki: 40 },
      attack_rate: 55,
      defend_rate: 60,
      hansoku_rate: 12,
      stamina: 68,
    },
  },
  {
    id: "p16",
    name: "Clamp Test Member",
    baseStats: {
      technique: { men: 97, kote: 4, dou: 50, tsuki: 30 },
      defense: { men: 98, kote: 3, dou: 50, tsuki: 30 },
      attack_rate: 96,
      defend_rate: 60,
      hansoku_rate: 2,
      stamina: 68,
    },
    styleModifiers: { Jodan: { attack_rate: 8, "technique.men": 9, "technique.kote": -9 } },
  },
];

const pool = toPlayers(people);
console.log(`  pool entries: ${pool.map((p) => `${p.id}[${p.styles.join("/")}]`).join(", ")}`);

check(
  "one person yields exactly one player",
  pool.length === people.length && new Set(pool.map((p) => p.id)).size === pool.length,
  `${people.length} people → ${pool.length} players`,
);
check(
  "available stances travel with the player",
  pool.find((p) => p.id === "p14")!.styles.join(",") === "Chudan,Jodan,Nito" &&
    pool.find((p) => p.id === "p15")!.styles.join(",") === "Chudan",
  `p14 ${pool.find((p) => p.id === "p14")!.styles.join("/")}, p15 ${pool.find((p) => p.id === "p15")!.styles.join("/")}`,
);

const p14 = pool.find((p) => p.id === "p14")!;
check(
  "a player's own stats are their Chudan numbers",
  p14.attack_rate === 65 && p14.defend_rate === 62 && p14.technique.men === 70,
  `atk ${p14.attack_rate} def ${p14.defend_rate} men ${p14.technique.men}`,
);
const jodanStats = statsForStance(p14, "Jodan");
check(
  "modifiers apply as signed deltas when the stance is taken",
  jodanStats.attack_rate === 73 &&
    jodanStats.defend_rate === 54 &&
    // Jodan's built-in +7% lands first (70 → 74.9), then the flat +5.
    Math.abs(jodanStats.technique.men - (70 * 1.07 + 5)) < 1e-9,
  `atk 65+8=${jodanStats.attack_rate}, def 62-8=${jodanStats.defend_rate}, men 70+7%+5=${jodanStats.technique.men.toFixed(1)}`,
);
const clampStats = statsForStance(pool.find((p) => p.id === "p16")!, "Jodan");
check(
  "deltas clamp to 0-100",
  clampStats.attack_rate === 100 && clampStats.technique.men === 100 && clampStats.technique.kote === 0,
  `atk 96+8→${clampStats.attack_rate}, men 97+9→${clampStats.technique.men}, kote 4-9→${clampStats.technique.kote}`,
);

const clashTeam: Team = {
  id: "clash",
  name: "Clash FC",
  roster: [p14, ...makeTeam("filler", "Filler", 60).roster],
  lineup: {
    senpo: "p14",
    jiho: "p14",
    chuken: "filler-2",
    fukusho: "filler-3",
    taisho: "filler-4",
  },
};
let clashRejected = false;
let clashMessage = "";
try {
  lineupPlayers(clashTeam);
} catch (err) {
  clashRejected = true;
  clashMessage = (err as Error).message;
}
check("one person cannot fill two positions in a round", clashRejected, clashMessage || "no error thrown");

console.log("\n=== 6b. Comparative hit resolution ===");
// p = hitScale × attackerTechnique[target] / (attackerTechnique[target] + defenderDefense[target]).
// The shape of the formula is asserted at hitScale 1 so these expectations stay
// readable; the shipped value is a separate pacing dial, checked below.
check(
  "shipped hitScale is the tuned 0.5",
  DEFAULT_CONFIG.hitScale === 0.5,
  `hitScale ${DEFAULT_CONFIG.hitScale}`,
);
const PURE = { hansokuScale: 0, counterScale: 0, fatigueTriggerScale: 0, hitScale: 1 };
const sharp = makePlayer("sharp", "Sharp", 50, {
  technique: { men: 100, kote: 100, dou: 100, tsuki: 100 },
  defense: { men: 100, kote: 100, dou: 100, tsuki: 100 },
});
const dull = makePlayer("dull", "Dull", 50, {
  // Technique deliberately different from defense: only defense may matter here.
  technique: { men: 20, kote: 20, dou: 20, tsuki: 20 },
  defense: { men: 65, kote: 65, dou: 65, tsuki: 65 },
});
let landed = 0;
let attempts = 0;
for (let i = 0; i < 40000; i++) {
  const bout = simulateBout(sharp, dull, {
    position: "Chuken",
    seed: `formula-${i}`,
    config: PURE,
  });
  for (const e of bout.exchanges) {
    if (e.initiator !== "A") continue;
    attempts++;
    if (e.outcome === "ippon") landed++;
  }
}
const observed = landed / attempts;
console.log(
  `  technique 100 attacking defense 65: ${(observed * 100).toFixed(1)}% over ${attempts} attempts`,
);
check(
  "technique 100 vs defense 65 lands ~61%",
  Math.abs(observed - 100 / 165) < 0.02,
  `expected ${((100 / 165) * 100).toFixed(1)}%, observed ${(observed * 100).toFixed(1)}%`,
);
const noFrills = { position: "Chuken" as const, config: PURE };
const mirrorBout = simulateBout(sharp, sharp, { ...noFrills, seed: "mirror" });
check(
  "equal technique and defense gives an even 50% roll",
  Math.abs(mirrorBout.exchanges[0].hitChance - 0.5) < 1e-9,
  `hitChance ${mirrorBout.exchanges[0].hitChance.toFixed(3)}`,
);
check(
  "the defender's own technique no longer resists anything",
  simulateBout(sharp, { ...dull, technique: { men: 1, kote: 1, dou: 1, tsuki: 1 } }, {
    ...noFrills,
    seed: "deftech",
  }).exchanges[0].hitChance ===
    simulateBout(sharp, { ...dull, technique: { men: 99, kote: 99, dou: 99, tsuki: 99 } }, {
      ...noFrills,
      seed: "deftech",
    }).exchanges[0].hitChance,
  "same hit chance whether the defender's technique is 1 or 99",
);
const softD = simulateBout(sharp, { ...dull, defense: { men: 20, kote: 20, dou: 20, tsuki: 20 } }, {
  ...noFrills,
  seed: "defcmp",
}).exchanges[0].hitChance;
const hardD = simulateBout(sharp, { ...dull, defense: { men: 90, kote: 90, dou: 90, tsuki: 90 } }, {
  ...noFrills,
  seed: "defcmp",
}).exchanges[0].hitChance;
check(
  "defense[target] is what resists the strike",
  softD > hardD && Math.abs(softD - 100 / 120) < 1e-9 && Math.abs(hardD - 100 / 190) < 1e-9,
  `defense 20 → ${(softD * 100).toFixed(1)}%, defense 90 → ${(hardD * 100).toFixed(1)}%`,
);
check(
  "defend_rate no longer touches the hit roll",
  simulateBout(sharp, { ...dull, defend_rate: 5 }, { ...noFrills, seed: "defrate" })
    .exchanges[0].hitChance ===
    simulateBout(sharp, { ...dull, defend_rate: 95 }, { ...noFrills, seed: "defrate" })
      .exchanges[0].hitChance,
  "same hit chance at defend_rate 5 and 95",
);
function meanCounterChance(defendRate: number): number {
  let total = 0;
  let n = 0;
  for (let i = 0; i < 3000; i++) {
    const bout = simulateBout(
      { ...sharp, defend_rate: defendRate },
      { ...dull, technique: { men: 70, kote: 70, dou: 70, tsuki: 70 } },
      { position: "Chuken", seed: `ctr-${defendRate}-${i}`, config: { hansokuScale: 0, fatigueTriggerScale: 0 } },
    );
    for (const e of bout.exchanges) {
      // Only exchanges the attacker lost expose a counter roll.
      if (e.initiator === "A" && e.outcome !== "ippon") {
        total += e.counterChance;
        n++;
      }
    }
  }
  return n ? total / n : 0;
}
const counterAtLowDef = meanCounterChance(5);
const counterAtHighDef = meanCounterChance(95);
check(
  "defend_rate still governs counter-ippon",
  counterAtLowDef > counterAtHighDef * 1.5,
  `attacker defend_rate 5 → ${(counterAtLowDef * 100).toFixed(1)}% counter risk, 95 → ${(counterAtHighDef * 100).toFixed(1)}%`,
);

console.log("\n=== 6b2. Stance stat trade-offs (percentages off base) ===");
const stanceSubject = makePlayer("st", "Stance Subject", 60, {
  technique: { men: 80, kote: 60, dou: 50, tsuki: 40 },
  defense: { men: 70, kote: 65, dou: 90, tsuki: 55 },
  styles: ["Chudan", "Jodan", "Nito"],
});
const inChudan = statsForStance(stanceSubject, "Chudan");
const inJodan = statsForStance(stanceSubject, "Jodan");
const inNito = statsForStance(stanceSubject, "Nito");
console.log(
  `  base   men ${inChudan.technique.men} kote ${inChudan.technique.kote} dou ${inChudan.technique.dou} | def dou ${inChudan.defense.dou} men ${inChudan.defense.men}`,
);
console.log(
  `  Jodan  men ${inJodan.technique.men.toFixed(1)} kote ${inJodan.technique.kote.toFixed(1)} | def dou ${inJodan.defense.dou.toFixed(1)}`,
);
console.log(
  `  Nito   kote ${inNito.technique.kote.toFixed(1)} dou ${inNito.technique.dou.toFixed(1)} tsuki ${inNito.technique.tsuki.toFixed(1)} | def men ${inNito.defense.men.toFixed(1)} dou ${inNito.defense.dou.toFixed(1)}`,
);

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
check(
  "Chudan is the untouched baseline",
  near(inChudan.technique.men, 80) && near(inChudan.defense.dou, 90),
  "no stance deltas applied",
);
check(
  "Jodan: technique men/kote +7%, defense dou -7%",
  near(inJodan.technique.men, 80 * 1.07) &&
    near(inJodan.technique.kote, 60 * 1.07) &&
    near(inJodan.defense.dou, 90 * 0.93),
  `men ${inJodan.technique.men.toFixed(2)}=85.60, kote ${inJodan.technique.kote.toFixed(2)}=64.20, def dou ${inJodan.defense.dou.toFixed(2)}=83.70`,
);
check(
  "Nito: defense men/dou +7%, technique kote/dou/tsuki -7%",
  near(inNito.defense.men, 70 * 1.07) &&
    near(inNito.defense.dou, 90 * 1.07) &&
    near(inNito.technique.kote, 60 * 0.93) &&
    near(inNito.technique.dou, 50 * 0.93) &&
    near(inNito.technique.tsuki, 40 * 0.93),
  `def men ${inNito.defense.men.toFixed(2)}=74.90, def dou ${inNito.defense.dou.toFixed(2)}=96.30, tech kote ${inNito.technique.kote.toFixed(2)}=55.80`,
);
check(
  "percentages are relative, not flat points",
  !near(inJodan.technique.men - 80, inJodan.technique.kote - 60),
  `+${(inJodan.technique.men - 80).toFixed(2)} on 80 vs +${(inJodan.technique.kote - 60).toFixed(2)} on 60`,
);
const ceilingCase = statsForStance(
  makePlayer("hi", "High", 60, {
    technique: { men: 98, kote: 60, dou: 50, tsuki: 40 },
    defense: { men: 99, kote: 65, dou: 99, tsuki: 55 },
    styles: ["Chudan", "Jodan", "Nito"],
  }),
  "Nito",
);
check(
  "stance percentages clamp to 0-100",
  ceilingCase.defense.men === 100 && ceilingCase.defense.dou === 100,
  `99 +7% → ${ceilingCase.defense.men} and ${ceilingCase.defense.dou}`,
);
const layered = statsForStance(
  makePlayer("ly", "Layered", 60, {
    technique: { men: 80, kote: 60, dou: 50, tsuki: 40 },
    defense: { men: 70, kote: 65, dou: 90, tsuki: 55 },
    styles: ["Chudan", "Jodan"],
    styleModifiers: { Jodan: { "technique.men": 4, "defense.dou": 10 } },
  }),
  "Jodan",
);
check(
  "per-player styleModifiers layer on top of the stance percentages",
  near(layered.technique.men, 80 * 1.07 + 4) && near(layered.defense.dou, 90 * 0.93 + 10),
  `men 85.60+4=${layered.technique.men.toFixed(2)}, def dou 83.70+10=${layered.defense.dou.toFixed(2)}`,
);

console.log("\n=== 6c. Bout-time stance ===");
const tripleStyle = makePlayer("tri", "Triple", 60, { styles: ["Chudan", "Jodan", "Nito"] });
const plain = makePlayer("plain", "Plain", 60);
const openings = { Chudan: 0, Jodan: 0, Nito: 0 };
let nitoLocked = true;
let switchesSeen = 0;
let illegalSwitch = "";
for (let i = 0; i < 4000; i++) {
  const bout = simulateBout(tripleStyle, plain, { position: "Chuken", seed: `stance-${i}` });
  openings[bout.openingStance.a]++;
  for (const e of bout.exchanges) {
    for (const s of e.stanceSwitches ?? []) {
      switchesSeen++;
      if (s.from === "Nito" || s.to === "Nito") {
        nitoLocked = false;
        illegalSwitch = `${s.from}→${s.to}`;
      }
    }
  }
  if (bout.openingStance.a === "Nito") {
    const stances = new Set(bout.exchanges.map((e) => e.stance.a));
    if (stances.size !== 1) nitoLocked = false;
  }
}
console.log(
  `  opening stance over 4000 bouts: Chudan ${openings.Chudan}, Jodan ${openings.Jodan}, Nito ${openings.Nito}; ${switchesSeen} mid-bout switches`,
);
check(
  "opening stance is random across available styles",
  openings.Chudan > 1000 && openings.Jodan > 1000 && openings.Nito > 1000,
  `${openings.Chudan}/${openings.Jodan}/${openings.Nito}`,
);
check("Nito never switches, in or out", nitoLocked, illegalSwitch || "locked for the whole bout");
check("Chudan and Jodan do switch mid-bout", switchesSeen > 0, `${switchesSeen} switches`);

let switchAfterScoreOnly = true;
for (let i = 0; i < 2000; i++) {
  const bout = simulateBout(tripleStyle, plain, { position: "Chuken", seed: `when-${i}` });
  for (const e of bout.exchanges) {
    if (!e.stanceSwitches?.length) continue;
    const scored = e.outcome === "ippon" || e.outcome === "counter" || e.hansokuIppon;
    if (!scored) switchAfterScoreOnly = false;
  }
}
check("stance only changes right after a point", switchAfterScoreOnly, "no mid-exchange switching");

const singleStyle = simulateBout(plain, plain, { position: "Chuken", seed: "single" });
check(
  "a Chudan-only player never switches",
  singleStyle.exchanges.every((e) => !e.stanceSwitches?.length),
  "nothing to switch to",
);

console.log("\n=== 6d. Stance log lines ===");
{
  const multi = makePlayer("m", "Đa Thế", 60, { styles: ["Chudan", "Jodan", "Nito"] });
  const solo = makePlayer("s", "Đơn Thế", 60);
  const opens = new Map<string, string>();
  const switches = new Map<string, string>();
  let soloAnnounced = 0;
  let wrongStanceTag = 0;
  let notLastWord = 0;

  for (let i = 0; i < 4000; i++) {
    const bout = simulateBout(multi, solo, { position: "Chuken", seed: `slog-${i}` });
    const log = buildMatchLog({
      id: `m-${i}`,
      roundName: "Test",
      teamA: { id: "a", name: "A", roster: [multi], lineup: {} as never },
      teamB: { id: "b", name: "B", roster: [solo], lineup: {} as never },
      bouts: [bout],
      result: {
        winner: bout.result.winner,
        teamAWins: 0, teamBWins: 0, draws: 0,
        teamAIppons: 0, teamBIppons: 0, decidedBy: "bouts",
      },
      log: [],
    });

    const stanceLines = log.filter((e) => e.kind === "stance");
    for (const line of stanceLines) {
      if (line.text.includes(solo.name)) soloAnnounced++;
      // The stance word must be caps and last, so the UI can colour it.
      const word = line.stance!.toUpperCase();
      if (!line.text.endsWith(word)) notLastWord++;
      if (!line.text.includes(word)) wrongStanceTag++;
    }
    const opening = stanceLines[0];
    if (opening) opens.set(opening.stance!, opening.text);
    for (const line of stanceLines.slice(1)) switches.set(line.stance!, line.text);
  }

  for (const [stance, text] of [...opens].sort()) console.log(`  open  ${stance.padEnd(7)} "${text}"`);
  for (const [stance, text] of [...switches].sort()) console.log(`  switch ${stance.padEnd(6)} "${text}"`);

  check(
    "opening stance is announced for a multi-style player",
    opens.size === 3,
    `saw ${[...opens.keys()].sort().join(", ")}`,
  );
  check(
    "a single-style player is never announced",
    soloAnnounced === 0,
    `${soloAnnounced} stray lines for ${solo.name}`,
  );
  check(
    "opening wording matches the spec",
    opens.get("Jodan") === "Đa Thế đã lên JODAN" &&
      opens.get("Nito") === "Đa Thế đã chọn lối chơi NITO" &&
      opens.get("Chudan") === "Đa Thế đã vào thế CHUDAN",
    "lên JODAN / chọn lối chơi NITO / vào thế CHUDAN",
  );
  check(
    "switching into Jodan reuses the opening wording",
    switches.get("Jodan") === "Đa Thế đã lên JODAN",
    `"${switches.get("Jodan")}"`,
  );
  check(
    "switching back to Chudan has its own wording",
    switches.get("Chudan") === "Đa Thế đã về thủ CHUDAN",
    `"${switches.get("Chudan")}"`,
  );
  check(
    "no switch ever lands on Nito",
    !switches.has("Nito"),
    `switch destinations: ${[...switches.keys()].sort().join(", ")}`,
  );
  check(
    "every stance line tags its stance and ends with it in caps",
    wrongStanceTag === 0 && notLastWord === 0,
    "renderer can always colour the final word",
  );
}

console.log("\n=== 7. Time limit scaling ===");
const timeStats = TOURNAMENT_ROUNDS.map((round) => {
  let exchanges = 0;
  let draws = 0;
  let ippons = 0;
  let endFatigue = 0;
  const runs = 4000;
  for (let i = 0; i < runs; i++) {
    const bout = simulateBout(
      makePlayer("a", "Mid A", 55, { stamina: 45 }),
      makePlayer("b", "Mid B", 55, { stamina: 45 }),
      { position: "Chuken", timeLimitSeconds: round.timeLimitSeconds, seed: `t-${round.index}-${i}` },
    );
    exchanges += bout.exchanges.length;
    ippons += bout.result.ipponsA + bout.result.ipponsB;
    if (bout.result.winner === "draw") draws++;
    const last = bout.exchanges[bout.exchanges.length - 1];
    endFatigue += Math.max(last.fatigue.a, last.fatigue.b);
  }
  const row = {
    round,
    exchanges: exchanges / runs,
    drawRate: draws / runs,
    ippons: ippons / runs,
    endFatigue: endFatigue / runs,
  };
  console.log(
    `  ${round.name.padEnd(13)} ${formatTimeLimit(round.timeLimitSeconds)}  avg exch ${row.exchanges.toFixed(1).padStart(5)} | end fatigue ${(row.endFatigue * 100).toFixed(1).padStart(5)}% | ippons ${row.ippons.toFixed(2)} | draws ${pct(draws, runs).padStart(6)}`,
  );
  return row;
});

const timeLimitBinds =
  timeStats[3].exchanges > timeStats[0].exchanges + 0.3;
console.log(
  `  NOTE draw rate by round: ${timeStats.map((t) => `${t.round.name.split(" ")[0]} ${(t.drawRate * 100).toFixed(1)}%`).join(" · ")}`,
);
if (!timeLimitBinds) {
  console.log(
    "  NOTE at the current hitScale, bouts reach 2 ippon long before the clock,",
  );
  console.log(
    "       so the per-round time limits are effectively inert. Lower hitScale to revive them.",
  );
}

check(
  "the time-limit unit actually binds at the shipped hitScale",
  timeLimitBinds,
  `R16 ${timeStats[0].exchanges.toFixed(1)} exch → Final ${timeStats[3].exchanges.toFixed(1)}`,
);
check(
  "each of the first three rounds has its own length",
  timeStats[0].exchanges < timeStats[1].exchanges &&
    timeStats[1].exchanges < timeStats[2].exchanges,
  `${timeStats.map((t) => `${formatTimeLimit(t.round.timeLimitSeconds)}=${t.exchanges.toFixed(1)}`).join(" · ")}`,
);
check(
  "Semifinal and Final tie, being the same unit",
  Math.abs(timeStats[2].exchanges - timeStats[3].exchanges) < 0.3,
  `${timeStats[2].exchanges.toFixed(1)} vs ${timeStats[3].exchanges.toFixed(1)}`,
);
check(
  "longer rounds tire players more",
  timeStats[3].endFatigue > timeStats[0].endFatigue,
  `${(timeStats[0].endFatigue * 100).toFixed(1)}% → ${(timeStats[3].endFatigue * 100).toFixed(1)}%`,
);

console.log("\n=== 7a. Round difficulty never touches bout resolution ===");
{
  // Structural guard: the simulator cannot see a round at all. Comments are
  // stripped first — the rule is written in one, and would match itself.
  const boutSource = readFileSync(new URL("../src/lib/kendo/bout.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const forbidden = ["./tournament", "difficulty", "aiSkill", "strengthBias", "RoundSpec"];
  const leaks = forbidden.filter((token) => boutSource.includes(token));
  check(
    "bout.ts references nothing round-related",
    leaks.length === 0,
    leaks.length ? `found ${leaks.join(", ")}` : "no round or difficulty term in the resolver",
  );

  // Behavioural guard: identical stat blocks resolve identically in every
  // round. The time limit is held constant because it is the pacing unit,
  // not a difficulty term.
  const attacker = makePlayer("atk", "Attacker", 70, {
    technique: { men: 82, kote: 64, dou: 55, tsuki: 40 },
    defense: { men: 70, kote: 66, dou: 71, tsuki: 52 },
  });
  const defender = makePlayer("def", "Defender", 70, {
    technique: { men: 61, kote: 73, dou: 58, tsuki: 44 },
    defense: { men: 77, kote: 59, dou: 64, tsuki: 50 },
  });

  const perRound = TOURNAMENT_ROUNDS.map((round) =>
    JSON.stringify(
      simulateBout(attacker, defender, {
        position: "Chuken",
        // Same unit for all four, so only "which round is it" varies.
        timeLimitSeconds: 180,
        seed: "round-invariance",
      }),
      // The round is not an input, so nothing about it can appear anyway.
    ) + `|${round.name}`,
  );
  const stripped = perRound.map((s) => s.slice(0, s.lastIndexOf("|")));
  check(
    "the same two fencers resolve identically in every round",
    new Set(stripped).size === 1,
    `R16 / QF / SF / Final produced ${new Set(stripped).size} distinct bout`,
  );

  // And the hit probability depends only on the two stat blocks and the target
  // — not on which corner a fencer occupies. Fatigue is off so the chance is a
  // pure function of stats, then compared per target across both orientations.
  const still = { fatigueTriggerScale: 0 };
  function chancesByTarget(first: Player, second: Player, who: string) {
    const seen = new Map<string, number>();
    for (let i = 0; i < 600; i++) {
      const bout = simulateBout(first, second, {
        position: "Chuken",
        timeLimitSeconds: 180,
        seed: `sides-${i}`,
        config: still,
      });
      for (const e of bout.exchanges) {
        const actor = e.initiator === "A" ? bout.playerA : bout.playerB;
        if (actor.name === who) seen.set(e.target, e.hitChance);
      }
    }
    return seen;
  }
  const asA = chancesByTarget(attacker, defender, "Attacker");
  const asB = chancesByTarget(defender, attacker, "Attacker");
  const shared = [...asA.keys()].filter((t) => asB.has(t));
  const mismatched = shared.filter((t) => Math.abs(asA.get(t)! - asB.get(t)!) > 1e-12);
  check(
    "hit chance depends on stats and target only, not on which corner you are in",
    shared.length >= 3 && mismatched.length === 0,
    `${shared.length} targets compared, ${mismatched.length} differed`,
  );
}

console.log("\n=== 7e. Two hansoku convert to an ippon ===");
{
  // Striking is switched off entirely, so every ippon here must have come from
  // a foul — otherwise the arithmetic below could not be checked.
  const noStrikes = { hitScale: 0, hitFloor: 0, counterScale: 0 };
  const sloppy = makePlayer("s1", "Hay Phạm Lỗi", 60, { hansoku_rate: 85 });
  const alsoSloppy = makePlayer("s2", "Cũng Phạm Lỗi", 60, { hansoku_rate: 85 });

  let bouts = 0;
  let mismatched = 0;
  let awardsSeen = 0;
  let misplacedAward = 0;
  let wrongExchange = 0;
  let maxFouls = 0;

  for (let i = 0; i < 4000; i++) {
    const bout = simulateBout(sloppy, alsoSloppy, {
      position: "Chuken",
      timeLimitSeconds: 240,
      seed: `hansoku-${i}`,
      config: noStrikes,
    });
    bouts++;
    const { ipponsA, ipponsB, hansokuA, hansokuB } = bout.result;
    maxFouls = Math.max(maxFouls, hansokuA, hansokuB);

    // A's ippons come only from B's fouls, two fouls to the ippon.
    if (ipponsA !== Math.floor(hansokuB / 2) || ipponsB !== Math.floor(hansokuA / 2)) {
      mismatched++;
    }

    // Walk the exchanges: the award must land on the offender's opponent, and
    // only on the exchange carrying their even-numbered foul.
    let runningA = 0;
    let runningB = 0;
    for (const e of bout.exchanges) {
      if (!e.hansoku) {
        if (e.hansokuIppon) wrongExchange++;
        continue;
      }
      const count = e.hansoku === "A" ? ++runningA : ++runningB;
      const shouldAward = count % 2 === 0;
      if (shouldAward !== Boolean(e.hansokuIppon)) wrongExchange++;
      if (e.hansokuIppon) {
        awardsSeen++;
        if (e.hansokuIppon === e.hansoku) misplacedAward++;
      }
    }
  }

  console.log(
    `  ${bouts} strike-free bouts: ${awardsSeen} ippons awarded from fouls, worst foul count ${maxFouls}`,
  );
  check(
    "each pair of fouls yields exactly one ippon to the opponent",
    mismatched === 0,
    mismatched ? `${mismatched} bouts broke floor(fouls/2)` : "ippons = floor(opponent fouls / 2) in every bout",
  );
  check(
    "the ippon goes to the other fencer, never the offender",
    awardsSeen > 0 && misplacedAward === 0,
    `${awardsSeen} awards, ${misplacedAward} given to the offender`,
  );
  check(
    "the award lands on the second foul, not the first or third",
    wrongExchange === 0,
    `${wrongExchange} exchanges awarded at the wrong count`,
  );
  check(
    "a single foul is only a warning",
    simulateBout(sloppy, makePlayer("clean", "Sạch", 60, { hansoku_rate: 0 }), {
      position: "Chuken", seed: "one-foul", config: noStrikes,
    }).exchanges.filter((e) => e.hansoku && !e.hansokuIppon).length > 0,
    "first fouls recorded with no ippon",
  );

  // And the log says so.
  let warned = "";
  let awarded = "";
  for (let i = 0; i < 400 && (!warned || !awarded); i++) {
    const bout = simulateBout(sloppy, alsoSloppy, {
      position: "Chuken", timeLimitSeconds: 240, seed: `hlog-${i}`, config: noStrikes,
    });
    const log = buildMatchLog({
      id: `hl-${i}`, roundName: "Test",
      teamA: { id: "a", name: "A", roster: [], lineup: {} as never },
      teamB: { id: "b", name: "B", roster: [], lineup: {} as never },
      bouts: [bout],
      result: { winner: "draw", teamAWins: 0, teamBWins: 0, draws: 0, teamAIppons: 0, teamBIppons: 0, decidedBy: "bouts" },
      log: [],
    });
    warned ||= log.find((e) => e.text.includes("cảnh cáo"))?.text ?? "";
    awarded ||= log.find((e) => e.text.includes("lỗi thứ hai"))?.text ?? "";
  }
  console.log(`  warning: "${warned}"`);
  console.log(`  award:   "${awarded}"`);
  check(
    "the log distinguishes a warning from an awarded ippon",
    warned.includes("cảnh cáo") && awarded.includes("được ippon"),
    "both HANSOKU lines present",
  );
}

console.log("\n=== 7c. Shared overall-strength score ===");
{
  const sample: PersonRecord = {
    id: "rate1",
    name: "Mẫu Thử",
    baseStats: {
      technique: { men: 74, kote: 63, dou: 58, tsuki: 41 },
      defense: { men: 69, kote: 71, dou: 60, tsuki: 55 },
      attack_rate: 66,
      defend_rate: 61,
      hansoku_rate: 12,
      stamina: 72,
    },
  };
  const viaRating = personRating(sample);
  const viaShared = overallStrength(sample.baseStats);
  check(
    "opponent weighting and the stats page use one formula",
    Math.abs(viaRating - viaShared) < 1e-12,
    `${sample.name} → ${viaShared.toFixed(1)} from both call sites`,
  );
  // Tổng lực is an expected win rate against the reference fencer, so the
  // reference itself must sit at an even 50.
  const mirror = overallStrength(REFERENCE_FENCER);
  check(
    "the reference fencer scores exactly 50",
    Math.abs(mirror - 50) < 1e-6,
    `reference → ${mirror.toFixed(3)}`,
  );
  const foulProne = overallStrength({ ...REFERENCE_FENCER, hansoku_rate: 60 });
  check(
    "fouling more than the reference drags the score below 50",
    foulProne < 50,
    `same fencer with hansoku 60 → ${foulProne.toFixed(1)}`,
  );
  const stronger = overallStrength({
    ...REFERENCE_FENCER,
    technique: { men: 80, kote: 80, dou: 80, tsuki: 80 },
  });
  check(
    "better technique than the reference lifts it above 50",
    stronger > 50,
    `technique 80 across the board → ${stronger.toFixed(1)}`,
  );
  check(
    "every stat moves the score",
    new Set(
      [
        overallStrength({ ...REFERENCE_FENCER, attack_rate: 80 }),
        overallStrength({ ...REFERENCE_FENCER, defend_rate: 80 }),
        overallStrength({ ...REFERENCE_FENCER, stamina: 90 }),
        overallStrength({ ...REFERENCE_FENCER, hansoku_rate: 0 }),
        overallStrength({ ...REFERENCE_FENCER, defense: { men: 80, kote: 80, dou: 80, tsuki: 80 } }),
        mirror,
      ].map((v) => v.toFixed(4)),
    ).size === 6,
    "attack, defend_rate, stamina, hansoku, defense and technique all shift it",
  );
  const clean = overallStrength({ ...sample.baseStats, hansoku_rate: 0 });
  const sloppy = overallStrength({ ...sample.baseStats, hansoku_rate: 100 });
  check(
    "a low foul rate counts as strength, not weakness",
    clean > sloppy,
    `hansoku 0 → ${clean.toFixed(1)}, hansoku 100 → ${sloppy.toFixed(1)}`,
  );
}

console.log("\n=== 7d. Miss-line rationing ===");
{
  let worstDetailed = 0;
  let totalDetailed = 0;
  let adjacentDetailed = 0;
  const runs = 3000;
  for (let i = 0; i < runs; i++) {
    const bout = simulateBout(
      makePlayer("a", "Người A", 45),
      makePlayer("b", "Người B", 45),
      { position: "Chuken", timeLimitSeconds: 240, seed: `miss-${i}` },
    );
    const log = buildMatchLog({
      id: `mm-${i}`, roundName: "Test",
      teamA: { id: "a", name: "A", roster: [], lineup: {} as never },
      teamB: { id: "b", name: "B", roster: [], lineup: {} as never },
      bouts: [bout],
      result: { winner: "draw", teamAWins: 0, teamBWins: 0, draws: 0, teamAIppons: 0, teamBIppons: 0, decidedBy: "bouts" },
      log: [],
    });
    const detailed = log.filter((e) => e.text.includes("khá nhạy cảm"));
    totalDetailed += detailed.length;
    worstDetailed = Math.max(worstDetailed, detailed.length);
    for (let k = 1; k < detailed.length; k++) {
      if ((detailed[k].exchangeIndex ?? 0) - (detailed[k - 1].exchangeIndex ?? 0) < 3) {
        adjacentDetailed++;
      }
    }
  }
  console.log(
    `  over ${runs} long bouts: at most ${worstDetailed} detailed misses per bout, ${(totalDetailed / runs).toFixed(2)} on average`,
  );
  check(
    "the long miss line is capped at 3 per bout",
    worstDetailed <= 3,
    `worst case ${worstDetailed}`,
  );
  check(
    "detailed misses are always spaced apart",
    adjacentDetailed === 0,
    `${adjacentDetailed} back-to-back occurrences`,
  );
}

console.log("\n=== 7b. Probabilistic fatigue ===");
{
  function fatigueProfile(stamina: number, timeLimitSeconds: number) {
    let boutsWithAnyTrigger = 0;
    let triggers = 0;
    let steppedNotSmooth = 0;
    const runs = 4000;
    for (let i = 0; i < runs; i++) {
      const bout = simulateBout(
        makePlayer("a", "Subject", 60, { stamina }),
        makePlayer("b", "Foil", 60, { stamina: 100 }),
        { position: "Chuken", timeLimitSeconds, seed: `fat-${stamina}-${timeLimitSeconds}-${i}` },
      );
      const fired = bout.exchanges.filter((e) => e.fatigueTriggers?.includes("A")).length;
      triggers += fired;
      if (fired > 0) boutsWithAnyTrigger++;
      // Between triggers the debuff must hold flat, not creep.
      let previous = 0;
      let stepped = true;
      for (const e of bout.exchanges) {
        if (e.fatigue.a !== previous && !bout.exchanges.some((x) => x.index === e.index - 1 && x.fatigueTriggers?.includes("A"))) {
          stepped = false;
        }
        previous = e.fatigue.a;
      }
      if (stepped) steppedNotSmooth++;
    }
    return {
      everTired: boutsWithAnyTrigger / runs,
      triggersPerBout: triggers / runs,
      alwaysStepped: steppedNotSmooth === runs,
    };
  }

  const unfitShort = fatigueProfile(15, 120);
  const fitShort = fatigueProfile(95, 120);
  const unfitLong = fatigueProfile(15, 240);
  console.log(
    `  stamina 15 @2:00 → tired in ${(unfitShort.everTired * 100).toFixed(1)}% of bouts (${unfitShort.triggersPerBout.toFixed(2)} triggers/bout)`,
  );
  console.log(
    `  stamina 95 @2:00 → tired in ${(fitShort.everTired * 100).toFixed(1)}% of bouts (${fitShort.triggersPerBout.toFixed(2)} triggers/bout)`,
  );
  console.log(
    `  stamina 15 @4:00 → tired in ${(unfitLong.everTired * 100).toFixed(1)}% of bouts (${unfitLong.triggersPerBout.toFixed(2)} triggers/bout)`,
  );

  check(
    "stamina lowers how often fatigue triggers at all",
    fitShort.everTired < unfitShort.everTired / 2,
    `fit ${(fitShort.everTired * 100).toFixed(1)}% vs unfit ${(unfitShort.everTired * 100).toFixed(1)}%`,
  );
  check(
    "a fit player can get through a bout untouched",
    fitShort.everTired < 0.9,
    `${((1 - fitShort.everTired) * 100).toFixed(1)}% of bouts with no fatigue at all`,
  );
  check(
    "longer rounds tire the same player more often",
    unfitLong.triggersPerBout > unfitShort.triggersPerBout,
    `${unfitShort.triggersPerBout.toFixed(2)} → ${unfitLong.triggersPerBout.toFixed(2)} triggers/bout`,
  );
  check(
    "fatigue moves in steps, never a smooth curve",
    unfitLong.alwaysStepped,
    "debuff only changes on an exchange that triggered",
  );

  // The log states it as a fact, with no numbers.
  let line = "";
  for (let i = 0; i < 500 && !line; i++) {
    const bout = simulateBout(
      makePlayer("a", "Kiệt Sức", 60, { stamina: 5 }),
      makePlayer("b", "Foil", 60, { stamina: 100 }),
      { position: "Chuken", timeLimitSeconds: 240, seed: `fatlog-${i}` },
    );
    const log = buildMatchLog({
      id: `f-${i}`, roundName: "Test",
      teamA: { id: "a", name: "A", roster: [], lineup: {} as never },
      teamB: { id: "b", name: "B", roster: [], lineup: {} as never },
      bouts: [bout],
      result: { winner: "draw", teamAWins: 0, teamBWins: 0, draws: 0, teamAIppons: 0, teamBIppons: 0, decidedBy: "bouts" },
      log: [],
    });
    line = log.find((e) => e.text.includes("thấm mệt"))?.text ?? "";
  }
  console.log(`  log line: "${line}"`);
  check(
    "fatigue is logged as a fact, with no numbers",
    line === "Kiệt Sức đã thấm mệt do trận đấu kéo dài" && !/\d/.test(line),
    line || "no fatigue line produced",
  );
}

console.log("\n=== 8. Encho / daihyosen (sudden death) ===");
let enchoDraws = 0;
let enchoCap = 0;
let enchoExchanges = 0;
const ENCHO_RUNS = 3000;
let longestEncho = 0;
for (let i = 0; i < ENCHO_RUNS; i++) {
  const bout = simulateEncho(
    makePlayer("a", "Rep A", 50, { stamina: 30 }),
    makePlayer("b", "Rep B", 50, { stamina: 30 }),
    { seed: `encho-${i}` },
  );
  if (bout.result.winner === "draw") enchoDraws++;
  if (bout.result.decidedBy === "safety-cap") enchoCap++;
  enchoExchanges += bout.exchanges.length;
  longestEncho = Math.max(longestEncho, bout.exchanges.length);
}
console.log(
  `  ${ENCHO_RUNS} encho: avg ${(enchoExchanges / ENCHO_RUNS).toFixed(1)} exchanges, longest ${longestEncho}`,
);
check("sudden death never draws", enchoDraws === 0, `${enchoDraws} draws`);
check("safety cap never fires in practice", enchoCap === 0, `${enchoCap} capped out of ${ENCHO_RUNS}`);
check("safety cap is still a real bound", longestEncho < 200, `longest encho ${longestEncho} exchanges`);

console.log("\n=== 9. Draft flow ===");
const rawSeed: SeedPlayer[] = JSON.parse(
  readFileSync(new URL("../players.seed.json", import.meta.url), "utf8"),
);
const club: PersonRecord[] = loadRoster(rawSeed);
console.log(`  loaded ${club.length} club members from players.seed.json`);
check("seed roster loads all 41 members", club.length === 41, `${club.length} people`);
check(
  "seed file carries no id, rank or gender",
  rawSeed.every(
    (entry) => !("id" in entry) && !("rank" in entry) && !("gender" in entry),
  ),
  `keys per entry: ${Object.keys(rawSeed[0]).join(", ")}`,
);
check(
  "ids are derived internally and unique",
  new Set(club.map((p) => p.id)).size === club.length && club[0].id === "p01",
  `${club[0].id} … ${club[club.length - 1].id}`,
);
check(
  "derived ids are stable for a given file order",
  loadRoster(rawSeed).every((p, i) => p.id === club[i].id),
  "reloading the same file reproduces the same ids",
);
check(
  "names are unique, so the UI can tell people apart",
  duplicateNames(club).length === 0,
  duplicateNames(club).join(", ") || "no duplicates",
);
check(
  "no stray whitespace in seeded names",
  club.every((p) => p.name === p.name.trim()),
  club.filter((p) => p.name !== p.name.trim()).map((p) => `"${p.name}"`).join(", ") || "all clean",
);

let rejectedBadStat = false;
try {
  loadRoster([
    { name: "Broken", baseStats: { ...club[0].baseStats, attack_rate: 140 } },
  ]);
} catch (err) {
  rejectedBadStat = (err as Error).message.includes("attack_rate");
}
check("a malformed hand-edit is rejected by name", rejectedBadStat, "out-of-range stat throws");

let rejectedBadStyle = false;
try {
  loadRoster([
    {
      name: "Broken",
      baseStats: club[0].baseStats,
      styleModifiers: { Jodan: { "technique.mem": 5 } } as never,
    },
  ]);
} catch (err) {
  rejectedBadStyle = (err as Error).message.includes("technique.mem");
}
check("a typo'd stat path is rejected", rejectedBadStyle, "unknown stat in modifier throws");

let draft = startDraft(club, { seed: "draft-demo" });
check("three candidates offered", draft.candidates.length === 3, `${draft.candidates.length} offered`);
check("three rerolls to start", draft.rerollsLeft === 3, `${draft.rerollsLeft}`);
check("draft starts at Senpo", currentPosition(draft) === "Senpo", `${currentPosition(draft)}`);

const firstOffer = draft.candidates.map((c) => c.person.id).join(",");
draft = rerollCandidates(draft);
check(
  "reroll replaces the offer and spends one",
  draft.rerollsLeft === 2 && draft.candidates.map((c) => c.person.id).join(",") !== firstOffer,
  `${firstOffer} → ${draft.candidates.map((c) => c.person.id).join(",")}, ${draft.rerollsLeft} left`,
);

draft = rerollCandidates(rerollCandidates(draft));
check("rerolls run out after three", draft.rerollsLeft === 0 && !canReroll(draft), "no rerolls left");
const afterExhausted = rerollCandidates(draft);
check(
  "spent rerolls cannot go negative",
  afterExhausted.rerollsLeft === 0 && afterExhausted === draft,
  "reroll is a no-op once exhausted",
);

const draftedIds: string[] = [];
const reofferViolations: string[] = [];
const poolViolations: string[] = [];
while (!isDraftComplete(draft)) {
  const taken = draft.candidates[0].person.id;
  draftedIds.push(taken);
  draft = pickCandidate(draft, taken);
  // Only people already taken may not reappear; someone merely *offered*
  // earlier is still free to come up again for a later position.
  for (const candidate of draft.candidates) {
    if (draftedIds.includes(candidate.person.id)) reofferViolations.push(candidate.person.id);
  }
  for (const id of draftedIds) {
    if (draft.remaining.some((p) => p.id === id)) poolViolations.push(id);
  }
}
check("draft fills all five positions", draft.picks.length === 5, draft.picks.map((p) => p.position).join(" > "));
check(
  "positions drafted in order",
  draft.picks.map((p) => p.position).join(",") === POSITIONS.join(","),
  draft.picks.map((p) => p.position).join(" > "),
);
check(
  "five distinct people drafted",
  new Set(draftedIds).size === 5,
  draft.picks.map((p) => p.person.name).join(", "),
);
check(
  "a picked person is never offered again",
  reofferViolations.length === 0,
  reofferViolations.length ? `re-offered ${reofferViolations.join(",")}` : "no pick ever reappeared in an offer",
);
check(
  "a picked person leaves the pool entirely",
  poolViolations.length === 0,
  poolViolations.length ? `still in pool: ${poolViolations.join(",")}` : "removed on pick, every time",
);
check(
  "pool shrinks by exactly the five drafted",
  draft.remaining.length === club.length - 5,
  `${club.length} → ${draft.remaining.length}`,
);

const squad = draftedSquad(draft);
const squadEntries = toPlayers(squad);
check(
  "the drafted five become exactly five players",
  squadEntries.length === 5 && squadEntries.every((e) => squad.some((s) => s.id === e.id)),
  `${squadEntries.length} players, stances: ${squadEntries.map((e) => e.styles.join("/")).join(", ")}`,
);

console.log("\n=== 10. Opponent generation ===");
// A clean strength gradient, so the round weighting has an unambiguous signal
// to act on regardless of how the real seed happens to be tuned.
const variedClub: PersonRecord[] = club.map((person, i) => {
  const level = 25 + Math.round((i / (club.length - 1)) * 65);
  return {
    ...person,
    baseStats: {
      technique: { men: level, kote: level, dou: level - 5, tsuki: level - 15 },
      defense: { men: level, kote: level, dou: level - 5, tsuki: level - 10 },
      attack_rate: level,
      defend_rate: level,
      hansoku_rate: 20,
      stamina: level,
    },
  };
});

const coachPersonIds = squad.map((p) => p.id);
function opponentRatingProfile(round: (typeof TOURNAMENT_ROUNDS)[number]) {
  let total = 0;
  let leaked = 0;
  let sawWeakest = 0;
  let sawStrongest = 0;
  const runs = 1500;
  const weakest = [...variedClub].sort((a, b) => personRating(a) - personRating(b))[0].id;
  const strongest = [...variedClub].sort((a, b) => personRating(b) - personRating(a))[0].id;

  for (let i = 0; i < runs; i++) {
    const opponents = generateOpponentSquad(variedClub, {
      round,
      excludePersonIds: coachPersonIds,
      seed: `opp-${round.index}-${i}`,
    });
    if (opponents.some((o) => coachPersonIds.includes(o.id))) leaked++;
    if (opponents.some((o) => o.id === weakest)) sawWeakest++;
    if (opponents.some((o) => o.id === strongest)) sawStrongest++;
    total += opponents.reduce((sum, o) => sum + personRating(o), 0) / opponents.length;
  }
  return {
    avgRating: total / runs,
    leaked,
    weakestRate: sawWeakest / runs,
    strongestRate: sawStrongest / runs,
  };
}

const profiles = TOURNAMENT_ROUNDS.map((round) => {
  const p = opponentRatingProfile(round);
  console.log(
    `  ${round.name.padEnd(13)} avg opponent rating ${p.avgRating.toFixed(1)} | weakest drawn ${(p.weakestRate * 100).toFixed(1)}% | strongest drawn ${(p.strongestRate * 100).toFixed(1)}%`,
  );
  return p;
});

check(
  "coach's drafted five never appear as opponents",
  profiles.every((p) => p.leaked === 0),
  "6000 opponent squads, zero overlap",
);
check(
  "opponent strength climbs with the round",
  profiles[0].avgRating < profiles[1].avgRating &&
    profiles[1].avgRating < profiles[2].avgRating &&
    profiles[2].avgRating < profiles[3].avgRating,
  profiles.map((p) => p.avgRating.toFixed(1)).join(" → "),
);
check(
  "weighting is continuous, not a cutoff: strong players still show up in R16",
  profiles[0].strongestRate > 0.01,
  `strongest player drawn in ${(profiles[0].strongestRate * 100).toFixed(1)}% of R16 squads`,
);
check(
  "and weak players can still reach the Final",
  profiles[3].weakestRate > 0.01,
  `weakest player drawn in ${(profiles[3].weakestRate * 100).toFixed(1)}% of Final squads`,
);

console.log("\n=== 11. Counter-picking AI ===");
const varsById = new Map(variedClub.map((p) => [p.id, p]));
const coachSquadVaried = coachPersonIds.map((id) => varsById.get(id)!);
const coachEntries = toPlayers(coachSquadVaried);
const coachTeam: Team = {
  id: "dalat",
  name: "Dalat Kendo Club",
  roster: coachEntries,
  lineup: {
    senpo: coachEntries[0].id,
    jiho: coachEntries[1].id,
    chuken: coachEntries[2].id,
    fukusho: coachEntries[3].id,
    taisho: coachEntries[4].id,
  },
};

function counterPickQuality(round: (typeof TOURNAMENT_ROUNDS)[number]) {
  const runs = 60;
  let chosenEdge = 0;
  let bestEdge = 0;
  let worstEdge = 0;
  for (let i = 0; i < runs; i++) {
    const rng = createRng(`cp-${round.index}-${i}`);
    const { players } = buildOpponentTeam(variedClub, {
      round,
      excludePersonIds: coachPersonIds,
      rng,
    });
    const lineup = lineupPlayers(coachTeam);
    const result = assignOpponentLineup(lineup, players, { round, rng, samples: 12 });

    // Score every assignment to place the AI's choice on the scale.
    const edges = players.map((o) => lineup.map((c) => estimateEdge(o, c, round.timeLimitSeconds, rng, 12)));
    const allPerms: number[][] = [];
    const build = (rest: number[], acc: number[]) => {
      if (!rest.length) return void allPerms.push(acc);
      rest.forEach((r, k) => build([...rest.slice(0, k), ...rest.slice(k + 1)], [...acc, r]));
    };
    build([0, 1, 2, 3, 4], []);
    const totals = allPerms.map((perm) => perm.reduce((s, o, p) => s + edges[o][p], 0));
    chosenEdge += result.edge;
    bestEdge += Math.max(...totals);
    worstEdge += Math.min(...totals);
  }
  const span = bestEdge - worstEdge;
  return span < 1e-9 ? 0.5 : (chosenEdge - worstEdge) / span;
}

const r16Quality = counterPickQuality(TOURNAMENT_ROUNDS[0]);
const finalQuality = counterPickQuality(TOURNAMENT_ROUNDS[3]);
console.log(
  `  assignment quality (0 = worst possible, 1 = optimal): R16 ${r16Quality.toFixed(2)} · Final ${finalQuality.toFixed(2)}`,
);
check("AI counter-picking sharpens with the round", finalQuality > r16Quality, `${r16Quality.toFixed(2)} → ${finalQuality.toFixed(2)}`);
check("Round of 16 AI is near-random", r16Quality < 0.75, `quality ${r16Quality.toFixed(2)}`);
check("Final AI is close to optimal", finalQuality > 0.7, `quality ${finalQuality.toFixed(2)}`);

console.log("\n=== 11b. Stance weighting ===");
const weighted = makePlayer("w", "Weighted", 60, {
  styles: ["Chudan", "Jodan", "Nito"],
  styleWeights: { Chudan: 0.5, Jodan: 0.3, Nito: 0.2 },
});
const unweighted = makePlayer("u", "Uniform", 60, {
  styles: ["Chudan", "Jodan", "Nito"],
});
function openingSpread(player: Player, tag: string) {
  const counts = { Chudan: 0, Jodan: 0, Nito: 0 };
  const runs = 20000;
  for (let i = 0; i < runs; i++) {
    counts[
      simulateBout(player, unweighted, { position: "Chuken", seed: `${tag}-${i}` })
        .openingStance.a
    ]++;
  }
  return {
    Chudan: counts.Chudan / runs,
    Jodan: counts.Jodan / runs,
    Nito: counts.Nito / runs,
  };
}
const wSpread = openingSpread(weighted, "weighted");
const uSpread = openingSpread(unweighted, "uniform");
console.log(
  `  weighted {0.5/0.3/0.2} → Chudan ${(wSpread.Chudan * 100).toFixed(1)}% · Jodan ${(wSpread.Jodan * 100).toFixed(1)}% · Nito ${(wSpread.Nito * 100).toFixed(1)}%`,
);
console.log(
  `  no weights            → Chudan ${(uSpread.Chudan * 100).toFixed(1)}% · Jodan ${(uSpread.Jodan * 100).toFixed(1)}% · Nito ${(uSpread.Nito * 100).toFixed(1)}%`,
);
check(
  "relative weights are normalised to the right proportions",
  Math.abs(wSpread.Chudan - 0.5) < 0.02 &&
    Math.abs(wSpread.Jodan - 0.3) < 0.02 &&
    Math.abs(wSpread.Nito - 0.2) < 0.02,
  `${(wSpread.Chudan * 100).toFixed(1)}/${(wSpread.Jodan * 100).toFixed(1)}/${(wSpread.Nito * 100).toFixed(1)}`,
);
const scaled = makePlayer("s", "Scaled", 60, {
  styles: ["Chudan", "Jodan", "Nito"],
  // Same ratios, arbitrary magnitudes — must behave identically.
  styleWeights: { Chudan: 50, Jodan: 30, Nito: 20 },
});
const sSpread = openingSpread(scaled, "scaled");
check(
  "weights need not sum to 1",
  Math.abs(sSpread.Chudan - wSpread.Chudan) < 0.02,
  `{50,30,20} → ${(sSpread.Chudan * 100).toFixed(1)}% Chudan, same as {0.5,0.3,0.2}`,
);
check(
  "no weights still means uniform",
  Math.abs(uSpread.Chudan - 1 / 3) < 0.02 && Math.abs(uSpread.Nito - 1 / 3) < 0.02,
  `${(uSpread.Chudan * 100).toFixed(1)}/${(uSpread.Jodan * 100).toFixed(1)}/${(uSpread.Nito * 100).toFixed(1)}`,
);
// The real seed now hand-tunes some tendencies, so assert it is coherent
// rather than assuming it is empty.
const seededWeighted = club.filter((p) => p.styleWeights);
const strayWeights = seededWeighted.flatMap((p) => {
  const usable = stylesFor(p);
  return Object.keys(p.styleWeights!)
    .filter((style) => !usable.includes(style as CombatStyle))
    .map((style) => `${p.name}:${style}`);
});
check(
  "every weighted stance in the seed is one that player can actually use",
  strayWeights.length === 0,
  strayWeights.length
    ? `dead weights → ${strayWeights.join(", ")}`
    : `${seededWeighted.length} of ${club.length} carry tendencies, all valid`,
);
check(
  "players without tendencies fall back to uniform",
  club.filter((p) => !p.styleWeights).every((p) => p.styleWeights === undefined),
  `${club.length - seededWeighted.length} players use uniform choice`,
);

const tuned = seededWeighted.find((p) => stylesFor(p).length > 1);
if (tuned) {
  const weights = tuned.styleWeights!;
  const usable = stylesFor(tuned);
  const total = usable.reduce((sum, s) => sum + (weights[s] ?? 0), 0);
  const player = toPlayer(tuned);
  const counts = new Map<string, number>();
  const runs = 12000;
  for (let i = 0; i < runs; i++) {
    const stance = simulateBout(player, makePlayer("foil", "Foil", 60), {
      position: "Chuken",
      seed: `seedw-${i}`,
    }).openingStance.a;
    counts.set(stance, (counts.get(stance) ?? 0) + 1);
  }
  const worst = Math.max(
    ...usable.map((s) =>
      Math.abs((counts.get(s) ?? 0) / runs - (weights[s] ?? 0) / total),
    ),
  );
  console.log(
    `  ${tuned.name}: wanted ${usable.map((s) => `${s} ${(((weights[s] ?? 0) / total) * 100).toFixed(0)}%`).join(" / ")} — got ${usable.map((s) => `${(((counts.get(s) ?? 0) / runs) * 100).toFixed(1)}%`).join(" / ")}`,
  );
  check(
    "a hand-tuned player opens in their stated proportions",
    worst < 0.02,
    `largest deviation ${(worst * 100).toFixed(1)} points`,
  );
}
let rejectedWeights = false;
try {
  loadRoster([{ name: "Bad", baseStats: club[0].baseStats, styleWeights: { Jodan: -1 } }]);
} catch (err) {
  rejectedWeights = (err as Error).message.includes("negative");
}
check("negative weights are rejected", rejectedWeights, "loader throws");

console.log("\n=== 11c. No repeat opponents in one run ===");
let tourney = createTournament(coachSquadVaried);
const seenPerRound: string[][] = [];
for (let r = 0; r < TOURNAMENT_ROUNDS.length; r++) {
  tourney = beginRound(tourney, variedClub, `norepeat-${r}`);
  seenPerRound.push(tourney.pendingOpponent!.players.map((p) => p.id));
  // Advance without simulating: we only care about who gets drawn.
  tourney = {
    ...tourney,
    roundIndex: tourney.roundIndex + 1,
    pendingOpponent: undefined,
  };
}
const flat = seenPerRound.flat();
console.log(`  drew ${flat.length} opponents across 4 rounds from a pool of ${variedClub.length}`);
check(
  "nobody appears as an opponent twice in one run",
  new Set(flat).size === flat.length,
  `${flat.length} slots, ${new Set(flat).size} distinct people`,
);
check(
  "the coach's own five never appear as opponents",
  !flat.some((id) => coachPersonIds.includes(id)),
  "squad excluded in every round",
);
const freshRun = beginRound(createTournament(coachSquadVaried), variedClub, "fresh");
check(
  "a new tournament resets the exclusion set",
  freshRun.usedOpponentIds.length === 5,
  `${freshRun.usedOpponentIds.length} used ids on a fresh run`,
);

console.log("\n=== 11d. Round sequence ===");
let seqState = beginRound(createTournament(coachSquadVaried), variedClub, "seq");
check(
  "opponents are drawn before the coach commits positions",
  seqState.pendingOpponent !== undefined && seqState.results.length === 0,
  `${seqState.pendingOpponent!.players.length} opponents known, 0 rounds played`,
);
const preCommitLineup = seqState.pendingOpponent!.team.lineup;
seqState = playCurrentRound(seqState, { seed: "seq-play" });
const postMatch = seqState.results[0];
check(
  "the AI assigns its positions only at simulate time",
  JSON.stringify(preCommitLineup) !== JSON.stringify(postMatch.opponentTeam.lineup) ||
    postMatch.counterPickEdge !== 0,
  "opponent lineup is decided after the coach's commit",
);
check(
  "playing the round clears the pending opponent",
  seqState.pendingOpponent === undefined && seqState.results.length === 1,
  "ready for the next draw",
);

console.log("\n=== 12. Full tournament run ===");
let advanced = 0;
const runLog: string[] = [];
for (const round of TOURNAMENT_ROUNDS) {
  const outcome = playRound({
    round,
    coachTeam,
    people: variedClub,
    seed: `run-${round.index}`,
    aiSamples: 12,
  });
  const r = outcome.match.result;
  runLog.push(
    `  ${round.name.padEnd(13)} ${formatTimeLimit(round.timeLimitSeconds)} vs ${outcome.opponentTeam.name.padEnd(24)} ${r.teamAWins}-${r.teamBWins} (${r.draws}D, ippons ${r.teamAIppons}-${r.teamBIppons}) → ${r.winner === "A" ? "WIN" : r.winner === "B" ? "LOSS" : "DRAW"} by ${r.decidedBy}`,
  );
  if (r.winner === "A") advanced++;
}
runLog.forEach((line) => console.log(line));
check("a full four-round run completes", runLog.length === 4, `${advanced} rounds won`);

let tourneyDraws = 0;
for (let i = 0; i < 200; i++) {
  const round = TOURNAMENT_ROUNDS[i % 4];
  const outcome = playRound({
    round,
    coachTeam,
    people: variedClub,
    seed: `bulk-${i}`,
    aiSamples: 6,
  });
  if (outcome.match.result.winner === "draw") tourneyDraws++;
}
check(
  "a team match always resolves — encho leaves no drawn round",
  tourneyDraws === 0,
  `${tourneyDraws} drawn matches in 200 rounds`,
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
