import { CLUB_ROSTER } from "@/data/club";
import { PASSIVE_CATALOG } from "@/data/passives";
import { overallStrength, POSITIONS } from "@/lib/kendo";
import type {
  Bout,
  Lineup,
  Player,
  Position,
  Side,
  StatPath,
} from "@/lib/kendo/types";
import type { LiveModifierHook } from "@/lib/kendo/bout";

/**
 * Character passives ("Nội tại") — a second, character-owned source of stat
 * effects alongside augments/items, resolved through three mechanisms:
 *
 *   A. Static, resolved once both lineups lock in (resolvePassiveStaticEffects)
 *      — same "no live computation needed" shape as the augment engine's
 *      conditional gates, just per-player instead of team-wide.
 *   B/C/D/E/F. Live, resolved per bout / per exchange (buildPassiveHookForBout)
 *      — reuses the same LiveModifierHook machinery dan_nice/dan_fighting are
 *      built on, extended (see kendo/bout.ts) with the current bout's two
 *      combatants, the bout-win tally, prior bouts in this game, current
 *      stance, and an rng, since these passives need all of that where
 *      augments never did.
 *
 * The actual numeric deltas live in passives_catalog.json (hand-edited, same
 * pattern as augments_catalog.json/items_catalog.json/players.seed.json) —
 * this file only ever holds the TRIGGER logic (position checks, team
 * detection, live hooks, carry-forward conditions) and looks entries up by
 * id via effectsFor. Never define a numeric effect inline here again; add it
 * to the catalog instead.
 *
 * Names are resolved to ids once at module load, same fail-fast philosophy as
 * loadRoster/loadAugments and MEMBERSHIP_GATED_AUGMENT_NAMES in versus/bout.ts
 * — if a name here ever stops matching players.seed.json, this throws
 * immediately on startup instead of a passive silently never triggering.
 */
function idOf(name: string): string {
  const person = CLUB_ROSTER.find((p) => p.name === name);
  if (!person) throw new Error(`passives: no player named "${name}" in the club roster`);
  return person.id;
}

const ID = {
  dangKieuDiem: idOf("Đặng Kiều Diễm"),
  kaNguyet: idOf("Ka Nguyệt"),
  tranThuyBaoNhu: idOf("Trần Thụy Bảo Như"),
  phanAnhMinh: idOf("Phan Anh Minh"),
  phanPhucLam: idOf("Phan Phúc Lâm"),
  nguyenTrungTin: idOf("Nguyễn Trung Tín"),
  nguyenPhucDieuAn: idOf("Nguyễn Phúc Diệu An"),
  luongTrongNhan: idOf("Lương Trọng Nhân"),
  nguyenKieuHongNhung: idOf("Nguyễn Kiều Hồng Nhung"),
  tranMaiKhanh: idOf("Trần Mai Khánh"),
  taDucThien: idOf("Tạ Đức Thiện"),
  ngoDacSyPhong: idOf("Ngô Đắc Sỹ Phong"),
  lienToan: idOf("Liên Toàn"),
  nhiNhi: idOf("Nhi Nhi"),
  nguyenCaoBichTram: idOf("Nguyễn Cao Bích Trâm"),
} as const;

/** Full "Nội tại" text, shown on click/hover under a character's name
 *  wherever they're displayed (draft, lineup, match viewer). */
