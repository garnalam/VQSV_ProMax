import type { DesignTraitMechanics, DesignTraitUnit } from "../../DesignTraits";
import { BUFF_BANK, type StatusInstance } from "../../StatusState";
import {
  CONTROL_STATUSES,
  KIT_STATUS,
  type Kit,
  type KitAction,
  type KitSkill,
  type KitStatus,
  type TraitScript,
} from "../TraitKit";

/** Hệ: 0 Hỏa, 1 Mộc, 2 Thổ, 3 Thủy, 4 Điện (Lôi), 5 Quỷ, 6 Phong. */
const FIRE = 0;
const EARTH = 2;
const ELECTRIC = 4;

/** Phần khai báo của một kịch bản (tên, số chỉnh được, mô tả mẫu). */
type Meta = Pick<TraitScript, "name" | "params" | "text" | "text2v2">;

/** Chiêu hồi máu (Power 0, nhắm phe mình, tên hồi máu). */
const HEAL_NAME = /Dưỡng|Hồi Sinh|Chữa Lành|Tái Tạo|Thảo nguyện|Địa Giới/i;
const isHeal = (s?: KitSkill): boolean => !!s && s.support && s.ownSide && HEAL_NAME.test(s.name);
const isAttack = (s?: KitSkill, element?: number): boolean =>
  !!s?.attack && (element === undefined || s.element === element);
/** `percent`% của `amount`, làm tròn xuống. */
const pct = (amount: number, percent: number): number => Math.trunc((amount * percent) / 100);
/** Chiêu "· Bạo" Power 155 → 190 khi tiêu dấu: +23% sát thương (số của chiêu, không cân bằng ở đây). */
const BURST_BONUS = Math.round((190 / 155 - 1) * 100);
/** Buff Dự Trữ của chiêu độc quyền "· Dưỡng" (điều kiện has_reserve). */
const RESERVE_ID = 18;
/** Khống chế cứng 275 miễn. */
const HARD_CONTROL: readonly KitStatus[] = [
  "daze",
  "entangle",
  "bind",
  "paralysis",
  "petrify",
  "confusion",
  "sleep",
];

/** Người được chiêu hồi máu nhắm tới: mục tiêu phe mình, không thì chính pet. */
function healTarget(k: Kit, target: DesignTraitUnit | undefined): DesignTraitUnit {
  return target && target.ownerSide === k.self.ownerSide && target.alive() ? target : k.self;
}

/** Một đòn tấn công của đối thủ trượt pet hoặc đồng đội: trả người bị nhắm tới. */
function foeMissed(
  k: Kit,
  e: KitAction & { actor: DesignTraitUnit; isAlly: boolean },
): DesignTraitUnit | undefined {
  if (e.isAlly || !k.isFoe(e.actor) || !e.skill?.attack || e.hit || !e.target) return undefined;
  return k.team.includes(e.target) ? e.target : undefined;
}

/** Tự gây trạng thái lên chính pet (kit chỉ gây lên đối thủ). */
function selfStatus(k: Kit, status: KitStatus, turns: number): void {
  const slot = KIT_STATUS[status];
  k.runtime.put(k.self, slot.bank, slot.id, turns, slot.value, k.self, slot.sourceSkill);
}

/** Kéo dài trạng thái `status` trên `target` thêm `turns` vòng. */
function extend(target: DesignTraitUnit, status: KitStatus, turns: number): void {
  const slot = KIT_STATUS[status];
  const inst = target.statuses.get(slot.bank, slot.id);
  if (inst) inst.remainingTurns += turns;
}

// ------------------------------------------------------------------ Tĩnh Điện (242–244)

/** params: para (% Tê Liệt), charge (% mỗi tầng). */
function staticScript(meta: Meta, variant: "base" | "storm" | "fort"): TraitScript {
  return {
    ...meta,
    onHitTaken(k, e) {
      if (k.chance(k.p.para, "tê liệt") && k.inflict(e.source, "paralysis", 1))
        k.proc("tê liệt", e.source);
      if ((k.v.charge ?? 0) < 3) {
        k.stack("charge", 1, 3);
        k.proc("tĩnh điện");
      }
    },
    beforeAction(k, e) {
      k.e.dis = isAttack(e.skill, ELECTRIC) ? (k.v.charge ?? 0) : 0;
    },
    outgoing(k, e) {
      const n = k.e.dis ?? 0;
      if (n <= 0 || !isAttack(e.skill, ELECTRIC)) return;
      k.proc("xả tĩnh điện", e.target);
      let bonus = k.p.charge * n;
      // Lôi Thiết Bạo Vũ: mỗi tầng Phòng ngự +20 Power trên 110 → mỗi Tĩnh Điện thêm ~18%.
      if (variant === "storm" && e.skill?.name === "Lôi Thiết Bạo Vũ") {
        bonus += Math.round((20 * n * 100) / 110);
        k.proc("bạo vũ tĩnh điện", e.target);
      }
      return bonus;
    },
    afterAction(k) {
      if ((k.e.dis ?? 0) <= 0) return;
      k.e.dis = 0;
      k.stack("charge", -3, 3);
    },
    admits(k) {
      // 244: đủ 3 tầng thì miễn hiệu ứng xấu cho tới lần xả.
      if (variant === "fort" && (k.v.charge ?? 0) >= 3) {
        k.proc("lôi thành miễn");
        return false;
      }
    },
  };
}

// ------------------------------------------------------------------ Nộ (248–250)

/** params: rage (% Sức mạnh mỗi Nộ), heal (250). */
function rageScript(
  meta: Meta,
  opts: {
    start: boolean;
    allyHit: boolean;
    bleed: boolean;
    revenge: boolean;
    /** Số Nộ tối đa nhận được khi bị đánh (mặc định 3). */
    hitCap?: number;
    /** Ngưỡng % HP báo thù ở trận đơn (mặc định 35). */
    line?: number;
  },
): TraitScript {
  /** Báo thù vẫn lên đủ 3 Nộ. */
  const hitCap = opts.hitCap ?? 3;
  /** Nộ còn hiệu lực (mỗi lần nhận Nộ làm mới 3 lượt cho cả chồng). */
  const rage = (k: Kit) => (k.round <= (k.e.rageUntil ?? 0) ? (k.e.rage ?? 0) : 0);
  const gain = (k: Kit, n: number) => {
    const before = rage(k);
    k.e.rage = Math.min(3, before + n);
    k.e.rageUntil = k.round + 2;
    if (opts.bleed && before < 3 && k.e.rage >= 3) k.e.bleedReady = 1;
    k.refresh();
    k.proc("nộ");
  };
  const hitOnce = (k: Kit) => {
    if (rage(k) >= hitCap) return;
    if (k.oncePerRound("nộ")) gain(k, 1);
  };
  const revenge = (k: Kit) => {
    if (k.v.revenge) return;
    k.v.revenge = 1;
    gain(k, 3);
    k.heal(k.self, k.p.heal);
    k.proc("báo thù");
  };
  return {
    ...meta,
    onEnter(k) {
      if (opts.start) gain(k, 1);
    },
    onHitTaken(k) {
      hitOnce(k);
    },
    onAllyHitTaken(k) {
      if (opts.allyHit) hitOnce(k);
    },
    statBonus(k, stat) {
      if (stat === "attack") return rage(k) * k.p.rage;
    },
    onOtherAction(k, e) {
      // Bị giải trừ: mất hết Nộ.
      if (!e.isAlly && e.target === k.self && e.dispelled > 0 && rage(k) > 0) {
        k.e.rage = 0;
        k.refresh();
        k.proc("mất nộ");
      }
    },
    onHitDealt(k, e) {
      if (!opts.bleed || !k.e.bleedReady) return;
      k.e.bleedReady = 0;
      if (k.inflict(e.target, "bleed", 2)) k.proc("xé rách", e.target);
    },
    onAllyFaint(k) {
      if (opts.revenge) revenge(k);
    },
    onDamaged(k, e) {
      // 1v1: lần đầu tụt dưới 35% HP.
      if (!opts.revenge || k.twoVsTwo) return;
      const line = pct(k.self.maxHp(), opts.line ?? 35);
      if (e.before >= line && e.after < line) revenge(k);
    },
  };
}

// ------------------------------------------------------------------ Côn Ấn (251–252)

