import type { DesignTraitUnit } from "../../DesignTraits";
import { BUFF_BANK } from "../../StatusState";
import type { Kit, KitSkill, TraitScript } from "../TraitKit";

/** Hệ: 0 Hỏa, 1 Mộc, 2 Thổ, 3 Thủy, 4 Điện (Lôi), 5 Quỷ, 6 Phong. */
const WOOD = 1;
const EARTH = 2;
const ELECTRIC = 4;
const WIND = 6;
/** Khiên chắn là buff 15. */
const SHIELD_ID = 15;

/** Phần khai báo của một kịch bản (tên, số chỉnh được, mô tả mẫu). */
type Meta = Pick<TraitScript, "name" | "params" | "text" | "text2v2">;

/** Chiêu "· Bạo" Power 155 → 190 khi tiêu dấu: +23% sát thương (số của chiêu, không cân bằng ở đây). */
const BURST_BONUS = Math.round((190 / 155 - 1) * 100);
const isBurst = (skill: KitSkill | undefined, name: string) => skill?.name === name;
const isAttack = (skill: KitSkill | undefined, element?: number) =>
  !!skill?.attack && (element === undefined || skill.element === element);

/** Thêm `count` tầng Phòng ngự thật (buff 4, chung với Thổ thuẫn, DEF +7%/tầng, 2 lượt, tối đa 3). */
function addDefenseTiers(k: Kit, count: number): void {
  for (let i = 0; i < count; i++) k.self.effects.applySourceBuff(k.self, 4, 0);
  k.self.restoreSourceStatusState();
  k.refresh();
}

/** Pet phe mình (kể cả chính pet) có % HP thấp nhất. */
function lowestTeammate(k: Kit): DesignTraitUnit {
  return k.team.reduce((a, b) => (k.hpPct(b) < k.hpPct(a) ? b : a), k.self);
}

// ------------------------------------------------------------------ Vòng Siết (121–123)

/** Mục tiêu đang siết của từng pet (mất khi đổi mục tiêu hoặc rời sân). */
const constrictTarget = new WeakMap<DesignTraitUnit, DesignTraitUnit>();
const RING = "vòng siết";

function ringKey(k: Kit): string {
  return `${RING}:${k.self.ownerSide}:${k.self.speciesId}`;
}
function rings(k: Kit, target: DesignTraitUnit | undefined): number {
  return target && constrictTarget.get(k.self) === target ? k.marked(target, RING) : 0;
}
function dropRings(k: Kit): void {
  const old = constrictTarget.get(k.self);
  if (old) {
    k.unmark(old, RING);
    k.clearStat(old, ringKey(k));
  }
  constrictTarget.delete(k.self);
}
/** Đánh trúng: cùng mục tiêu ở lượt liên tiếp thêm 1 Vòng (tối đa 3); đổi mục tiêu thì mất Vòng. */
function constrictHit(k: Kit, target: DesignTraitUnit, skill: KitSkill | undefined, cap = 3): void {
  if (!skill?.attack || !k.oncePerRound("siết")) return;
  const prev = constrictTarget.get(k.self);
  if (prev !== target) {
    dropRings(k);
    constrictTarget.set(k.self, target);
  } else if (k.v.ringRound === k.round - 1) {
    const n = k.mark(target, RING, 99, cap);
    // Mỗi Vòng: mục tiêu −slow% Linh xảo (đồng đội đánh nó cũng hưởng).
    k.statUp(target, "speed", -k.p.slow * n, 99, ringKey(k));
    k.proc("vòng siết", target);
  }
  k.v.ringRound = k.round;
}
/** params: slow (% Linh xảo mỗi Vòng), dmg (% sát thương mỗi Vòng). */
function constrictScript(meta: Meta, extra: Partial<TraitScript> = {}, cap = 3): TraitScript {
  return {
    ...meta,
    onHitDealt(k, e) {
      constrictHit(k, e.target, e.skill, cap);
    },
    outgoing(k, e) {
      const n = rings(k, e.target);
      if (n > 0 && e.skill?.attack) {
        k.proc("siết +%", e.target);
        return k.p.dmg * n;
      }
    },
    onLeave(k) {
      dropRings(k);
    },
    ...extra,
  };
}

// ------------------------------------------------------------------ Chấn Lực (131–132)

/** params: dmg (% mỗi Chấn Lực), def (% DEF mỗi Chấn Lực), quake, petrify (dư chấn). */
function quakeScript(meta: Meta, aftershock: boolean): TraitScript {
  return {
    ...meta,
    onHitTaken(k) {
      // Bị đòn trực tiếp: +1 Chấn Lực (tối đa 3, giữ tới khi dùng).
      k.stack("chấn", 1, 3);
      k.proc("chấn lực");
    },
    statBonus(k, stat) {
      if (stat === "defense" && k.p.def) return (k.v.chấn ?? 0) * k.p.def;
    },
    beforeAction(k, e) {
      k.e.useQ = isAttack(e.skill, EARTH) ? (k.v.chấn ?? 0) : 0;
    },
    outgoing(k, e) {
      if (k.e.useQ) {
        k.proc("xả chấn lực", e.target);
        return k.p.dmg * k.e.useQ;
      }
    },
    afterAction(k, e) {
      const n = k.e.useQ ?? 0;
      if (n <= 0) return;
      k.e.useQ = 0;
      k.stack("chấn", -3, 3);
      if (n < 3) return;
      if (!aftershock) {
        if (!k.has(e.target, "petrify") && k.inflict(e.target, "petrify", 1, { refresh: false }))
          k.proc("hóa đá", e.target);
        return;
      }
      // Dư chấn: mọi đối thủ mất quake% HP tối đa của chúng, mỗi con petrify% Hóa Đá 1 lượt.
      for (const foe of k.foes) {
        if (k.damage(foe, k.pctOf(foe, k.p.quake)) > 0) k.proc("dư chấn", foe);
        if (!k.has(foe, "petrify") && k.chance(k.p.petrify, "dư chấn"))
          if (k.inflict(foe, "petrify", 1, { refresh: false })) k.proc("hóa đá", foe);
      }
    },
  };
}

// ------------------------------------------------------------------ Đồng Cầu (134–135)

const BALL_LINE = [134, 135];

/** params: def (% DEF khi HP > hpLine%), bounce (% đòn kế tiếp), brother (% DEF khi đứng cạnh anh em). */
function ballScript(meta: Meta, extra: Partial<TraitScript>, hpLine = 60): TraitScript {
  return {
    ...meta,
    beforeAction(k) {
      // Ghi một lần mỗi lần ra sân khi đứng cạnh anh em (đồng đội có thể vào sân sau pet).
      if (!k.e.bro && k.ally && BALL_LINE.includes(k.ally.speciesId)) {
        k.e.bro = 1;
        k.proc("anh em song cầu", k.ally);
      }
    },
    statBonus(k, stat) {
      if (stat !== "defense") return;
      let bonus = k.hpPct() > hpLine && !k.e.shellBroken ? k.p.def : 0;
      // 2v2: đứng cạnh pet cùng dòng Đồng Cầu, cả hai thêm DEF.
      if (k.ally && BALL_LINE.includes(k.ally.speciesId)) bonus += k.p.brother;
      return bonus;
    },
    onDamaged(k) {
      k.refresh();
    },
    outgoing(k, e) {
      if (k.e.bounce && e.skill?.attack) {
        k.proc("nảy bật +30%", e.target);
        return k.p.bounce;
      }
    },
    afterAction(k, e) {
      if (k.e.bounce && e.skill?.attack && e.damaging) k.e.bounce = 0;
    },
    ...extra,
  };
}

// ------------------------------------------------------------------ Thiên Điện (136–139)