export const PASSIVE_DESCRIPTION_BY_ID: Record<string, string> = {
  [ID.dangKieuDiem]:
    "Nếu được xếp ở vị trí Taisho: tăng toàn bộ chỉ số (tấn công, phòng thủ, kĩ thuật, phòng thủ kĩ thuật, thể lực) và giảm tỉ lệ phạm luật cho bản thân. " +
    "Nếu Lương Trọng Nhân cùng góp mặt trong trận: cùng đội thì cả hai tăng chỉ số tấn công; khác đội thì bản thân vẫn tăng chỉ số tấn công.",
  [ID.kaNguyet]: "Nếu được xếp ở vị trí Senpo: tăng chỉ số tấn công, kĩ thuật Men và kĩ thuật Dou cho bản thân.",
  [ID.tranThuyBaoNhu]:
    "Nếu được xếp ở vị trí Chuken hoặc Taisho: đối thủ ở trận đấu đó bị giảm thể lực, chỉ số phòng thủ và phòng thủ kĩ thuật.",
  [ID.phanAnhMinh]:
    "Cùng đội với Phan Phúc Lâm: cả hai tăng chỉ số phòng thủ và phòng thủ kĩ thuật. " +
    "Cùng đội với Nguyễn Kiều Hồng Nhung: cả hai tăng thể lực, giảm tỉ lệ phạm luật; khác đội thì bản thân giảm chỉ số tấn công. " +
    "Khi đội nhà đang thua về số trận thắng (hoặc đang thua điểm trong trận đang đấu): toàn đội tăng chỉ số tấn công và thể lực, tính lại liên tục theo từng pha đấu.",
  [ID.phanPhucLam]: "Cùng đội với Phan Anh Minh: cả hai tăng chỉ số phòng thủ và phòng thủ kĩ thuật.",
  [ID.nguyenTrungTin]:
    "Cùng đội với Nguyễn Phúc Diệu An: cả hai tăng chỉ số tấn công, phòng thủ, kĩ thuật, phòng thủ kĩ thuật, thể lực — nhưng cũng tăng tỉ lệ phạm luật.",
  [ID.nguyenPhucDieuAn]:
    "Cùng đội với Nguyễn Trung Tín: cả hai tăng chỉ số tấn công, phòng thủ, kĩ thuật, phòng thủ kĩ thuật, thể lực — nhưng cũng tăng tỉ lệ phạm luật. " +
    "Nếu thắng hoặc hòa trận của mình: các đồng đội chưa thi đấu tăng chỉ số tấn công và kĩ thuật cho phần còn lại của ván (không áp dụng cho daihyosen).",
  [ID.luongTrongNhan]:
    "Với mỗi đồng đội có Tổng Lực thấp hơn bản thân: đồng đội đó được tăng kĩ thuật. " +
    "Nếu Đặng Kiều Diễm cùng góp mặt trong trận: cùng đội thì cả hai tăng chỉ số tấn công; khác đội thì bản thân giảm chỉ số phòng thủ.",
  [ID.nguyenKieuHongNhung]:
    "Cùng đội với Phan Anh Minh: cả hai tăng thể lực, giảm tỉ lệ phạm luật; khác đội thì bản thân tăng chỉ số tấn công và kĩ thuật.",
  [ID.tranMaiKhanh]:
    "Cùng đội với Tạ Đức Thiện: cả hai tăng chỉ số tấn công và kĩ thuật; khác đội thì bản thân giảm chỉ số tấn công và kĩ thuật. " +
    "Nếu thắng trận của mình: các đồng đội chưa thi đấu tăng kĩ thuật và thể lực cho phần còn lại của ván (không áp dụng cho daihyosen).",
  [ID.taDucThien]:
    "Cùng đội với Trần Mai Khánh: cả hai tăng chỉ số tấn công và kĩ thuật; khác đội thì bản thân giảm chỉ số phòng thủ và phòng thủ kĩ thuật.",
  [ID.ngoDacSyPhong]:
    "Đầu mỗi trận đấu, nếu chỉ số phòng thủ của đối thủ cao hơn bản thân: đối thủ bị giảm chỉ số phòng thủ và phòng thủ kĩ thuật, bản thân tăng chỉ số tấn công.",
  [ID.lienToan]:
    "Trong lúc giữ thế JODAN: tăng kĩ thuật Men và Kote cho bản thân; đồng thời bản thân và đối thủ cùng bị giảm chỉ số phòng thủ.",
  [ID.nhiNhi]:
    "Ngẫu nhiên rơi vào 1 trong 2 trạng thái, đổi lại mỗi khi có ippon (của bên nào cũng được) trong trận của cô ấy: " +
    "\"Hưng phấn\" (tăng toàn bộ chỉ số) hoặc \"Kiệt sức\" (giảm chỉ số phòng thủ, phòng thủ kĩ thuật, thể lực).",
  [ID.nguyenCaoBichTram]:
    "Nếu thua trận của mình: các đồng đội chưa thi đấu tăng thể lực, chỉ số phòng thủ và phòng thủ kĩ thuật cho phần còn lại của ván (không áp dụng cho daihyosen).",
};