/** params: seal (% mỗi Côn Ấn), heal (252). */
function sealScript(meta: Meta, burst: boolean): TraitScript {
  return {
    ...meta,
    beforeAction(k, e) {
      if (!e.skill) return;
      const last = k.lastSkill;
      if (last >= 0 && last === e.skill.id) {
        if ((k.e.seal ?? 0) > 0) k.proc("mất côn ấn");
        k.stack("seal", -3, 3, true);
        k.e.full = 0;
      } else if (last >= 0) {
        const n = k.stack("seal", 1, 3, true);
        k.proc("côn ấn");
        if (burst && n >= 3) k.e.full = 1;
      }
    },
    outgoing(k, e) {
      const n = k.e.seal ?? 0;
      if (n > 0 && e.skill?.attack) {
        k.proc("côn ấn +%", e.target);
        return n * k.p.seal;
      }
    },
    onHitDealt(k, e) {
      if (!burst || !k.e.full) return;
      k.e.full = 0;
      k.stack("seal", -3, 3, true);
      if (k.inflict(e.target, "entangle", 2)) k.proc("quấn quanh", e.target);
      k.heal(k.self, k.p.heal);
      k.proc("xả côn ấn");
    },
  };
}

// ------------------------------------------------------------------ Hư ảnh đòn đầu (253–256)

const CURSE = "ám";

/** params: first (% giảm đòn đầu), curse (% dội ngược), cap (255), mark (256), ghost (254). */
function phantomScript(
  meta: Meta,
  opts: { kind: "curse" | "seal"; absorb?: boolean; allyCurse?: boolean },
  extra: Partial<TraitScript> = {},
): TraitScript {
  /**
   * Đòn của kẻ mang Ám / Vương Ấn có `curse`% dội ngược. Xấp xỉ: kit không đổi mục tiêu được → kẻ
   * đánh tự chịu sát thương đòn đó và người bị nhắm giảm 80% (trần của kit).
   */
  const backlash = (k: Kit, source: DesignTraitUnit, damage: number): number | undefined => {
    if (k.marked(source, CURSE) <= 0) return undefined;
    if (opts.kind === "curse") k.unmark(source, CURSE);
    if (!k.chance(k.p.curse, "dội ngược")) return undefined;
    k.damage(source, damage);
    k.proc("dội ngược", source);
    return 80;
  };
  return {
    ...meta,
    incoming(k, e) {
      if (!e.direct) return;
      if (e.skill?.attack && !k.e.firstDone) {
        k.e.firstDone = 1;
        k.e.firstFrom = 1;
        k.proc("hư ảnh");
        if (opts.absorb) k.e.stored = Math.min(k.pctOf(k.self, k.p.cap), pct(e.damage, k.p.first));
        return k.p.first;
      }
      return backlash(k, e.source, e.damage);
    },
    onHitTaken(k, e) {
      if (!k.e.firstFrom) return;
      k.e.firstFrom = 0;
      // "1 lượt" tính tới hết vòng sau (đòn kế tiếp của nó); Vương Ấn 2 lượt.
      k.mark(e.source, CURSE, opts.kind === "curse" ? 2 : 3);
      k.proc(opts.kind === "curse" ? "ám" : "vương ấn", e.source);
    },
    guardAlly(k, e) {
      if (opts.allyCurse) return backlash(k, e.source, e.damage);
    },
    onOtherAction(k, e) {
      // Ám chỉ ứng với đòn kế tiếp của kẻ bị ám, dù nó đánh ai.
      if (opts.kind !== "curse" || e.isAlly || !e.skill?.attack || k.marked(e.actor, CURSE) <= 0)
        return;
      if (e.target === k.self || (opts.allyCurse && e.target === k.ally)) return;
      k.unmark(e.actor, CURSE);
    },
    outgoing(k, e) {
      if (opts.kind === "seal" && e.skill?.attack && k.marked(e.target, CURSE) > 0) {
        k.proc("đánh vương ấn", e.target);
        return k.p.mark;
      }
    },
    onHitDealt(k, e) {
      const stored = k.e.stored ?? 0;
      if (!opts.absorb || stored <= 0 || !e.skill?.attack) return;
      k.e.stored = 0;
      if (k.damage(e.target, stored) > 0) k.proc("phản phệ", e.target);
    },
    ...extra,
  };
}

// ------------------------------------------------------------------ Hồn (257–259)

/** params: soul (% mỗi Hồn), heal (% hồi mỗi Hồn), weak (258), guard (259). */
function soulScript(meta: Meta, extra: Partial<TraitScript> = {}): TraitScript {
  return {
    ...meta,
    onDotTick(k, e) {
      if ((e.status !== "bleed" && e.status !== "corrosion") || e.damage <= 0) return;
      if ((k.v.soul ?? 0) >= 3) return;
      k.stack("soul", 1, 3);
      k.proc("thu hồn", e.target);
    },
    beforeAction(k, e) {
      k.e.useSoul = isAttack(e.skill) ? (k.v.soul ?? 0) : 0;
    },
    outgoing(k, e) {
      const n = k.e.useSoul ?? 0;
      if (n > 0 && e.skill?.attack) {
        k.proc("hồn +%", e.target);
        return n * k.p.soul;
      }
    },
    afterAction(k) {
      const n = k.e.useSoul ?? 0;
      if (n <= 0) return;
      k.e.useSoul = 0;
      k.stack("soul", -3, 3);
      k.heal(k.self, n * k.p.heal);
      k.proc("tiêu hồn");
    },
    ...extra,
  };
}

/** 259: +1 Hồn (tối đa 3). */
function gainSoul(k: Kit, target: DesignTraitUnit, label: string): void {
  if ((k.v.soul ?? 0) >= 3) return;
  k.stack("soul", 1, 3);
  k.proc(label, target);
}

// ------------------------------------------------------------------ Đèn Gieo Hạt (263–265)

const LAMP = "đèn";

/** params: weak (% giảm sát thương), heal (264). */
function lampScript(meta: Meta, extra: Partial<TraitScript> = {}): TraitScript {
  const weakened = (k: Kit, source: DesignTraitUnit) =>
    k.has(source, "seed") && k.marked(source, LAMP) > 0;
  const script: TraitScript = {
    ...meta,
    afterAction(k, e) {
      // Gieo Hạt pet vừa gây kéo dài thêm 1 lượt.
      if (!e.target || !e.newStatuses.includes("seed") || !k.isFoe(e.target)) return;
      extend(e.target, "seed", 1);
      const left = e.target.statuses.get(KIT_STATUS.seed.bank, KIT_STATUS.seed.id);
      k.mark(e.target, LAMP, (left?.remainingTurns ?? 4) + 1);
      k.proc("gieo hạt +1", e.target);
    },
    incoming(k, e) {
      if (e.direct && weakened(k, e.source)) {
        k.proc("đèn soi", e.source);
        return k.p.weak;
      }
    },
    guardAlly(k, e) {
      if (weakened(k, e.source)) {
        k.proc("đèn soi đồng đội", e.source);
        return k.p.weak;
      }
    },
  };
  return { ...script, ...extra, afterAction: chain(script.afterAction, extra.afterAction) };
}

/** Gộp hai hook afterAction (cái sau chạy sau). */
function chain(
  a: TraitScript["afterAction"],
  b: TraitScript["afterAction"],
): TraitScript["afterAction"] {
  if (!a || !b) return a ?? b;
  return (k, e) => {
    a(k, e);
    b(k, e);
  };
}

// ------------------------------------------------------------------ Nhãn Ấn (266–268)

const EYE = "nhãn ấn";
const EYE_DONE = "nhãn ấn xong";

/** params: eye (% giảm mỗi Nhãn Ấn). */
function eyeScript(meta: Meta, finisher?: "daze" | "petrify"): TraitScript {
  const weak = (k: Kit, source: DesignTraitUnit) => k.marked(source, EYE) * k.p.eye;
  return {
    ...meta,
    onHitDealt(k, e) {
      if (!e.skill?.attack) return;
      const n = k.mark(e.target, EYE, 3, 3);
      k.proc("nhãn ấn", e.target);
      if (!finisher || n < 3 || k.marked(e.target, EYE_DONE) > 0) return;
      k.mark(e.target, EYE_DONE, 999);
      if (finisher === "daze") {
        if (k.inflict(e.target, "daze", 2)) k.proc("mê muội", e.target);
      } else {
        if (k.inflict(e.target, "petrify", 1)) k.proc("thạch hóa", e.target);
        k.unmark(e.target, EYE);
      }
    },
    incoming(k, e) {
      const r = e.direct ? weak(k, e.source) : 0;
      if (r > 0) {
        k.proc("nhãn yếu", e.source);
        return r;
      }
    },
    guardAlly(k, e) {
      const r = weak(k, e.source);
      if (r > 0) {
        k.proc("nhãn yếu đồng đội", e.source);
        return r;
      }
    },
  };
}

// ------------------------------------------------------------------ Hồi sinh một lần (271)

