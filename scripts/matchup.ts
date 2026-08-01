/**
 * Matchup analyser: works out a head-to-head win probability from the stats by
 * hand, then checks it against the simulator. Run with: npm run matchup
 *
 * The analytic model below deliberately mirrors bout.ts step for step. If the
 * two ever disagree, one of them is wrong.
 */
import { readFileSync } from "node:fs";
import {
  loadRoster,
  overallStrength,
  simulateBout,
  toPlayers,
  COUNTER_TARGETS,
  DEFAULT_CONFIG,
  STYLE_ATTACK_BIAS,
  TARGETS,
  type Player,
  type SeedPlayer,
  type Target,
} from "../src/lib/kendo";

const cfg = DEFAULT_CONFIG;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const club = loadRoster(
  JSON.parse(readFileSync(new URL("../players.seed.json", import.meta.url), "utf8")) as SeedPlayer[],
);
const players = toPlayers(club);
const byName = (n: string) => players.find((p) => p.name === n)!;

/** Everything that can happen in one exchange, as probabilities. */
function exchangeModel(a: Player, b: Player) {
  const bias = STYLE_ATTACK_BIAS.Chudan;

  // Who initiates: attack_rate weighted.
  const wA = Math.max(1, a.attack_rate);
  const wB = Math.max(1, b.attack_rate);
  const pInitA = wA / (wA + wB);

  // Which target the initiator goes for: their own technique, style-biased.
  function targetMix(p: Player) {
    const weights = TARGETS.map((t) => Math.max(1, p.technique[t]) * bias[t]);
    const total = weights.reduce((s, x) => s + x, 0);
    return TARGETS.map((t, i) => ({ target: t, p: weights[i] / total }));
  }

  const hit = (atk: Player, def: Player, t: Target) =>
    clamp(
      (cfg.hitScale * Math.max(1, atk.technique[t])) /
        (Math.max(1, atk.technique[t]) + Math.max(1, def.defense[t])),
      cfg.hitFloor,
      cfg.hitCeiling,
    );

  // Counter-ippon: defender's technique for a plausible counter vs the
  // attacker's defend_rate.
  function counterChance(defender: Player, attacker: Player, attacked: Target) {
    const plausible = COUNTER_TARGETS[attacked];
    const options = TARGETS.filter((t) => plausible[t] !== undefined);
    const weights = options.map(
      (t) => Math.max(1, defender.technique[t]) * plausible[t]! * bias[t],
    );
    const total = weights.reduce((s, x) => s + x, 0);
    return options.reduce((acc, t, i) => {
      const atk = Math.max(1, defender.technique[t]);
      const p = clamp(
        (cfg.counterScale * atk) / (atk + Math.max(1, attacker.defend_rate)),
        0,
        cfg.counterCeiling,
      );
      return acc + (weights[i] / total) * p;
    }, 0);
  }

  function side(atk: Player, def: Player) {
    const mix = targetMix(atk);
    const scores = mix.reduce((s, m) => s + m.p * hit(atk, def, m.target), 0);
    const conceded = mix.reduce(
      (s, m) => s + m.p * (1 - hit(atk, def, m.target)) * counterChance(def, atk, m.target),
      0,
    );
    return { mix, scores, conceded };
  }

  const foul = (p: Player) =>
    clamp((clamp(p.hansoku_rate, 0, 100) / 100) * cfg.hansokuScale, 0, 0.9);

  return {
    pInitA,
    aAttacks: side(a, b),
    bAttacks: side(b, a),
    foulA: foul(a),
    foulB: foul(b),
  };
}

/**
 * Exact win probability by enumerating states over the exchange budget:
 * (ippons A, ippons B, A's foul parity, B's foul parity).
 */