/** Anyone with a "Nội tại" entry — drives the small label under a name. */
export function hasPassive(playerId: string): boolean {
  return playerId in PASSIVE_DESCRIPTION_BY_ID;
}

/** Every character id that has at least one passive — the draft pool's
 *  "cap at 2 passive-holders per roster" rule (see draft.ts) filters
 *  candidates against this set. */
export const PASSIVE_HOLDER_IDS: ReadonlySet<string> = new Set(Object.keys(PASSIVE_DESCRIPTION_BY_ID));

/** Max passive-holding characters allowed on one 5-person roster, both
 *  formats (Bo3/Bo5) — a draft rule, not a stat-effect concern, but lives
 *  here alongside PASSIVE_HOLDER_IDS since both are needed together. */
export const PASSIVE_ROSTER_CAP = 2;

/**
 * Draft-pool exclusion for the cap: once a side already has
 * PASSIVE_ROSTER_CAP passive-holders drafted, further passive-holding
 * candidates should stop being offered to that side, same "exclude from the
 * roll" mechanism already used to keep an already-drafted player from
 * reappearing (see rollPool's excludeIds in draft.ts).
 *
 * Caveat: the draft's pool is shared and simultaneously visible to BOTH
 * players (see draft.ts's own module comment — it's a public, live-watched
 * snake draft, not a per-viewer offer), and is only ever rolled once per
 * PHASE, serving every turn within that phase, which can belong to either
 * side. That means this can only gate at phase-roll granularity, not per
 * individual turn: if EITHER side is already capped by the time a phase's
 * pool is rolled, passive-holders are excluded from that whole roll for the
 * rest of the phase — including for an as-yet-uncapped side sharing it.
 * This is the closest behavior achievable without splitting the pool per
 * viewer, which the draft's simultaneous-reveal design doesn't support; in
 * practice a side only reaches the cap partway through the draft, so the
 * common case is a clean phase-boundary cutover, not mid-phase overlap.
 */
export function passiveHolderCapExclusions(
  pickedA: readonly string[],
  pickedB: readonly string[],
): ReadonlySet<string> {
  const isCapped = (picked: readonly string[]) =>
    picked.filter((id) => PASSIVE_HOLDER_IDS.has(id)).length >= PASSIVE_ROSTER_CAP;
  return isCapped(pickedA) || isCapped(pickedB) ? PASSIVE_HOLDER_IDS : new Set();
}

type Effects = Partial<Record<StatPath, number>>;

/** Looks up one catalog entry's effects by id — fail-fast (same philosophy
 *  as idOf above) since a passive referencing an id that's gone missing from
 *  passives_catalog.json is a real bug, not something to silently no-op. */
function effectsFor(id: string): Effects {
  const entry = PASSIVE_CATALOG.get(id);
  if (!entry) throw new Error(`passives.ts: no entry "${id}" in passives_catalog.json`);
  return entry.effects;
}

function merge(...parts: readonly Effects[]): Effects {
  const out: Effects = {};
  for (const part of parts) {
    for (const [path, delta] of Object.entries(part)) {
      if (delta === undefined) continue;
      out[path as StatPath] = (out[path as StatPath] ?? 0) + delta;
    }
  }
  return out;
}

function findPosition(id: string, lineup: Lineup): Lowercase<Position> | null {
  for (const pos of POSITIONS) {
    const key = pos.toLowerCase() as Lowercase<Position>;
    if (lineup[key] === id) return key;
  }
  return null;
}

/**
 * Category A: everything resolvable the instant both lineups lock in — team/
 * position/opponent membership is fully known, no live computation needed.
 * Mirrors resolveConditionalEffects's role for augments, just per-player
 * (Map<playerId, Effects>) instead of team-wide, since these passives target
 * specific individuals (self, a same-position opponent, a named teammate),
 * never "everyone on the team" the way an augment does.
 */