/**
 * Kit không hồi sinh được pet đã gục. Xấp xỉ: trước đòn trực tiếp chí tử (sát thương dự kiến ≥ máu
 * còn), pet được một khiên tạm đủ đỡ đòn; sau đòn gỡ khiên tạm (trả khiên cũ) và đặt máu revive%.
 * Không bắt được cái chết do độc/gián tiếp.
 */
const SHIELD_ID = 15;
const reviveGuard = new WeakMap<DesignTraitUnit, { old?: StatusInstance }>();
function armRevive(k: Kit, unit: DesignTraitUnit, damage: number): void {
  if (k.v.revived || reviveGuard.has(unit) || damage < unit.hp()) return;
  reviveGuard.set(unit, { old: unit.statuses.get(BUFF_BANK, SHIELD_ID) });
  unit.statuses.remove(BUFF_BANK, SHIELD_ID);
  k.shieldAmount(unit, damage * 3 + unit.maxHp(), 1);
}
function finishRevive(k: Kit, unit: DesignTraitUnit): void {
  const armed = reviveGuard.get(unit);
  if (!armed) return;
  reviveGuard.delete(unit);
  unit.statuses.remove(BUFF_BANK, SHIELD_ID);
  if (armed.old) unit.statuses.put(armed.old);
  unit.restoreSourceStatusState();
  k.v.revived = 1;
  unit.setHp(Math.max(1, k.pctOf(unit, k.p.revive)));
  k.proc("tái sinh", unit);
}

// ------------------------------------------------------------------ Tử Thần Xúc Ấn (272)

const ppSnapshot = new WeakMap<DesignTraitUnit, number[]>();
/** Engine vừa đưa PP về 0: trả lại một nửa PP mỗi chiêu có trước lúc dùng Tử Thần Xúc Ấn. */
function restoreHalfPp(k: Kit, last: boolean): void {
  const snap = ppSnapshot.get(k.self);
  if (!snap) return;
  const zeroed = k.self.skillIds.every((id, i) => id <= 0 || k.self.skillPp[i] === 0);
  if (!zeroed) {
    if (last) ppSnapshot.delete(k.self);
    return;
  }
  ppSnapshot.delete(k.self);
  let any = false;
  for (let i = 0; i < snap.length; i++) {
    const half = Math.trunc(snap[i] / 2);
    if (k.self.skillIds[i] > 0 && half > 0) {
      k.self.skillPp[i] = half;
      any = true;
    }
  }
  if (any) k.proc("giữ nửa PP");
}

// ------------------------------------------------------------------ 278

/** 278: pha Huyết Nguyệt còn khiên. */
function moonUp(k: Kit): boolean {
  return k.v.moon === 1 && k.round <= (k.v.moonUntil ?? 0) && k.shieldHp() > 0;
}
/** 278: khiên Huyết Nguyệt vỡ trước hạn → tự Thạch Hóa 1 lượt. */
function shatterCheck(k: Kit): void {
  if (k.v.moon !== 1 || k.round > (k.v.moonUntil ?? 0) || k.shieldHp() > 0) return;
  k.v.moon = 2;
  selfStatus(k, "petrify", 1);
  k.proc("vỡ khiên thạch hóa");
}

/** Kịch bản đặc tính, phần 7. */
// ------------------------------------------------------------------ Ô thép (279)

/** Đòn trực tiếp đầu tiên mỗi lượt lên pet (2v2: hoặc đồng đội) bị đỡ `guard`%; nhớ phần đỡ để dội. */
function umbrella(k: Kit, damage: number, self: boolean): number | undefined {
  if (!k.oncePerRound("ô thép")) return;
  k.e.umbRound = k.round;
  k.e.umbSelf = self ? 1 : 0;
  k.e.umbAmt = pct(damage, k.p.guard);
  if (self) k.proc("ô thép");
  return k.p.guard;
}
/** Phần dội lại kẻ đánh của đòn vừa bị ô đỡ (`reflect`% phần đỡ được). */
function umbrellaBack(k: Kit, self: boolean): number {
  if (k.e.umbRound !== k.round || !k.e.umbAmt || !!k.e.umbSelf !== self) return 0;
  const back = pct(k.e.umbAmt, k.p.reflect);
  k.e.umbAmt = 0;
  return back;
}