function thunderTiers(k: Kit): number {
  return k.e.tdUntil !== undefined && k.e.tdUntil >= k.round ? (k.e.td ?? 0) : 0;
}
/** +1 tầng Thiên Điện trong 3 lượt (mất khi rời sân). */
function addThunder(k: Kit, cap: number): number {
  if (thunderTiers(k) === 0) k.e.td = 0;
  k.e.tdUntil = k.round + 2;
  const n = k.stack("td", 1, cap, true);
  k.proc("thiên điện");
  return n;
}
/** params: dmg (% sát thương Lôi mỗi tầng), speed (% Linh xảo mỗi tầng, nếu có). */
function thunderScript(meta: Meta, cap: number, extra: Partial<TraitScript> = {}): TraitScript {
  return {
    ...meta,
    statBonus(k, stat) {
      if (stat === "speed" && k.p.speed) return thunderTiers(k) * k.p.speed;
    },
    outgoing(k, e) {
      if (isAttack(e.skill, ELECTRIC)) {
        const n = thunderTiers(k);
        if (n > 0) k.proc("thiên điện +%", e.target);
        return n * k.p.dmg;
      }
    },
    onHitDealt(k, e) {
      if (isAttack(e.skill, ELECTRIC)) addThunder(k, cap);
    },
    ...extra,
  };
}

// ------------------------------------------------------------------ Thứu (140–142)

/** params: first (% đòn đi trước), slow (% Linh xảo hãm), speed (% Linh xảo tự tăng, nếu có). */
function hawkScript(
  meta: Meta,
  opts: { executeBelow?: number; extra?: Partial<TraitScript> } = {},
): TraitScript {
  const first = (k: Kit, target: DesignTraitUnit | undefined, actedFirst: boolean) =>
    actedFirst || (!!opts.executeBelow && !!target && k.hpPct(target) < opts.executeBelow);
  return {
    ...meta,
    outgoing(k, e) {
      if (e.skill?.attack && first(k, e.target, e.actedFirst)) {
        k.proc("đi trước +%", e.target);
        return k.p.first;
      }
    },
    onHitDealt(k, e) {
      if (!e.skill?.attack) return;
      if (first(k, e.target, k.self.designTraitState.actedFirst)) {
        if (k.p.speed) {
          k.statUp(k.self, "speed", k.p.speed, 2, "ưng tốc");
          k.proc("tăng tốc");
        }
      } else if (e.skill.element === WIND) {
        // Không cộng dồn với chính nó: cùng khóa thì thay bản cũ.
        const key = `hãm tốc:${k.self.ownerSide}:${k.self.speciesId}`;
        k.statUp(e.target, "speed", -k.p.slow, 2, key);
        k.proc("hãm tốc", e.target);
      }
    },
    ...opts.extra,
  };
}

// ------------------------------------------------------------------ Hút máu (143–145)

/** Khống chế mà bản phác thảo liệt kê: Ngủ, Quỷ Mị, Hỗn Loạn, Giam Cầm, Mê Muội. */
const SOFT_CONTROL = ["sleep", "ghost", "confusion", "bind", "daze"] as const;
const held = (k: Kit, unit: DesignTraitUnit | undefined) =>
  SOFT_CONTROL.some((s) => k.has(unit, s));

/** params: drain, ctlDrain (% hút), ctlDmg (% sát thương lên mục tiêu bị khống chế), cap (khiên). */
function drainScript(meta: Meta, overflowShield = false): TraitScript {
  return {
    ...meta,
    beforeAction(k, e) {
      k.e.ctl = held(k, e.target) ? 1 : 0;
    },
    outgoing(k, e) {
      if (k.p.ctlDmg && e.skill?.attack && held(k, e.target)) {
        k.proc("đánh mục tiêu bị khống chế", e.target);
        return k.p.ctlDmg;
      }
    },
    afterAction(k, e) {
      if (!e.hit || e.damage <= 0 || !e.skill?.attack) return;
      const pct = k.e.ctl ? k.p.ctlDrain : k.p.drain;
      const r = k.healAmount(k.self, Math.trunc((e.damage * pct) / 100));
      if (r.healed > 0 || r.overflow > 0) k.proc(k.e.ctl ? "hút máu mạnh" : "hút máu");
      // Phần hút vượt HP tối đa: khiên cho đồng đội thấp máu nhất (1v1: chính pet), 2 lượt.
      if (overflowShield && r.overflow > 0) {
        const to = k.ally ? lowestTeammate(k) : k.self;
        const amount = Math.min(r.overflow, k.pctOf(to, k.p.cap));
        if (k.shieldAmount(to, amount, 2)) k.proc("hút dư thành khiên", to);
      }
    },
  };
}

// ------------------------------------------------------------------ Tầng nộ (152–155)

function rageTiers(k: Kit): number {
  return k.e.rageUntil !== undefined && k.e.rageUntil >= k.round ? (k.e.rage ?? 0) : 0;
}
/** +1 tầng nộ (Sức mạnh) trong 3 lượt, cộng dồn tới `cap`. */
function addRage(k: Kit, cap: number): number {
  if (rageTiers(k) === 0) k.e.rage = 0;
  k.e.rageUntil = k.round + 2;
  const n = k.stack("rage", 1, cap, true);
  k.proc("nộ");
  return n;
}
/** params: atk (% Sức mạnh mỗi tầng). */
function rageScript(meta: Meta, cap: number, extra: Partial<TraitScript> = {}): TraitScript {
  return {
    ...meta,
    onHitTaken(k) {
      addRage(k, cap);
    },
    statBonus(k, stat) {
      if (stat === "attack") return rageTiers(k) * k.p.atk;
    },
    ...extra,
  };
}
/** 155: pet hoặc đồng đội bị đánh trúng → +1 tầng, mỗi lượt tối đa 2 tầng. */
function chiefRage(k: Kit): boolean {
  if (k.e.chiefRound !== k.round) {
    k.e.chiefRound = k.round;
    k.e.chiefCount = 0;
  }
  if ((k.e.chiefCount ?? 0) >= 2) return false;
  k.e.chiefCount = (k.e.chiefCount ?? 0) + 1;
  addRage(k, 3);
  return true;
}

// ------------------------------------------------------------------ danh sách chiêu theo tên

/** Chiêu hồi máu hoặc giải trừ. */
const HEAL_OR_CLEANSE = new Set([
  "Thủy Linh Hồi Sinh",
  "Lam Tuyền Chữa Lành",
  "Hải Tâm Tái Tạo",
  "Thảo nguyện thuật",
  "Thiên Mã Thánh Hộ · Dưỡng",
  "Người bảo vệ Địa Giới",
  "Thạch phu thuật",
  "Thuật cầu nguyện",
]);
const isHealOrCleanse = (skill: KitSkill | undefined) => !!skill && HEAL_OR_CLEANSE.has(skill.name);

/** Chiêu khống chế (Ngủ, Giam Cầm, Quỷ Mị, Hỗn Loạn) mà Pháp Quan có thể mang. */
const CONTROL_SKILLS = new Set([
  "Mao Cầu Bạo Phấn · Tỏa",
  "Miên Ca Lam Mộng",
  "Long Quyển Phong Tỏa",
  "Hỗn loạn",
  "Mị ảnh",
]);

/** 151: mục tiêu đang Ngủ, Mê Muội hoặc Giam Cầm. */
const judged = (k: Kit, unit: DesignTraitUnit | undefined) =>
  k.has(unit, "sleep") || k.has(unit, "daze") || k.has(unit, "bind");

/** Chiêu gây Xé Rách theo tỉ lệ. */
const BLEED_SKILLS = new Set(["Nham Nha Phệ Cốt", "Liệt Trảo Xé Gió", "Vạn Thú Chấn Hống"]);