export function resolvePassiveStaticEffects(ctx: {
  pickedA: readonly string[];
  pickedB: readonly string[];
  lineupA: Lineup;
  lineupB: Lineup;
  rawPlayersA: readonly Player[];
  rawPlayersB: readonly Player[];
}): Map<string, Effects> {
  const { pickedA, pickedB, lineupA, lineupB, rawPlayersA, rawPlayersB } = ctx;
  const effects = new Map<string, Effects>();
  const add = (id: string, delta: Effects) => effects.set(id, merge(effects.get(id) ?? {}, delta));

  const inA = (id: string) => pickedA.includes(id);
  const inB = (id: string) => pickedB.includes(id);
  const sideOf = (id: string): Side | null => (inA(id) ? "A" : inB(id) ? "B" : null);
  const sameTeam = (x: string, y: string) => (inA(x) && inA(y)) || (inB(x) && inB(y));

  // Đặng Kiều Diễm — Taisho self buff.
  if (findPosition(ID.dangKieuDiem, lineupA) === "taisho" || findPosition(ID.dangKieuDiem, lineupB) === "taisho") {
    add(ID.dangKieuDiem, effectsFor("dang_kieu_diem_taisho"));
  }

  // Ka Nguyệt — Senpo self buff.
  if (findPosition(ID.kaNguyet, lineupA) === "senpo" || findPosition(ID.kaNguyet, lineupB) === "senpo") {
    add(ID.kaNguyet, effectsFor("ka_nguyet_senpo"));
  }

  // Trần Thụy Bảo Như — Chuken/Taisho, debuffs her same-position opponent.
  for (const [ownLineup, oppLineup] of [
    [lineupA, lineupB],
    [lineupB, lineupA],
  ] as const) {
    const pos = findPosition(ID.tranThuyBaoNhu, ownLineup);
    if (pos === "chuken" || pos === "taisho") {
      const oppId = oppLineup[pos];
      if (oppId) add(oppId, effectsFor("tran_thuy_bao_nhu_opponent_debuff"));
    }
  }

  // Phan Anh Minh & Phan Phúc Lâm — same team only.
  if (sameTeam(ID.phanAnhMinh, ID.phanPhucLam)) {
    add(ID.phanAnhMinh, effectsFor("phan_anh_minh_same_team_phan_phuc_lam"));
    add(ID.phanPhucLam, effectsFor("phan_phuc_lam_same_team_phan_anh_minh"));
  }

  // Nguyễn Trung Tín & Nguyễn Phúc Diệu An — same team only.
  if (sameTeam(ID.nguyenTrungTin, ID.nguyenPhucDieuAn)) {
    add(ID.nguyenTrungTin, effectsFor("nguyen_trung_tin_same_team_nguyen_phuc_dieu_an"));
    add(ID.nguyenPhucDieuAn, effectsFor("nguyen_phuc_dieu_an_same_team_nguyen_trung_tin"));
  }

  // Lương Trọng Nhân — per teammate whose Tổng Lực (base seed stats) is lower.
  {
    const nhanSide = sideOf(ID.luongTrongNhan);
    if (nhanSide) {
      const teammates = nhanSide === "A" ? rawPlayersA : rawPlayersB;
      const nhan = teammates.find((p) => p.id === ID.luongTrongNhan);
      if (nhan) {
        const nhanStrength = overallStrength(nhan);
        for (const p of teammates) {
          if (p.id === ID.luongTrongNhan) continue;
          if (overallStrength(p) < nhanStrength) add(p.id, effectsFor("luong_trong_nhan_teammate_buff"));
        }
      }
    }
  }

  // Lương Trọng Nhân & Đặng Kiều Diễm — both-sides pairing.
  {
    const nhanSide = sideOf(ID.luongTrongNhan);
    const diemSide = sideOf(ID.dangKieuDiem);
    if (nhanSide && diemSide) {
      if (nhanSide === diemSide) {
        add(ID.luongTrongNhan, effectsFor("luong_trong_nhan_same_team_dang_kieu_diem"));
        add(ID.dangKieuDiem, effectsFor("dang_kieu_diem_same_team_luong_trong_nhan"));
      } else {
        add(ID.luongTrongNhan, effectsFor("luong_trong_nhan_opposing_dang_kieu_diem"));
      }
      // Đặng Kiều Diễm's own attack_rate bonus fires whenever Lương Trọng
      // Nhân is anywhere in the match, teammate or opponent — only his own
      // effect differs by side.
      add(ID.dangKieuDiem, effectsFor("dang_kieu_diem_luong_trong_nhan_present"));
    }
  }

  // Phan Anh Minh & Nguyễn Kiều Hồng Nhung — both-sides pairing.
  {
    const pamSide = sideOf(ID.phanAnhMinh);
    const nkhnSide = sideOf(ID.nguyenKieuHongNhung);
    if (pamSide && nkhnSide) {
      if (pamSide === nkhnSide) {
        add(ID.phanAnhMinh, effectsFor("phan_anh_minh_same_team_nguyen_kieu_hong_nhung"));
        add(ID.nguyenKieuHongNhung, effectsFor("nguyen_kieu_hong_nhung_same_team_phan_anh_minh"));
      } else {
        add(ID.phanAnhMinh, effectsFor("phan_anh_minh_opposing_nguyen_kieu_hong_nhung"));
        add(ID.nguyenKieuHongNhung, effectsFor("nguyen_kieu_hong_nhung_opposing_phan_anh_minh"));
      }
    }
  }

  // Trần Mai Khánh & Tạ Đức Thiện — both-sides pairing.
  {
    const tmkSide = sideOf(ID.tranMaiKhanh);
    const tdtSide = sideOf(ID.taDucThien);
    if (tmkSide && tdtSide) {
      if (tmkSide === tdtSide) {
        add(ID.tranMaiKhanh, effectsFor("tran_mai_khanh_same_team_ta_duc_thien"));
        add(ID.taDucThien, effectsFor("ta_duc_thien_same_team_tran_mai_khanh"));
      } else {
        add(ID.tranMaiKhanh, effectsFor("tran_mai_khanh_opposing_ta_duc_thien"));
        add(ID.taDucThien, effectsFor("ta_duc_thien_opposing_tran_mai_khanh"));
      }
    }
  }

  return effects;
}