function analyticWinProbability(a: Player, b: Player, timeLimitSeconds: number) {
  const m = exchangeModel(a, b);
  const base = timeLimitSeconds / cfg.secondsPerExchange;
  const min = Math.max(1, Math.round(base * (1 - cfg.exchangeJitter)));
  const max = Math.max(min, Math.round(base * (1 + cfg.exchangeJitter)));

  let winA = 0;
  let winB = 0;
  let draw = 0;

  for (let budget = min; budget <= max; budget++) {
    // state key: ia,ib,fa,fb -> probability
    let states = new Map<string, number>([["0,0,0,0", 1]]);

    for (let step = 0; step < budget; step++) {
      const next = new Map<string, number>();
      const add = (k: string, p: number) => next.set(k, (next.get(k) ?? 0) + p);

      for (const [key, prob] of states) {
        const [ia, ib, fa, fb] = key.split(",").map(Number);
        if (ia >= cfg.ipponsToWin || ib >= cfg.ipponsToWin) {
          add(key, prob); // already decided, bout stopped
          continue;
        }

        for (const [initiator, pInit] of [
          ["A", m.pInitA],
          ["B", 1 - m.pInitA],
        ] as const) {
          const attack = initiator === "A" ? m.aAttacks : m.bAttacks;
          const foul = initiator === "A" ? m.foulA : m.foulB;

          // Strike outcome: attacker scores, defender counters, or nothing.
          const outcomes = [
            { dIa: initiator === "A" ? 1 : 0, dIb: initiator === "B" ? 1 : 0, p: attack.scores },
            { dIa: initiator === "B" ? 1 : 0, dIb: initiator === "A" ? 1 : 0, p: attack.conceded },
            { dIa: 0, dIb: 0, p: 1 - attack.scores - attack.conceded },
          ];

          for (const o of outcomes) {
            if (o.p <= 0) continue;
            // Foul is rolled on the initiator, independent of the strike —
            // unless the strike already ended the bout (mirrors bout.ts).
            const decidedByStrike =
              ia + o.dIa >= cfg.ipponsToWin || ib + o.dIb >= cfg.ipponsToWin;
            const branches = decidedByStrike
              ? ([[false, 1]] as const)
              : ([
                  [true, foul],
                  [false, 1 - foul],
                ] as const);
            for (const [fouled, pf] of branches) {
              if (pf <= 0) continue;
              let nia = ia + o.dIa;
              let nib = ib + o.dIb;
              let nfa = fa;
              let nfb = fb;
              if (fouled) {
                if (initiator === "A") {
                  nfa = (fa + 1) % cfg.hansokuPerIppon;
                  if (nfa === 0) nib += 1;
                } else {
                  nfb = (fb + 1) % cfg.hansokuPerIppon;
                  if (nfb === 0) nia += 1;
                }
              }
              add(`${nia},${nib},${nfa},${nfb}`, prob * pInit * o.p * pf);
            }
          }
        }
      }
      states = next;
    }

    const share = 1 / (max - min + 1);
    for (const [key, prob] of states) {
      const [ia, ib] = key.split(",").map(Number);
      if (ia >= cfg.ipponsToWin || ia > ib) winA += prob * share;
      else if (ib >= cfg.ipponsToWin || ib > ia) winB += prob * share;
      else draw += prob * share;
    }
  }
  return { winA, winB, draw, model: m };
}