/** Kịch bản đặc tính, phần 4. */
export const PART_4: Record<number, TraitScript> = {
  // 120 Thủy Tinh Hùng Sư
  120: {
    name: "Hùng sư bá khí",
    params: { roar: 15, pierce: 15 },
    text: "Khi ra sân, pet gầm: đối thủ gây ít hơn {roar}% sát thương trong 2 lượt. Đánh đối thủ đang bị Gầm thì bỏ qua {pierce}% DEF; nếu đòn đó gỡ được buff, Gầm được làm mới.",
    onEnter(k) {
      // Gầm (2v2: cả hai đối thủ).
      for (const foe of k.foes)
        if (k.inflict(foe, "damage_down", 2, { value: k.p.roar })) {
          k.mark(foe, "gầm", 2);
          k.proc("gầm", foe);
        }
    },
    pierce(k, e) {
      if (k.marked(e.target, "gầm") > 0 && k.has(e.target, "damage_down")) {
        k.proc("xuyên giáp", e.target);
        return k.p.pierce;
      }
    },
    afterAction(k, e) {
      // Đòn lên mục tiêu đang bị Gầm gỡ được buff: Gầm được làm mới trên con đó.
      if (!e.target || e.dispelled <= 0 || k.marked(e.target, "gầm") === 0) return;
      if (k.inflict(e.target, "damage_down", 2, { value: k.p.roar })) {
        k.mark(e.target, "gầm", 2);
        k.proc("làm mới gầm", e.target);
      }
    },
  },

  // 121 Xích Đồng Xà
  121: constrictScript({
    name: "Xà vảy cuộn siết",
    params: { slow: 8, dmg: 10 },
    text: "Đánh trúng cùng một mục tiêu ở lượt liên tiếp, mỗi lần thêm 1 Vòng Siết lên nó (tối đa 3): mỗi Vòng làm mục tiêu −{slow}% Linh xảo và chiêu tấn công của pet lên nó +{dmg}% sát thương. Đổi mục tiêu hoặc rời sân thì mất Vòng.",
  }),

  // 122 Thiết Giáp Xà
  122: constrictScript(
    {
      name: "Thiết xà xiết mồi",
      params: { slow: 6, dmg: 8, thorn: 4 },
      text: "Đánh trúng cùng một mục tiêu ở lượt liên tiếp thêm 1 Vòng Siết (tối đa 2; mỗi Vòng −{slow}% Linh xảo, pet đánh nó +{dmg}%). Khi mục tiêu đang bị siết đánh trúng pet, nó mất {thorn}% HP tối đa của chính nó (mỗi lần ra sân 1 lần). Khi bị đối thủ thứ hai đánh, pet không mất Vòng trên mục tiêu chính; đồng đội đánh mục tiêu bị siết cũng hưởng Linh xảo giảm.",
    },
    {
      onHitTaken(k, e) {
        // Mục tiêu đang bị siết đánh trúng pet: mất thorn% HP tối đa của nó.
        if (rings(k, e.source) <= 0 || k.e.thorned) return;
        k.e.thorned = 1;
        if (k.damage(e.source, k.pctOf(e.source, k.p.thorn)) > 0) k.proc("gai siết", e.source);
      },
    },
    2,
  ),

  // 123 Xích Kim Xà Vương
  123: constrictScript(
    {
      name: "Xà vương nghiền cốt",
      params: { slow: 8, dmg: 8 },
      text: "Đánh trúng cùng một mục tiêu ở lượt liên tiếp thêm 1 Vòng Siết (tối đa 3; mỗi Vòng −{slow}% Linh xảo, pet đánh nó +{dmg}%). Xà Vương Lôi Tỏa · Bạo coi Vòng Siết là dấu: tiêu hết để đạt Power 190, và nếu tiêu đủ 3 Vòng thì mục tiêu bị Tê Liệt 1 lượt.",
    },
    {
      outgoing(k, e) {
        const n = rings(k, e.target);
        let bonus = 0;
        if (n > 0 && e.skill?.attack) {
          k.proc("siết +%", e.target);
          bonus += k.p.dmg * n;
        }
        // Xà Vương Lôi Tỏa · Bạo tiêu hết Vòng để đạt Power 190.
        if (n > 0 && isBurst(e.skill, "Xà Vương Lôi Tỏa · Bạo")) {
          k.e.burst = n;
          bonus += BURST_BONUS;
        }
        return bonus;
      },
      afterAction(k, e) {
        const n = k.e.burst ?? 0;
        if (n <= 0) return;
        k.e.burst = 0;
        if (e.target) {
          k.unmark(e.target, RING);
          k.clearStat(e.target, ringKey(k));
        }
        k.proc("nghiền cốt", e.target);
        if (n >= 3 && k.inflict(e.target, "paralysis", 1)) k.proc("tê liệt", e.target);
      },
    },
  ),

  // 124 Xích Kim Xà Hậu
  124: {
    name: "Nanh hậu tê dại",
    params: { chance: 15, drain: 5 },
    text: "Chiêu hệ Lôi đánh trúng có thêm {chance}% gây Tê Liệt 1 lượt. Đánh mục tiêu đang Tê Liệt thì nó mất thêm {drain}% HP tối đa và pet hồi đúng lượng đó. Tê Liệt do đồng đội gây cũng kích phần hút sinh lực khi pet đánh mục tiêu đó.",
    beforeAction(k, e) {
      k.e.para = k.has(e.target, "paralysis") ? 1 : 0;
    },
    onHitDealt(k, e) {
      // Đánh mục tiêu đang Tê Liệt (kể cả do đồng đội gây): mất drain% HP tối đa, pet hồi đúng lượng đó.
      if (k.e.para && k.oncePerRound("hút")) {
        const lost = k.damage(e.target, k.pctOf(e.target, k.p.drain));
        if (lost > 0) {
          k.healAmount(k.self, lost);
          k.proc("hút sinh lực", e.target);
        }
      }
      if (isAttack(e.skill, ELECTRIC) && !k.has(e.target, "paralysis"))
        if (k.chance(k.p.chance, "tê") && k.inflict(e.target, "paralysis", 1))
          k.proc("tê liệt", e.target);
    },
  },

  // 125 Binh lính Thiết Giáp
  125: {
    name: "Thuẫn binh xếp hàng",
    params: { tier: 6, ally: 2 },
    text: "Khi ra sân và mỗi lượt lần đầu bị đánh trúng, pet nhận 1 tầng Phòng ngự (DEF +7% trong 2 lượt, tối đa 3, chung với Thổ thuẫn). Mỗi tầng Phòng ngự đang có giảm thêm {tier}% sát thương pet nhận. Mỗi tầng Phòng ngự của pet cũng giảm {ally}% sát thương đồng đội nhận.",
    onEnter(k) {
      addDefenseTiers(k, 1);
      k.proc("nhận tầng giáp");
    },
    onHitTaken(k) {
      // Mỗi lượt, đòn trực tiếp đầu tiên trúng pet: +1 tầng Phòng ngự thật (buff 4).
      if (!k.oncePerRound("xếp hàng")) return;
      addDefenseTiers(k, 1);
      k.proc("bị đánh thêm tầng");
    },
    incoming(k, e) {
      const tiers = Math.min(3, k.defenseTiers());
      if (tiers > 0 && e.direct) {
        k.proc("giáp tầng");
        return tiers * k.p.tier;
      }
    },
    guardAlly(k, e) {
      // 2v2: mỗi tầng của pet che đồng đội (1v1 không có đồng đội: hook không chạy).
      const tiers = Math.min(3, k.defenseTiers());
      if (tiers > 0) {
        k.proc("che đồng đội", e.target);
        return tiers * k.p.ally;
      }
    },
  },

  // 126 Đội trưởng Thiết Giáp
  126: {
    name: "Đội trưởng đổi giáp",
    params: { guard: 5, shield: 5 },
    text: "Khi ra sân, pet nhận 2 tầng Phòng ngự (DEF +7%, tối đa 3). Mỗi tầng đang có giảm thêm {guard}% sát thương nhận. Khi Lôi Thiết Bạo Vũ tiêu tầng, mỗi tầng tiêu được đổi thành khiên {shield}% HP tối đa trong 2 lượt. Khi pet xả Lôi Thiết Bạo Vũ, khiên đổi từ giáp có thể chia đôi cho đồng đội.",
    onEnter(k) {
      addDefenseTiers(k, 2);
      k.proc("nhận tầng giáp");
    },
    incoming(k, e) {
      const tiers = Math.min(3, k.defenseTiers());
      if (tiers > 0 && e.direct) {
        k.proc("giáp tầng");
        return tiers * k.p.guard;
      }
    },
    beforeAction(k, e) {
      k.e.spent = e.skill?.name === "Lôi Thiết Bạo Vũ" ? Math.min(3, k.defenseTiers()) : 0;
    },
    afterAction(k) {
      // Lôi Thiết Bạo Vũ tiêu tầng: mỗi tầng thành khiên 2 lượt (2v2: chia đôi với đồng đội).
      const spent = k.e.spent ?? 0;
      k.e.spent = 0;
      if (spent <= 0) return;
      const total = k.pctOf(k.self, k.p.shield * spent);
      const ally = k.ally;
      if (ally) {
        k.shieldAmount(k.self, Math.trunc(total / 2), 2);
        k.shieldAmount(ally, Math.trunc(total / 2), 2);
        k.proc("khiên chia đồng đội", ally);
      } else k.shieldAmount(k.self, total, 2);
      k.proc("giáp thành khiên");
    },
  },

  // 127 Tướng Thiết Giáp
  127: {
    name: "Thiết tướng trấn tuyến",
    params: { guard: 5, reflect: 25 },
    text: "Khi ra sân, pet nhận 2 tầng Phòng ngự (tối đa 3); mỗi tầng giảm thêm {guard}% sát thương nhận. Khi đủ 3 tầng, đòn trực tiếp làm pet mất ≥15% HP tối đa bị phản {reflect}% lượng đó. Khi đủ 3 tầng, pet khiêu khích: chiêu tấn công đơn mục tiêu của đối thủ buộc phải nhắm pet trong lượt đó.",
    onEnter(k) {
      addDefenseTiers(k, 2);
      k.proc("nhận tầng giáp");
    },
    incoming(k, e) {
      const tiers = Math.min(3, k.defenseTiers());
      if (tiers > 0 && e.direct) {
        k.proc("giáp tầng");
        return tiers * k.p.guard;
      }
    },
    onHitTaken(k, e) {
      // Đủ 3 tầng: đòn làm mất ≥15% HP tối đa bị phản.
      if (k.defenseTiers() >= 3 && e.damage >= k.pctOf(k.self, 15)) {
        k.proc("phản giáp", e.source);
        return Math.trunc((e.damage * k.p.reflect) / 100);
      }
    },
    redirect(k, e) {
      // 2v2, đủ 3 tầng: khiêu khích, chiêu tấn công đơn mục tiêu của đối thủ phải nhắm pet.
      if (k.defenseTiers() >= 3 && e.skill?.attack) {
        k.proc("khiêu khích", e.attacker);
        return true;
      }
    },
  },

  // 128 Song Đao Tướng Quân
  128: {
    name: "Song đao giao trảm",
    params: { second: 40 },
    text: "Mỗi chiêu tấn công khác với chiêu tấn công lượt trước cho 1 dấu Liên Trảm (tối đa 2, giữ 3 lượt). Đủ 2 dấu, chiêu tấn công kế tiếp chém thêm nhát thứ hai bằng {second}% Power rồi tiêu dấu; Song Đao Liên Trảm · Bạo tiêu dấu để đạt Power 190. Khi có đối thủ thứ hai, nhát chém thứ hai đánh đối thủ còn lại thay vì cùng mục tiêu.",
    beforeAction(k, e) {
      const live = k.v.ltUntil !== undefined && k.v.ltUntil >= k.round ? (k.v.lt ?? 0) : 0;
      k.e.full = live >= 2 && e.skill?.attack ? 1 : 0;
    },
    outgoing(k, e) {
      if (k.e.full && isBurst(e.skill, "Song Đao Liên Trảm · Bạo")) {
        k.proc("liên trảm bạo", e.target);
        return BURST_BONUS;
      }
    },
    onHitDealt(k, e) {
      // Đủ 2 dấu: nhát chém thứ hai (xấp xỉ: second% sát thương đòn chính); 2v2 đánh đối thủ còn lại.
      if (!k.e.full || isBurst(e.skill, "Song Đao Liên Trảm · Bạo") || !k.oncePerRound("nhát 2"))
        return;
      const to = k.otherFoe(e.target) ?? e.target;
      if (k.damage(to, Math.trunc((e.damage * k.p.second) / 100)) > 0) k.proc("nhát thứ hai", to);
    },
    afterAction(k, e) {
      if (!e.skill?.attack) return;
      if (k.e.full) {
        k.e.full = 0;
        k.v.lt = 0;
      } else if (k.v.lastAtk !== undefined && k.v.lastAtk !== e.skill.id) {
        if (!(k.v.ltUntil !== undefined && k.v.ltUntil >= k.round)) k.v.lt = 0;
        k.v.lt = Math.min(2, (k.v.lt ?? 0) + 1);
        k.v.ltUntil = k.round + 2;
        k.proc("dấu liên trảm");
      }
      k.v.lastAtk = e.skill.id;
    },
  },

  // 129 Đao Thương Tướng Quân
  129: {
    name: "Thương thuẫn phản trận",
    params: { shield: 15, punish: 6 },
    text: "Khi trúng một đòn làm mất ≥15% HP tối đa, pet nhận khiên {shield}% HP tối đa trong 2 lượt (mỗi lần ra sân 1 lần). Khi khiên này bị đòn trực tiếp phá hết, kẻ phá mất HP bằng {punish}% HP tối đa của pet.",
    onHitTaken(k, e) {
      // Khiên của đặc tính bị đòn trực tiếp phá hết: kẻ phá mất punish% HP tối đa của pet.
      if (k.v.sh && k.v.shUntil >= k.round && k.shieldHp() === 0) {
        k.v.sh = 0;
        if (k.damage(e.source, k.pctOf(k.self, k.p.punish)) > 0) k.proc("thuẫn vỡ", e.source);
      }
      if (e.damage >= k.pctOf(k.self, 15) && !k.e.shielded && k.self.alive()) {
        k.e.shielded = 1;
        k.shield(k.self, k.p.shield, 2);
        k.v.sh = 1;
        k.v.shUntil = k.round + 1;
        k.proc("khiên phản trận");
      }
    },
  },

  // 130 Thiết Đầu
  130: {
    name: "Đầu sắt choáng váng",
    params: { chance: 15, lateChance: 30 },
    text: "Chiêu hệ Thổ đánh trúng có {chance}% gây Hóa Đá 1 lượt; nếu pet ra đòn sau mục tiêu trong lượt, tỉ lệ là {lateChance}%. Không làm mới khi mục tiêu đang Hóa Đá.",
    onHitDealt(k, e) {
      if (!isAttack(e.skill, EARTH) || k.has(e.target, "petrify")) return;
      const late = !k.self.designTraitState.actedFirst;
      const pct = late ? k.p.lateChance : k.p.chance;
      if (k.chance(pct, "hóa đá") && k.inflict(e.target, "petrify", 1, { refresh: false }))
        k.proc(late ? "hóa đá (đi sau)" : "hóa đá", e.target);
    },
  },

  // 131 Thiết Cự Nhân
  131: quakeScript(
    {
      name: "Cự nhân tích chấn",
      params: { dmg: 15 },
      text: "Mỗi lần bị đòn trực tiếp đánh trúng, pet tích 1 Chấn Lực (tối đa 3, giữ tới khi dùng). Chiêu hệ Thổ kế tiếp tiêu hết: mỗi Chấn Lực +{dmg}% sát thương; tiêu đủ 3 thì gây Hóa Đá 1 lượt (không làm mới).",
    },
    false,
  ),

  // 132 Thiết Cự Linh
  132: quakeScript(
    {
      name: "Cự linh địa chấn",
      params: { def: 4, dmg: 12, quake: 6, petrify: 40 },
      text: "Mỗi lần bị đòn trực tiếp đánh trúng, tích 1 Chấn Lực (tối đa 3) và DEF +{def}% mỗi Chấn Lực. Chiêu Thổ kế tiếp tiêu hết: mỗi Chấn Lực +{dmg}% sát thương; tiêu đủ 3 thì dư chấn làm mọi đối thủ mất {quake}% HP tối đa của chúng, {petrify}% bị Hóa Đá 1 lượt.",
    },
    true,
  ),

  // 133 Người điện
  133: {
    name: "Giải mạch nạp áp",
    params: { volt: 25, bare: 10 },
    text: "Đòn đầu tiên đánh trúng mỗi lần ra sân gỡ 1 buff hoặc khiên của mục tiêu. Mỗi buff/khiên pet gỡ được thành 1 Điện Áp (tối đa 2): chiêu Lôi kế tiếp tiêu hết, mỗi Điện Áp +{volt}% sát thương. Mục tiêu không có buff hay khiên thì chiêu Lôi +{bare}%.",
    beforeAction(k, e) {
      const lightning = isAttack(e.skill, ELECTRIC);
      k.e.useV = lightning ? (k.v.volt ?? 0) : 0;
      k.e.bare =
        lightning && e.target && k.buffs(e.target) === 0 && k.shieldHp(e.target) === 0 ? 1 : 0;
      k.e.stripped = 0;
    },
    outgoing(k, e) {
      if (!isAttack(e.skill, ELECTRIC)) return;
      let bonus = 0;
      if (k.e.useV) {
        k.proc("xả điện áp", e.target);
        bonus += k.p.volt * k.e.useV;
      }
      if (k.e.bare) {
        k.proc("lôi +10%", e.target);
        bonus += k.p.bare;
      }
      return bonus;
    },
    onHitDealt(k, e) {
      // Đòn đầu tiên mỗi lần ra sân gỡ 1 buff hoặc khiên.
      if (k.e.firstDone) return;
      k.e.firstDone = 1;
      if (k.dispel(e.target, 1) > 0) k.e.stripped = 1;
      else if (k.shieldHp(e.target) > 0 && e.target.statuses.remove(BUFF_BANK, SHIELD_ID)) {
        e.target.restoreSourceStatusState();
        k.e.stripped = 1;
      }
      if (k.e.stripped) k.proc("gỡ buff/khiên", e.target);
    },
    afterAction(k, e) {
      if (k.e.useV) {
        k.v.volt = 0;
        k.e.useV = 0;
      }
      const gained = Math.max(e.dispelled, k.e.stripped ?? 0);
      k.e.stripped = 0;
      if (gained > 0) {
        k.v.volt = Math.min(2, (k.v.volt ?? 0) + gained);
        k.proc("điện áp");
      }
    },
  },

  // 134 Đồng Cầu huynh đệ
  134: ballScript(
    {
      name: "Song cầu nảy bật",
      params: { def: 30, bounce: 30, brother: 10 },
      text: "Khi HP trên 60%, DEF +{def}%; vỏ cầu này chỉ đỡ được 5 đòn trực tiếp mỗi lần ra sân, sau đó mất phần DEF đó. Khi trúng một đòn làm mất ≥20% HP tối đa, pet nảy bật: chiêu tấn công kế tiếp +{bounce}% sát thương (2 lượt 1 lần). Khi đồng đội trên sân là pet cùng dòng Đồng Cầu, cả hai thêm DEF +{brother}%.",
    },
    {
      onHitTaken(k, e) {
        // Vỏ cầu đỡ đòn khi HP trên 60%; đỡ đủ 5 đòn thì vỡ (tới lần ra sân sau).
        if (!k.e.shellBroken && k.self.hp() + e.damage > k.pctOf(k.self, 60)) {
          k.proc("vỏ cầu đỡ đòn", e.source);
          k.e.shell = (k.e.shell ?? 0) + 1;
          if (k.e.shell >= 5) {
            k.e.shellBroken = 1;
            k.refresh();
          }
        }
        if (e.damage >= k.pctOf(k.self, 20) && k.tryUse("nảy", 2)) {
          k.e.bounce = 1;
          k.proc("nảy bật");
        }
      },
    },
  ),

  // 135 Thiết Cầu huynh đệ
  135: ballScript(
    {
      name: "Thiết cầu phản lực",
      params: { def: 35, shield: 15, bounce: 30, brother: 10 },
      text: "Khi HP trên 60%, DEF +{def}%. Lần đầu HP xuống dưới 50% mỗi lần ra sân, pet phản lực: nhận khiên {shield}% HP tối đa trong 2 lượt và chiêu tấn công kế tiếp +{bounce}% sát thương. Đứng cạnh pet cùng dòng Đồng Cầu, cả hai thêm DEF +{brother}%; khiên phản lực có thể trao cho người anh em nếu nó đang ít HP hơn.",
    },
    {
      onDamaged(k, e) {
        k.refresh();
        if (k.e.low || e.after * 2 >= k.self.maxHp()) return;
        k.e.low = 1;
        k.e.bounce = 1;
        const brother = k.ally && BALL_LINE.includes(k.ally.speciesId) ? k.ally : undefined;
        const to = brother && k.hpPct(brother) < k.hpPct() ? brother : k.self;
        k.shield(to, k.p.shield, 2);
        k.proc("phản lực", to);
      },
    },
  ),

  // 136 Ấu Long
  136: thunderScript(
    {
      name: "Long tâm sơ điện",
      params: { dmg: 8, speed: 10 },
      text: "Mỗi chiêu Lôi đánh trúng cho 1 tầng Thiên Điện trong 3 lượt (tối đa 2): mỗi tầng +{dmg}% sát thương hệ Lôi và +{speed}% Linh xảo. Mất tầng khi rời sân.",
    },
    2,
  ),

  // 137 Tiểu Bạch Long
  137: thunderScript(
    {
      name: "Tiểu long truy lôi",
      params: { dmg: 8, speed: 8, chance: 25 },
      text: "Mỗi chiêu Lôi đánh trúng cho 1 tầng Thiên Điện trong 3 lượt (tối đa 3): mỗi tầng +{dmg}% sát thương hệ Lôi và +{speed}% Linh xảo. Khi đủ 3 tầng, chiêu Lôi có thêm {chance}% gây Tê Liệt 1 lượt.",
    },
    3,
    {
      onHitDealt(k, e) {
        if (!isAttack(e.skill, ELECTRIC)) return;
        if (thunderTiers(k) >= 3 && !k.has(e.target, "paralysis"))
          if (k.chance(k.p.chance, "tê") && k.inflict(e.target, "paralysis", 1))
            k.proc("tê liệt", e.target);
        addThunder(k, 3);
      },
    },
  ),

  // 138 Kim Dực Long
  138: thunderScript(
    {
      name: "Kim dực hoán lôi",
      params: { dmg: 8, speed: 8, shield: 5 },
      text: "Mỗi chiêu Lôi đánh trúng cho 1 tầng Thiên Điện trong 3 lượt (tối đa 3): mỗi tầng +{dmg}% sát thương hệ Lôi và +{speed}% Linh xảo. Bạch Kim Thiên Điện · Bạo coi tầng là dấu, tiêu hết để đạt Power 190; mỗi tầng tiêu được đổi thành khiên {shield}% HP tối đa trong 2 lượt. Khiên đổi từ tầng có thể trao cho đồng đội ít HP hơn thay vì tự nhận.",
    },
    3,
    {
      outgoing(k, e) {
        if (!isAttack(e.skill, ELECTRIC)) return;
        const n = thunderTiers(k);
        let bonus = n * k.p.dmg;
        if (n > 0 && isBurst(e.skill, "Bạch Kim Thiên Điện · Bạo")) {
          k.e.burst = n;
          bonus += BURST_BONUS;
        }
        return bonus;
      },
      onHitDealt(k, e) {
        if (isAttack(e.skill, ELECTRIC) && !k.e.burst) addThunder(k, 3);
      },
      afterAction(k) {
        const n = k.e.burst ?? 0;
        if (n <= 0) return;
        k.e.burst = 0;
        k.e.td = 0;
        k.refresh();
        // Mỗi tầng tiêu được thành khiên (2v2: trao đồng đội ít HP hơn).
        const to = k.ally && k.hpPct(k.ally) < k.hpPct() ? k.ally : k.self;
        k.shieldAmount(to, k.pctOf(to, k.p.shield * n), 2);
        k.proc("tầng thành khiên", to);
      },
    },
  ),

  // 139 Bạch Kim Long
  139: thunderScript(
    {
      name: "Bạch kim long uy",
      params: { dmg: 8, allySpeed: 15, soloDmg: 15 },
      text: "Mỗi chiêu Lôi đánh trúng cho 1 tầng Thiên Điện trong 3 lượt (tối đa 3): mỗi tầng +{dmg}% sát thương hệ Lôi. Đủ 3 tầng, pet tỏa long uy: đồng đội +{allySpeed}% Linh xảo trong 2 lượt (không có đồng đội thì pet +{soloDmg}% sát thương thay thế).",
    },
    3,
    {
      onHitDealt(k, e) {
        if (!isAttack(e.skill, ELECTRIC)) return;
        const before = thunderTiers(k);
        const n = addThunder(k, 3);
        if (n < 3 || before >= 3) return;
        const ally = k.ally;
        if (ally) {
          k.statUp(ally, "speed", k.p.allySpeed, 2, "long uy");
          k.proc("long uy", ally);
        } else {
          k.e.awe = k.round + 1;
          k.proc("long uy");
        }
      },
      outgoing(k, e) {
        let bonus = 0;
        if (isAttack(e.skill, ELECTRIC)) bonus += thunderTiers(k) * k.p.dmg;
        if (!k.ally && (k.e.awe ?? -1) >= k.round) bonus += k.p.soloDmg;
        return bonus;
      },
    },
  ),

  // 140 Ưng
  140: hawkScript({
    name: "Ưng nhãn song thế",
    params: { first: 12, speed: 10, slow: 12 },
    text: "Ra đòn trước đối thủ: đòn đó gây thêm {first}% sát thương và pet được Linh xảo +{speed}% trong 2 lượt. Ra đòn sau: chiêu hệ Phong đánh trúng làm mục tiêu giảm {slow}% Linh xảo trong 2 lượt (không cộng dồn với chính nó).",
  }),

  // 141 Vương Thứu
  141: hawkScript(
    {
      name: "Vương nhãn truy sát",
      params: { first: 15, slow: 15 },
      text: "Ra đòn trước đối thủ: đòn đó gây thêm {first}% sát thương. Ra đòn sau: chiêu hệ Phong đánh trúng làm mục tiêu giảm {slow}% Linh xảo trong 2 lượt. Đánh mục tiêu dưới 35% HP luôn tính như ra đòn trước.",
    },
    { executeBelow: 35 },
  ),

  // 142 Sư Thứu
  142: hawkScript(
    {
      name: "Sư Thứu thiên phạt",
      params: { first: 15, slow: 15 },
      text: "Ra đòn trước đối thủ: đòn đó gây thêm {first}% sát thương. Ra đòn sau: chiêu hệ Phong đánh trúng làm mục tiêu giảm {slow}% Linh xảo trong 2 lượt. Hạ gục đối thủ thì lượt kế tiếp pet được ưu tiên ra đòn trước. Trong trận đôi, đòn ưu tiên đó có thể nhắm vào đối thủ còn lại hoặc pet vào thay.",
    },
    {
      extra: {
        onFoeFaint(k, e) {
          if (e.byMe) {
            k.v.prioFrom = k.round;
            k.proc("hạ gục → ưu tiên", e.foe);
          }
        },
        priority(k) {
          // Còn hiệu lực tới hết hành động đầu tiên của pet sau lượt hạ gục.
          if (k.v.prioFrom !== undefined) {
            k.proc("ưu tiên");
            return true;
          }
        },
        afterAction(k) {
          if (k.v.prioFrom !== undefined && k.round > k.v.prioFrom) delete k.v.prioFrom;
        },
      },
    },
  ),

  // 143 Dơi khổng lồ
  143: drainScript({
    name: "Sóng âm hút huyết",
    params: { drain: 10, ctlDrain: 25, ctlDmg: 10 },
    text: "Đòn tấn công trúng hút {drain}% sát thương gây ra. Nếu mục tiêu đang bị khống chế (Ngủ, Quỷ Mị, Hỗn loạn, Giam Cầm hoặc Mê Muội), hút {ctlDrain}% và đòn đó gây thêm {ctlDmg}% sát thương. Tính cả mục tiêu bị đồng đội khống chế.",
  }),

  // 144 Răng nanh của dơi
  144: drainScript({
    name: "Huyết nha dạ hành",
    params: { drain: 12, ctlDrain: 25, ctlDmg: 12 },
    text: "Đòn tấn công trúng hút {drain}% sát thương gây ra. Nếu mục tiêu đang bị khống chế (Ngủ, Quỷ Mị, Hỗn loạn, Giam Cầm, Mê Muội), hút {ctlDrain}% và đòn đó gây thêm {ctlDmg}% sát thương.",
  }),

  // 145 Tần số của dơi
  145: drainScript(
    {
      name: "Tần số đoạt hồn",
      params: { drain: 15, ctlDrain: 30, cap: 15 },
      text: "Đòn tấn công trúng hút {drain}% sát thương; mục tiêu đang bị khống chế (Ngủ, Quỷ Mị, Hỗn loạn, Giam Cầm, Mê Muội) thì hút {ctlDrain}%. Phần hút vượt HP tối đa chuyển thành khiên chắn cho đồng đội thấp máu nhất (không có đồng đội thì cho chính pet), tối đa {cap}% HP, 2 lượt.",
    },
    true,
  ),

  // 146 Thiên Mã cánh bạc
  146: {
    name: "Cánh bạc che chở",
    params: { guard: 30 },
    text: "Lượt dùng chiêu hồi máu hoặc giải trừ, pet được ưu tiên ra đòn trước và mục tiêu được chữa giảm {guard}% sát thương nhận đến hết lượt kế tiếp. Chiêu hồi máu của pet xóa thêm 1 hiệu ứng xấu trên mục tiêu.",
    priority(k) {
      // Xấp xỉ: kit không biết chiêu được chọn lúc xếp lượt, nên coi pet sẽ chữa khi mang chiêu
      // hồi máu/giải trừ và có pet phe mình dưới 60% HP hoặc đang dính hiệu ứng xấu.
      const carries = k.self.skillIds.some((id) => isHealOrCleanse(k.skill(id)));
      const needy = k.team.some((u) => k.hpPct(u) < 60 || k.debuffs(u) > 0);
      if (carries && needy) {
        k.proc("ưu tiên chữa");
        return true;
      }
    },
    healOut(k, e) {
      if (k.cleanse(e.target, 1) > 0) k.proc("xóa thêm hiệu ứng xấu", e.target);
    },
    afterAction(k, e) {
      if (!isHealOrCleanse(e.skill) && e.cleansed <= 0) return;
      const to = e.target && (e.target === k.self || k.isAlly(e.target)) ? e.target : k.self;
      k.mark(to, "che chở", 2);
      k.proc("che chở", to);
    },
    incoming(k, e) {
      if (e.direct && k.marked(k.self, "che chở") > 0) {
        k.proc("che chở giảm", k.self);
        return k.p.guard;
      }
    },
    guardAlly(k, e) {
      if (k.marked(e.target, "che chở") > 0) {
        k.proc("che chở giảm", e.target);
        return k.p.guard;
      }
    },
  },

  // 147 Thiên Mã một sừng
  147: {
    name: "Thánh giác xuyên thạch",
    params: { pierce: 25, weaken: 10 },
    text: "Đánh đối thủ đang Thạch Hóa hoặc Mê Muội thì bỏ qua {pierce}% DEF và không bị giảm 30% sát thương của Thạch Hóa. Chiêu hệ Thổ đánh trúng làm mục tiêu gây ít hơn {weaken}% sát thương trong 2 lượt (không cộng dồn).",
    pierce(k, e) {
      if (k.has(e.target, "petrify") || k.has(e.target, "daze")) {
        k.proc("xuyên thạch", e.target);
        return k.p.pierce;
      }
    },
    outgoing(k, e) {
      // Bù phần giảm 30% sát thương nhận của Thạch Hóa (số của trạng thái): ×100/70.
      if (e.skill?.attack && k.has(e.target, "petrify")) {
        k.proc("phá giảm thạch hóa", e.target);
        return 43;
      }
    },
    onHitDealt(k, e) {
      if (isAttack(e.skill, EARTH))
        if (k.inflict(e.target, "damage_down", 2, { value: k.p.weaken }))
          k.proc("nhụt chí", e.target);
    },
  },

  // 148 Thiên Mã Vương
  148: {
    name: "Vương giá hộ giá",
    params: { allyGuard: 15, soloGuard: 12, shield: 8 },
    text: "Khi pet đang có tầng DEF hoặc khiên chắn, đồng đội giảm {allyGuard}% sát thương nhận (không có đồng đội thì chính pet giảm {soloGuard}%). Dùng Thiên Mã Thánh Hộ · Thủ thì đồng đội cũng nhận khiên chắn {shield}% HP tối đa trong 2 lượt.",
    guardAlly(k, e) {
      if (k.defenseTiers() > 0 || k.shieldHp() > 0) {
        k.proc("hộ giá", e.target);
        return k.p.allyGuard;
      }
    },
    incoming(k, e) {
      if (!k.ally && e.direct && (k.defenseTiers() > 0 || k.shieldHp() > 0)) {
        k.proc("hộ giá (1v1)");
        return k.p.soloGuard;
      }
    },
    afterAction(k, e) {
      if (e.skill?.name !== "Thiên Mã Thánh Hộ · Thủ") return;
      const to = k.allyOrSelf;
      k.shield(to, k.p.shield, 2);
      k.proc("khiên thánh hộ", to);
    },
  },

  // 149 Mao Cầu Điểu
  149: {
    name: "Phấn bay mù mắt",
    params: { blind: 10, guard: 12 },
    text: "Chiêu hệ Phong đánh trúng làm mục tiêu giảm {blind}% chính xác trong 2 lượt (không cộng dồn). Khi đối thủ đang có ít nhất 1 hiệu ứng xấu, pet giảm {guard}% sát thương nhận từ đối thủ đó.",
    onHitDealt(k, e) {
      if (isAttack(e.skill, WIND))
        if (k.inflict(e.target, "accuracy_down", 2, { value: k.p.blind }))
          k.proc("mù mắt", e.target);
    },
    incoming(k, e) {
      if (e.direct && k.isFoe(e.source) && k.debuffs(e.source) > 0) {
        k.proc("phấn giảm sát thương", e.source);
        return k.p.guard;
      }
    },
  },

  // 150 Phiêu Phù Mao Cầu
  150: {
    name: "Bạo phấn đa tầng",
    params: { dmg: 8, max: 24, slow: 10 },
    text: "Mỗi loại hiệu ứng xấu khác nhau đang có trên mục tiêu giúp đòn của pet gây thêm {dmg}% sát thương (tối đa 3 loại, +{max}%). Đòn đánh trúng mục tiêu chưa có hiệu ứng xấu nào làm nó giảm {slow}% Linh xảo trong 2 lượt. Hiệu ứng xấu do đồng đội gây ra cũng được tính.",
    beforeAction(k, e) {
      k.e.clean = e.target && k.debuffs(e.target) === 0 ? 1 : 0;
    },
    outgoing(k, e) {
      const kinds = Math.min(3, k.debuffs(e.target));
      if (kinds > 0 && e.skill?.attack) {
        k.proc("bạo phấn +%", e.target);
        return Math.min(k.p.max, kinds * k.p.dmg);
      }
    },
    onHitDealt(k, e) {
      if (k.e.clean && e.skill?.attack)
        if (k.inflict(e.target, "agility_down", 2, { value: k.p.slow }))
          k.proc("chậm chạp", e.target);
      k.e.clean = 0;
    },
  },

  // 151 Pháp Quan Mao Cầu
  151: {
    name: "Miên phán pháp quan",
    params: { sleep: 20, bonus: 20, guard: 25 },
    text: "Chiêu tấn công đánh trúng có {sleep}% ru Ngủ mục tiêu 1 lượt (3 lượt 1 lần). Đánh mục tiêu đang Ngủ, Mê Muội hoặc Giam Cầm gây thêm {bonus}% sát thương. Lượt pet dùng chiêu khống chế, pet nhận ít hơn {guard}% sát thương. Đồng đội đánh mục tiêu bị khống chế cũng gây thêm {bonus}% sát thương.",
    beforeAction(k, e) {
      // Lượt dùng chiêu khống chế: giảm sát thương nhận (xấp xỉ: tính từ lúc pet ra đòn).
      if (e.skill && CONTROL_SKILLS.has(e.skill.name)) k.e.guard = k.round;
    },
    outgoing(k, e) {
      if (e.skill?.attack && judged(k, e.target)) {
        k.proc("đánh kẻ bị khống chế", e.target);
        return k.p.bonus;
      }
    },
    allyOutgoing(k, e) {
      // 2v2: đồng đội đánh mục tiêu Ngủ/Mê Muội/Giam Cầm cũng được cộng.
      if (e.skill?.attack && judged(k, e.target)) {
        k.proc("đồng đội đánh kẻ bị khống chế", e.source);
        return k.p.bonus;
      }
    },
    onHitDealt(k, e) {
      // Đòn đã trừ máu xong nên giấc ngủ mới không bị chính đòn này đánh thức.
      if (!e.skill?.attack || k.has(e.target, "sleep") || !k.ready("ru", 3)) return;
      if (!k.chance(k.p.sleep, "ru ngủ")) return;
      if (k.inflict(e.target, "sleep", 1)) {
        k.use("ru");
        k.e.lulled = k.round;
        k.proc("ru ngủ", e.target);
      }
    },
    afterAction(k, e) {
      // Chiêu vừa gây khống chế (giấc ngủ do chính đặc tính ru không tính là chiêu khống chế).
      const own = (s: string) => s === "sleep" && k.e.lulled === k.round;
      if (
        e.newStatuses.some(
          (s) => !own(s) && (s === "sleep" || s === "bind" || s === "ghost" || s === "confusion"),
        )
      )
        k.e.guard = k.round;
    },
    incoming(k, e) {
      if (k.e.guard === k.round && e.direct) {
        k.proc("pháp quan thủ");
        return k.p.guard;
      }
    },
  },

  // 152 Hổ Thú
  152: rageScript(
    {
      name: "Hổ nhi gầm gừ",
      params: { atk: 12, bleed: 50 },
      text: "Mỗi lần bị đánh trúng, Sức mạnh +{atk}% trong 3 lượt; cộng dồn tối đa 2 tầng. Khi có ít nhất 1 tầng, chiêu gây Xé Rách của pet có tỉ lệ tối thiểu {bleed}%.",
    },
    2,
    {
      onHitDealt(k, e) {
        // Xấp xỉ "tỉ lệ tối thiểu": thêm một lần thử bleed% Xé Rách khi chiêu gốc chưa gây được.
        if (!e.skill || !BLEED_SKILLS.has(e.skill.name) || rageTiers(k) < 1) return;
        if (
          !k.has(e.target, "bleed") &&
          k.chance(k.p.bleed, "xé") &&
          k.inflict(e.target, "bleed", 2)
        )
          k.proc("xé rách", e.target);
      },
    },
  ),

  // 153 Công phu hổ
  153: rageScript(
    {
      name: "Hổ quyền phản kích",
      params: { atk: 15, reflect: 20 },
      text: "Mỗi lần bị đánh trúng, Sức mạnh +{atk}% trong 3 lượt; cộng dồn tối đa 3 tầng. Khi có từ 2 tầng trở lên, đòn trực tiếp kế tiếp đánh trúng pet bị phản {reflect}% lượng HP vừa mất.",
    },
    3,
    {
      onHitTaken(k, e) {
        const reflect = rageTiers(k) >= 2 ? Math.trunc((e.damage * k.p.reflect) / 100) : 0;
        addRage(k, 3);
        if (reflect > 0) {
          k.proc("hổ quyền phản", e.source);
          return reflect;
        }
      },
    },
  ),

  // 154 Hổ Dũng Sĩ
  154: rageScript(
    {
      name: "Dũng hổ xả nộ",
      params: { atk: 11, power: 19, heal: 4 },
      text: "Khi trúng một đòn làm mất ≥10% HP tối đa (2 lượt 1 lần), Sức mạnh +{atk}% trong 3 lượt (tối đa 2 tầng); mỗi chiêu tấn công gây sát thương của pet xả bớt 1 tầng. Tù Trường Liệt Quyền · Chiến tiêu toàn bộ tầng nộ: mỗi tầng tiêu cộng {power} uy lực và hồi {heal}% HP tối đa.",
    },
    2,
    {
      onHitTaken(k, e) {
        // Đòn nặng (≥10% HP tối đa) tích nộ, 2 lượt 1 lần.
        if (e.damage >= k.pctOf(k.self, 10) && k.tryUse("nộ", 2)) addRage(k, 2);
      },
      outgoing(k, e) {
        // Mỗi tầng +power uy lực, đổi ra % theo Power của chiêu.
        const n = rageTiers(k);
        if (n > 0 && e.skill?.name === "Tù Trường Liệt Quyền · Chiến") {
          k.e.spend = n;
          k.proc("xả nộ", e.target);
          return Math.round((k.p.power * n * 100) / Math.max(1, e.skill.power));
        }
      },
      afterAction(k, e) {
        const n = k.e.spend ?? 0;
        if (n <= 0) {
          // Chiêu tấn công thường xả bớt 1 tầng nộ.
          if (e.skill?.attack && e.damaging && rageTiers(k) > 0) {
            k.stack("rage", -1, 2, true);
            k.proc("xả bớt nộ");
          }
          return;
        }
        k.e.spend = 0;
        k.e.rage = 0;
        k.refresh();
        k.heal(k.self, k.p.heal * n);
        k.proc("hồi nộ");
      },
    },
  ),

  // 155 Hổ Tù Trường
  155: rageScript(
    {
      name: "Tù trưởng bách thú",
      params: { atk: 12 },
      text: "Mỗi lần pet hoặc đồng đội bị đánh trúng, pet Sức mạnh +{atk}% trong 3 lượt (tối đa 3 tầng, mỗi lượt cộng tối đa 2 tầng). Khi vào sân, pet nhận sẵn 1 tầng.",
    },
    3,
    {
      onEnter(k) {
        addRage(k, 3);
      },
      onHitTaken(k) {
        chiefRage(k);
      },
      onAllyHitTaken(k, e) {
        if (chiefRage(k)) k.proc("trả thù cho bầy", e.target);
      },
    },
  ),

  // 156 Ngựa núi
  156: {
    name: "Vó ngựa tích đà",
    params: { dmg: 8 },
    text: "Ra đòn trước đối thủ hoặc đánh trúng đối thủ đang Xé Rách/Quấn Quanh thì nhận 1 dấu Đà (tối đa 2; mỗi lượt tối đa 1). Mỗi dấu Đà giúp pet gây thêm {dmg}% sát thương; mất khi rời sân.",
    beforeAction(k, e) {
      k.e.torn = k.has(e.target, "bleed") || k.has(e.target, "entangle") ? 1 : 0;
    },
    outgoing(k, e) {
      const n = k.e.đà ?? 0;
      if (n > 0 && e.skill?.attack) {
        k.proc("đà +%", e.target);
        return n * k.p.dmg;
      }
    },
    afterAction(k, e) {
      if (!e.skill?.attack || !e.hit) return;
      if ((e.actedFirst || k.e.torn) && k.oncePerRound("đà")) {
        k.stack("đà", 1, 2, true);
        k.proc("đà", e.target);
      }
    },
  },

  // 157 Ngựa vằn
  157: {
    name: "Vằn mã bôn đà",
    params: { dmg: 7, drain: 25 },
    text: "Ra đòn trước đối thủ thì nhận 1 dấu Đà (tối đa 2; mỗi dấu +{dmg}% sát thương; mất khi rời sân). Khi HP dưới 70%, chiêu hệ Mộc đánh trúng tiêu 1 dấu Đà để hút {drain}% sát thương gây ra.",
    beforeAction(k) {
      k.e.lowHp = k.hpPct() < 70 ? 1 : 0;
    },
    outgoing(k, e) {
      const n = k.e.đà ?? 0;
      if (n > 0 && e.skill?.attack) {
        k.proc("đà +%", e.target);
        return n * k.p.dmg;
      }
    },
    afterAction(k, e) {
      if (!e.skill?.attack || !e.hit) return;
      if (k.e.lowHp && e.skill.element === WOOD && (k.e.đà ?? 0) > 0 && e.damage > 0) {
        k.stack("đà", -1, 2, true);
        k.healAmount(k.self, Math.trunc((e.damage * k.p.drain) / 100));
        k.proc("tiêu đà hút máu");
      }
      if (e.actedFirst && k.oncePerRound("đà")) {
        k.stack("đà", 1, 2, true);
        k.proc("đà");
      }
    },
  },

  // 158 Ngựa lưỡi liềm khổng lồ
  158: {
    name: "Liềm gặt phá giáp",
    params: { dmg: 10, buffed: 30, atk: 15 },
    text: "Đòn trực tiếp gây thêm {dmg}% sát thương; nếu mục tiêu đang có khiên chắn hoặc trạng thái có lợi thì thành {buffed}%. Mỗi lần pet phá vỡ khiên hoặc xóa được trạng thái có lợi, Sức mạnh +{atk}% trong 2 lượt (không cộng dồn).",
    beforeAction(k, e) {
      k.e.shieldBefore = e.target ? k.shieldHp(e.target) : 0;
    },
    outgoing(k, e) {
      if (k.shieldHp(e.target) > 0 || k.buffs(e.target) > 0) {
        k.proc("liềm +30%", e.target);
        return k.p.buffed;
      }
      k.proc("liềm +10%", e.target);
      return k.p.dmg;
    },
    afterAction(k, e) {
      const broke = (k.e.shieldBefore ?? 0) > 0 && !!e.target && k.shieldHp(e.target) === 0;
      k.e.shieldBefore = 0;
      if (broke || e.dispelled > 0) {
        k.statUp(k.self, "attack", k.p.atk, 2, "liềm gặt");
        k.proc("phá giáp tăng sức", e.target);
      }
    },
  },

  // 159 Heo núi
  159: {
    name: "Heo rừng lì đòn",
    params: { dmg: 10, shield: 45 },
    text: "Ra đòn sau đối thủ trong lượt thì đòn của pet gây thêm {dmg}% sát thương. Lần đầu mỗi trận HP tụt xuống 35% trở xuống mà chưa gục, nhận khiên chắn {shield}% HP tối đa trong 2 lượt.",
    outgoing(k, e) {
      if (!e.actedFirst) {
        k.proc("đi sau +10%", e.target);
        return k.p.dmg;
      }
    },
    onDamaged(k, e) {
      if (k.v.lastStand || e.after * 100 > k.self.maxHp() * 35) return;
      k.v.lastStand = 1;
      k.shield(k.self, k.p.shield, 2);
      k.proc("lì đòn");
    },
  },
};