export { ID as PASSIVE_CHARACTER_ID };

// ---- categories B/C/D/E/F: live, per-bout / per-exchange -----------------
// All resolved through the same LiveModifierHook machinery dan_nice/
// dan_fighting are built on (see kendo/bout.ts), just built directly from
// passive ownership instead of an equipped-augment id. buildPassiveHookForBout
// is called fresh once per bout (including the daihyosen tiebreak) by
// buildLiveModifierForGame in versus/bout.ts, exactly like the augment hooks
// it runs alongside.

/** B: Ngô Đắc Sỹ Phong — compared once, at bout start, against effective
 *  pre-bout stats (this bout's actual combatants, already carrying every
 *  earlier layer: augments, items, category-A passives). */
function makeNgoDacSyPhongHook(playerA: Player, playerB: Player): LiveModifierHook | undefined {
  let side: Side;
  let self: Player;
  let opponent: Player;
  if (playerA.id === ID.ngoDacSyPhong) {
    side = "A";
    self = playerA;
    opponent = playerB;
  } else if (playerB.id === ID.ngoDacSyPhong) {
    side = "B";
    self = playerB;
    opponent = playerA;
  } else {
    return undefined;
  }
  if (opponent.defend_rate <= self.defend_rate) return undefined;
  const selfBuff = effectsFor("ngo_dac_sy_phong_self_buff");
  const opponentDebuff = effectsFor("ngo_dac_sy_phong_opponent_debuff");
  return () => (side === "A" ? { a: selfBuff, b: opponentDebuff } : { a: opponentDebuff, b: selfBuff });
}

/** C: Phan Anh Minh — team-wide (not just his own bout), live per exchange.
 *  Reuses dan_fighting's exact "behind on the team tally entering this bout
 *  OR behind on ippons within this bout" OR-condition. */
function makePhanAnhMinhTeamHook(
  pickedA: readonly string[],
  pickedB: readonly string[],
  teamAWinsSoFar: number,
  teamBWinsSoFar: number,
): LiveModifierHook | undefined {
  const side: Side | null = pickedA.includes(ID.phanAnhMinh) ? "A" : pickedB.includes(ID.phanAnhMinh) ? "B" : null;
  if (!side) return undefined;
  const behindOnTeam = side === "A" ? teamAWinsSoFar < teamBWinsSoFar : teamBWinsSoFar < teamAWinsSoFar;
  const buff = effectsFor("phan_anh_minh_team_behind_buff");
  return (state) => {
    const behindOnBout = side === "A" ? state.ipponsA < state.ipponsB : state.ipponsB < state.ipponsA;
    if (!behindOnTeam && !behindOnBout) return undefined;
    return side === "A" ? { a: buff } : { b: buff };
  };
}