export const PART_7: Record<number, TraitScript> = {
  // 240 Huyền Giáp Hải Hùng
  240: {
    name: "Huyền Giáp Hồi Triều",
    params: { ebb: 20, heal: 6, surge: 30, cap: 15, ally: 10 },
    text: "Lượt chẵn (Triều Rút): pet chịu ít hơn {ebb}% sát thương và cuối lượt hồi {heal}% HP. Lượt lẻ (Triều Lên): chiêu tấn công cộng thêm sát thương bằng {surge}% lượng HP pet đã mất ở lượt Triều Rút trước đó (tối đa {cap}% HP tối đa của pet). Khi có đồng đội trên sân, ở lượt Triều Rút pet khiêu khích nhẹ: đối thủ đánh đồng đội của pet bị giảm {ally}% sát thương.",
    incoming(k, e) {
      if (e.direct && k.round % 2 === 0) {
        k.proc("triều rút");
        return k.p.ebb;
      }
    },
    guardAlly(k, e) {
      if (k.round % 2 === 0) {
        k.proc("sóng che chắn", e.target);
        return k.p.ally;
      }
    },
    roundEnd(k) {
      if (k.round % 2 !== 0) return;
      // Ghi máu mất ở lượt Triều Rút cho lượt Triều Lên kế tiếp.
      k.v.ebbLost = k.hpLostThisRound;
      k.v.ebbRound = k.round;
      k.heal(k.self, k.p.heal);
      k.proc("triều hồi");
    },
    onHitDealt(k, e) {
      if (k.round % 2 !== 1 || !e.skill?.attack || k.v.ebbRound !== k.round - 1) return;
      const lost = k.v.ebbLost ?? 0;
      if (lost <= 0 || !k.oncePerRound("triều lên")) return;
      const amount = Math.min(pct(lost, k.p.surge), k.pctOf(k.self, k.p.cap));
      if (k.damage(e.target, amount) > 0) k.proc("triều lên", e.target);
    },
  },

  // 241 Hải Nguyệt Hùng Mẫu
  241: {
    name: "Mẫu Hùng Hộ Nhi",
    params: { save: 12, guard: 25 },
    text: "Khi đồng đội (không có đồng đội thì chính pet) tụt dưới 40% HP, pet lập tức hồi cho nó {save}% HP tối đa của người nhận (mỗi trận 2 lần). Lượt pet dùng chiêu hồi máu, pet chịu ít hơn {guard}% sát thương.",
    onDamaged(k, e) {
      if (k.twoVsTwo) return;
      const line = pct(k.self.maxHp(), 40);
      if (e.before < line || e.after >= line || (k.v.saves ?? 0) >= 2) return;
      k.v.saves = (k.v.saves ?? 0) + 1;
      k.heal(k.self, k.p.save);
      k.proc("cứu", k.self);
    },
    onAllyHitTaken(k, e) {
      const ally = e.target;
      const line = pct(ally.maxHp(), 40);
      if (!ally.alive() || ally.hp() >= line || ally.hp() + e.damage < line) return;
      if ((k.v.saves ?? 0) >= 2) return;
      k.v.saves = (k.v.saves ?? 0) + 1;
      k.heal(ally, k.p.save);
      k.proc("cứu", ally);
    },
    beforeAction(k, e) {
      if (isHeal(e.skill)) k.e.healRound = k.round;
    },
    incoming(k, e) {
      if (e.direct && k.e.healRound === k.round) {
        k.proc("che con");
        return k.p.guard;
      }
    },
  },

  // 242 Lôi Nhung Dương
  242: staticScript(
    {
      name: "Len Tĩnh Điện",
      params: { para: 20, charge: 15 },
      text: "Mỗi lần bị đánh trúng bởi đòn trực tiếp: kẻ đánh có {para}% bị Tê Liệt 1 lượt, và pet tích 1 Tĩnh Điện (tối đa 3). Chiêu Lôi kế tiếp xả hết Tĩnh Điện, mỗi tầng gây thêm {charge}% sát thương.",
    },
    "base",
  ),

  // 243 Cự Giác Lôi Dương
  243: staticScript(
    {
      name: "Cự Giác Lôi Nhung",
      params: { para: 25, charge: 15 },
      text: "Mỗi lần bị đánh trúng bởi đòn trực tiếp: kẻ đánh có {para}% bị Tê Liệt 1 lượt, pet tích 1 Tĩnh Điện (tối đa 3). Chiêu Lôi kế tiếp xả hết, mỗi tầng +{charge}% sát thương; Lôi Thiết Bạo Vũ tính mỗi Tĩnh Điện như một tầng Phòng ngự.",
    },
    "storm",
  ),

  // 244 Thiên Lôi Dương Vương
  244: staticScript(
    {
      name: "Dương Vương Lôi Thành",
      params: { para: 25, charge: 15 },
      text: "Mỗi lần bị đánh trúng bởi đòn trực tiếp: kẻ đánh có {para}% bị Tê Liệt 1 lượt, pet tích 1 Tĩnh Điện (tối đa 3). Chiêu Lôi xả hết, mỗi tầng +{charge}% sát thương. Khi đủ 3 tầng, pet được miễn hiệu ứng xấu cho tới lần xả.",
    },
    "fort",
  ),

  // 245 Thủy Nang Oa
  245: {
    name: "Thủy Nang Phun Sương",
    params: { acc: 15, heal: 8 },
    text: "Lượt pet dùng chiêu hồi máu, túi nước phun sương: mọi đối thủ giảm {acc}% chính xác trong 2 lượt (không cộng dồn). Mỗi lần đòn của đối thủ đánh trượt, pet hoặc đồng đội bị nhắm tới hồi {heal}% HP tối đa.",
    afterAction(k, e) {
      if (!isHeal(e.skill)) return;
      for (const foe of k.foes)
        if (k.inflict(foe, "accuracy_down", 2, { value: k.p.acc, refresh: false }))
          k.proc("phun sương", foe);
    },
    onOtherAction(k, e) {
      const victim = foeMissed(k, e);
      if (!victim) return;
      k.heal(victim, k.p.heal);
      k.proc("trượt hồi", victim);
    },
  },

  // 246 Cự Khẩu Triều Oa
  246: {
    name: "Cự Khẩu Nuốt Sương",
    params: { acc: 12, heal: 8, next: 20 },
    text: "Chiêu tấn công trúng đối thủ đang bị giảm chính xác gây thêm {acc}% sát thương. Mỗi lần đòn của đối thủ đánh trượt pet, pet nuốt sương: hồi {heal}% HP tối đa và chiêu tấn công kế tiếp gây thêm {next}% sát thương.",
    outgoing(k, e) {
      if (!e.skill?.attack) return;
      let bonus = 0;
      if (k.has(e.target, "accuracy_down")) {
        k.proc("đánh mờ mắt", e.target);
        bonus += k.p.acc;
      }
      if (k.e.swallow) {
        k.e.swallow = 0;
        k.proc("nuốt sương +%", e.target);
        bonus += k.p.next;
      }
      return bonus;
    },
    onOtherAction(k, e) {
      if (foeMissed(k, e) !== k.self) return;
      k.heal(k.self, k.p.heal);
      k.e.swallow = 1;
      k.proc("nuốt sương");
    },
  },

  // 247 Hải Khiếu Câm Thú
  247: {
    name: "Hải Khiếu Câm Thú",
    params: { reduce: 20, charm: 15, heal: 8 },
    text: "Đối thủ đang bị giảm chính xác gây ít hơn {reduce}% sát thương lên pet. Mỗi lần đòn của đối thủ đánh trượt pet, pet gầm lên: đối thủ đó bị Mị Hoặc 2 lượt (giảm {charm}% sát thương) và pet hồi {heal}% HP tối đa. Mị Hoặc giảm sát thương lên cả đồng đội của pet.",
    incoming(k, e) {
      if (!e.direct) return;
      let r = 0;
      if (k.has(e.source, "accuracy_down")) {
        k.proc("sương chắn");
        r += k.p.reduce;
      }
      if (k.marked(e.source, "mị") > 0) {
        k.proc("mị hoặc yếu", e.source);
        r += k.p.charm;
      }
      return r;
    },
    guardAlly(k, e) {
      if (k.marked(e.source, "mị") > 0) {
        k.proc("mị hoặc yếu đồng đội", e.source);
        return k.p.charm;
      }
    },
    onOtherAction(k, e) {
      if (foeMissed(k, e) !== k.self) return;
      k.inflict(e.actor, "charm", 2);
      k.mark(e.actor, "mị", 3);
      k.heal(k.self, k.p.heal);
      k.proc("gầm mị hoặc", e.actor);
    },
  },

  // 248 Viêm Trảo Hổ Binh
  248: rageScript(
    {
      name: "Hổ Con Gầm Lửa",
      params: { rage: 10 },
      text: "Vào sân có sẵn 1 Nộ. Mỗi lượt lần đầu pet hoặc đồng đội bị đánh trúng, pet nhận 1 Nộ: Sức mạnh +{rage}% trong 3 lượt (tối đa 3 tầng). Mất hết khi rời sân hoặc bị giải trừ.",
    },
    { start: true, allyHit: true, bleed: false, revenge: false },
  ),

  // 249 Xích Diễm Hổ Tướng
  249: rageScript(
    {
      name: "Xích Diễm Nộ Trảo",
      params: { rage: 12 },
      text: "Mỗi lượt lần đầu pet hoặc đồng đội bị đánh trúng, pet nhận 1 Nộ: Sức mạnh +{rage}% trong 3 lượt (tối đa 3). Khi đạt 3 Nộ, đòn trúng kế tiếp chắc chắn gây Xé Rách 2 lượt.",
    },
    { start: false, allyHit: true, bleed: true, revenge: false },
  ),

  // 250 Liệt Hỏa Hổ Vương
  250: rageScript(
    {
      name: "Hổ Vương Báo Thù",
      params: { rage: 9, heal: 11 },
      text: "Mỗi lượt lần đầu bị đánh trúng, pet nhận 1 Nộ: Sức mạnh +{rage}% trong 3 lượt (bị đánh chỉ giữ tối đa 1 Nộ). Khi đồng đội bị hạ (không có đồng đội thì khi pet lần đầu tụt dưới 25% HP), pet báo thù: nhận ngay đủ 3 Nộ và hồi {heal}% HP tối đa.",
    },
    { start: false, allyHit: false, bleed: false, revenge: true, hitCap: 1, line: 25 },
  ),

  // 251 Linh Quả Tiểu Hầu
  251: sealScript(
    {
      name: "Hầu Côn Biến Hóa",
      params: { seal: 9 },
      text: "Mỗi lần pet dùng một chiêu khác chiêu đã dùng ở lượt trước, pet nhận 1 Côn Ấn (tối đa 3): mỗi Côn Ấn làm chiêu tấn công gây thêm {seal}% sát thương. Dùng lại đúng chiêu vừa dùng thì mất hết Côn Ấn.",
    },
    false,
  ),

  // 252 Cổ Mộc Hầu Tiên
  252: sealScript(
    {
      name: "Hầu Tiên Thất Thập Nhị Biến",
      params: { seal: 10, heal: 10 },
      text: "Mỗi lần dùng chiêu khác chiêu ở lượt trước, pet nhận 1 Côn Ấn (tối đa 3): mỗi Côn Ấn +{seal}% sát thương. Khi đạt 3 Côn Ấn, đòn trúng kế tiếp xả hết: gây Quấn Quanh 2 lượt và hồi {heal}% HP tối đa. Dùng lại chiêu vừa dùng thì mất hết.",
    },
    true,
  ),

  // 253 U Hồn Sơ Sinh
  253: phantomScript(
    {
      name: "Hồn Non Hư Ảnh",
      params: { first: 60, curse: 25 },
      text: "Đòn tấn công đầu tiên trúng pet sau mỗi lần vào sân bị giảm {first}% sát thương, và kẻ đánh bị Ám 1 lượt: đòn kế tiếp của nó có {curse}% dội ngược vào chính nó. Kẻ đánh bị Ám có thể dội ngược cả đòn đang nhắm vào đồng đội của pet.",
    },
    { kind: "curse", allyCurse: true },
  ),

  // 254 Loạn Giới Linh Thể
  254: phantomScript(
    {
      name: "Loạn Giới Xuyên Hồn",
      params: { first: 60, curse: 25, ghost: 40 },
      text: "Đòn tấn công đầu tiên trúng pet sau mỗi lần vào sân giảm {first}%, kẻ đánh bị Ám 1 lượt ({curse}% dội ngược). Khi pet rời sân bằng U Minh Hư Phán · Chuyển, pet vào thay nhận Hư Thể: đòn đầu tiên trúng nó giảm {ghost}%.",
    },
    { kind: "curse" },
    {
      afterAction(k, e) {
        if (e.skill?.name === "U Minh Hư Phán · Chuyển") k.v.pivot = k.round;
      },
      onLeave(k, e) {
        // Xấp xỉ: kit không gắn được "giảm đòn đầu" lên pet khác → khiên ghost/4 % HP tối đa 2 lượt
        // (≈ ghost% của một đòn nặng 25% HP).
        if (e.fainted || !e.next || k.v.pivot !== k.round) return;
        k.shieldAmount(e.next, k.pctOf(e.next, k.p.ghost / 4), 2);
        k.proc("hư thể", e.next);
      },
    },
  ),

  // 255 Hư Vô Hồn Tướng
  255: phantomScript(
    {
      name: "Hư Vô Phản Phệ",
      params: { first: 50, cap: 20, curse: 25 },
      text: "Đòn tấn công đầu tiên trúng pet sau mỗi lần vào sân giảm {first}%; lượng sát thương chặn được cộng vào đòn tấn công kế tiếp của pet (tối đa {cap}% HP tối đa của pet). Kẻ đánh bị Ám 1 lượt ({curse}% dội ngược).",
    },
    { kind: "curse", absorb: true },
  ),

  // 256 U Minh Hồn Vương
  256: phantomScript(
    {
      name: "U Minh Vương Ấn",
      params: { first: 50, curse: 20, mark: 15 },
      text: "Đòn tấn công đầu tiên trúng pet sau mỗi lần vào sân giảm {first}%, kẻ đánh mang Vương Ấn 2 lượt: đòn của nó có {curse}% dội ngược, và pet đánh nó gây thêm {mark}% sát thương. Đồng đội của pet cũng được hưởng phần dội ngược {curse}% khi kẻ mang ấn đánh họ.",
    },
    { kind: "seal", allyCurse: true },
  ),

  // 257 Triều Vụ U Linh
  257: soulScript({
    name: "Sương Triều Thu Hồn",
    params: { soul: 10, heal: 4 },
    text: "Mỗi lần Xé Rách hoặc Hủ Thực làm đối thủ mất HP, pet thu 1 Hồn (tối đa 3). Chiêu tấn công kế tiếp tiêu hết Hồn: mỗi Hồn gây thêm {soul}% sát thương và hồi cho pet {heal}% HP tối đa. Thu Hồn từ tick trên cả hai đối thủ.",
  }),

  // 258 Hải Oán Tà Linh
  258: soulScript(
    {
      name: "Hải Oán Câu Hồn",
      params: { soul: 12, heal: 4, weak: 10 },
      text: "Mỗi lần Xé Rách hoặc Hủ Thực làm đối thủ mất HP, pet thu 1 Hồn (tối đa 3). Chiêu tấn công kế tiếp tiêu hết Hồn: mỗi Hồn +{soul}% sát thương và hồi {heal}% HP tối đa. Đối thủ mang cả hai loại mất máu bị giảm {weak}% sát thương.",
    },
    {
      incoming(k, e) {
        if (e.direct && k.has(e.source, "bleed") && k.has(e.source, "corrosion")) {
          k.proc("oán yếu", e.source);
          return k.p.weak;
        }
      },
      guardAlly(k, e) {
        if (k.has(e.source, "bleed") && k.has(e.source, "corrosion")) {
          k.proc("oán yếu đồng đội", e.source);
          return k.p.weak;
        }
      },
    },
  ),

  // 259 Độ Hồn Minh Sư
  259: {
    name: "Minh Sư Độ Hồn",
    params: { heal: 6, guard: 8, per: 12 },
    text: "Mỗi lần pet đánh trúng, pet thu 1 Hồn (2 Hồn nếu đối thủ đang mang hiệu ứng xấu); Xé Rách/Hủ Thực làm đối thủ mất HP cũng cho 1 Hồn (tối đa 3). Chiêu hồi máu tiêu hết Hồn: mỗi Hồn hồi thêm {heal}% HP và người được hồi chịu ít hơn {guard}% sát thương trong lượt đó. Chiêu tấn công tiêu Hồn: +{per}% sát thương mỗi Hồn.",
    onDotTick(k, e) {
      if ((e.status === "bleed" || e.status === "corrosion") && e.damage > 0)
        gainSoul(k, e.target, "thu hồn");
    },
    onHitDealt(k, e) {
      if (!e.skill?.attack) return;
      gainSoul(k, e.target, "thu hồn khi đánh");
      if (k.debuffs(e.target) > 0) gainSoul(k, e.target, "thu hồn khi đánh");
    },
    beforeAction(k, e) {
      // Chiêu tấn công tiêu Hồn ngay khi ra đòn (Hồn thu từ chính đòn này giữ lại cho lần sau).
      const n = isAttack(e.skill) ? (k.v.soul ?? 0) : 0;
      k.e.useSoul = n;
      if (n > 0) k.stack("soul", -n, 3);
    },
    outgoing(k, e) {
      const n = k.e.useSoul ?? 0;
      if (n > 0 && e.skill?.attack) {
        k.proc("hồn +%", e.target);
        return n * k.p.per;
      }
    },
    afterAction(k) {
      if ((k.e.useSoul ?? 0) <= 0) return;
      k.e.useSoul = 0;
      k.proc("tiêu hồn");
    },
    healOut(k, e) {
      const n = k.v.soul ?? 0;
      if (n <= 0) return;
      k.stack("soul", -3, 3);
      for (let i = 0; i < n; i++) k.mark(e.target, "độ hồn", 1, 3);
      k.proc("độ hồn", e.target);
      return k.pctOf(e.target, n * k.p.heal);
    },
    incoming(k, e) {
      const n = k.marked(k.self, "độ hồn");
      if (e.direct && n > 0) {
        k.proc("hồn che");
        return n * k.p.guard;
      }
    },
    guardAlly(k, e) {
      const n = k.marked(e.target, "độ hồn");
      if (n > 0) {
        k.proc("hồn che đồng đội", e.target);
        return n * k.p.guard;
      }
    },
  },

  // 260 Dạ Diệp Yêu Tinh
  260: {
    name: "Ước Lá Che Đêm",
    params: { cover: 25 },
    text: "Khi pet ra đòn trước đối thủ trong lượt, lá ước che chắn: đòn đầu tiên trúng pet hoặc đồng đội trong lượt đó giảm {cover}% sát thương.",
    afterAction(k, e) {
      if (e.actedFirst) k.e.leaf = k.round;
    },
    incoming(k, e) {
      if (k.twoVsTwo || !e.direct || k.e.leaf !== k.round) return;
      k.e.leaf = 0;
      k.proc("lá che");
      return k.p.cover;
    },
    guardAlly(k, e) {
      if (k.e.leaf !== k.round) return;
      k.e.leaf = 0;
      k.proc("lá che", e.target);
      return k.p.cover;
    },
  },

  // 261 Hắc Lâm Tinh Vương
  261: {
    name: "Hắc Lâm Huyết Ước",
    params: { pay: 4, bonus: 25, drain: 25, cap: 8 },
    text: "Khi HP trên 60%: mỗi lượt, chiêu tấn công đầu tiên trả {pay}% HP tối đa để gây thêm {bonus}% sát thương. Khi HP từ 60% trở xuống, ước đổi chiều: chiêu tấn công hút {drain}% sát thương thực gây ra (tối đa {cap}% HP).",
    beforeAction(k, e) {
      k.e.paid = 0;
      k.e.drain = 0;
      if (!e.skill?.attack) return;
      if (k.hpPct() > 60) {
        if (!k.oncePerRound("huyết ước")) return;
        k.payHp(k.p.pay);
        k.e.paid = 1;
        k.proc("trả máu");
      } else k.e.drain = 1;
    },
    outgoing(k, e) {
      if (k.e.paid && e.skill?.attack) {
        k.proc("huyết ước +%", e.target);
        return k.p.bonus;
      }
    },
    afterAction(k, e) {
      if (!k.e.drain || !e.hit || e.damage <= 0) return;
      k.e.drain = 0;
      const amount = Math.min(pct(e.damage, k.p.drain), k.pctOf(k.self, k.p.cap));
      if (k.healAmount(k.self, amount).healed > 0) k.proc("hút máu");
    },
  },

  // 262 Lam Dực Mộc Hậu
  262: {
    name: "Mộc Hậu Kết Rễ",
    params: { guard: 12, regen: 5 },
    text: "Chiêu hồi máu của pet gieo Rễ Ước lên người được hồi trong 2 lượt: chịu ít hơn {guard}% sát thương và cuối lượt hồi {regen}% HP tối đa. Lượt đầu tiên sau khi vào sân, chiêu hồi máu của pet được ra đòn trước.",
    afterAction(k, e) {
      if (!isHeal(e.skill)) return;
      const who = healTarget(k, e.target);
      k.mark(who, "rễ ước", 2);
      k.proc("rễ ước", who);
    },
    incoming(k, e) {
      if (e.direct && k.marked(k.self, "rễ ước") > 0) {
        k.proc("rễ che");
        return k.p.guard;
      }
    },
    guardAlly(k, e) {
      if (k.marked(e.target, "rễ ước") > 0) {
        k.proc("rễ che", e.target);
        return k.p.guard;
      }
    },
    roundEnd(k) {
      for (const u of k.team) {
        if (k.marked(u, "rễ ước") <= 0) continue;
        k.heal(u, k.p.regen);
        k.proc("rễ hồi", u);
      }
    },
    priority(k, e) {
      // Lượt đầu trên sân, chiêu hồi máu của pet được ra đòn trước.
      if (k.roundsOnField !== 0 || !isHeal(e.skill)) return;
      k.proc("hồi đi trước");
      return true;
    },
  },

  // 263 Hỏa Đăng Tiểu Linh
  263: lampScript({
    name: "Đốm Lửa Dẫn Đường",
    params: { weak: 12 },
    text: "Gieo Hạt do pet gây ra kéo dài thêm 1 lượt. Đối thủ đang Gieo Hạt của pet bị lửa đèn soi rát tay: gây ít hơn {weak}% sát thương lên pet và đồng đội.",
  }),

  // 264 Xích Du Đăng Quái
  264: lampScript(
    {
      name: "Đèn Dầu Xích Du",
      params: { weak: 12, heal: 12 },
      text: "Gieo Hạt do pet gây ra kéo dài thêm 1 lượt, và đối thủ mang nó gây ít hơn {weak}% sát thương lên pet và đồng đội. Khi pet kích nổ Gieo Hạt (Chước nhiệt chi xúc), dầu đèn bắn lên: pet hồi {heal}% HP tối đa.",
    },
    {
      beforeAction(k, e) {
        k.e.det = e.skill?.name === "Chước nhiệt chi xúc" && k.has(e.target, "seed") ? 1 : 0;
      },
      afterAction(k, e) {
        if (!k.e.det || !e.hit) return;
        k.e.det = 0;
        k.heal(k.self, k.p.heal);
        k.proc("dầu đèn hồi");
      },
    },
  ),

  // 265 Cổ Diễm Đăng Vương
  265: lampScript(
    {
      name: "Đăng Vương Trường Minh",
      params: { weak: 12 },
      text: "Gieo Hạt do pet gây ra kéo dài thêm 1 lượt, đối thủ mang nó gây ít hơn {weak}% sát thương. Lượt pet dùng chiêu hồi máu, ngọn đèn bùng: mọi đối thủ đang Gieo Hạt mất ngay một tick. Chiêu hồi máu cho đồng đội cũng kích tick lên cả hai đối thủ mang Gieo Hạt.",
    },
    {
      afterAction(k, e) {
        if (!isHeal(e.skill)) return;
        for (const foe of k.foes) {
          const seed = foe.statuses.get(KIT_STATUS.seed.bank, KIT_STATUS.seed.id);
          if (!seed) continue;
          // Một tick Gieo Hạt = primaryValue% HP tối đa của mục tiêu.
          const tick = k.pctOf(foe, Math.max(1, seed.primaryValue));
          if (k.damage(foe, tick) > 0) k.proc("đèn bùng", foe);
        }
      },
    },
  ),

  // 266 Thạch Nhãn Quái
  266: eyeScript({
    name: "Thạch Nhãn Trừng Mắt",
    params: { eye: 8 },
    text: "Mỗi đòn tấn công trúng gắn 1 Nhãn Ấn lên đối thủ (tối đa 3, giữ 3 lượt). Mỗi Nhãn Ấn làm đối thủ đó gây ít hơn {eye}% sát thương.",
  }),

  // 267 Bách Túc Ma Nhãn
  267: eyeScript(
    {
      name: "Bách Túc Mê Nhãn",
      params: { eye: 8 },
      text: "Mỗi đòn trúng gắn 1 Nhãn Ấn (tối đa 3, giữ 3 lượt): mỗi Ấn làm đối thủ gây ít hơn {eye}% sát thương. Khi đạt 3 Nhãn Ấn, đối thủ bị Mê Muội 2 lượt (mỗi đối thủ 1 lần mỗi trận).",
    },
    "daze",
  ),

  // 268 Tam Đồng Địa Ma
  268: eyeScript(
    {
      name: "Tam Đồng Hóa Thạch",
      params: { eye: 8 },
      text: "Mỗi đòn trúng gắn 1 Nhãn Ấn (tối đa 3, giữ 3 lượt): mỗi Ấn làm đối thủ gây ít hơn {eye}% sát thương. Khi đạt 3 Nhãn Ấn, ánh mắt thứ ba mở: đối thủ bị Thạch Hóa 1 lượt rồi xóa hết Ấn (mỗi đối thủ 1 lần mỗi trận).",
    },
    "petrify",
  ),

  // 269 Lôi Long Thiên Tướng
  269: {
    name: "Thiên Tướng Hiệu Lôi",
    params: { lead: 12, para: 10, ally: 5, allyCap: 15 },
    text: "Lượt đầu sau mỗi lần vào sân, pet luôn ra đòn trước. Mỗi lượt ra đòn trước, pet nhận 1 Lôi Lệnh (tối đa 3): mỗi tầng làm chiêu Lôi gây thêm {lead}% sát thương và có thêm {para}% gây Tê Liệt 1 lượt. Bị đối thủ ra đòn trước thì mất hết Lôi Lệnh. Mỗi Lôi Lệnh còn cho đồng đội +{ally}% sát thương (tối đa +{allyCap}%).",
    priority(k) {
      if (k.roundsOnField === 0) {
        k.proc("tiên phong");
        return true;
      }
    },
    beforeAction(k, e) {
      if (!e.actedFirst && (k.v.lead ?? 0) > 0) {
        k.stack("lead", -3, 3);
        k.proc("mất lôi lệnh");
      }
    },
    afterAction(k, e) {
      if (e.actedFirst && k.oncePerRound("lôi lệnh") && (k.v.lead ?? 0) < 3) {
        k.stack("lead", 1, 3);
        k.proc("lôi lệnh");
      }
    },
    outgoing(k, e) {
      const n = k.v.lead ?? 0;
      if (n > 0 && isAttack(e.skill, ELECTRIC)) {
        k.proc("lôi lệnh +%", e.target);
        return n * k.p.lead;
      }
    },
    onHitDealt(k, e) {
      const n = k.v.lead ?? 0;
      if (n <= 0 || !isAttack(e.skill, ELECTRIC)) return;
      if (k.chance(n * k.p.para, "lôi lệnh") && k.inflict(e.target, "paralysis", 1))
        k.proc("tê liệt", e.target);
    },
    allyOutgoing(k, e) {
      const n = k.v.lead ?? 0;
      if (n <= 0) return;
      k.proc("cờ lôi lệnh", e.source);
      return Math.min(k.p.allyCap, n * k.p.ally);
    },
  },

  // 270 Cổ Giới Thiết Thần
  270: (() => {
    /** Kết Giới còn nguyên: chưa từng nứt, hoặc đã qua 2 lượt kể từ lần nứt. */
    const intact = (k: Kit) => k.v.crack === undefined || k.round - k.v.crack >= 2;
    const crack = (k: Kit, damage: number) => {
      k.v.crack = k.round;
      k.e.blocked = pct(damage, k.p.block);
    };
    const script: TraitScript = {
      name: "Cổ Giới Thiết Bích",
      params: { block: 80, reflect: 40, tier: 7, tierCap: 21 },
      text: "Kết Giới chặn {block}% đòn tấn công đầu tiên trúng pet và dội {reflect}% lượng chặn được về kẻ đánh, rồi nứt; tái tạo sau 2 lượt (đầu trận có sẵn). Khi Kết Giới đang nứt, mỗi tầng DEF giúp pet chịu ít hơn {tier}% sát thương (tối đa {tierCap}%). Khi Kết Giới còn nguyên, nó chặn đòn đầu tiên nhắm vào pet hoặc đồng đội.",
      incoming(k, e) {
        if (!e.direct) return;
        if (e.skill?.attack && intact(k)) {
          crack(k, e.damage);
          k.proc("kết giới");
          return k.p.block;
        }
        if (intact(k)) return;
        const r = Math.min(k.p.tierCap, k.defenseTiers() * k.p.tier);
        if (r > 0) {
          k.proc("giáp nứt");
          return r;
        }
      },
      onHitTaken(k) {
        const blocked = k.e.blocked ?? 0;
        if (blocked <= 0) return;
        k.e.blocked = 0;
        k.proc("dội kết giới");
        return pct(blocked, k.p.reflect);
      },
      guardAlly(k, e) {
        if (!e.skill?.attack || !intact(k)) return;
        crack(k, e.damage);
        k.e.allyBlocked = 1;
        k.proc("kết giới", e.target);
        return k.p.block;
      },
      onAllyHitTaken(k, e) {
        if (!k.e.allyBlocked) return;
        k.e.allyBlocked = 0;
        const blocked = k.e.blocked ?? 0;
        k.e.blocked = 0;
        if (k.damage(e.source, pct(blocked, k.p.reflect)) > 0) k.proc("dội kết giới", e.source);
      },
    };
    return script;
  })(),

  // 271 Vạn Hoa Thánh Mẫu
  271: {
    name: "Vạn Hoa Tái Sinh",
    params: { regen: 6, revive: 25 },
    text: "Cuối mỗi lượt, pet và đồng đội hồi {regen}% HP tối đa. Mỗi tick Hủ Thực do pet gây ra tạo Dự Trữ cho Vạn Hoa Trường Sinh · Dưỡng. Lần đầu trong trận đồng đội (không có đồng đội thì chính pet) bị hạ, hoa tái sinh: hồi sinh với {revive}% HP tối đa.",
    roundEnd(k) {
      for (const u of k.team) {
        k.heal(u, k.p.regen);
        k.proc("vạn hoa hồi", u);
      }
    },
    onDotTick(k, e) {
      if (e.status !== "corrosion" || e.damage <= 0) return;
      // Dự Trữ thật (buff 18, như chiêu utility_reserve: 4 lượt, tối đa 3 tầng).
      (k.self as unknown as { mechanics: DesignTraitMechanics }).mechanics.stack(
        k.self,
        RESERVE_ID,
        4,
        3,
        1,
      );
      k.proc("dự trữ");
    },
    incoming(k, e) {
      if (!k.twoVsTwo && e.direct) armRevive(k, k.self, e.damage);
    },
    onHitTaken(k) {
      if (!k.twoVsTwo) finishRevive(k, k.self);
    },
    guardAlly(k, e) {
      armRevive(k, e.target, e.damage);
    },
    onAllyHitTaken(k, e) {
      finishRevive(k, e.target);
    },
  },

  // 272 U Minh Thần Đồng
  272: {
    name: "U Minh Thần Ấn",
    params: { shield: 12, bonus: 25 },
    text: "Mỗi lần chiêu của pet gây hiệu ứng xấu mới, pet nhận khiên {shield}% HP tối đa trong 2 lượt (không cộng dồn) và chiêu tấn công kế tiếp gây thêm {bonus}% sát thương. Tử Thần Xúc Ấn không đưa PP về 0 nữa: các chiêu khác giữ lại một nửa PP hiện có.",
    beforeAction(k, e) {
      if (e.skill?.name === "Tử Thần Xúc Ấn") ppSnapshot.set(k.self, [...k.self.skillPp]);
    },
    outgoing(k, e) {
      if (k.e.omen && e.skill?.attack) {
        k.e.omen = 0;
        k.proc("thần ấn +%", e.target);
        return k.p.bonus;
      }
    },
    afterAction(k, e) {
      restoreHalfPp(k, false);
      if (!e.target || !k.isFoe(e.target) || e.newStatuses.length === 0) return;
      k.shield(k.self, k.p.shield, 2);
      k.e.omen = 1;
      k.proc("thần ấn", e.target);
    },
    onOtherAction(k) {
      // Engine đưa PP về 0 sau khi đòn kết thúc: trả lại ở hành động kế tiếp trên sân.
      restoreHalfPp(k, false);
    },
    roundEnd(k) {
      restoreHalfPp(k, true);
    },
  },

  // 273 Phúc Triều Thần Miêu
  273: (() => {
    const fortune = (k: Kit) => {
      k.heal(k.self, k.p.heal);
      k.e.luck = 1;
    };
    const script: TraitScript = {
      name: "Thần Miêu Đổi Vận",
      params: { heal: 10, bonus: 25, regen: 5 },
      text: "Lần đầu mỗi lượt pet bị gây hiệu ứng xấu, Thần Miêu đổi vận: xóa nó và gây lại đúng hiệu ứng đó lên kẻ gây ra. Mỗi lần đổi vận hoặc giải trừ thành công, pet hồi {heal}% HP tối đa và chiêu tấn công kế tiếp gây thêm {bonus}%. Cuối mỗi lượt pet hồi {regen}% HP. Đổi vận cũng bảo vệ đồng đội: lần đầu mỗi lượt đồng đội bị gây hiệu ứng xấu, Thần Miêu xóa và ném ngược (dùng chung lượt đổi vận với pet).",
      onOtherAction(k, e) {
        if (e.isAlly || !k.isFoe(e.actor) || !e.target || e.newStatuses.length === 0) return;
        if (e.target !== k.self && e.target !== k.ally) return;
        if (!k.oncePerRound("đổi vận")) return;
        for (const status of e.newStatuses) {
          const slot = KIT_STATUS[status];
          const turns = e.target.statuses.get(slot.bank, slot.id)?.remainingTurns ?? 1;
          if (k.remove(e.target, status)) k.inflict(e.actor, status, Math.max(1, turns));
        }
        fortune(k);
        k.proc("đổi vận", e.target);
      },
      afterAction(k, e) {
        if (e.cleansed <= 0) return;
        fortune(k);
        k.proc("giải trừ");
      },
      outgoing(k, e) {
        if (k.e.luck && e.skill?.attack) {
          k.e.luck = 0;
          k.proc("vận may +%", e.target);
          return k.p.bonus;
        }
      },
      roundEnd(k) {
        k.heal(k.self, k.p.regen);
        k.proc("miêu hồi");
      },
    };
    return script;
  })(),

  // 274 Hỏa Vu Mộc Linh
  274: {
    name: "Vu Mộc Song Chủng",
    params: { one: 12, both: 25, sprout: 5 },
    text: "Chiêu tấn công trúng đối thủ mang Gieo Hạt hoặc Hủ Thực gây thêm {one}%; mang cả hai thì thêm {both}%. Khi đối thủ mang cả hai loại do pet gây ra, cuối mỗi lượt hai hạt nảy mầm: đối thủ mất thêm {sprout}% HP tối đa và pet hồi lượng đó. Khi đối thủ mang song chủng bị hạ, hạt lan sang đối thủ còn lại (đặt Gieo Hạt nếu chưa có).",
    outgoing(k, e) {
      if (!e.skill?.attack) return;
      const seed = k.has(e.target, "seed");
      const rot = k.has(e.target, "corrosion");
      if (seed && rot) {
        k.proc("song chủng +%", e.target);
        return k.p.both;
      }
      if (seed || rot) {
        k.proc("đơn chủng +%", e.target);
        return k.p.one;
      }
    },
    afterAction(k, e) {
      if (!e.target || !k.isFoe(e.target)) return;
      // Ghi hạt do pet gây (dấu sống lâu; vẫn đòi trạng thái còn trên mục tiêu).
      if (e.newStatuses.includes("seed")) k.mark(e.target, "vu-seed", 99);
      if (e.newStatuses.includes("corrosion")) k.mark(e.target, "vu-rot", 99);
    },
    roundEnd(k) {
      for (const foe of k.foes) {
        if (!k.has(foe, "seed") || !k.has(foe, "corrosion")) continue;
        if (k.marked(foe, "vu-seed") <= 0 || k.marked(foe, "vu-rot") <= 0) continue;
        const lost = k.damage(foe, k.pctOf(foe, k.p.sprout));
        if (lost <= 0) continue;
        k.healAmount(k.self, lost);
        k.proc("nảy mầm", foe);
      }
    },
    onFoeFaint(k, e) {
      if (k.marked(e.foe, "vu-seed") <= 0 || k.marked(e.foe, "vu-rot") <= 0) return;
      const other = k.otherFoe(e.foe);
      if (!other || k.has(other, "seed")) return;
      if (k.inflict(other, "seed", 3)) {
        k.mark(other, "vu-seed", 99);
        k.proc("hạt lan", other);
      }
    },
  },

  // 275 Thiên Luân Di Lặc
  275: {
    name: "Thiên Luân Kim Thân",
    params: { reduce: 25, def: 15 },
    text: "Không bao giờ bị Mê Muội, Quấn Quanh, Giam Cầm, Tê Liệt, Hóa Đá, Hỗn Loạn hay Ngủ, và chịu ít hơn {reduce}% sát thương từ mọi đòn. Mỗi đòn trúng pet quay Thiên Luân 1 nấc (tối đa 3); chiêu tấn công kế tiếp xả hết, mỗi nấc cộng sát thương bằng {def}% DEF của pet. Đồng đội đứng cạnh được rút ngắn 1 lượt mọi khống chế cứng.",
    admits(k, e) {
      if (HARD_CONTROL.includes(e.status)) {
        k.proc("kim thân miễn");
        return false;
      }
    },
    incoming(k, e) {
      if (e.direct) return k.p.reduce;
    },
    onHitTaken(k) {
      if ((k.v.wheel ?? 0) >= 3) return;
      k.stack("wheel", 1, 3);
      k.proc("thiên luân");
    },
    onHitDealt(k, e) {
      const n = k.v.wheel ?? 0;
      if (n <= 0 || !e.skill?.attack) return;
      k.stack("wheel", -3, 3);
      const amount = pct(k.self.currentStats.defense, n * k.p.def);
      if (k.damage(e.target, amount) > 0) k.proc("xả thiên luân", e.target);
    },
    onOtherAction(k, e) {
      // 2v2: khống chế cứng mới trên đồng đội ngắn đi 1 lượt.
      const ally = k.ally;
      if (e.isAlly || !ally || e.target !== ally) return;
      for (const status of e.newStatuses) {
        if (!CONTROL_STATUSES.includes(status)) continue;
        const slot = KIT_STATUS[status];
        const inst = ally.statuses.get(slot.bank, slot.id);
        if (!inst) continue;
        if (inst.remainingTurns <= 1) k.remove(ally, status);
        else inst.remainingTurns--;
        k.proc("rút khống chế", ally);
      }
    },
  },

  // 276 Hỏa Diễm Hầu Vương
  276: {
    name: "Hỏa Lôi Song Côn",
    params: { mark: 7 },
    text: "Mỗi lần dùng chiêu tấn công khác hệ với chiêu trước (Hỏa, Lôi, Thổ), pet nhận 1 dấu Côn (tối đa 2, giữ 3 lượt): mỗi dấu +{mark}% sát thương. Hầu Vương Liệt Côn · Bạo tiêu dấu để lên 190 uy lực; tiêu đủ 2 dấu thì đòn chắc chắn gây Xé Rách 2 lượt.",
    beforeAction(k, e) {
      k.e.spent = 0;
      if (!e.skill?.attack) return;
      if (k.round > (k.e.markUntil ?? 0)) k.e.marks = 0;
      const prev = k.e.lastEl;
      const el = e.skill.element;
      if (prev !== undefined && prev !== el && [FIRE, ELECTRIC, EARTH].includes(el)) {
        k.e.marks = Math.min(2, (k.e.marks ?? 0) + 1);
        k.e.markUntil = k.round + 2;
        k.proc("dấu côn");
      }
      k.e.lastEl = el;
      if (e.skill.name === "Hầu Vương Liệt Côn · Bạo" && (k.e.marks ?? 0) > 0) {
        k.e.spent = k.e.marks;
        k.e.marks = 0;
      }
    },
    outgoing(k, e) {
      if (!e.skill?.attack) return;
      if ((k.e.spent ?? 0) > 0) {
        k.proc("liệt côn bạo", e.target);
        return BURST_BONUS;
      }
      const n = k.round <= (k.e.markUntil ?? 0) ? (k.e.marks ?? 0) : 0;
      if (n > 0) {
        k.proc("dấu côn +%", e.target);
        return n * k.p.mark;
      }
    },
    onHitDealt(k, e) {
      if ((k.e.spent ?? 0) < 2) return;
      k.e.spent = 0;
      if (k.inflict(e.target, "bleed", 2)) k.proc("xé rách", e.target);
    },
  },

  // 277 Thiên Viêm Hồ
  277: {
    name: "Thiên Viêm Tàn Ảnh",
    params: { dodge: 30, fire: 25 },
    text: "Khi pet ra đòn trước trong lượt, pet để lại Tàn Ảnh: đòn tấn công đầu tiên nhắm vào pet sau đó trong lượt có {dodge}% đánh vào ảnh và trượt. Mỗi lần Tàn Ảnh bị đánh tan, chiêu Hỏa kế tiếp của pet gây thêm {fire}% sát thương.",
    afterAction(k, e) {
      if (e.actedFirst) k.e.image = k.round;
    },
    incoming(k, e) {
      // Xấp xỉ "trượt": kit không hủy được đòn → giảm 80% (trần của kit).
      if (!e.direct || !e.skill?.attack || k.e.image !== k.round) return;
      k.e.image = 0;
      if (!k.chance(k.p.dodge, "tàn ảnh")) return;
      k.e.flame = 1;
      k.proc("tàn ảnh");
      return 80;
    },
    outgoing(k, e) {
      if (k.e.flame && isAttack(e.skill, FIRE)) {
        k.e.flame = 0;
        k.proc("tàn ảnh +%", e.target);
        return k.p.fire;
      }
    },
  },

  // 278 Tàn Nguyệt Long Ma (boss; cơ chế riêng ở engine/TanNguyetLongMa.ts chạy thêm)
  278: {
    name: "Huyết Nguyệt Thực Thiên",
    params: { shield: 140, bonus: 30, drain: 20, spread: 30 },
    text: "Lần đầu HP tụt từ trên 30% xuống 30% trở xuống mà chưa gục, Huyết Nguyệt mọc: pet nhận khiên {shield}% HP tối đa trong 3 lượt; khi còn khiên, chiêu tấn công gây thêm {bonus}% sát thương và hút {drain}% sát thương gây ra. Nếu khiên bị đánh vỡ trước khi hết hạn, Long Ma bị Thạch Hóa 1 lượt. Trong pha Huyết Nguyệt, mỗi đòn của Long Ma lan {spread}% sát thương sang đối thủ còn lại.",
    onDamaged(k, e) {
      shatterCheck(k);
      if (k.v.moon) return;
      const line = pct(k.self.maxHp(), 30);
      if (e.before <= line || e.after > line) return;
      k.v.moon = 1;
      k.v.moonUntil = k.round + 2;
      k.shield(k.self, k.p.shield, 3);
      k.proc("huyết nguyệt");
    },
    outgoing(k, e) {
      if (!e.skill?.attack || !moonUp(k)) return;
      k.proc("huyết nguyệt +%", e.target);
      return k.p.bonus;
    },
    onHitDealt(k, e) {
      if (!moonUp(k) || !e.skill?.attack) return;
      k.healAmount(k.self, pct(e.damage, k.p.drain));
      k.proc("hút huyết", e.target);
      const other = k.otherFoe(e.target);
      if (other && k.damage(other, pct(e.damage, k.p.spread)) > 0) k.proc("lan huyết", other);
    },
    onHitTaken(k) {
      shatterCheck(k);
    },
    roundEnd(k) {
      if (k.v.moon === 1 && k.round >= (k.v.moonUntil ?? 0)) k.v.moon = 2;
    },
  },

  // 279 Huyền Thiết Tán Cô
  279: {
    name: "Huyền Thiết Tán Ô",
    params: { guard: 25, reflect: 30, pivot: 25 },
    text: "Mỗi lượt, đòn trực tiếp đầu tiên nhắm vào pet bị ô thép đỡ {guard}% sát thương và {reflect}% phần đỡ được dội lại kẻ đánh. Khi pet rút bằng chiêu đổi pet, pet vào thay nhận khiên {pivot}% HP tối đa trong 2 lượt. Ô thép che cả đồng đội: đòn trực tiếp đầu tiên mỗi lượt nhắm vào bất kỳ pet nào phe mình đều bị đỡ và dội lại.",
    incoming(k, e) {
      if (e.direct) return umbrella(k, e.damage, true);
    },
    guardAlly(k, e) {
      // 2v2: ô dùng chung một lần mỗi lượt cho cả phe.
      const cut = umbrella(k, e.damage, false);
      if (cut) k.proc("ô thép đồng đội", e.target);
      return cut;
    },
    onHitTaken(k, e) {
      const back = umbrellaBack(k, true);
      if (back > 0) {
        k.proc("ô dội", e.source);
        return back;
      }
    },
    onAllyHitTaken(k, e) {
      const back = umbrellaBack(k, false);
      if (back > 0 && k.damage(e.source, back) > 0) k.proc("ô dội", e.source);
    },
    afterAction(k, e) {
      if (e.skill?.name.startsWith("Thiết Tán Hồi Chuyển")) k.v.pivot = k.round;
    },
    onLeave(k, e) {
      if (e.fainted || !e.next || k.v.pivot !== k.round) return;
      if (k.shield(e.next, k.p.pivot, 2)) k.proc("khiên ô thép", e.next);
    },
  },
};
