import type { DesignTraitUnit } from "../../DesignTraits";
import { BUFF_BANK } from "../../StatusState";
import {
  KIT_STATUS,
  kitState,
  type Kit,
  type KitSkill,
  type KitStatus,
  type TraitScript,
} from "../TraitKit";

/** Kịch bản đặc tính, phần 6 (pet 200..239). */

/** Hệ: 0 Hỏa, 1 Mộc, 2 Thổ, 3 Thủy, 4 Điện (Lôi), 5 Quỷ, 6 Phong. */
const WOOD = 1;
const EARTH = 2;
const WATER = 3;
const ELECTRIC = 4;
const WIND = 6;
const SHIELD_ID = 15;

type Meta = Pick<TraitScript, "name" | "params" | "text" | "text2v2">;

const HEAL_NAME = /Dưỡng|Hồi Sinh|Chữa Lành|Tái Tạo|Thảo nguyện|cầu nguyện|Địa Giới/i;
const GUARD_NAME = /· Thủ|bích|Thạch phu|cầu nguyện|Đằng chi/i;
const isHeal = (s?: KitSkill): boolean => !!s && s.support && s.ownSide && HEAL_NAME.test(s.name);
const isGuard = (s?: KitSkill): boolean => !!s && s.support && s.ownSide && GUARD_NAME.test(s.name);
/** Chiêu tăng chỉ số: hỗ trợ nhắm phe mình, không phải chiêu hồi máu. */
const isStatUp = (s?: KitSkill): boolean => !!s && s.support && s.ownSide && !isHeal(s);
const isAttack = (s: KitSkill | undefined, element?: number): boolean =>
  !!s?.attack && (element === undefined || s.element === element);
const pct = (amount: number, percent: number): number => Math.trunc((amount * percent) / 100);

function remaining(unit: DesignTraitUnit | undefined, status: KitStatus): number {
  if (!unit) return 0;
  const slot = KIT_STATUS[status];
  return unit.statuses.get(slot.bank, slot.id)?.remainingTurns ?? 0;
}

/** Thêm `count` tầng Phòng ngự thật (buff 4, chung với Thổ thuẫn, DEF +7%/tầng, 2 lượt, tối đa 3). */
function addDefenseTiers(k: Kit, count: number): void {
  for (let i = 0; i < count; i++) k.self.effects.applySourceBuff(k.self, 4, 0);
  k.self.restoreSourceStatusState();
  k.refresh();
}

/** Hồi `amount`; trong 2v2 khi `split` thì chia đều cho pet và đồng đội. */
function healSplit(k: Kit, amount: number, split: boolean, label: string): void {
  if (amount <= 0) return;
  if (split && k.ally) {
    const half = Math.max(1, Math.trunc(amount / 2));
    k.healAmount(k.self, half);
    k.healAmount(k.ally, half);
    k.proc(label, k.ally);
    return;
  }
  k.healAmount(k.self, amount);
  k.proc(label);
}

// ------------------------------------------------------------------ Rễ rút nhựa (202–204)

const BINDS: KitStatus[] = ["entangle", "bind", "corrosion"];

/** Số hiệu ứng trói do pet gây (dấu riêng `trói:<status>`) đang còn trên `foe`. */
function myBinds(k: Kit, foe: DesignTraitUnit): number {
  let n = 0;
  for (const s of BINDS) {
    if (!k.marked(foe, `trói:${s}`)) continue;
    if (k.has(foe, s)) n++;
    else k.unmark(foe, `trói:${s}`);
  }
  return n;
}

/**
 * params: drain (% HP tối đa đối thủ), drain2 (khi từ 2 hiệu ứng), times (số lần rút tối đa mỗi trận).
 * Mỗi lượt chỉ rút 1 đối thủ: đối thủ đang mang nhiều hiệu ứng trói của pet nhất.
 */
function rootScript(meta: Meta, split: boolean): TraitScript {
  return {
    ...meta,
    afterAction(k, e) {
      if (!e.target) return;
      for (const s of e.newStatuses) if (BINDS.includes(s)) k.mark(e.target, `trói:${s}`, 99);
    },
    roundEnd(k) {
      if (k.p.times !== undefined && (k.v.drains ?? 0) >= k.p.times) return;
      let best: DesignTraitUnit | undefined;
      let most = 0;
      for (const foe of k.foes) {
        const n = myBinds(k, foe);
        if (n > most) [best, most] = [foe, n];
      }
      if (!best) return;
      const percent = most >= 2 && k.p.drain2 !== undefined ? k.p.drain2 : k.p.drain;
      const lost = k.damage(best, k.pctOf(best, percent));
      if (lost <= 0) return;
      k.v.drains = (k.v.drains ?? 0) + 1;
      k.proc("rút nhựa", best);
      healSplit(k, lost, split, split && k.ally ? "hồi chia đồng đội" : "hồi nhựa");
    },
  };
}

// ------------------------------------------------------------------ Cuộn thân (214–216)

/** Tầng cuộn thân riêng: DEF +p.def%/tầng, 2 lượt (làm mới khi nhận tầng), tối đa 3. */
function coils(k: Kit): number {
  if ((k.v.coilUntil ?? -1) < k.round) k.v.coil = 0;
  return k.v.coil ?? 0;
}
/** Chiêu tấn công ở vòng `k.v.rush` được ra đòn trước. */
function rushPriority(k: Kit, e: { skill?: KitSkill }): boolean | void {
  if (k.v.rush !== k.round || (e.skill && !e.skill.attack)) return;
  if (k.oncePerRound("ưu tiên")) k.proc("ra đòn trước");
  return true;
}
function coilScript(meta: Meta, fang: boolean, paralyze: boolean): TraitScript {
  return {
    ...meta,
    onHitTaken(k) {
      if (!k.oncePerRound("cuộn")) return;
      coils(k);
      k.stack("coil", 1, 3);
      k.v.coilUntil = k.round + 1;
      k.refresh();
      k.proc("cuộn thân");
      if (k.tryUse("bật nanh", 2)) k.v.rush = k.round + 1;
    },
    statBonus(k, stat) {
      if (stat === "defense") return coils(k) * k.p.def;
    },
    priority: rushPriority,
    outgoing(k, e) {
      if (!fang || k.v.rush !== k.round || !e.skill?.attack) return;
      k.proc("bật nanh +%", e.target);
      return k.p.dmg;
    },
    onHitDealt(k, e) {
      if (!paralyze || k.v.rush !== k.round || !e.skill?.attack || k.e.fangDone === k.round) return;
      k.e.fangDone = k.round;
      if (k.chance(k.p.para, "bật nanh") && k.inflict(e.target, "paralysis", 2))
        k.proc("bật nanh tê liệt", e.target);
    },
  };
}

// ------------------------------------------------------------------ Móc Câu (217–219)

const HOOK = "móc câu";
const hooked = (k: Kit, u: DesignTraitUnit | undefined): boolean =>
  !!u && k.marked(u, HOOK) > 0 && k.has(u, "bind");

/** params: slow (% Linh xảo của Móc), dmg (% sát thương lên mục tiêu mang Móc). */
function hookScript(meta: Meta, extra: Partial<TraitScript> = {}): TraitScript {
  const { onHitDealt, ...rest } = extra;
  return {
    ...meta,
    onHitDealt(k, e) {
      if (e.skill?.attack && !k.marked(e.target, "móc-đầu")) {
        k.mark(e.target, "móc-đầu", 999);
        if (k.inflict(e.target, "bind", 3, { value: k.p.slow })) {
          k.mark(e.target, HOOK, 3);
          k.proc("móc câu", e.target);
        }
      }
      onHitDealt?.(k, e);
    },
    outgoing(k, e) {
      if (!e.skill?.attack || !hooked(k, e.target)) return;
      k.proc("móc +%", e.target);
      return k.p.dmg;
    },
    ...rest,
  };
}