function simulate(a: Player, b: Player, timeLimitSeconds: number, runs: number) {
  let winA = 0, winB = 0, draw = 0, ipponsA = 0, ipponsB = 0;
  for (let i = 0; i < runs; i++) {
    const bout = simulateBout(a, b, {
      position: "Chuken",
      timeLimitSeconds,
      seed: `mu-${a.id}-${b.id}-${i}`,
      // Fatigue off: the analytic model above assumes no debuff, so this
      // isolates whether the core resolution maths agrees.
      config: { fatigueTriggerScale: 0 },
    });
    if (bout.result.winner === "A") winA++;
    else if (bout.result.winner === "B") winB++;
    else draw++;
    ipponsA += bout.result.ipponsA;
    ipponsB += bout.result.ipponsB;
  }
  return { winA: winA / runs, winB: winB / runs, draw: draw / runs, ipponsA: ipponsA / runs, ipponsB: ipponsB / runs };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function report(nameA: string, nameB: string, timeLimitSeconds = 120) {
  const a = byName(nameA);
  const b = byName(nameB);
  const analytic = analyticWinProbability(a, b, timeLimitSeconds);
  const sim = simulate(a, b, timeLimitSeconds, 40000);
  const m = analytic.model;

  console.log(`\n${"=".repeat(78)}`);
  console.log(`${a.name}  (Tổng lực ${overallStrength(a).toFixed(1)})`);
  console.log(`   vs`);
  console.log(`${b.name}  (Tổng lực ${overallStrength(b).toFixed(1)})`);
  console.log("=".repeat(78));

  console.log(`\nStats`);
  console.log(`  ${a.name}`);
  console.log(`    technique  M ${a.technique.men}  K ${a.technique.kote}  D ${a.technique.dou}  T ${a.technique.tsuki}`);
  console.log(`    defense    M ${a.defense.men}  K ${a.defense.kote}  D ${a.defense.dou}  T ${a.defense.tsuki}`);
  console.log(`    attack ${a.attack_rate}  defend_rate ${a.defend_rate}  hansoku ${a.hansoku_rate}  stamina ${a.stamina}`);
  console.log(`  ${b.name}`);
  console.log(`    technique  M ${b.technique.men}  K ${b.technique.kote}  D ${b.technique.dou}  T ${b.technique.tsuki}`);
  console.log(`    defense    M ${b.defense.men}  K ${b.defense.kote}  D ${b.defense.dou}  T ${b.defense.tsuki}`);
  console.log(`    attack ${b.attack_rate}  defend_rate ${b.defend_rate}  hansoku ${b.hansoku_rate}  stamina ${b.stamina}`);

  console.log(`\nStep 1 — who initiates (attack_rate ${a.attack_rate} vs ${b.attack_rate})`);
  console.log(`    ${a.name}: ${a.attack_rate}/(${a.attack_rate}+${b.attack_rate}) = ${pct(m.pInitA)}`);

  console.log(`\nStep 2 — ${a.name} attacking: target choice and hit chance`);
  for (const { target, p } of m.aAttacks.mix) {
    const atk = Math.max(1, a.technique[target]);
    const def = Math.max(1, b.defense[target]);
    const h = clamp((cfg.hitScale * atk) / (atk + def), cfg.hitFloor, cfg.hitCeiling);
    console.log(
      `    ${target.padEnd(5)} chosen ${pct(p).padStart(6)} | ${cfg.hitScale} × ${atk}/(${atk}+${def}) = ${pct(h)}`,
    );
  }
  console.log(`    → P(scores this exchange) = ${pct(m.aAttacks.scores)}`);
  console.log(`    → P(counter-ippon against) = ${pct(m.aAttacks.conceded)}`);

  console.log(`\nStep 3 — ${b.name} attacking`);
  for (const { target, p } of m.bAttacks.mix) {
    const atk = Math.max(1, b.technique[target]);
    const def = Math.max(1, a.defense[target]);
    const h = clamp((cfg.hitScale * atk) / (atk + def), cfg.hitFloor, cfg.hitCeiling);
    console.log(
      `    ${target.padEnd(5)} chosen ${pct(p).padStart(6)} | ${cfg.hitScale} × ${atk}/(${atk}+${def}) = ${pct(h)}`,
    );
  }
  console.log(`    → P(scores this exchange) = ${pct(m.bAttacks.scores)}`);
  console.log(`    → P(counter-ippon against) = ${pct(m.bAttacks.conceded)}`);

  const perExA = m.pInitA * m.aAttacks.scores + (1 - m.pInitA) * m.bAttacks.conceded;
  const perExB = (1 - m.pInitA) * m.bAttacks.scores + m.pInitA * m.aAttacks.conceded;
  console.log(`\nStep 4 — per exchange, ignoring fouls`);
  console.log(`    P(${a.name} scores) = ${pct(m.pInitA)}×${pct(m.aAttacks.scores)} + ${pct(1 - m.pInitA)}×${pct(m.bAttacks.conceded)} = ${pct(perExA)}`);
  console.log(`    P(${b.name} scores) = ${pct(1 - m.pInitA)}×${pct(m.bAttacks.scores)} + ${pct(m.pInitA)}×${pct(m.aAttacks.conceded)} = ${pct(perExB)}`);
  console.log(`    foul chance per exchange initiated: ${a.name} ${pct(m.foulA)}, ${b.name} ${pct(m.foulB)}`);

  console.log(`\nStep 5 — first to 2 ippon over an 8-12 exchange budget`);
  console.log(`    ANALYTIC   ${a.name} ${pct(analytic.winA)} | ${b.name} ${pct(analytic.winB)} | hikiwake ${pct(analytic.draw)}`);
  console.log(`    SIMULATED  ${a.name} ${pct(sim.winA)} | ${b.name} ${pct(sim.winB)} | hikiwake ${pct(sim.draw)}   (40k bouts)`);
  const worst = Math.max(
    Math.abs(analytic.winA - sim.winA),
    Math.abs(analytic.winB - sim.winB),
    Math.abs(analytic.draw - sim.draw),
  );
  console.log(`    largest gap between hand-calculation and simulator: ${(worst * 100).toFixed(2)} points`);
  return worst;
}

const gaps = [
  report("Phan Anh Minh", "Đinh Nguyên Long"),
  report("Nguyễn Hoàng Minh Tâm", "Nguyễn Xuân Khoa"),
  report("Nhi Nhi", "Phan Phúc Lâm"),
];
console.log(`\nWorst disagreement across all three: ${(Math.max(...gaps) * 100).toFixed(2)} points\n`);

// Does the headline "Tổng lực" number actually predict who wins?
console.log("=".repeat(78));
console.log("Tổng lực vs actual head-to-head win rate, across every pairing");
console.log("=".repeat(78));
const pairs: { a: Player; b: Player; dTL: number; winA: number }[] = [];
for (let i = 0; i < players.length; i++) {
  for (let j = i + 1; j < players.length; j++) {
    const a = players[i], b = players[j];
    const s = simulate(a, b, 120, 300);
    pairs.push({ a, b, dTL: overallStrength(a) - overallStrength(b), winA: s.winA + s.draw / 2 });
  }
}
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const mx = mean(pairs.map((p) => p.dTL));
const my = mean(pairs.map((p) => p.winA));
const cov = mean(pairs.map((p) => (p.dTL - mx) * (p.winA - my)));
const sx = Math.sqrt(mean(pairs.map((p) => (p.dTL - mx) ** 2)));
const sy = Math.sqrt(mean(pairs.map((p) => (p.winA - my) ** 2)));
console.log(`  ${pairs.length} pairings · correlation between Tổng lực gap and win rate: ${(cov / (sx * sy)).toFixed(3)}`);

const upsets = pairs
  .filter((p) => Math.abs(p.dTL) >= 4)
  .map((p) => (p.dTL > 0 ? { fav: p.a, dog: p.b, dTL: p.dTL, favWin: p.winA } : { fav: p.b, dog: p.a, dTL: -p.dTL, favWin: 1 - p.winA }))
  .sort((x, y) => x.favWin - y.favWin)
  .slice(0, 8);
console.log(`\n  Biggest upsets — clearly stronger on paper, yet losing:`);
for (const u of upsets) {
  console.log(
    `    ${u.fav.name} (TL +${u.dTL.toFixed(1)}) beats ${u.dog.name} only ${pct(u.favWin)} of the time`,
  );
}