/** D: Liên Toàn — only relevant in his own bout; live per exchange since
 *  stance can switch mid-bout (post-ippon reconsider). */
function makeLienToanHook(playerA: Player, playerB: Player): LiveModifierHook | undefined {
  let side: Side;
  if (playerA.id === ID.lienToan) side = "A";
  else if (playerB.id === ID.lienToan) side = "B";
  else return undefined;
  const self = effectsFor("lien_toan_self_jodan");
  const opponent = effectsFor("lien_toan_opponent_jodan");
  return (state) => {
    const myStance = side === "A" ? state.stanceA : state.stanceB;
    if (myStance !== "Jodan") return undefined;
    return side === "A" ? { a: self, b: opponent } : { a: opponent, b: self };
  };
}

type NhiNhiPhase = "excited" | "exhausted";

/**
 * E: Nhi Nhi — two alternating states, re-rolled (not deterministically
 * flipped) every time ANY ippon lands in her bout: 70% "Hưng phấn" at the
 * very start (before the first ippon), 50/50 on every re-roll after that.
 * Detected the same way dan_nice detects "has this side scored yet" — diff
 * the incoming ippon total against the last call's — since the hook is
 * otherwise only ever told the *incoming* score for an exchange, not
 * whether the previous one just scored.
 */
function makeNhiNhiHook(playerA: Player, playerB: Player): LiveModifierHook | undefined {
  let side: Side;
  let name: string;
  if (playerA.id === ID.nhiNhi) {
    side = "A";
    name = playerA.name;
  } else if (playerB.id === ID.nhiNhi) {
    side = "B";
    name = playerB.name;
  } else {
    return undefined;
  }

  const excited = effectsFor("nhi_nhi_excited");
  const exhausted = effectsFor("nhi_nhi_exhausted");
  let phase: NhiNhiPhase | undefined;
  let lastTotalIppons = -1;

  return (state) => {
    const totalIppons = state.ipponsA + state.ipponsB;
    let justRolled = false;
    if (phase === undefined) {
      phase = state.rng.chance(0.7) ? "excited" : "exhausted";
      lastTotalIppons = totalIppons;
      justRolled = true;
    } else if (totalIppons > lastTotalIppons) {
      phase = state.rng.chance(0.5) ? "excited" : "exhausted";
      lastTotalIppons = totalIppons;
      justRolled = true;
    }

    const effects = phase === "excited" ? excited : exhausted;
    const notes = justRolled
      ? [{ side, text: `${name} đang ${phase === "excited" ? "HƯNG PHẤN" : "KIỆT SỨC"}!` }]
      : undefined;
    return side === "A" ? { a: effects, notes } : { b: effects, notes };
  };
}

interface CarrySpec {
  id: string;
  condition: (result: "win" | "loss" | "draw") => boolean;
  catalogId: string;
}

const CARRY_FORWARD_SPECS: CarrySpec[] = [
  { id: ID.tranMaiKhanh, condition: (r) => r === "win", catalogId: "tran_mai_khanh_win_carryforward" },
  {
    id: ID.nguyenPhucDieuAn,
    condition: (r) => r === "win" || r === "draw",
    catalogId: "nguyen_phuc_dieu_an_win_or_draw_carryforward",
  },
  { id: ID.nguyenCaoBichTram, condition: (r) => r === "loss", catalogId: "nguyen_cao_bich_tram_loss_carryforward" },
];

function resultFor(charId: string, boutsSoFar: readonly Bout[]): "win" | "loss" | "draw" | undefined {
  const bout = boutsSoFar.find((b) => b.playerA.id === charId || b.playerB.id === charId);
  if (!bout) return undefined;
  const charSide: Side = bout.playerA.id === charId ? "A" : "B";
  if (bout.result.winner === "draw") return "draw";
  return bout.result.winner === charSide ? "win" : "loss";
}