/** 219: mục tiêu mang Móc dưới 35% HP → thu lưới (mỗi đối thủ 1 lần). */
function haul(k: Kit, target: DesignTraitUnit): void {
  if (!target.alive() || !hooked(k, target) || k.hpPct(target) >= 35) return;
  if (k.marked(target, "lưới-xong")) return;
  k.mark(target, "lưới-xong", 999);
  k.heal(k.self, k.p.heal);
  k.statUp(target, "defense", -k.p.def, 2, "thu lưới");
  k.proc("thu lưới", target);
}

// ------------------------------------------------------------------ Bào tử (213)

/** Hủ Thực của pet vừa hết/bị kích nổ → bào tử lan; đối thủ Hủ Thực/Ngủ hít Phấn Cười. */
function spores(k: Kit): void {
  for (const foe of k.foes) {
    if (!k.marked(foe, "bào") || k.has(foe, "corrosion")) continue;
    k.unmark(foe, "bào");
    const other = k.twoVsTwo ? k.otherFoe(foe) : undefined;
    if (other) {
      if (!k.has(other, "corrosion") && k.inflict(other, "corrosion", 3, { refresh: false })) {
        k.mark(other, "bào", 99);
        k.proc("bào tử lan", other);
      }
      continue;
    }
    k.heal(k.self, k.p.heal);
    k.proc("bào tử lan");
  }
  for (const foe of k.foes)
    if ((k.has(foe, "corrosion") || k.has(foe, "sleep")) && !k.has(foe, "accuracy_down"))
      if (k.inflict(foe, "accuracy_down", 2, { value: k.p.acc })) k.proc("phấn cười", foe);
}

// ------------------------------------------------------------------ Lôi Đà (222–225)

function momentum(k: Kit): number {
  if ((k.v.daUntil ?? -1) < k.round) k.v.da = 0;
  return k.v.da ?? 0;
}
function gainMomentum(k: Kit, cap: number): number {
  momentum(k);
  const n = k.stack("da", 1, cap);
  k.v.daUntil = k.round + 2;
  k.proc("lôi đà");
  return n;
}
const BAO = "Thiên Lôi Long Phán · Bạo";

// ------------------------------------------------------------------ Phấn (226–228)

function dust(k: Kit, target: DesignTraitUnit | undefined, both: boolean): void {
  if (!k.oncePerRound("phấn")) return;
  const targets = both && k.twoVsTwo ? k.foes : target ? [target] : [];
  for (const foe of targets)
    if (k.inflict(foe, "accuracy_down", 2, { value: k.p.acc, refresh: false }))
      k.proc("rắc phấn", foe);
}
const drowsy = (k: Kit, u: DesignTraitUnit | undefined): boolean =>
  k.has(u, "sleep") || k.has(u, "entangle") || k.has(u, "corrosion");

// ------------------------------------------------------------------ Gió (232–235)

const SLOW_SKILLS = new Set([
  "Phong áp",
  "Tuyết ảnh",
  "Phong Chi Tuyền Qua",
  "Long Quyển Phong Tỏa",
  "Băng Phong Hãm Tịnh",
]);
/** params: per (% mỗi 10% Linh xảo chênh lệch), cap (tối đa). */
function windOutgoing(k: Kit, target: DesignTraitUnit, skill: KitSkill | undefined): number {
  if (!isAttack(skill, WIND)) return 0;
  const mine = k.self.currentStats.speed;
  const theirs = Math.max(1, target.currentStats.speed);
  const steps = Math.floor(((mine - theirs) * 100) / theirs / 10);
  if (steps <= 0) return 0;
  k.proc("gió +%", target);
  return Math.min(k.p.cap, steps * k.p.per);
}

// ------------------------------------------------------------------ Thoát xác (236–237)

/**
 * Đòn trực tiếp sắp hạ pet: khiên tạm vừa đủ để pet còn 1 HP. `settleMolt` (khi đòn đã trúng) gỡ
 * khiên tạm rồi ép HP: đòn thật sự đủ hạ gục thì pet còn 1 HP, không thì HP như không có khiên.
 */
function armMolt(k: Kit, damage: number): void {
  if (k.e.molting || damage < k.self.hp() + k.shieldHp()) return;
  const amount = damage - k.self.hp() + 1;
  if (!k.shieldAmount(k.self, amount, 1)) return;
  k.e.molting = 1;
  k.e.moltHp = k.self.hp();
  k.e.moltShield = amount;
}
/** Trả true khi đòn vừa rồi lẽ ra hạ gục pet (pet trụ lại với 1 HP). */
function settleMolt(k: Kit): boolean {
  if (!k.e.molting) return false;
  k.e.molting = 0;
  const absorbed = Math.max(0, (k.e.moltShield ?? 0) - k.shieldHp());
  if (k.self.statuses.remove(BUFF_BANK, SHIELD_ID)) k.self.restoreSourceStatusState();
  const before = k.e.moltHp ?? k.self.hp();
  const taken = absorbed + Math.max(0, before - k.self.hp());
  k.self.setHp(Math.max(1, before - taken));
  return taken >= before;
}
/** 236: lần đầu mỗi lần ra sân HP dưới 50% → bỏ xác. */
function shedSkin(k: Kit): void {
  if (k.e.shed || !k.self.alive() || k.hpPct() >= 50) return;
  k.e.shed = 1;
  k.shield(k.self, k.p.shield, 1);
  k.statUp(k.self, "speed", k.p.spd, 2, "thoát xác");
  k.e.bolt = 1;
  k.proc("thoát xác");
}
/** 237: mỗi trận một lần, HP dưới 40% → mọc cánh. */
function regrow(k: Kit): void {
  if (k.v.wings || !k.self.alive() || k.hpPct() >= 40) return;
  k.v.wings = 1;
  k.heal(k.self, k.p.heal);
  k.v.rush = k.round + 1;
  k.proc("mọc cánh");
}

// ------------------------------------------------------------------ Nạp giáp (220–221)

/** Vào sân 1 tầng DEF thật; mỗi lượt lần đầu bị đánh trúng +1 tầng; chiêu tấn công +per%/tầng. */
function cannonScript(meta: Meta, extra: Partial<TraitScript> = {}): TraitScript {
  return {
    ...meta,
    onEnter(k) {
      addDefenseTiers(k, 1);
      k.proc("nạp giáp");
    },
    onHitTaken(k) {
      if (!k.oncePerRound("nạp nòng")) return;
      addDefenseTiers(k, 1);
      k.proc("nạp tầng");
    },
    outgoing(k, e) {
      // 221 bắn đủ 3 tầng: tính 3 tầng dù chiêu có tiêu tầng (k.e.full).
      const n = k.e.full ? 3 : Math.min(3, k.defenseTiers());
      if (n <= 0 || !e.skill?.attack) return;
      k.proc("pháo tầng +%", e.target);
      return n * k.p.per;
    },
    ...extra,
  };
}

// ------------------------------------------------------------------ Thủy triều (238–239)

const MOON_LINE = [238, 239, 240, 241];
/** Pha Triều Lên: lượt lẻ (đảo khi `v.tide` = 1). */
const rising = (k: Kit): boolean => (k.round + (k.v.tide ?? 0)) % 2 === 1;
const sameLine = (u: DesignTraitUnit | undefined): boolean =>
  !!u && MOON_LINE.includes(u.speciesId);

function tideScript(meta: Meta, flips: boolean): TraitScript {
  return {
    ...meta,
    outgoing(k, e) {
      if (!rising(k) || !isAttack(e.skill, WATER)) return;
      k.proc("triều lên +%", e.target);
      return k.p.dmg;
    },
    incoming(k, e) {
      if (!e.direct || rising(k)) return;
      k.proc("triều rút giảm");
      return k.p.reduce;
    },
    roundEnd(k) {
      if (rising(k)) return;
      if (k.heal(k.self, k.p.heal).healed > 0) k.proc("triều rút hồi");
    },
    allyOutgoing(k, e) {
      if (k.p.ally === undefined || !sameLine(e.source) || !rising(k) || !isAttack(e.skill, WATER))
        return;
      k.proc("triều cùng họ +%", e.source);
      return k.p.ally;
    },
    guardAlly(k, e) {
      if (k.p.ally === undefined || !sameLine(e.target) || rising(k)) return;
      k.proc("triều cùng họ giảm", e.target);
      return k.p.ally;
    },
    afterAction(k, e) {
      if (!flips || !isHeal(e.skill)) return;
      k.v.tide = (k.v.tide ?? 0) ^ 1;
      k.proc("đảo triều");
      const ally = k.ally;
      if (ally && sameLine(ally)) {
        const v = kitState(ally).v;
        v.tide = (v.tide ?? 0) ^ 1;
        k.proc("đảo triều đồng đội", ally);
      }
    },
  };
}

// ==================================================================================================