/**
 * F: cross-bout carry-forward — Trần Mai Khánh / Nguyễn Phúc Diệu An /
 * Nguyễn Cao Bích Trâm each buff their team's remaining not-yet-played bouts
 * once their OWN bout resolves. `boutsSoFar` (threaded through
 * simulateTeamMatch's bout loop, see teamMatch.ts) already only ever
 * contains bouts strictly earlier than the one this hook is being built for,
 * so "remaining not-yet-played, in position order" falls out for free: her
 * own bout can never buff itself (she isn't in boutsSoFar yet when her own
 * hook is being built), and every subsequent bout's hook keeps finding her
 * already-resolved result for the rest of the game. Never called for the
 * daihyosen tiebreak (see buildPassiveHookForBout / SimulateTeamMatchOptions'
 * `isDaihyosen`) — confirmed as this feature's own scope, not an engine
 * limitation.
 */
function makeCarryForwardHook(
  pickedA: readonly string[],
  pickedB: readonly string[],
  boutsSoFar: readonly Bout[],
): LiveModifierHook | undefined {
  const perSide: Record<Side, Effects[]> = { A: [], B: [] };
  for (const spec of CARRY_FORWARD_SPECS) {
    const side: Side | null = pickedA.includes(spec.id) ? "A" : pickedB.includes(spec.id) ? "B" : null;
    if (!side) continue;
    const result = resultFor(spec.id, boutsSoFar);
    if (result === undefined || !spec.condition(result)) continue;
    perSide[side].push(effectsFor(spec.catalogId));
  }
  const aEffects = perSide.A.length ? merge(...perSide.A) : undefined;
  const bEffects = perSide.B.length ? merge(...perSide.B) : undefined;
  if (!aEffects && !bEffects) return undefined;
  return () => ({ a: aEffects, b: bEffects });
}

/** Cheap pre-check so buildLiveModifierForGame can skip building anything at
 *  all for a game where none of these ever apply. */
const LIVE_PASSIVE_CHARACTER_IDS = new Set([
  ID.ngoDacSyPhong,
  ID.phanAnhMinh,
  ID.lienToan,
  ID.nhiNhi,
  ID.tranMaiKhanh,
  ID.nguyenPhucDieuAn,
  ID.nguyenCaoBichTram,
]);

export function hasLivePassiveCandidates(pickedA: readonly string[], pickedB: readonly string[]): boolean {
  return [...pickedA, ...pickedB].some((id) => LIVE_PASSIVE_CHARACTER_IDS.has(id));
}

export interface PassiveBoutContext {
  pickedA: readonly string[];
  pickedB: readonly string[];
  playerA: Player;
  playerB: Player;
  teamAWinsSoFar: number;
  teamBWinsSoFar: number;
  boutsSoFar: readonly Bout[];
  isDaihyosen: boolean;
}

/** Combines every live passive that applies to this specific upcoming bout
 *  into one hook — same "sum whatever each contributes" merge as
 *  combineLiveModifiers in versus/bout.ts, just generalized to hooks that
 *  can return both `a` and `b` from the same call (Liên Toàn's mutual
 *  defend_rate hit needs that; dan_nice/dan_fighting never did). */
export function buildPassiveHookForBout(ctx: PassiveBoutContext): LiveModifierHook | undefined {
  const hooks: LiveModifierHook[] = [
    makeNgoDacSyPhongHook(ctx.playerA, ctx.playerB),
    makePhanAnhMinhTeamHook(ctx.pickedA, ctx.pickedB, ctx.teamAWinsSoFar, ctx.teamBWinsSoFar),
    makeLienToanHook(ctx.playerA, ctx.playerB),
    makeNhiNhiHook(ctx.playerA, ctx.playerB),
    ctx.isDaihyosen ? undefined : makeCarryForwardHook(ctx.pickedA, ctx.pickedB, ctx.boutsSoFar),
  ].filter((h): h is LiveModifierHook => !!h);

  if (hooks.length === 0) return undefined;
  return (state) => {
    const results = hooks
      .map((h) => h(state))
      .filter((r): r is { a?: Effects; b?: Effects; notes?: { side: Side; text: string }[] } => !!r);
    if (results.length === 0) return undefined;
    const aParts = results.map((r) => r.a).filter((x): x is Effects => !!x);
    const bParts = results.map((r) => r.b).filter((x): x is Effects => !!x);
    const notes = results.flatMap((r) => r.notes ?? []);
    return {
      a: aParts.length ? merge(...aParts) : undefined,
      b: bParts.length ? merge(...bParts) : undefined,
      notes: notes.length ? notes : undefined,
    };
  };
}