export const PART_6: Record<number, TraitScript> = {
  // 200 Sa vương cuồng thực
  200: {
    name: "Sa vương cuồng thực",
    params: { dmg: 7, drain: 6 },
    text: "Mỗi lần đánh trúng, nhận 1 tầng Cuồng thực (tối đa 3; mỗi tầng +{dmg}% sát thương; mất khi rời sân). Khi mục tiêu dưới 50% HP, mỗi tầng còn giúp hút {drain}% sát thương gây ra.",
    beforeAction(k, e) {
      k.e.low = e.target && k.hpPct(e.target) < 50 ? 1 : 0;
    },
    outgoing(k, e) {
      const n = k.e.feast ?? 0;
      if (n <= 0 || !e.skill?.attack) return;
      k.proc("cuồng thực +%", e.target);
      return k.p.dmg * n;
    },
    onHitDealt(k, e) {
      if (!e.skill?.attack) return;
      const n = k.stack("feast", 1, 3, true);
      k.proc("cuồng thực");
      if (k.e.low && k.healAmount(k.self, pct(e.damage, k.p.drain * n)).healed > 0)
        k.proc("hút cuồng thực", e.target);
    },
  },

  // 201 Hải mộng tiên ca
  201: {
    name: "Hải mộng tiên ca",
    params: { regen: 8, healBonus: 20 },
    text: "Chiêu hồi máu của pet cất tiếng hát: mọi đối thủ trên sân bị Mị Hoặc 2 lượt nếu chưa có. Khi có đối thủ đang Mị Hoặc hoặc Ngủ, cuối mỗi lượt pet và đồng đội hồi {regen}% HP tối đa, và chiêu hồi máu của pet hồi thêm {healBonus}%.",
    afterAction(k, e) {
      if (!isHeal(e.skill)) return;
      for (const foe of k.foes)
        if (!k.has(foe, "charm") && k.inflict(foe, "charm", 2)) k.proc("tiên ca mị hoặc", foe);
    },
    roundEnd(k) {
      if (!k.foes.some((f) => k.has(f, "charm") || k.has(f, "sleep"))) return;
      for (const u of k.team) if (k.heal(u, k.p.regen).healed > 0) k.proc("hồi tiên ca", u);
    },
    healOut(k, e) {
      if (!k.foes.some((f) => k.has(f, "charm") || k.has(f, "sleep"))) return;
      k.proc("tiên ca hồi thêm", e.target);
      return pct(e.amount, k.p.healBonus);
    },
  },

  // 202 Dây leo hút nhựa
  202: rootScript(
    {
      name: "Dây leo hút nhựa",
      params: { drain: 4, times: 3 },
      text: "Cuối lượt, một đối thủ đang Quấn Quanh, Giam Cầm hoặc Hủ Thực do pet gây ra mất thêm {drain}% HP tối đa của nó; pet hồi lượng HP bằng phần đó. Mỗi lượt chỉ rút 1 đối thủ (đối thủ mang nhiều hiệu ứng đó của pet nhất), tối đa {times} lần mỗi trận.",
    },
    false,
  ),

  // 203 Kim diệp triền phược
  203: rootScript(
    {
      name: "Kim diệp triền phược",
      params: { drain: 4, drain2: 6, times: 3 },
      text: "Cuối lượt, một đối thủ đang Quấn Quanh, Giam Cầm hoặc Hủ Thực do pet gây ra mất thêm {drain}% HP tối đa của nó; nếu đang mang từ 2 hiệu ứng đó của pet trở lên thì {drain2}%. Pet hồi lượng HP bằng phần đó. Mỗi lượt chỉ rút 1 đối thủ (đối thủ mang nhiều hiệu ứng đó của pet nhất), tối đa {times} lần mỗi trận.",
    },
    false,
  ),

  // 204 U lâm nhiếp hồn
  204: rootScript(
    {
      name: "U lâm nhiếp hồn",
      params: { drain: 5, drain2: 7, times: 2 },
      text: "Cuối lượt, một đối thủ đang Quấn Quanh, Giam Cầm hoặc Hủ Thực do pet gây ra mất thêm {drain}% HP tối đa của nó (2 hiệu ứng đó của pet trở lên: {drain2}%). Mỗi lượt chỉ rút 1 đối thủ (đối thủ mang nhiều hiệu ứng đó của pet nhất), tối đa {times} lần mỗi trận. Lượng rút được hồi cho pet; khi có đồng đội trên sân thì chia đều cho pet và đồng đội.",
    },
    true,
  ),

  // 205 Gai non hộ thể
  205: {
    name: "Gai non hộ thể",
    params: { thorn: 5, thorn2: 8, times: 4 },
    text: "Mỗi lần bị đánh trực tiếp, kẻ đánh mất {thorn}% HP tối đa của pet (mỗi lượt 1 lần, gai non chỉ đâm được {times} lần mỗi trận). Khi đang có Đằng chi bích lũy hoặc Thuật cầu nguyện, gai thành {thorn2}%.",
    afterAction(k, e) {
      if (e.skill?.name === "Đằng chi bích lũy") k.e.guardUntil = k.round + 2;
      if (e.skill?.name === "Thuật cầu nguyện") k.e.guardUntil = k.round + 1;
    },
    onHitTaken(k, e) {
      if ((k.v.thorns ?? 0) >= k.p.times || !k.oncePerRound("gai")) return;
      const hard = (k.e.guardUntil ?? -1) >= k.round;
      if (k.damage(e.source, k.pctOf(k.self, hard ? k.p.thorn2 : k.p.thorn)) <= 0) return;
      k.v.thorns = (k.v.thorns ?? 0) + 1;
      k.proc(hard ? "gai cứng" : "gai", e.source);
    },
  },

  // 206 Độc thứ hủ cầu
  206: {
    name: "Độc thứ hủ cầu",
    params: { thorn: 8, rot: 40 },
    text: "Mỗi lần bị đánh trực tiếp, kẻ đánh mất {thorn}% HP tối đa của pet (mỗi lượt 1 lần) và có {rot}% bị Hủ Thực 2 lượt nếu chưa có (cứ 2 lượt 1 lần).",
    onHitTaken(k, e) {
      if (!k.oncePerRound("gai")) return;
      if (k.damage(e.source, k.pctOf(k.self, k.p.thorn)) > 0) k.proc("gai", e.source);
      if (!e.source.alive() || k.has(e.source, "corrosion") || !k.ready("gai độc", 2)) return;
      if (!k.chance(k.p.rot, "hủ")) return;
      if (k.inflict(e.source, "corrosion", 2, { refresh: false })) {
        k.use("gai độc");
        k.proc("gai độc", e.source);
      }
    },
  },

  // 207 Vạn thứ hộ lâm
  207: {
    name: "Vạn thứ hộ lâm",
    params: { thorn: 8, allyThorn: 4, heal: 4, times: 3 },
    text: "Mỗi lần bị đánh trực tiếp, kẻ đánh mất {thorn}% HP tối đa của pet (cứ 2 lượt 1 lần, tối đa {times} lần mỗi trận); khi không có đồng đội trên sân và HP của pet dưới 50%, mỗi lần gai này đâm trúng pet còn hồi {heal}% HP tối đa. Khi có đồng đội trên sân, kẻ đánh trực tiếp đồng đội mất {allyThorn}% HP tối đa của pet (mỗi lượt 1 lần).",
    onHitTaken(k, e) {
      if ((k.v.thorns ?? 0) >= k.p.times || !k.ready("gai", 2)) return;
      if (k.damage(e.source, k.pctOf(k.self, k.p.thorn)) <= 0) return;
      k.use("gai");
      k.v.thorns = (k.v.thorns ?? 0) + 1;
      k.proc("gai", e.source);
      if (!k.ally && k.hpPct() < 50 && k.heal(k.self, k.p.heal).healed > 0) k.proc("gai hồi");
    },
    onAllyHitTaken(k, e) {
      if (!k.isFoe(e.source) || !k.ready("gai đồng đội", 1)) return;
      if (k.damage(e.source, k.pctOf(k.self, k.p.allyThorn)) <= 0) return;
      k.use("gai đồng đội");
      k.proc("gai đồng đội", e.source);
    },
  },

  // 208 Hạt vàng nảy mầm
  208: {
    name: "Hạt vàng nảy mầm",
    params: { reduce: 8, heal: 15 },
    text: "Cuối mỗi lượt trên sân, pet nhận 1 tầng Mầm (tối đa 3). Khi còn Mầm, sát thương trực tiếp pet nhận giảm {reduce}%. Lần đầu đủ 3 tầng trong trận, pet tiêu hết Mầm để hồi {heal}% HP tối đa (mỗi trận 1 lần).",
    roundEnd(k) {
      const n = k.stack("sprout", 1, 3, true);
      k.proc("mầm");
      if (n < 3 || k.v.bloomed) return;
      k.v.bloomed = 1;
      k.stack("sprout", -3, 3, true);
      k.heal(k.self, k.p.heal);
      k.proc("nảy mầm");
    },
    incoming(k, e) {
      if (!e.direct || (k.e.sprout ?? 0) <= 0) return;
      k.proc("mầm giảm");
      return k.p.reduce;
    },
  },

  // 209 Kim tâm kết quả
  209: {
    name: "Kim tâm kết quả",
    params: { heal: 5 },
    text: "Cuối mỗi lượt trên sân, pet nhận 1 tầng DEF +7% trong 2 lượt (chung giới hạn 3 tầng với Thổ thuẫn). Lôi Thiết Bạo Vũ tiêu tầng DEF thì mỗi tầng tiêu còn hồi {heal}% HP tối đa.",
    roundEnd(k) {
      addDefenseTiers(k, 1);
      k.proc("kết quả giáp");
    },
    beforeAction(k, e) {
      k.e.tiers = e.skill?.name === "Lôi Thiết Bạo Vũ" ? k.defenseTiers() : 0;
    },
    afterAction(k) {
      const used = (k.e.tiers ?? 0) - k.defenseTiers();
      k.e.tiers = 0;
      if (used <= 0) return;
      k.heal(k.self, k.p.heal * used);
      k.proc("giáp hồi máu");
    },
  },

  // 210 Rễ Kim Tâm
  210: {
    name: "Rễ Kim Tâm",
    params: { dmg: 15, drain: 25, cap: 7 },
    text: "Khi pet ra đòn sau mục tiêu trong lượt, chiêu Thổ hoặc Mộc gây thêm {dmg}% sát thương. Nếu mục tiêu đang Hủ Thực hoặc Mê Muội, đòn đó còn hồi cho pet {drain}% sát thương thực gây ra (tối đa {cap}% HP tối đa, mỗi lượt 1 lần). Trong trận đôi, phần hồi chuyển sang đồng đội nếu đồng đội có % HP thấp hơn pet.",
    beforeAction(k, e) {
      k.e.rot = e.target && (k.has(e.target, "corrosion") || k.has(e.target, "daze")) ? 1 : 0;
    },
    outgoing(k, e) {
      if (e.actedFirst || !(isAttack(e.skill, EARTH) || isAttack(e.skill, WOOD))) return;
      k.proc("đi sau +%", e.target);
      return k.p.dmg;
    },
    onHitDealt(k, e) {
      if (k.self.designTraitState.actedFirst || !k.e.rot) return;
      if (!(isAttack(e.skill, EARTH) || isAttack(e.skill, WOOD)) || !k.oncePerRound("rễ")) return;
      const amount = Math.min(pct(e.damage, k.p.drain), k.pctOf(k.self, k.p.cap));
      const to = k.ally && k.hpPct(k.ally) < k.hpPct(k.self) ? k.ally : k.self;
      if (k.healAmount(to, amount).healed > 0) k.proc("rễ hồi máu", to);
    },
  },

  // 211 Kim Tâm Bất Hoại
  211: {
    name: "Kim Tâm Bất Hoại",
    params: { reduce: 15, heal: 8, burst: 35, drain: 20, allyBurst: 15 },
    text: "Khi HP trên 60%: pet chịu ít hơn {reduce}% sát thương, và lượt dùng chiêu tăng chỉ số hồi ngay {heal}% HP tối đa. Lần đầu HP tụt dưới 60%: Kim Tâm vỡ, chiêu tấn công kế tiếp gây thêm {burst}% sát thương và hồi {drain}% sát thương thực gây ra. Khi Kim Tâm vỡ, đồng đội cũng nhận +{allyBurst}% sát thương cho đòn kế tiếp.",
    incoming(k, e) {
      if (!e.direct || k.hpPct() <= 60) return;
      k.proc("kim tâm");
      return k.p.reduce;
    },
    beforeAction(k) {
      k.e.whole = k.hpPct() > 60 ? 1 : 0;
    },
    afterAction(k, e) {
      if (!k.e.whole || !isStatUp(e.skill)) return;
      k.heal(k.self, k.p.heal);
      k.proc("kim tâm hồi");
    },
    onDamaged(k, e) {
      if (k.v.broken) return;
      const max = Math.max(1, k.self.maxHp());
      if ((e.before * 100) / max < 60 || (e.after * 100) / max >= 60) return;
      k.v.broken = 1;
      k.v.burst = 1;
      if (k.twoVsTwo) k.v.allyBurst = 1;
      k.proc("kim tâm vỡ");
    },
    outgoing(k, e) {
      if (!k.v.burst || !e.skill?.attack) return;
      k.e.bursting = 1;
      k.proc("vỡ tâm +%", e.target);
      return k.p.burst;
    },
    onHitDealt(k, e) {
      if (!k.e.bursting) return;
      k.e.bursting = 0;
      k.v.burst = 0;
      if (k.healAmount(k.self, pct(e.damage, k.p.drain)).healed > 0) k.proc("vỡ tâm hút máu");
    },
    allyOutgoing(k, e) {
      if (!k.v.allyBurst || !e.skill?.attack) return;
      k.v.allyBurst = 0;
      k.proc("vỡ tâm đồng đội", e.source);
      return k.p.allyBurst;
    },
  },

  // 212 Phấn Cười Mê Hồn
  212: {
    name: "Phấn Cười Mê Hồn",
    params: { acc: 20, drain: 50 },
    text: "Khi pet đặt Hủ Thực mới lên đối thủ, đối thủ hít Phấn Cười: giảm {acc}% chính xác trong 2 lượt. Mỗi tick Hủ Thực do pet gây ra hồi cho pet {drain}% lượng HP đối thủ vừa mất. Trong trận đôi, phần hồi chia đều cho pet và đồng đội, và mỗi đối thủ mang Hủ Thực của pet đều hít Phấn Cười riêng.",
    afterAction(k, e) {
      if (!e.target || !e.newStatuses.includes("corrosion")) return;
      if (k.inflict(e.target, "accuracy_down", 2, { value: k.p.acc }))
        k.proc("phấn cười", e.target);
    },
    onDotTick(k, e) {
      if (e.status !== "corrosion") return;
      healSplit(k, pct(e.damage, k.p.drain), true, "hủ hồi máu");
    },
  },

  // 213 Huyết Bào Lan Tỏa
  213: {
    name: "Huyết Bào Lan Tỏa",
    params: { acc: 20, dmg: 15, heal: 10 },
    text: "Đối thủ đang Hủ Thực hoặc Ngủ hít Phấn Cười: giảm {acc}% chính xác và chịu thêm {dmg}% sát thương từ pet. Khi Hủ Thực do pet gây ra hết hạn hoặc bị kích nổ, bào tử lan: pet hồi {heal}% HP tối đa. Khi có đồng đội trên sân, bào tử lan còn đặt Hủ Thực 3 lượt lên đối thủ còn lại nếu chưa có (thay cho phần hồi {heal}% HP).",
    outgoing(k, e) {
      if (!e.skill?.attack || !(k.has(e.target, "corrosion") || k.has(e.target, "sleep"))) return;
      k.proc("phấn cười +%", e.target);
      return k.p.dmg;
    },
    afterAction(k, e) {
      if (e.target && e.newStatuses.includes("corrosion")) k.mark(e.target, "bào", 99);
      spores(k);
    },
    onOtherAction(k) {
      spores(k);
    },
    roundEnd(k) {
      spores(k);
    },
  },

  // 214 Đồng Xà Cuộn Thân
  214: coilScript(
    {
      name: "Đồng Xà Cuộn Thân",
      params: { def: 7 },
      text: "Lần đầu mỗi lượt bị đánh trúng, pet cuộn thân: nhận 1 tầng DEF +{def}% trong 2 lượt (tối đa 3 tầng) và chiêu tấn công ở lượt kế tiếp được ra đòn trước. Phần ra đòn trước cứ 2 lượt kích hoạt 1 lần.",
    },
    false,
    false,
  ),

  // 215 Lôi Mãng Bật Nanh
  215: coilScript(
    {
      name: "Lôi Mãng Bật Nanh",
      params: { def: 8, dmg: 15 },
      text: "Lần đầu mỗi lượt bị đánh trúng: nhận 1 tầng DEF +{def}% trong 2 lượt (tối đa 3 tầng) và chiêu tấn công ở lượt kế tiếp được ra đòn trước, gây thêm {dmg}% sát thương. Phần ra đòn trước cứ 2 lượt 1 lần.",
    },
    true,
    false,
  ),

  // 216 Xà Vương Lôi Khiếu
  216: coilScript(
    {
      name: "Xà Vương Lôi Khiếu",
      params: { def: 8, dmg: 15, para: 30 },
      text: "Lần đầu mỗi lượt bị đánh trúng: nhận 1 tầng DEF +{def}% (2 lượt, tối đa 3) và đòn kế tiếp được ra trước, gây thêm {dmg}% sát thương (cứ 2 lượt 1 lần). Đòn bật nanh ấy nếu trúng còn {para}% gây Tê Liệt 2 lượt.",
    },
    true,
    true,
  ),

  // 217 Móc Câu Thủy Thủ
  217: hookScript(
    {
      name: "Móc Câu Thủy Thủ",
      params: { slow: 15, dmg: 12, reduce: 10 },
      text: "Đòn tấn công đầu tiên lên mỗi đối thủ gắn Móc Câu 3 lượt (Giam Cầm, Linh xảo −{slow}%). Pet và pet vào thay chỗ gây thêm {dmg}% sát thương lên mục tiêu mang Móc Câu; mục tiêu mang Móc gây ít hơn {reduce}% sát thương lên pet. Đồng đội đánh mục tiêu mang Móc cũng gây thêm {dmg}%.",
    },
    {
      incoming(k, e) {
        if (!e.direct || !hooked(k, e.source)) return;
        k.proc("móc giảm", e.source);
        return k.p.reduce;
      },
      allyOutgoing(k, e) {
        if (!e.skill?.attack || !hooked(k, e.target)) return;
        k.proc("móc đồng đội +%", e.source);
        return k.p.dmg;
      },
      onLeave(k, e) {
        // Pet vào thay hưởng thưởng Móc: xấp xỉ bằng Sức mạnh +dmg% tới khi Móc hết.
        if (!e.next) return;
        const foe = k.foes.find((f) => hooked(k, f));
        if (!foe) return;
        k.statUp(e.next, "attack", k.p.dmg, Math.max(1, remaining(foe, "bind")), "móc thay");
        k.proc("móc truyền", e.next);
      },
    },
  ),

  // 218 Hắc Triều Cướp Buồm
  218: hookScript(
    {
      name: "Hắc Triều Cướp Buồm",
      params: { slow: 15, dmg: 15, shield: 12, ally: 10 },
      text: "Đòn tấn công đầu tiên lên mỗi đối thủ gắn Móc Câu 3 lượt (Giam Cầm, Linh xảo −{slow}%); pet đánh mục tiêu mang Móc gây thêm {dmg}% sát thương. Mỗi lần pet gỡ hoặc cướp buff của mục tiêu mang Móc, pet nhận khiên {shield}% HP tối đa trong 2 lượt. Đồng đội đánh mục tiêu mang Móc cũng gây thêm {ally}%.",
    },
    {
      afterAction(k, e) {
        if (e.dispelled <= 0 || !hooked(k, e.target)) return;
        k.shield(k.self, k.p.shield, 2);
        k.proc("khiên cướp buồm", e.target);
      },
      allyOutgoing(k, e) {
        if (!e.skill?.attack || !hooked(k, e.target)) return;
        k.proc("móc đồng đội +%", e.source);
        return k.p.ally;
      },
    },
  ),

  // 219 Hải Vương Thu Lưới
  219: hookScript(
    {
      name: "Hải Vương Thu Lưới",
      params: { slow: 15, dmg: 18, heal: 10, def: 15 },
      text: "Đòn tấn công đầu tiên lên mỗi đối thủ gắn Móc Câu 3 lượt (Giam Cầm, Linh xảo −{slow}%); pet đánh mục tiêu mang Móc gây thêm {dmg}% sát thương. Khi mục tiêu mang Móc tụt dưới 35% HP, pet thu lưới: hồi {heal}% HP tối đa và mục tiêu giảm thêm {def}% DEF trong 2 lượt. Thu lưới kích hoạt riêng với từng đối thủ mang Móc (mỗi đối thủ 1 lần), đồng đội cùng hưởng phần giảm DEF.",
    },
    {
      onHitDealt(k, e) {
        haul(k, e.target);
      },
      onAllyHitDealt(k, e) {
        haul(k, e.target);
      },
    },
  ),

  // 220 Nòng Thép Nạp Giáp
  220: cannonScript({
    name: "Nòng Thép Nạp Giáp",
    params: { per: 8 },
    text: "Khi vào sân pet nhận 1 tầng DEF +7% trong 2 lượt; mỗi lượt lần đầu bị đánh trúng nhận thêm 1 tầng (tối đa 3). Chiêu tấn công +{per}% sát thương cho mỗi tầng DEF đang có.",
  }),

  // 221 Kim Đảm Đại Pháo
  221: cannonScript(
    {
      name: "Kim Đảm Đại Pháo",
      params: { per: 8, pierce: 25 },
      text: "Vào sân nhận 1 tầng DEF +7%; mỗi lượt lần đầu bị đánh trúng nhận thêm 1 tầng (tối đa 3). Chiêu tấn công +{per}% sát thương cho mỗi tầng DEF. Khi bắn với đủ 3 tầng, đòn bỏ qua {pierce}% DEF mục tiêu và giữ lại các tầng (không bị Lôi Thiết Bạo Vũ tính).",
    },
    {
      beforeAction(k, e) {
        k.e.full = e.skill?.attack && k.defenseTiers() >= 3 ? 1 : 0;
      },
      pierce(k, e) {
        if (!e.skill?.attack || (!k.e.full && k.defenseTiers() < 3)) return;
        k.proc("xuyên giáp", e.target);
        return k.p.pierce;
      },
      afterAction(k) {
        if (!k.e.full) return;
        k.e.full = 0;
        // Giữ lại các tầng: chiêu nào tiêu tầng (Lôi Thiết Bạo Vũ) thì trả lại đủ 3.
        const lost = 3 - k.defenseTiers();
        if (lost > 0) {
          addDefenseTiers(k, lost);
          k.proc("giữ tầng");
        }
      },
    },
  ),

  // 222 Lôi Dực Phá Xác
  222: {
    name: "Lôi Dực Phá Xác",
    params: { dmg: 15, reduce: 6 },
    text: "Khi pet ra đòn trước mục tiêu, chiêu Lôi gây thêm {dmg}% sát thương và pet tích 1 Lôi Đà (tối đa 2, giữ 3 lượt). Mỗi Lôi Đà giúp pet chịu ít hơn {reduce}% sát thương.",
    outgoing(k, e) {
      if (!e.actedFirst || !isAttack(e.skill, ELECTRIC)) return;
      k.proc("đi trước +%", e.target);
      return k.p.dmg;
    },
    afterAction(k, e) {
      if (e.actedFirst && e.hit && isAttack(e.skill, ELECTRIC)) gainMomentum(k, 2);
    },
    incoming(k, e) {
      const n = momentum(k);
      if (!e.direct || n <= 0) return;
      k.proc("lôi đà giảm");
      return k.p.reduce * n;
    },
  },

  // 223 Tật Điện Truy Phong
  223: {
    name: "Tật Điện Truy Phong",
    params: { dmg: 8 },
    text: "Khi ra đòn trước mục tiêu, pet tích 1 Lôi Đà (tối đa 3, giữ 3 lượt); mỗi Lôi Đà làm chiêu Lôi gây thêm {dmg}% sát thương. Chiêu Phong trúng cũng cho 1 Lôi Đà dù đi sau.",
    outgoing(k, e) {
      const n = momentum(k);
      if (n <= 0 || !isAttack(e.skill, ELECTRIC)) return;
      k.proc("lôi đà +%", e.target);
      return k.p.dmg * n;
    },
    afterAction(k, e) {
      if (!e.skill?.attack) return;
      if (e.actedFirst || (e.hit && isAttack(e.skill, WIND))) gainMomentum(k, 3);
    },
  },

  // 224 Long Kỵ Xung Lôi
  224: {
    name: "Long Kỵ Xung Lôi",
    params: { dmg: 9, burst: 10 },
    text: "Khi ra đòn trước mục tiêu, pet tích 1 Lôi Đà (tối đa 3, giữ 3 lượt); mỗi Lôi Đà làm chiêu Lôi gây thêm {dmg}% sát thương. Thiên Lôi Long Phán · Bạo tiêu hết Lôi Đà, mỗi tầng tiêu thêm {burst}% sát thương cho chính đòn đó.",
    outgoing(k, e) {
      const n = momentum(k);
      if (n <= 0 || !isAttack(e.skill, ELECTRIC)) return;
      if (e.skill?.name === BAO) {
        k.e.spent = n;
        k.proc("xả lôi đà", e.target);
        return (k.p.dmg + k.p.burst) * n;
      }
      k.proc("lôi đà +%", e.target);
      return k.p.dmg * n;
    },
    afterAction(k, e) {
      if (e.skill?.name === BAO) {
        k.e.spent = 0;
        k.stack("da", -3, 3);
        return;
      }
      if (e.skill?.attack && e.actedFirst) gainMomentum(k, 3);
    },
  },

  // 225 Thiên Lôi Long Uy
  225: {
    name: "Thiên Lôi Long Uy",
    params: { dmg: 7, para: 35, splash: 40 },
    text: "Vào sân với 1 Lôi Đà. Ra đòn trước mục tiêu thì tích thêm 1 (tối đa 3, giữ 3 lượt); mỗi tầng làm chiêu Lôi gây thêm {dmg}% sát thương. Thiên Lôi Long Phán · Bạo tiêu đủ 3 tầng thì sét lan: mục tiêu {para}% Tê Liệt 2 lượt. Khi sét lan, đối thủ còn lại cũng nhận {splash}% sát thương của đòn đó (không kèm Tê Liệt).",
    onEnter(k) {
      gainMomentum(k, 3);
    },
    beforeAction(k, e) {
      k.e.spent = e.skill?.name === BAO ? momentum(k) : 0;
    },
    outgoing(k, e) {
      const n = momentum(k);
      if (n <= 0 || !isAttack(e.skill, ELECTRIC)) return;
      k.proc("lôi đà +%", e.target);
      return k.p.dmg * n;
    },
    onHitDealt(k, e) {
      if ((k.e.spent ?? 0) < 3 || e.skill?.name !== BAO) return;
      k.proc("sét lan", e.target);
      if (k.chance(k.p.para, "sét lan") && k.inflict(e.target, "paralysis", 2))
        k.proc("sét lan tê liệt", e.target);
      const other = k.twoVsTwo ? k.otherFoe(e.target) : undefined;
      if (other && k.damage(other, pct(e.damage, k.p.splash)) > 0) k.proc("sét lan phụ", other);
    },
    afterAction(k, e) {
      if (e.skill?.name === BAO) {
        k.e.spent = 0;
        k.stack("da", -3, 3);
        return;
      }
      if (e.skill?.attack && e.actedFirst) gainMomentum(k, 3);
    },
  },

  // 226 Hồng Phấn Mê Lộ
  226: {
    name: "Hồng Phấn Mê Lộ",
    params: { acc: 15, reduce: 12 },
    text: "Mỗi lượt, chiêu tấn công đầu tiên trúng rắc Phấn: đối thủ giảm {acc}% chính xác trong 2 lượt (không cộng dồn). Khi pet nhanh hơn đối thủ, pet chịu ít hơn {reduce}% sát thương từ đối thủ đó.",
    onHitDealt(k, e) {
      if (e.skill?.attack) dust(k, e.target, true);
    },
    incoming(k, e) {
      if (!e.direct || !k.faster(e.source)) return;
      k.proc("nhanh hơn giảm", e.source);
      return k.p.reduce;
    },
  },

  // 227 Dạ Phấn Ru Mộng
  227: {
    name: "Dạ Phấn Ru Mộng",
    params: { acc: 15, dmg: 18, ally: 8 },
    text: "Mỗi lượt, chiêu tấn công đầu tiên trúng rắc Phấn: đối thủ giảm {acc}% chính xác trong 2 lượt. Đối thủ đang Ngủ, Quấn Quanh hoặc Hủ Thực chịu thêm {dmg}% sát thương từ pet. Đồng đội đánh mục tiêu đang Ngủ, Quấn Quanh hoặc Hủ Thực cũng gây thêm {ally}%.",
    onHitDealt(k, e) {
      if (e.skill?.attack) dust(k, e.target, false);
    },
    outgoing(k, e) {
      if (!e.skill?.attack || !drowsy(k, e.target)) return;
      k.proc("ru mộng +%", e.target);
      return k.p.dmg;
    },
    allyOutgoing(k, e) {
      if (!e.skill?.attack || !drowsy(k, e.target)) return;
      k.proc("ru mộng đồng đội +%", e.source);
      return k.p.ally;
    },
  },

  // 228 Điệp Hậu Mộng Cảnh
  228: {
    name: "Điệp Hậu Mộng Cảnh",
    params: { acc: 15, dmg: 25 },
    text: "Mỗi lượt, chiêu tấn công đầu tiên trúng rắc Phấn: đối thủ giảm {acc}% chính xác trong 2 lượt. Đòn tấn công đầu tiên của pet lên đối thủ đang Ngủ không đánh thức nó và gây thêm {dmg}% sát thương. Đồng đội đánh vào mục tiêu đang Ngủ vẫn đánh thức nó như thường.",
    beforeAction(k, e) {
      const t = e.target;
      k.e.lull = 0;
      if (!t || !e.skill?.attack) return;
      if (!k.has(t, "sleep")) {
        k.unmark(t, "ru-đã");
        return;
      }
      if (k.marked(t, "ru-đã")) return;
      k.e.lull = 1;
      k.e.sleepLeft = Math.max(1, remaining(t, "sleep"));
    },
    outgoing(k, e) {
      if (!k.e.lull || !e.skill?.attack) return;
      k.proc("ru ngủ +%", e.target);
      return k.p.dmg;
    },
    onHitDealt(k, e) {
      if (k.e.lull) {
        k.e.lull = 0;
        k.mark(e.target, "ru-đã", 99);
        // Đòn trực tiếp đã đánh thức mục tiêu: ru ngủ lại với thời hạn còn lại.
        if (!k.has(e.target, "sleep") && k.inflict(e.target, "sleep", k.e.sleepLeft ?? 1))
          k.proc("giữ giấc", e.target);
      }
      if (e.skill?.attack) dust(k, e.target, true);
    },
  },

  // 229 Hắc Dực Đứt Mạch
  229: {
    name: "Hắc Dực Đứt Mạch",
    params: { def: 10 },
    text: "Chiêu Lôi trúng làm đối thủ Đứt Mạch 2 lượt: DEF −{def}% (là hiệu ứng xấu, không cộng dồn). Lượt pet dùng chiêu tăng chỉ số, chiêu tấn công ở lượt kế tiếp được ra đòn trước.",
    onHitDealt(k, e) {
      if (isAttack(e.skill, ELECTRIC) && k.inflict(e.target, "defense_down", 2, { value: k.p.def }))
        k.proc("đứt mạch", e.target);
    },
    afterAction(k, e) {
      if (!isStatUp(e.skill)) return;
      k.v.rush = k.round + 1;
      k.proc("nạp đi trước");
    },
    priority: rushPriority,
  },

  // 230 Bạch Dực Hộ Mạch
  230: {
    name: "Bạch Dực Hộ Mạch",
    params: { def: 10, shield: 12 },
    text: "Chiêu Lôi trúng làm đối thủ Đứt Mạch 2 lượt (DEF −{def}%). Lượt pet dùng chiêu phòng thủ, đồng đội (không có đồng đội thì chính pet) nhận khiên {shield}% HP tối đa của người nhận trong 2 lượt và được xóa 1 debuff.",
    onHitDealt(k, e) {
      if (isAttack(e.skill, ELECTRIC) && k.inflict(e.target, "defense_down", 2, { value: k.p.def }))
        k.proc("đứt mạch", e.target);
    },
    afterAction(k, e) {
      if (!isGuard(e.skill)) return;
      const to = k.allyOrSelf;
      k.shield(to, k.p.shield, 2);
      k.cleanse(to, 1);
      k.proc("hộ mạch", to);
    },
  },

  // 231 Kim Dực Đoạt Mạch
  231: {
    name: "Kim Dực Đoạt Mạch",
    params: { def: 10, defBuffed: 15, heal: 8, dmg: 20 },
    text: "Chiêu Lôi trúng làm đối thủ Đứt Mạch 2 lượt (DEF −{def}%, lên −{defBuffed}% nếu đối thủ đang có buff). Mỗi lần pet xóa hoặc cướp được buff, pet hồi {heal}% HP tối đa và chiêu tấn công kế tiếp gây thêm {dmg}% sát thương.",
    beforeAction(k, e) {
      k.e.buffed = e.target && k.buffs(e.target) > 0 ? 1 : 0;
    },
    onHitDealt(k, e) {
      if (!isAttack(e.skill, ELECTRIC)) return;
      const value = k.e.buffed || k.buffs(e.target) > 0 ? k.p.defBuffed : k.p.def;
      if (k.inflict(e.target, "defense_down", 2, { value })) k.proc("đứt mạch", e.target);
    },
    outgoing(k, e) {
      if (!k.v.loot || !e.skill?.attack) return;
      k.v.loot = 0;
      k.proc("đoạt mạch +%", e.target);
      return k.p.dmg;
    },
    afterAction(k, e) {
      if (e.dispelled <= 0) return;
      k.heal(k.self, k.p.heal);
      k.v.loot = 1;
      k.proc("đoạt mạch", e.target);
    },
  },

  // 232 Liệt Phong Sải Cánh
  232: {
    name: "Liệt Phong Sải Cánh",
    params: { per: 3, cap: 15, slow: 5 },
    text: "Mỗi 10% Linh xảo pet cao hơn mục tiêu, chiêu Phong gây thêm {per}% sát thương (tối đa +{cap}%). Chiêu làm chậm của pet giảm thêm {slow}% Linh xảo mục tiêu.",
    outgoing(k, e) {
      return windOutgoing(k, e.target, e.skill);
    },
    afterAction(k, e) {
      if (!e.hit || !e.target || !e.skill || !SLOW_SKILLS.has(e.skill.name)) return;
      k.statUp(e.target, "speed", -k.p.slow, 2, "liệt phong");
      k.proc("làm chậm thêm", e.target);
    },
  },

  // 233 Điêu Vương Truy Sát
  233: {
    name: "Điêu Vương Truy Sát",
    params: { per: 3, cap: 18 },
    text: "Mỗi 10% Linh xảo pet cao hơn mục tiêu, chiêu Phong gây thêm {per}% sát thương (tối đa +{cap}%). Khi mục tiêu dưới 35% HP, chiêu tấn công của pet được ra đòn trước dù chậm hơn.",
    outgoing(k, e) {
      return windOutgoing(k, e.target, e.skill);
    },
    priority(k, e) {
      if (k.hpPct(e.opponent) >= 35 || (e.skill && !e.skill.attack)) return;
      if (k.oncePerRound("truy sát")) k.proc("truy sát đi trước", e.opponent);
      return true;
    },
  },

  // 234 Phong Sư Áp Trận
  234: {
    name: "Phong Sư Áp Trận",
    params: { per: 3, cap: 18, reduce: 10 },
    text: "Mỗi 10% Linh xảo pet cao hơn mục tiêu, chiêu Phong gây thêm {per}% sát thương (tối đa +{cap}%). Đối thủ chậm hơn pet gây ít hơn {reduce}% sát thương lên pet. Đối thủ chậm hơn pet cũng gây ít hơn {reduce}% sát thương lên đồng đội của pet.",
    outgoing(k, e) {
      return windOutgoing(k, e.target, e.skill);
    },
    incoming(k, e) {
      if (!e.direct || !k.faster(e.source)) return;
      k.proc("áp trận giảm", e.source);
      return k.p.reduce;
    },
    guardAlly(k, e) {
      if (!k.faster(e.source)) return;
      k.proc("hào quang gió", e.target);
      return k.p.reduce;
    },
  },

  // 235 Thiên Vũ Cuồng Phong
  235: {
    name: "Thiên Vũ Cuồng Phong",
    params: { per: 3, cap: 15, slow: 15 },
    text: "Mỗi 10% Linh xảo pet cao hơn mục tiêu, chiêu Phong gây thêm {per}% sát thương (tối đa +{cap}%). Khi HP trên 60%, đòn trúng của pet cuốn gió: mục tiêu giảm {slow}% Linh xảo trong 2 lượt (không cộng dồn).",
    outgoing(k, e) {
      return windOutgoing(k, e.target, e.skill);
    },
    onHitDealt(k, e) {
      if (!e.skill?.attack || k.hpPct() <= 60) return;
      k.statUp(e.target, "speed", -k.p.slow, 2, "cuốn gió");
      k.proc("cuốn gió", e.target);
    },
  },

  // 236 Ve Sầu Thoát Xác
  236: {
    name: "Ve Sầu Thoát Xác",
    params: { shield: 20, spd: 20, bonus: 30 },
    text: "Mỗi lần ra sân, lần đầu HP tụt xuống dưới 50%, pet bỏ xác: nhận khiên {shield}% HP tối đa trong 1 lượt, Linh xảo +{spd}% trong 2 lượt và chiêu Lôi kế tiếp gây thêm {bonus}% sát thương. Nếu đòn đó lẽ ra hạ gục pet khi đang đầy HP, pet trụ lại với 1 HP trước khi bỏ xác.",
    incoming(k, e) {
      // Đòn hạ gục lúc đầy HP (chưa bỏ xác lần ra sân này): khiên tạm, trụ lại 1 HP.
      if (e.direct && !k.e.shed && k.self.hp() >= k.self.maxHp()) armMolt(k, e.damage);
    },
    onHitTaken(k) {
      if (settleMolt(k)) k.proc("trụ 1 HP");
      shedSkin(k);
    },
    onDamaged(k) {
      if (!k.e.molting) shedSkin(k);
    },
    roundEnd(k) {
      settleMolt(k);
    },
    outgoing(k, e) {
      if (!k.e.bolt || !isAttack(e.skill, ELECTRIC)) return;
      k.e.bolt = 0;
      k.proc("xác lôi +%", e.target);
      return k.p.bonus;
    },
  },

  // 237 Lục Dực Tân Sinh
  237: {
    name: "Lục Dực Tân Sinh",
    params: { heal: 20, bonus: 20 },
    text: "Mỗi trận một lần, khi HP tụt xuống dưới 40%, pet mọc cánh mới: hồi {heal}% HP tối đa, chiêu Lôi gây thêm {bonus}% sát thương tới hết trận và đòn kế tiếp được ra trước. Nếu đòn đó lẽ ra hạ gục pet khi đang trên 70% HP, pet trụ lại với 1 HP rồi mới mọc cánh.",
    incoming(k, e) {
      // Đòn hạ gục khi trên 70% HP (chưa mọc cánh): khiên tạm, trụ lại 1 HP.
      if (e.direct && !k.v.wings && k.hpPct() > 70) armMolt(k, e.damage);
    },
    onHitTaken(k) {
      if (settleMolt(k)) k.proc("trụ 1 HP");
      regrow(k);
    },
    onDamaged(k) {
      if (!k.e.molting) regrow(k);
    },
    roundEnd(k) {
      settleMolt(k);
    },
    priority: rushPriority,
    outgoing(k, e) {
      if (!k.v.wings || !isAttack(e.skill, ELECTRIC)) return;
      k.proc("cánh lôi +%", e.target);
      return k.p.bonus;
    },
  },

  // 238 Triều Dâng Lam Hải
  238: tideScript(
    {
      name: "Triều Dâng Lam Hải",
      params: { dmg: 15, reduce: 15, heal: 6, ally: 8 },
      text: "Trận đấu chạy theo thủy triều. Lượt lẻ (Triều Lên): chiêu Thủy gây thêm {dmg}% sát thương. Lượt chẵn (Triều Rút): pet chịu ít hơn {reduce}% sát thương và cuối lượt hồi {heal}% HP tối đa. Đồng đội cùng dòng Nguyệt Hùng đứng cạnh cùng hưởng pha triều của pet (+{ally}%/−{ally}% theo pha).",
    },
    false,
  ),

  // 239 Nguyệt Triều Chiến Ý
  239: tideScript(
    {
      name: "Nguyệt Triều Chiến Ý",
      params: { dmg: 18, reduce: 18, heal: 6 },
      text: "Lượt lẻ (Triều Lên): chiêu Thủy gây thêm {dmg}% sát thương. Lượt chẵn (Triều Rút): chịu ít hơn {reduce}% sát thương và cuối lượt hồi {heal}% HP. Dùng chiêu hồi máu sẽ đảo pha triều ngay lượt đó. Đảo pha cũng đảo cho đồng đội cùng họ Nguyệt Hùng; chiêu hồi máu hồi đồng đội cũng tính.",
    },
    true,
  ),
};
