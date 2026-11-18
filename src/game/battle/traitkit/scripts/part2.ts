import type { DesignTraitUnit } from "../../DesignTraits";
import { BUFF_BANK, StatusInstance } from "../../StatusState";
import { KIT_STATUS, type Kit, type KitStatus, type TraitScript } from "../TraitKit";

/** Đối thủ pet đang theo dõi (để biết đối thủ vừa đổi/gục trong 1v1). */
const watchedFoe = new WeakMap<DesignTraitUnit, DesignTraitUnit>();
/** Ảnh chụp buff của mục tiêu trước hành động (74 cướp buff). */
const buffSnapshot = new WeakMap<DesignTraitUnit, Map<number, StatusInstance>>();
/** Vòng cuối của Hủ Thực trên từng pet, ghi lại vì trạng thái bị xóa ngay lúc gục. */
const corrosionUntil = new WeakMap<DesignTraitUnit, number>();

/** Ghi lại thời hạn Hủ Thực của các đối thủ (gọi sau mỗi hành động/đòn). */
function noteCorrosion(k: Kit): void {
  for (const foe of k.foes)
    if (k.has(foe, "corrosion"))
      corrosionUntil.set(foe, k.round + Math.max(1, remaining(foe, "corrosion")) - 1);
}

/** Số lượt Hủ Thực còn lại trên pet vừa gục (0 nếu không có). */
function corrosionLeftAtFaint(k: Kit, foe: DesignTraitUnit): number {
  const until = corrosionUntil.get(foe);
  return until === undefined || until < k.round ? 0 : until - k.round + 1;
}

function remaining(unit: DesignTraitUnit | undefined, status: KitStatus): number {
  if (!unit) return 0;
  const slot = KIT_STATUS[status];
  return unit.statuses.get(slot.bank, slot.id)?.remainingTurns ?? 0;
}

/** Hủ Thực do pet gây: có trạng thái và có dấu riêng `key`. */
function myCorrosion(k: Kit, unit: DesignTraitUnit | undefined, key: string): boolean {
  return k.has(unit, "corrosion") && k.marked(unit, key) > 0;
}

/** Gây Hủ Thực (nếu chưa có) và gắn dấu riêng để nhận ra "do pet gây". */
function corrode(k: Kit, target: DesignTraitUnit | undefined, turns: number, key: string): boolean {
  if (!target || k.has(target, "corrosion")) return false;
  if (!k.inflict(target, "corrosion", turns, { refresh: false })) return false;
  k.mark(target, key, turns + 1);
  return true;
}

/** 44: Hủ Thực nhảy sang `target` với thời hạn còn lại, kèm giảm Linh xảo. */
function jump44(k: Kit, target: DesignTraitUnit, turns: number): void {
  if (!corrode(k, target, turns, "kén")) return;
  k.statUp(target, "speed", -k.p.slow, turns, "kén44");
  k.proc("độc nhảy", target);
}

/** Theo dõi đối thủ 1v1: trả đối thủ mới nếu vừa đổi so với lần trước. */
function foeChanged(k: Kit): DesignTraitUnit | undefined {
  const now = k.foe;
  const old = watchedFoe.get(k.self);
  if (now) watchedFoe.set(k.self, now);
  return old && now && old !== now ? now : undefined;
}

/**
 * Dòng Tuyết: 1 tầng Băng lên `foe` (tối đa 3, 2 lượt), mỗi tầng giảm `p.slow`% Linh xảo. Đủ 3 tầng và
 * có `freeze`: thử Hóa Đá 1 lượt (mỗi đối thủ 3 lượt 1 lần) rồi xóa tầng.
 */
function frost(k: Kit, foe: DesignTraitUnit | undefined, freeze: boolean): void {
  if (!foe || !foe.alive() || !k.isFoe(foe)) return;
  const stacks = k.mark(foe, "băng", 2, 3);
  k.statUp(foe, "speed", -k.p.slow * stacks, 2, `băng${k.self.speciesId}`);
  k.proc("băng", foe);
  if (!freeze || stacks < 3 || k.marked(foe, "băng-cd") > 0) return;
  k.mark(foe, "băng-cd", 3);
  if (!k.chance(k.p.freeze ?? 100, "đông")) return;
  if (k.inflict(foe, "petrify", 1)) {
    k.mark(foe, "đông", 2);
    k.proc("đông cứng", foe);
  }
  k.unmark(foe, "băng");
  k.clearStat(foe, `băng${k.self.speciesId}`);
}

function frostScript(name: string, freeze = false): TraitScript {
  return {
    name,
    onHitDealt(k, e) {
      if (k.oncePerRound("băng-đánh")) frost(k, e.target, freeze);
    },
    onHitTaken(k, e) {
      if (k.oncePerRound("băng-nhận")) frost(k, e.source, freeze);
    },
  };
}

/** Hút máu bằng một nửa % HP đã mất, tối đa `cap`% (hoặc đúng `cap` khi `full`). */
function drainByMissing(k: Kit, damage: number, cap: number, full = false): void {
  const rate = full ? cap : Math.min(cap, (100 - k.hpPct()) / 2);
  const amount = Math.trunc((damage * rate) / 100);
  if (amount > 0 && k.healAmount(k.self, amount).healed > 0) k.proc("hút máu");
}

/** Dòng Thủy thủ: lượt lẻ kể từ khi ra sân là Triều Dâng, lượt chẵn là Triều Rút. */
function rising(k: Kit): boolean {
  return k.roundsOnField % 2 === 0;
}

function tideScript(name: string, extra: Partial<TraitScript> = {}): TraitScript {
  return {
    name,
    outgoing(k, e) {
      if (!rising(k) || !e.skill?.attack) return;
      k.proc("triều dâng");
      return k.p.surge;
    },
    incoming(k, e) {
      if (rising(k) || !e.direct) return;
      k.proc("triều rút");
      return k.p.ebb;
    },
    allyOutgoing(k, e) {
      if (!rising(k) || !e.skill?.attack || k.elementOf(e.source) !== 3) return;
      k.proc("đồng đội triều dâng", e.source);
      return Math.trunc(k.p.surge / 2);
    },
    guardAlly(k, e) {
      if (rising(k) || k.elementOf(e.target) !== 3) return;
      k.proc("đồng đội triều rút", e.target);
      return Math.trunc(k.p.ebb / 2);
    },
    roundEnd(k) {
      if (rising(k)) return;
      if (k.heal(k.self, k.p.regen).healed > 0) k.proc("triều hồi");
      const ally = k.ally;
      if (ally && k.elementOf(ally) === 3 && k.heal(ally, k.p.regen / 2).healed > 0)
        k.proc("đồng đội triều hồi", ally);
    },
    ...extra,
  };
}

/** Dòng Miêu điện: tích 1 tầng điện (mỗi lượt tối đa 1, tối đa 3). */
function chargeGain(k: Kit): void {
  if (!k.oncePerRound("tầng điện")) return;
  k.stack("điện", 1, 3);
  k.proc("tích điện");
}

function chargeScript(
  name: string,
  discharge: (k: Kit, target: DesignTraitUnit, damage: number) => void,
): TraitScript {
  return {
    name,
    outgoing(k, e) {
      if (!e.skill?.attack || e.skill.element !== 4) return;
      const stacks = k.v["điện"] ?? 0;
      k.e.xả = stacks >= 3 ? 1 : 0;
      if (stacks <= 0) return;
      k.proc("điện +sát thương");
      return stacks * k.p.perStack;
    },
    onHitDealt(k, e) {
      if (k.e.xả === 1 && e.skill?.element === 4) {
        k.e.xả = 0;
        k.stack("điện", -3, 3);
        k.proc("xả điện", e.target);
        discharge(k, e.target, e.damage);
        return;
      }
      chargeGain(k);
    },
    onHitTaken(k) {
      chargeGain(k);
    },
    onAllyHitTaken(k, e) {
      if (e.skill?.element === 4) chargeGain(k);
    },
  };
}

/** Kịch bản đặc tính, phần 2. */
export const PART_2: Record<number, TraitScript> = {
  // 40 Hắc châm bão xạ
  40: {
    name: "Hắc châm bão xạ",
    onHitDealt(k, e) {
      // Chiêu tấn công kế tiếp bắn hết Kim: mỗi Kim +4% HP tối đa mục tiêu.
      const kim = k.v.kim ?? 0;
      if (kim > 0 && e.skill?.attack) {
        k.stack("kim", -3, 3);
        k.damage(e.target, k.pctOf(e.target, k.p.perKim * kim));
        k.proc("bắn kim", e.target);
        if (kim >= 3) {
          if (k.inflict(e.target, "bleed", 2)) k.proc("xé rách", e.target);
          // 2v2: Kim lạc găm đối thủ còn lại 2% HP tối đa của nó.
          const other = k.otherFoe(e.target);
          if (other && k.damage(other, k.pctOf(other, k.p.stray)) > 0) k.proc("kim lạc", other);
        }
      }
      if (k.oncePerRound("kim")) {
        k.stack("kim", 1, 3);
        k.proc("nhận kim");
      }
    },
    onHitTaken(k) {
      if (k.oncePerRound("kim")) {
        k.stack("kim", 1, 3);
        k.proc("nhận kim");
      }
    },
  },

  // 41 Thi khí hút sinh
  41: {
    name: "Thi khí hút sinh",
    afterAction(k, e) {
      if (e.skill?.attack && e.hit && e.damage > 0) drainByMissing(k, e.damage, k.p.drainCap);
    },
  },

  // 42 Thi long bất diệt
  42: {
    name: "Thi long bất diệt",
    afterAction(k, e) {
      if (e.skill?.attack && e.hit && e.damage > 0)
        drainByMissing(k, e.damage, k.p.drainCap, k.round <= (k.v.fullDrain ?? -1));
    },
    onDamaged(k, e) {
      // Lần đầu HP tụt xuống 30% trở xuống mà chưa gục: khiên 30% HP tối đa 2 lượt.
      if (k.v.lastStand || e.after <= 0) return;
      if ((e.after * 100) / k.self.maxHp() > 30) return;
      k.v.lastStand = 1;
      if (k.shield(k.self, k.p.shield, 2)) k.proc("khiên bất diệt");
    },
    onAllyFaint(k, e) {
      // 2v2: đồng đội gục → hút ở mức tối đa 25% trong 2 lượt.
      k.v.fullDrain = k.round + 1;
      k.proc("cuồng hút", e.ally);
    },
  },

  // 43 Tơ độc dính chân
  43: {
    name: "Tơ độc dính chân",
    onHitDealt(k, e) {
      if (!e.skill?.attack || k.has(e.target, "corrosion") || !k.chance(k.p.chance, "tơ")) return;
      if (!corrode(k, e.target, 3, "tơ")) return;
      k.statUp(e.target, "speed", -k.p.slow, 3, "tơ43");
      k.proc("hủ thực", e.target);
      k.proc("tơ chậm", e.target);
    },
    roundEnd(k) {
      for (const foe of k.foes) if (!myCorrosion(k, foe, "tơ")) k.clearStat(foe, "tơ43");
    },
  },

  // 44 Lưới kén truyền độc
  44: {
    name: "Lưới kén truyền độc",
    onEnter(k) {
      if (k.foe) watchedFoe.set(k.self, k.foe);
    },
    onOtherAction(k) {
      noteCorrosion(k);
    },
    onHitDealt(k, e) {
      // Chiêu tấn công trúng: chance% gây Hủ Thực 2 lượt nếu mục tiêu chưa có.
      if (!e.skill?.attack || k.has(e.target, "corrosion") || !k.chance(k.p.chance, "kén")) return;
      if (corrode(k, e.target, 2, "kén")) k.proc("rải độc", e.target);
    },
    outgoing(k, e) {
      if (!e.skill?.attack || !myCorrosion(k, e.target, "kén")) return;
      k.proc("độc +sát thương", e.target);
      return k.p.bonus;
    },
    afterAction(k, e) {
      noteCorrosion(k);
      // Hủ Thực do pet gây (đặc tính hoặc chiêu của pet) → mục tiêu giảm slow% Linh xảo.
      if (!e.target || !e.newStatuses.includes("corrosion")) return;
      const turns = Math.max(1, remaining(e.target, "corrosion"));
      k.mark(e.target, "kén", turns + 1);
      k.statUp(e.target, "speed", -k.p.slow, turns, "kén44");
      k.proc("kén chậm", e.target);
    },
    onFoeFaint(k, e) {
      // Mục tiêu bị Hủ Thực gục: độc nhảy sang đối thủ còn lại (1v1: pet thay vào).
      const left = corrosionLeftAtFaint(k, e.foe);
      if (left <= 0 || k.marked(e.foe, "kén") <= 0) return;
      const other = k.otherFoe(e.foe);
      if (other) {
        jump44(k, other, left);
      } else k.v.carry = left;
    },
    beforeAction(k) {
      // 1v1: đối thủ gục/bị đổi ra → pet thay vào nhận phần Hủ Thực còn lại.
      const fresh = foeChanged(k);
      if (fresh && (k.v.carry ?? 0) > 0) jump44(k, fresh, k.v.carry);
      if (fresh) k.v.carry = 0;
    },
    roundEnd(k) {
      const fresh = foeChanged(k);
      if (fresh && (k.v.carry ?? 0) > 0) jump44(k, fresh, k.v.carry);
      if (fresh) k.v.carry = 0;
      for (const foe of k.foes) if (!myCorrosion(k, foe, "kén")) k.clearStat(foe, "kén44");
      const foe = k.foe;
      if (!k.twoVsTwo && foe && myCorrosion(k, foe, "kén"))
        k.v.carry = Math.max(1, remaining(foe, "corrosion") - 1);
    },
  },

  // 45 Lấy đà khủng giác
  45: {
    name: "Lấy đà khủng giác",
    onHitDealt(k) {
      if (!k.oncePerRound("đà")) return;
      k.stack("đà", 1, 3, true);
      k.proc("tích đà");
    },
    outgoing(k, e) {
      const da = k.e["đà"] ?? 0;
      if (!e.skill?.attack || da <= 0) return;
      k.proc("đà +sát thương");
      return k.p.dmg * da;
    },
    statBonus(k, stat) {
      if (stat === "defense") return k.p.def * (k.e["đà"] ?? 0);
    },
    afterAction(k) {
      k.e.acted = k.round;
    },
    roundEnd(k) {
      // Mất lượt vì khống chế → mất hết Đà.
      if (k.e.acted !== k.round && k.controlled(k.self) && (k.e["đà"] ?? 0) > 0) {
        k.stack("đà", -3, 3, true);
        k.proc("mất đà");
      }
    },
  },

  // 46 Khủng giác xuyên trận
  46: {
    name: "Khủng giác xuyên trận",
    onHitDealt(k, e) {
      const da = k.e["đà"] ?? 0;
      if (e.skill?.name.startsWith("Khủng Giác Nghiền Giáp") && da > 0) {
        k.stack("đà", -3, 3, true);
        k.proc("tiêu đà", e.target);
        if (da >= 3) {
          if (k.dispel(e.target, 1) > 0) k.proc("gỡ phòng ngự", e.target);
          // 2v2: húc xuyên, đối thủ còn lại nhận 30% sát thương của đòn.
          const other = k.otherFoe(e.target);
          if (other && k.damage(other, Math.trunc((e.damage * k.p.splash) / 100)) > 0)
            k.proc("húc xuyên", other);
        }
        return;
      }
      if (!k.oncePerRound("đà")) return;
      k.stack("đà", 1, 3, true);
      k.proc("tích đà");
    },
    outgoing(k, e) {
      const da = k.e["đà"] ?? 0;
      if (!e.skill?.attack || da <= 0) return;
      k.proc("đà +sát thương");
      // Chiêu độc quyền có Đà: Power 155 → 190 (≈ +23%).
      const signature = e.skill.name.startsWith("Khủng Giác Nghiền Giáp") ? k.p.sigBonus : 0;
      return k.p.dmg * da + signature;
    },
    statBonus(k, stat) {
      if (stat === "defense") return k.p.def * (k.e["đà"] ?? 0);
    },
  },

  // 47 Chiến thần tích ý
  47: {
    name: "Chiến thần tích ý",
    incoming(k, e) {
      // Đòn đầu tiên mỗi lượt giảm 30%; lượng đã chặn tích thành Chiến Ý (tối đa 30% HP tối đa).
      if (!e.direct || k.hitsTakenThisRound > 0) return;
      const cap = k.pctOf(k.self, k.p.cap);
      k.v.y = Math.min(cap, (k.v.y ?? 0) + Math.trunc((e.damage * k.p.block) / 100));
      k.proc("chặn đòn");
      return k.p.block;
    },
    onHitDealt(k, e) {
      const y = k.v.y ?? 0;
      if (!e.skill?.attack || y <= 0) return;
      k.v.y = 0;
      if (k.damage(e.target, y) > 0) k.proc("chiến ý", e.target);
    },
    redirect(k) {
      // 2v2 khiêu khích: lượt đầu sau khi ra sân, đòn đơn mục tiêu của đối thủ buộc nhắm vào pet.
      if (k.roundsOnField !== 0) return;
      k.proc("khiêu khích");
      return true;
    },
  },

  // 48 Hơi lạnh tuyết cầu
  48: frostScript("Hơi lạnh tuyết cầu"),

  // 49 Thân tuyết đông kết
  49: frostScript("Thân tuyết đông kết", true),

  // 50 Cự linh băng phong
  50: {
    ...frostScript("Cự linh băng phong", true),
    outgoing(k, e) {
      if (!e.skill?.attack || !k.has(e.target, "petrify")) return;
      k.proc("đánh hóa đá");
      return k.p.bonus;
    },
    allyOutgoing(k, e) {
      if (!k.has(e.target, "petrify") || k.marked(e.target, "đông") <= 0) return;
      k.proc("đồng đội đánh hóa đá", e.source);
      return k.p.ally;
    },
  },

  // 51 Con nước thủy thủ
  51: tideScript("Con nước thủy thủ"),

  // 52 Bá tước triều cường
  52: tideScript("Bá tước triều cường", {
    afterAction(k, e) {
      // Chiêu giảm sát thương đối thủ dùng trong Triều Rút kéo dài thêm 1 lượt.
      if (rising(k) || !e.target || !e.newStatuses.includes("damage_down")) return;
      const slot = KIT_STATUS.damage_down;
      const status = e.target.statuses.get(slot.bank, slot.id);
      if (!status) return;
      status.remainingTurns += 1;
      k.proc("triều kéo dài", e.target);
    },
  }),

  // 53 Võ thần hải triều
  53: tideScript("Võ thần hải triều", {
    onHitDealt(k, e) {
      // Triều Dâng: đòn trúng giảm 10% sát thương mục tiêu 2 lượt.
      if (!rising(k) || !e.skill?.attack) return;
      if (k.inflict(e.target, "damage_down", 2, { value: k.p.weaken }))
        k.proc("triều áp", e.target);
    },
  }),

  // 54 Gió đầu triều
  54: {
    name: "Gió đầu triều",
    priority(k) {
      if (k.roundsOnField !== 0) return;
      k.proc("ưu tiên");
      return true;
    },
    onHitDealt(k, e) {
      if (!k.self.designTraitState.actedFirst) return;
      if (k.inflict(e.target, "damage_down", 1, { value: k.p.weaken })) k.proc("gió nén", e.target);
    },
    afterAction(k, e) {
      // Lượt đi trước: đồng đội (1v1: chính pet) nhận khiên 10% trong 1 lượt (2 lượt 1 lần).
      if (!e.actedFirst || !k.ready("trinh sát", 2)) return;
      k.use("trinh sát");
      if (k.shield(k.allyOrSelf, k.p.shield, 1)) k.proc("khiên trinh sát", k.allyOrSelf);
    },
  },

  // 55 Đại khẩu nuốt chửng
  55: {
    name: "Đại khẩu nuốt chửng",
    beforeAction(k, e) {
      k.e.low = e.target && k.isFoe(e.target) && k.hpPct(e.target) < 40 ? 1 : 0;
    },
    afterAction(k, e) {
      if (k.e.low !== 1 || !e.hit || e.damage <= 0) return;
      if (k.healAmount(k.self, Math.trunc((e.damage * k.p.lifesteal) / 100)).healed > 0)
        k.proc("hút máu");
    },
    onFoeFaint(k, e) {
      if (!e.byMe) return;
      k.heal(k.self, k.p.heal);
      k.statUp(k.self, "defense", k.p.def, 2, "nuốt");
      k.proc("nuốt chửng", e.foe);
    },
  },

  // 56 Mực đen ám hải
  56: {
    name: "Mực đen ám hải",
    onHitTaken(k, e) {
      if (k.hitsTakenThisRound !== 1) return;
      if (k.inflict(e.source, "accuracy_down", 2, { value: k.p.acc, refresh: false }))
        k.proc("phun mực", e.source);
      // 2v2: mực lên cả đối thủ không đánh pet, chỉ −10%.
      const other = k.otherFoe(e.source);
      if (other && k.inflict(other, "accuracy_down", 2, { value: k.p.accOther, refresh: false }))
        k.proc("mực lan", other);
    },
    incoming(k, e) {
      if (!e.direct || !k.has(e.source, "accuracy_down")) return;
      k.proc("mực che");
      return k.p.reduce;
    },
    guardAlly(k, e) {
      if (!k.has(e.source, "accuracy_down")) return;
      k.proc("mực che đồng đội", e.target);
      return k.p.guard;
    },
  },

  // 57 Đèn dụ lạc lối
  57: {
    name: "Đèn dụ lạc lối",
    afterAction(k, e) {
      // Chiêu hồi máu (hỗ trợ phe mình): 40% Mị Hoặc 2 lượt lên đối thủ.
      if (!e.skill?.support || !e.skill.ownSide) return;
      const foe = k.foe;
      if (foe && k.chance(k.p.charm, "dụ") && k.inflict(foe, "charm", 2)) k.proc("mị hoặc", foe);
    },
    incoming(k, e) {
      // Đối thủ Mị Hoặc có 30% đánh nhầm: 1v1 tự đánh mình 30% sức chiêu, 2v2 sang đồng đội nó.
      if (!e.direct || !k.has(e.source, "charm") || !k.chance(k.p.misfire, "nhầm")) return;
      const mate = k.otherFoe(e.source);
      if (mate) {
        k.damage(mate, e.damage);
        k.proc("đánh nhầm đồng đội", mate);
      } else {
        k.damage(e.source, Math.trunc((e.damage * k.p.selfPower) / 100));
        k.proc("tự đánh", e.source);
      }
      return 100;
    },
  },

  // 58 Phiêu thủy tiếp sức
  58: {
    name: "Phiêu thủy tiếp sức",
    healOut(k, e) {
      // Hồi máu cho mục tiêu: xóa 1 hiệu ứng xấu, đòn tấn công kế tiếp của nó +20%.
      if (k.cleanse(e.target, 1) > 0) k.proc("tiếp sức giải", e.target);
      k.mark(e.target, "tiếp sức", 4);
      k.proc("tiếp sức", e.target);
      return 0;
    },
    outgoing(k, e) {
      if (!e.skill?.attack || k.marked(k.self, "tiếp sức") <= 0) return;
      k.unmark(k.self, "tiếp sức");
      k.proc("đòn tiếp sức");
      return k.p.bonus;
    },
    allyOutgoing(k, e) {
      if (!e.skill?.attack || k.marked(e.source, "tiếp sức") <= 0) return;
      k.unmark(e.source, "tiếp sức");
      k.proc("đồng đội đòn tiếp sức", e.source);
      return k.p.bonus;
    },
    afterAction(k, e) {
      // Ghi lượt pet dùng Phiêu Thủy Tiếp Sức để biết lần rời sân kế tiếp là nhờ chiêu này.
      if (e.skill?.name.startsWith("Phiêu Thủy Tiếp Sức")) k.v.relay = k.round;
    },
    onLeave(k, e) {
      // Pet được đổi vào bằng Phiêu Thủy Tiếp Sức nhận khiên 20% HP tối đa trong 2 lượt.
      if (e.fainted || !e.next || k.v.relay !== k.round) return;
      if (k.shield(e.next, k.p.shield, 2)) k.proc("khiên tiếp sức", e.next);
    },
  },

  // 59 Gai độc hải mã
  59: {
    name: "Gai độc hải mã",
    onHitTaken(k, e) {
      // Kẻ tấn công bị Hủ Thực 3 lượt (mỗi đối thủ 2 lượt 1 lần, không làm mới).
      if (k.marked(e.source, "gai-cd") > 0) return;
      if (!corrode(k, e.source, 3, "gai")) return;
      k.mark(e.source, "gai-cd", 2);
      k.proc("gai độc", e.source);
    },
    incoming(k, e) {
      if (!e.direct || !myCorrosion(k, e.source, "gai")) return;
      k.proc("độc yếu");
      return k.p.reduce;
    },
  },

  // 60 Mũi kiếm xuyên khiên
  60: {
    name: "Mũi kiếm xuyên khiên",
    pierce(k, e) {
      if (!e.skill?.attack) return;
      k.proc("xuyên giáp");
      return k.p.pierce;
    },
    ...shieldPiercer(),
  },

  // 61 Cốt kiếm đoạt giáp
  61: {
    name: "Cốt kiếm đoạt giáp",
    ...shieldPiercer(),
    pierce(k, e) {
      if (!e.skill?.attack) return;
      k.proc("xuyên giáp");
      return k.p.pierce;
    },
    beforeAction(k, e) {
      piercerBefore(k, e.target);
      // Đòn của pet lên mục tiêu có buff: gỡ 1 buff (2 lượt 1 lần) → +bonus% sát thương 2 lượt
      // (lượt này và lượt sau); 2v2 đồng đội +10%.
      const target = e.target;
      if (!e.skill?.attack || !target || !k.isFoe(target) || k.buffs(target) <= 0) return;
      if (!k.ready("đoạt giáp", 2) || k.dispel(target, 1) <= 0) return;
      k.use("đoạt giáp");
      k.v.boost = k.round + 1;
      k.proc("đoạt giáp", target);
    },
    outgoing(k, e) {
      k.e.raw = e.damage;
      if (!e.skill?.attack || k.round > (k.v.boost ?? -1)) return;
      k.proc("đoạt giáp +sát thương");
      return k.p.bonus;
    },
    allyOutgoing(k, e) {
      if (!e.skill?.attack || k.round > (k.v.boost ?? -1)) return;
      k.proc("đồng đội đoạt giáp", e.source);
      return ALLY_BOOST_61;
    },
  },

  // 62 Lân vàng phản quang
  62: {
    name: "Lân vàng phản quang",
    healIn(k, e) {
      // Pet được hồi máu: đối thủ đang đối mặt mất HP bằng `reflect`% lượng hồi (3 lượt 1 lần, chung).
      const foe = k.foe;
      const amount = Math.trunc((e.amount * k.p.reflect) / 100);
      if (!foe || amount <= 0 || !k.ready("phản quang", 3)) return;
      if (k.damage(foe, amount) <= 0) return;
      k.use("phản quang");
      k.proc("phản quang", foe);
    },
    healOut(k, e) {
      // Hồi cho đồng đội → đánh đối thủ HP cao nhất `reflect`% lượng hồi (chung hồi chiêu).
      if (e.target === k.self) return;
      const foe = [...k.foes].sort((a, b) => b.hp() - a.hp())[0];
      const amount = Math.trunc((e.amount * k.p.reflect) / 100);
      if (!foe || amount <= 0 || !k.ready("phản quang", 3)) return;
      if (k.damage(foe, amount) <= 0) return;
      k.use("phản quang");
      k.proc("phản quang đồng đội", foe);
    },
    beforeAction(k, e) {
      k.e.healRound = e.skill?.support && e.skill.ownSide ? k.round : -1;
    },
    incoming(k, e) {
      if (!e.direct || k.e.healRound !== k.round) return;
      k.proc("lân che");
      return k.p.reduce;
    },
  },

  // 63 Thần giáp càng kẹp
  63: {
    name: "Thần giáp càng kẹp",
    onEnter(k) {
      // Giáp Thần: khiên 50% HP tối đa, không tự hết hạn (xấp xỉ 99 lượt).
      if (k.shield(k.self, k.p.armor, 99)) {
        k.e.armor = 1;
        k.proc("giáp thần");
      }
    },
    onHitTaken(k, e) {
      if (k.e.armor === 1 && k.shieldHp() <= 0) {
        k.e.armor = 0;
        k.e.broken = 1;
        k.inflict(e.source, "bind", 2);
        k.inflict(e.source, "petrify", 1);
        k.proc("giáp vỡ", e.source);
        return;
      }
      if (k.e.broken === 1 && e.damage > 0 && k.tryUse("vỏ", 2)) {
        if (k.shield(k.self, k.p.shell, 2)) k.proc("vỏ mới");
      }
      // 1v1 (không có đồng đội): áp phần kẹp lên chính pet.
      if (!k.ally) pinch(k, e.source, e.target, e.damage);
    },
    onAllyHitTaken(k, e) {
      pinch(k, e.source, e.target, e.damage);
    },
  },

  // 64 Hầu vương xoay côn
  64: {
    name: "Hầu vương xoay côn",
    outgoing(k, e) {
      if (!e.skill?.attack) return;
      const last = k.v.lastEl;
      if (last === undefined || last === e.skill.element) return;
      k.statUp(k.self, "speed", k.p.speed, 2, "xoay côn");
      k.proc("xoay côn");
      return k.p.bonus;
    },
    afterAction(k, e) {
      if (e.skill?.attack) k.v.lastEl = e.skill.element;
    },
  },

  // 65 Tĩnh điện mây
  65: chargeScript("Tĩnh điện mây", (k, target) => {
    if (k.chance(k.p.para, "tê") && k.inflict(target, "paralysis", 1)) k.proc("tê liệt", target);
  }),

  // 66 Điện nhãn khóa mục
  66: chargeScript("Điện nhãn khóa mục", (k, target) => {
    if (k.marked(target, "tê-cd") > 0) return;
    if (k.inflict(target, "paralysis", 1)) {
      k.mark(target, "tê-cd", 3);
      k.proc("tê liệt", target);
    }
  }),

  // 67 Thân sĩ lôi phán
  67: chargeScript("Thân sĩ lôi phán", (k, target, damage) => {
    if (k.dispel(target, 1) > 0) k.proc("gỡ buff", target);
    if (k.chance(k.p.para, "tê") && k.inflict(target, "paralysis", 1)) k.proc("tê liệt", target);
    // 2v2: cú xả nảy sang đối thủ còn lại 30% sát thương.
    const other = k.otherFoe(target);
    if (other && k.damage(other, Math.trunc((damage * k.p.bounce) / 100)) > 0)
      k.proc("sét nảy", other);
  }),

  // 68 Đuổi kịp tia chớp
  68: {
    name: "Đuổi kịp tia chớp",
    beforeAction(k, e) {
      if (e.actedFirst) return;
      // Bị ra đòn trước: Linh xảo +25% trong 2 lượt, tối đa 2 tầng.
      if (k.round > (k.v.until ?? -1)) k.v.tiers = 0;
      k.v.tiers = Math.min(2, (k.v.tiers ?? 0) + 1);
      k.v.until = k.round + 1;
      k.statUp(k.self, "speed", k.p.speed * k.v.tiers, 2, "đuổi");
      k.proc("đuổi kịp");
    },
    outgoing(k, e) {
      if (e.actedFirst || !e.skill?.attack) return;
      k.proc("đuổi +sát thương");
      return k.p.bonus;
    },
  },

  // 69 Thiểm điện song kích
  69: {
    name: "Thiểm điện song kích",
    onHitDealt(k, e) {
      if (!k.self.designTraitState.actedFirst || !e.skill?.attack) return;
      if (!k.oncePerRound("tia phụ")) return;
      // Tia chớp phụ 30% uy lực (xấp xỉ 30% sát thương đòn); 2v2 đánh đối thủ còn lại.
      const target = k.otherFoe(e.target) ?? e.target;
      if (k.damage(target, Math.trunc((e.damage * k.p.power) / 100)) > 0)
        k.proc("tia chớp phụ", target);
    },
    beforeAction(k, e) {
      if (e.actedFirst) return;
      k.statUp(k.self, "speed", k.p.speed, 2, "thiểm");
      k.proc("tăng tốc");
    },
  },

  // 70 Song phong dẫn lôi
  70: switcher("Song phong dẫn lôi", "Quỷ Long Lôi Vực · Thủ", (k, target, skill) => {
    // Xấp xỉ "+15% tỉ lệ Tê Liệt/Giam Cầm": thêm 15% gây Tê Liệt (Lôi) / Giam Cầm (Phong) 1 lượt.
    if (!k.chance(k.p.ctrl, "dẫn lôi")) return;
    const status: KitStatus | undefined =
      skill.element === 4 ? "paralysis" : skill.element === 6 ? "bind" : undefined;
    if (status && k.inflict(target, status, 1)) k.proc("dẫn lôi khống chế", target);
  }),

  // 71 Quỷ lôi song vực
  71: switcher("Quỷ lôi song vực", "Quỷ Long Lôi Vực · Thực", (k, target, skill, prev) => {
    const pair = (skill.element === 4 && prev === 5) || (skill.element === 5 && prev === 4);
    const signature = skill.name.startsWith("Quỷ Long Lôi Vực · Thực");
    if (!(pair || signature) || !k.has(target, "corrosion") || !k.chance(k.p.para, "song vực"))
      return;
    if (k.inflict(target, "paralysis", 1)) k.proc("song vực tê liệt", target);
  }),

  // 72 Tĩnh điện đoản mạch
  72: {
    name: "Tĩnh điện đoản mạch",
    outgoing(k, e) {
      if (!e.skill?.attack || e.skill.element !== 4) return;
      const short = k.hpPct() < 50;
      k.proc(short ? "đoản mạch" : "tĩnh điện");
      return short ? k.p.shortBonus : k.p.bonus;
    },
    onHitDealt(k, e) {
      if (e.skill?.element !== 4 || !k.oncePerRound("trả máu")) return;
      if (k.payHp(k.p.cost) > 0) k.proc("trả máu");
    },
    statBonus(k, stat) {
      if (stat === "speed" && k.hpPct() < 50) return k.p.speed;
    },
  },

  // 73 Lôi thử hoàn điện
  73: {
    name: "Lôi thử hoàn điện",
    outgoing(k, e) {
      if (!e.skill?.attack || e.skill.element !== 4) return;
      k.proc("lôi thử");
      return k.p.bonus;
    },
    onHitDealt(k, e) {
      if (e.skill?.element !== 4 || !k.oncePerRound("trả máu")) return;
      const paid = k.payHp(k.p.cost);
      k.v.paid = (k.v.paid ?? 0) + paid;
      if (paid > 0) k.proc("trả máu");
    },
    afterAction(k, e) {
      // Xấp xỉ: chiêu · Bạo tự trả 6% HP tối đa, cũng được tích.
      if (e.skill?.name.startsWith("Lôi Thử Quá Tải · Bạo"))
        k.v.paid = (k.v.paid ?? 0) + k.pctOf(k.self, k.p.sigCost);
      checkRefund(k);
    },
    onDamaged(k) {
      checkRefund(k);
    },
  },

  // 74 Hiệp đạo đoạt lôi
  74: {
    name: "Hiệp đạo đoạt lôi",
    beforeAction(k, e) {
      const target = e.target;
      if (!target || !k.isFoe(target)) {
        buffSnapshot.delete(k.self);
        return;
      }
      const snap = new Map<number, StatusInstance>();
      for (const id of target.activeStatusIds(BUFF_BANK)) {
        const status = target.statuses.get(BUFF_BANK, id);
        if (status) snap.set(id, status);
      }
      buffSnapshot.set(k.self, snap);
    },
    afterAction(k, e) {
      // Gỡ được buff đối thủ → cướp buff đó 2 lượt (mỗi lượt 1 lần; 2v2: trao cho đồng đội).
      const snap = buffSnapshot.get(k.self);
      buffSnapshot.delete(k.self);
      if (!snap || !e.target || e.dispelled <= 0) return;
      for (const [id, old] of snap) {
        if (e.target.statuses.has(BUFF_BANK, id)) continue;
        if (!k.oncePerRound("cướp")) return;
        const taker = k.allyOrSelf;
        taker.statuses.put(
          new StatusInstance(
            old.definition,
            2,
            old.remainingActions,
            old.primaryValue,
            old.secondaryValue,
            old.stackCount,
            taker.ownerSide,
            taker.formationSlot,
            old.sourceSkillId,
            old.flags,
          ),
        );
        taker.restoreSourceStatusState();
        k.proc("cướp buff", taker);
        return;
      }
    },
    outgoing(k, e) {
      if (!e.actedFirst || !e.skill?.attack) return;
      k.proc("hiệp đạo đi trước");
      return k.p.bonus;
    },
  },

  // 75 Kỳ lân thiên phạt
  75: {
    name: "Kỳ lân thiên phạt",
    outgoing(k, e) {
      if (!e.skill?.attack || e.skill.element !== 4) return;
      const marks = thunderMarks(k);
      if (marks <= 0) return;
      k.proc("thiên lôi +sát thương");
      return k.p.perMark * marks;
    },
    onHitDealt(k, e) {
      if (e.skill?.element !== 4) return;
      const signature = !!e.skill.name.startsWith("Kỳ Lân Thiên Phạt · Bạo");
      const marks = Math.min(3, thunderMarks(k) + 1);
      k.v.tl = marks;
      k.v.tlUntil = k.round + 2;
      k.proc("dấu thiên lôi");
      if (marks < 3 && !signature) return;
      k.v.tl = 0;
      k.proc("giáng sét");
      for (const foe of k.foes) {
        k.damage(foe, k.pctOf(foe, k.p.strike));
        k.proc("sét thiên phạt", foe);
        if (k.chance(k.p.para, "thiên phạt") && k.inflict(foe, "paralysis", 1))
          k.proc("tê liệt", foe);
      }
    },
  },

  // 76 Bào tử ăn mòn
  76: {
    name: "Bào tử ăn mòn",
    onHitDealt(k, e) {
      if (!e.skill?.attack || k.e.spore === 1) return;
      k.e.spore = 1;
      if (corrode(k, e.target, 3, "bào tử")) k.proc("hủ thực", e.target);
    },
    incoming(k, e) {
      if (!e.direct || !myCorrosion(k, e.source, "bào tử")) return;
      k.proc("bào tử yếu");
      return k.p.reduce;
    },
    guardAlly(k, e) {
      if (!myCorrosion(k, e.source, "bào tử")) return;
      k.proc("bào tử che đồng đội", e.target);
      return k.p.reduce;
    },
  },

  // 77 Độc dịch lan tràn
  77: {
    name: "Độc dịch lan tràn",
    onHitDealt(k, e) {
      const el = e.skill?.element;
      if (!e.skill?.attack || (el !== 5 && el !== 1) || !k.chance(k.p.chance, "dịch")) return;
      if (corrode(k, e.target, 3, "dịch")) k.proc("hủ thực", e.target);
    },
    onDotTick(k, e) {
      if (e.status !== "corrosion" || e.damage <= 0) return;
      if (
        k.oncePerRound("hút độc") &&
        k.healAmount(k.self, Math.trunc((e.damage * k.p.leech) / 100)).healed > 0
      )
        k.proc("hút độc");
      // 2v2: tick bắn sang đối thủ kia 3% HP tối đa.
      const other = k.otherFoe(e.target);
      if (other && k.damage(other, k.pctOf(other, k.p.splash)) > 0) k.proc("độc bắn", other);
    },
  },

  // 78 Dịch vương mục cốt
  78: {
    name: "Dịch vương mục cốt",
    onEnter(k) {
      if (k.foe) watchedFoe.set(k.self, k.foe);
    },
    beforeAction(k, e) {
      k.e.wasCorroded = k.has(e.target, "corrosion") && k.isFoe(e.target) ? 1 : 0;
      plagueSwitch(k);
    },
    pierce(k, e) {
      if (!k.has(e.target, "corrosion")) return;
      k.proc("mục cốt");
      return k.p.pierce;
    },
    onHitDealt(k, e) {
      if (e.skill?.attack && corrode(k, e.target, 3, "dịch vương")) k.proc("hủ thực", e.target);
    },
    onOtherAction(k) {
      noteCorrosion(k);
    },
    afterAction(k, e) {
      noteCorrosion(k);
      if (k.e.wasCorroded !== 1 || !e.hit || e.damage <= 0) return;
      if (k.healAmount(k.self, Math.trunc((e.damage * k.p.lifesteal) / 100)).healed > 0)
        k.proc("hút máu");
    },
    onFoeFaint(k, e) {
      // Mục tiêu bị Hủ Thực gục: Hủ Thực chuyển sang đối thủ còn lại.
      const left = corrosionLeftAtFaint(k, e.foe);
      if (left <= 0) return;
      const other = k.otherFoe(e.foe);
      if (other && corrode(k, other, left, "dịch vương")) k.proc("dịch lây", other);
    },
    roundEnd(k) {
      plagueSwitch(k);
    },
  },

  // 79 Ác nhãn dò xét
  79: {
    name: "Ác nhãn dò xét",
    onHitTaken(k, e) {
      if (k.e.eye === 1) return;
      k.e.eye = 1;
      k.mark(e.source, "mắt ác", 2);
      k.proc("mắt ác", e.source);
    },
    incoming(k, e) {
      if (!e.direct || k.marked(e.source, "mắt ác") <= 0) return;
      k.proc("mắt ác giảm");
      return k.p.reduce;
    },
    guardAlly(k, e) {
      if (k.marked(e.source, "mắt ác") <= 0) return;
      k.proc("mắt ác che đồng đội", e.target);
      return k.p.reduce;
    },
    outgoing(k, e) {
      if (!e.skill?.attack || k.marked(e.target, "mắt ác") <= 0) return;
      k.proc("đánh mắt ác");
      return k.p.bonus;
    },
  },
};

/** Số chỉnh được (`k.p`) và mô tả mẫu của từng pet; gắn vào kịch bản ngay bên dưới. */
const META: Record<number, Pick<TraitScript, "params" | "text" | "text2v2">> = {
  40: {
    params: { perKim: 4, stray: 2 },
    text: "Mỗi lượt bị đánh trúng hoặc đánh trúng, pet nhận 1 Kim (tối đa 3, mỗi lượt tối đa 1). Chiêu tấn công kế tiếp bắn hết Kim: mỗi Kim +{perKim}% HP tối đa mục tiêu; bắn đủ 3 Kim thì gây thêm Xé Rách 2 lượt. Khi bắn đủ 3 Kim, một Kim lạc găm vào đối thủ còn lại ({stray}% HP tối đa của nó).",
  },
  41: {
    params: { drainCap: 20 },
    text: "Chiêu tấn công hút máu bằng một nửa phần trăm HP pet đã mất (ví dụ mất 40% HP thì hút 20% sát thương), tối đa {drainCap}%.",
  },
  42: {
    params: { drainCap: 25, shield: 30 },
    text: "Chiêu tấn công hút máu bằng một nửa phần trăm HP pet đã mất (tối đa {drainCap}%). Lần đầu HP tụt xuống 30% trở xuống mà chưa gục, pet nhận khiên chắn {shield}% HP tối đa trong 2 lượt. Khi đồng đội gục, pet hút máu ở mức tối đa {drainCap}% trong 2 lượt bất kể HP.",
  },
  43: {
    params: { chance: 30, slow: 12 },
    text: "Chiêu tấn công có {chance}% đặt Hủ Thực 3 lượt (3%/6%/9% HP tối đa; không làm mới nếu đang có). Mục tiêu đang bị Hủ Thực do pet gây bị giảm {slow}% Linh xảo.",
  },
  44: {
    params: { chance: 30, slow: 15, bonus: 15 },
    text: "Chiêu tấn công đánh trúng có {chance}% gây Hủ Thực 2 lượt nếu mục tiêu chưa có. Mục tiêu đang Hủ Thực do pet gây bị giảm {slow}% Linh xảo và nhận thêm {bonus}% sát thương từ pet. Khi mục tiêu đó gục hoặc bị đổi ra, Hủ Thực còn lại nhảy sang pet thay vào với thời hạn còn lại. Khi mục tiêu gục, Hủ Thực còn lại có thể nhảy sang đối thủ còn lại.",
  },
  45: {
    params: { dmg: 6, def: 4 },
    text: "Mỗi lượt pet đánh trúng, tích 1 Đà (tối đa 3; mất khi rời sân hoặc mất lượt vì khống chế). Mỗi Đà giúp chiêu tấn công gây thêm {dmg}% sát thương và Phòng ngự +{def}%.",
  },
  46: {
    params: { dmg: 7, def: 4, sigBonus: 23, splash: 30 },
    text: "Mỗi lượt đánh trúng, tích 1 Đà (tối đa 3); mỗi Đà +{dmg}% sát thương và DEF +{def}%. Đà là 'đà tích từ đặc tính' cho Khủng Giác Nghiền Giáp · Bạo; tiêu đủ 3 Đà bằng chiêu này thì gỡ 1 tăng Phòng ngự của mục tiêu. Cú tiêu 3 Đà còn húc xuyên: đối thủ còn lại nhận {splash}% sát thương của đòn đó.",
  },
  47: {
    params: { block: 30, cap: 30 },
    text: "Mỗi lượt, đòn đầu tiên trúng pet bị giảm {block}% sát thương; lượng đã chặn tích thành Chiến Ý. Chiêu tấn công kế tiếp của pet gây thêm sát thương bằng toàn bộ Chiến Ý (tối đa {cap}% HP tối đa của pet) rồi xóa Chiến Ý. Khiêu khích: lượt đầu sau khi ra sân, đòn đơn mục tiêu của đối thủ buộc nhắm vào pet; Chiến Ý tích từ cả hai kẻ đánh (chỉ đòn đầu mỗi lượt được giảm).",
  },
  48: {
    params: { slow: 8 },
    text: "Mỗi lần đánh trúng hoặc bị đánh trúng (mỗi chiều tối đa 1 lần mỗi lượt), đối phương nhận 1 tầng Băng: giảm {slow}% Linh xảo mỗi tầng trong 2 lượt (tối đa 3 tầng).",
  },
  49: {
    params: { slow: 10, freeze: 50 },
    text: "Mỗi lần đánh trúng hoặc bị đánh trúng (mỗi chiều 1 lần mỗi lượt), đối phương nhận 1 tầng Băng: −{slow}% Linh xảo mỗi tầng, 2 lượt, tối đa 3. Khi đạt 3 tầng, có {freeze}% bị Hóa Đá 1 lượt và xóa tầng (mỗi đối thủ 3 lượt 1 lần).",
  },
  50: {
    params: { slow: 12, freeze: 50, bonus: 25, ally: 12 },
    text: "Mỗi lần đánh trúng hoặc bị đánh trúng (mỗi chiều 1 lần mỗi lượt), đối phương nhận 1 tầng Băng (−{slow}% Linh xảo, tối đa 3). Đủ 3 tầng thì có {freeze}% bị Hóa Đá 1 lượt (3 lượt 1 lần). Đánh mục tiêu đang Hóa Đá gây thêm {bonus}% sát thương. Đồng đội đánh mục tiêu đang Hóa Đá do pet gây cũng được +{ally}% sát thương.",
  },
  51: {
    params: { surge: 12, ebb: 12, regen: 4 },
    text: "Lượt lẻ sau khi ra sân là Triều Dâng: chiêu tấn công +{surge}% sát thương. Lượt chẵn là Triều Rút: pet nhận ít hơn {ebb}% sát thương và hồi {regen}% HP tối đa cuối lượt. Đồng đội hệ Thủy đứng cạnh cùng chung con triều (nhận nửa hiệu lực).",
  },
  52: {
    params: { surge: 15, ebb: 15, regen: 5 },
    text: "Lượt lẻ sau khi ra sân là Triều Dâng: chiêu tấn công +{surge}% sát thương. Lượt chẵn là Triều Rút: nhận ít hơn {ebb}% sát thương và hồi {regen}% HP tối đa cuối lượt. Chiêu giảm sát thương đối thủ dùng trong Triều Rút kéo dài thêm 1 lượt. Đồng đội hệ Thủy chung con triều với nửa hiệu lực.",
  },
  53: {
    params: { surge: 18, ebb: 18, regen: 5, weaken: 10 },
    text: "Lượt lẻ sau khi ra sân là Triều Dâng: chiêu tấn công +{surge}% sát thương và đòn đánh trúng giảm {weaken}% sát thương mục tiêu 2 lượt. Lượt chẵn là Triều Rút: nhận ít hơn {ebb}% sát thương và hồi {regen}% HP tối đa cuối lượt. Đồng đội hệ Thủy chung con triều với nửa hiệu lực; giảm sát thương của Triều Dâng cũng che đồng đội.",
  },
  54: {
    params: { weaken: 20, shield: 10 },
    text: "Lượt pet ra đòn trước đối thủ, mục tiêu trúng đòn bị giảm {weaken}% sát thương trong lượt đó. Lượt đầu tiên sau mỗi lần ra sân, pet được ưu tiên ra đòn. Lượt pet đi trước, đồng đội nhận khiên {shield}% HP tối đa trong 1 lượt (2 lượt 1 lần).",
  },
  55: {
    params: { lifesteal: 35, heal: 20, def: 15 },
    text: "Đánh mục tiêu dưới 40% HP thì hút {lifesteal}% sát thương thực gây ra. Khi pet hạ gục đối thủ, pet nuốt chửng: hồi {heal}% HP tối đa và Phòng ngự +{def}% trong 2 lượt.",
  },
  56: {
    params: { acc: 20, reduce: 25, accOther: 10, guard: 10 },
    text: "Lần đầu bị đánh trúng mỗi lượt, pet phun mực: kẻ tấn công bị giảm {acc}% chính xác 2 lượt (không cộng dồn). Đòn từ đối thủ đang bị giảm chính xác gây ít hơn {reduce}% sát thương lên pet. Mực phun lên cả hai đối thủ nhưng chỉ giảm {accOther}% chính xác với kẻ không đánh pet; đồng đội được giảm {guard}% sát thương từ đối thủ bị mực.",
  },
  57: {
    params: { charm: 40, misfire: 30, selfPower: 30 },
    text: "Khi dùng chiêu hồi máu, pet có {charm}% gây Mị Hoặc 2 lượt lên đối thủ. Đối thủ đang Mị Hoặc có {misfire}% tự đánh chính mình bằng {selfPower}% sức chiêu thay vì đánh pet. Đối thủ Mị Hoặc cũng có {misfire}% đánh nhầm sang đồng đội của nó với toàn bộ sức chiêu.",
  },
  58: {
    params: { bonus: 20, shield: 20 },
    text: "Khi pet hồi máu cho mục tiêu, mục tiêu được xóa 1 hiệu ứng xấu và chiêu tấn công kế tiếp của nó gây thêm {bonus}% sát thương. Pet được đổi vào bằng Phiêu Thủy Tiếp Sức nhận khiên {shield}% HP tối đa trong 2 lượt.",
  },
  59: {
    params: { reduce: 15 },
    text: "Khi bị đánh trúng, kẻ tấn công bị Hủ Thực 3 lượt (2 lượt 1 lần, không làm mới). Đối thủ đang bị Hủ Thực do pet gây ra gây ít hơn {reduce}% sát thương.",
  },
  60: {
    params: { pierce: 15, bypass: 30 },
    text: "Chiêu tấn công bỏ qua {pierce}% Phòng ngự mục tiêu, và {bypass}% sát thương đánh thẳng vào HP dù mục tiêu đang có khiên chắn.",
  },
  61: {
    params: { pierce: 15, bypass: 40, bonus: 20 },
    text: "Chiêu tấn công bỏ qua {pierce}% DEF mục tiêu; nếu mục tiêu có khiên, {bypass}% sát thương đánh thẳng vào HP. Khi mục tiêu đang có hiệu ứng có lợi, đòn của pet gỡ 1 hiệu ứng (2 lượt 1 lần) và chiêu tấn công của pet +{bonus}% sát thương trong 2 lượt. Khi gỡ được hiệu ứng có lợi, đồng đội cũng +10% sát thương trong 2 lượt.",
  },
  62: {
    params: { reflect: 19, reduce: 15 },
    text: "Khi pet được hồi máu (bởi bất kỳ ai), đối thủ đang đối mặt mất HP bằng {reflect}% lượng vừa hồi (3 lượt 1 lần). Lượt pet dùng chiêu hồi máu, pet nhận ít hơn {reduce}% sát thương. Khi pet hồi cho đồng đội, phản quang cũng kích hoạt theo lượng hồi cho đồng đội, đánh đối thủ có HP cao nhất (dùng chung hồi chiêu).",
  },
  63: {
    params: { armor: 50, shell: 20 },
    text: "Khi ra sân nhận Giáp Thần: khiên chắn {armor}% HP tối đa, không tự hết hạn (chiêu gỡ buff phá được). Khi Giáp Thần vỡ, kẻ phá bị Giam Cầm 2 lượt và Hóa Đá 1 lượt. Sau đó mỗi khi bị đánh mất HP, nhận khiên {shell}% HP tối đa 2 lượt (2 lượt 1 lần). Khi đồng đội bị đánh mất từ 25% HP trở lên, càng cua kẹp kẻ đánh: Giam Cầm 1 lượt (3 lượt 1 lần).",
  },
  64: {
    params: { bonus: 18, speed: 10 },
    text: "Khi dùng chiêu tấn công khác hệ với chiêu tấn công lượt trước, chiêu đó gây thêm {bonus}% sát thương và pet được Linh xảo +{speed}% trong 2 lượt (không cộng dồn).",
  },
  65: {
    params: { perStack: 8, para: 50 },
    text: "Mỗi lượt đánh trúng hoặc bị đánh trúng, pet tích 1 tầng điện (tối đa 3). Mỗi tầng giúp chiêu Lôi +{perStack}% sát thương. Khi có 3 tầng, chiêu Lôi kế tiếp xả hết tầng và có {para}% gây Tê Liệt 1 lượt. Tầng cũng tích khi đồng đội bị đánh bằng chiêu Lôi (mỗi lượt 1 tầng).",
  },
  66: {
    params: { perStack: 9 },
    text: "Mỗi lượt đánh trúng hoặc bị đánh trúng, tích 1 tầng điện (tối đa 3); mỗi tầng +{perStack}% sát thương chiêu Lôi. Đủ 3 tầng: chiêu Lôi kế tiếp xả hết tầng và chắc chắn Tê Liệt 1 lượt (mỗi mục tiêu 3 lượt 1 lần). Tầng cũng tích khi đồng đội bị chiêu Lôi đánh trúng; cú xả có thể nhắm đối thủ nguy hiểm nhất.",
  },
  67: {
    params: { perStack: 8, para: 40, bounce: 30 },
    text: "Mỗi lượt đánh trúng hoặc bị đánh trúng, tích 1 tầng điện (tối đa 3); mỗi tầng +{perStack}% sát thương chiêu Lôi. Đủ 3 tầng: chiêu Lôi kế tiếp xả hết, gỡ 1 hiệu ứng có lợi của mục tiêu và có {para}% gây Tê Liệt 1 lượt. Cú xả 3 tầng nảy sang đối thủ còn lại với {bounce}% sát thương.",
  },
  68: {
    params: { speed: 25, bonus: 10 },
    text: "Lượt bị đối thủ ra đòn trước, pet nhận Linh xảo +{speed}% trong 2 lượt (tối đa 2 tầng) và chiêu tấn công lượt đó gây thêm {bonus}% sát thương.",
  },
  69: {
    params: { power: 30, speed: 20 },
    text: "Lượt pet ra đòn trước đối thủ, chiêu tấn công bắn thêm một tia chớp phụ {power}% uy lực (không gây hiệu ứng). Lượt bị đối thủ ra đòn trước, pet nhận Linh xảo +{speed}% trong 2 lượt (không cộng dồn). Trong trận đôi, tia chớp phụ đánh vào đối thủ còn lại thay vì cùng mục tiêu.",
  },
  70: {
    params: { bonus: 25, ctrl: 15 },
    text: "Khi dùng chiêu tấn công khác hệ với chiêu tấn công ngay trước đó của pet (Lôi ↔ Phong), chiêu này +{bonus}% sát thương và tỉ lệ Tê Liệt/Giam Cầm của nó +{ctrl}%. Dùng Quỷ Long Lôi Vực · Thủ thì chiêu tấn công kế tiếp được tính là đổi hệ. Nếu chiêu tấn công gần nhất của đồng đội trong lượt khác hệ với chiêu pet sắp dùng, điều kiện đổi hệ cũng được tính.",
  },
  71: {
    params: { bonus: 20, para: 30 },
    text: "Chiêu tấn công khác hệ với chiêu tấn công trước đó của pet +{bonus}% sát thương; nếu là cặp Lôi ↔ Quỷ thì thêm {para}% gây Tê Liệt 1 lượt lên mục tiêu đang bị Hủ Thực. Quỷ Long Lôi Vực · Thực luôn được tính là đổi hệ. Chiêu khác hệ của đồng đội trong lượt cũng mở điều kiện đổi hệ, và Hủ Thực do đồng đội đặt cũng đủ để kích Tê Liệt.",
  },
  72: {
    params: { bonus: 30, cost: 4, shortBonus: 45, speed: 10 },
    text: "Chiêu tấn công hệ Lôi +{bonus}% sát thương, đổi lại pet mất {cost}% HP tối đa sau đòn (mỗi lượt 1 lần, không tự gục). Khi HP dưới 50%, đoản mạch: mức cộng tăng thành +{shortBonus}% và Linh xảo +{speed}% (không cộng dồn).",
  },
  73: {
    params: { bonus: 35, cost: 5, cap: 25, sigCost: 6 },
    text: "Chiêu tấn công hệ Lôi +{bonus}% sát thương, đổi lại pet mất {cost}% HP tối đa (mỗi lượt 1 lần, không tự gục). Lượng HP đã tự trả được tích lại; lần đầu HP xuống dưới 30%, pet nhận khiên bằng toàn bộ lượng đã trả (tối đa {cap}% HP tối đa) trong 2 lượt. Khi pet chạm ngưỡng 30%, có thể chọn trao khiên cho đồng đội đang ít HP hơn thay vì tự nhận.",
  },
  74: {
    params: { bonus: 15 },
    text: "Khi chiêu của pet gỡ được một buff của đối thủ, pet cướp buff đó cho mình trong 2 lượt (mỗi lượt 1 lần). Nếu pet ra đòn trước mục tiêu, chiêu tấn công +{bonus}% sát thương. Buff cướp được có thể trao cho đồng đội thay vì tự giữ.",
  },
  75: {
    params: { perMark: 18, strike: 8, para: 40 },
    text: "Mỗi chiêu Lôi đánh trúng cho 1 dấu Thiên Lôi (tối đa 3, giữ 3 lượt), mỗi dấu +{perMark}% sát thương hệ Lôi. Đủ 3 dấu, hoặc khi dùng Kỳ Lân Thiên Phạt · Bạo, pet tiêu hết dấu để giáng sét: mỗi đối thủ mất thêm {strike}% HP tối đa và {para}% bị Tê Liệt 1 lượt.",
  },
  76: {
    params: { reduce: 15 },
    text: "Chiêu tấn công đầu tiên đánh trúng sau mỗi lần ra sân gây Hủ Thực 3 lượt nếu mục tiêu chưa có. Đối thủ đang bị Hủ Thực do pet gây ra đánh pet hoặc đồng đội của pet giảm {reduce}% sát thương.",
  },
  77: {
    params: { chance: 50, leech: 50, splash: 3 },
    text: "Chiêu tấn công hệ Quỷ hoặc Mộc đánh trúng mục tiêu chưa có Hủ Thực có {chance}% gây Hủ Thực 3 lượt. Mỗi khi Hủ Thực do pet gây ra làm đối thủ mất HP, pet hồi lượng bằng {leech}% HP đối thủ vừa mất (mỗi lượt 1 lần). Trong trận đôi, Hủ Thực tick trên đối thủ này còn bắn sang đối thủ kia {splash}% HP tối đa (không gây Hủ Thực mới).",
  },
  78: {
    params: { pierce: 20, lifesteal: 15 },
    text: "Mọi chiêu tấn công đánh trúng mục tiêu chưa có Hủ Thực đều gây Hủ Thực 3 lượt. Đánh mục tiêu đang bị Hủ Thực thì bỏ qua {pierce}% DEF và hút {lifesteal}% sát thương gây ra. Khi mục tiêu bị Hủ Thực gục, Hủ Thực chuyển sang đối thủ còn lại. Khi đối thủ đổi pet, pet vào sân bị Hủ Thực 2 lượt.",
  },
  79: {
    params: { reduce: 20, bonus: 10 },
    text: "Kẻ đầu tiên đánh trúng pet sau mỗi lần ra sân bị gắn Mắt Ác 2 lượt: nó gây ít hơn {reduce}% sát thương lên pet và đồng đội của pet. Chiêu tấn công của pet lên kẻ mang Mắt Ác +{bonus}% sát thương.",
  },
};
for (const [id, meta] of Object.entries(META)) Object.assign(PART_2[Number(id)], meta);

/** Một phần sát thương đánh thẳng vào HP dù mục tiêu có khiên (60, 61). */
function piercerBefore(k: Kit, target: DesignTraitUnit | undefined): void {
  k.e.sh = target && k.isFoe(target) ? k.shieldHp(target) : 0;
  k.e.raw = 0;
}
/** 61 (2v2): đồng đội +10% khi pet vừa gỡ buff. Số viết thẳng trong mô tả đã duyệt. */
const ALLY_BOOST_61 = 10;
function shieldPiercer(): Partial<TraitScript> {
  return {
    beforeAction(k, e) {
      piercerBefore(k, e.target);
    },
    outgoing(k, e) {
      k.e.raw = e.damage;
    },
    onHitDealt(k, e) {
      const shield = k.e.sh ?? 0;
      const raw = Math.max(e.damage, k.e.raw ?? 0);
      k.e.sh = 0;
      k.e.raw = 0;
      if (shield <= 0 || raw <= 0) return;
      // Xấp xỉ: p.bypass% phần khiên đã đỡ trừ thẳng vào HP (khiên không được hoàn).
      const absorbed = Math.min(shield, raw);
      const bypass = Math.trunc((absorbed * k.p.bypass) / 100);
      if (bypass <= 0) return;
      k.damage(e.target, bypass, { pierceShield: true });
      k.proc("xuyên khiên", e.target);
    },
  };
}

/** 63: đồng đội (hoặc pet trong 1v1) mất ≥25% HP tối đa vì một đòn → Giam Cầm kẻ đánh 1 lượt. */
function pinch(k: Kit, source: DesignTraitUnit, victim: DesignTraitUnit, damage: number): void {
  if (damage * 4 < victim.maxHp() || !k.ready("kẹp", 3)) return;
  if (k.inflict(source, "bind", 1)) {
    k.use("kẹp");
    k.proc("càng kẹp", source);
  }
}

/** 73: lần đầu HP dưới 30% → khiên bằng lượng đã tự trả (tối đa 25%); 2v2 trao đồng đội ít HP hơn. */
function checkRefund(k: Kit): void {
  if (k.v.refunded || k.hpPct() >= 30 || !k.self.alive()) return;
  k.v.refunded = 1;
  const amount = Math.min(k.v.paid ?? 0, k.pctOf(k.self, k.p.cap));
  const ally = k.ally;
  const taker = ally && k.hpPct(ally) < k.hpPct() ? ally : k.self;
  if (amount > 0 && k.shieldAmount(taker, amount, 2)) k.proc("hoàn điện", taker);
}

/** 75: số dấu Thiên Lôi còn hiệu lực. */
function thunderMarks(k: Kit): number {
  if (k.round > (k.v.tlUntil ?? -1)) k.v.tl = 0;
  return k.v.tl ?? 0;
}

/** 78 (1v1): đối thủ đổi pet → pet vào sân bị Hủ Thực 2 lượt. */
function plagueSwitch(k: Kit): void {
  if (k.twoVsTwo) return;
  const fresh = foeChanged(k);
  if (fresh && corrode(k, fresh, 2, "dịch vương")) k.proc("dịch đón", fresh);
}

/**
 * 70/71: chiêu tấn công khác hệ với chiêu tấn công trước của pet (hoặc của đồng đội trong lượt), hoặc
 * sau chiêu độc quyền `signature`, được +`pct`% và gọi `onSwitch` khi trúng.
 */
function switcher(
  name: string,
  signature: string,
  onSwitch: (
    k: Kit,
    target: DesignTraitUnit,
    skill: NonNullable<import("../TraitKit").KitSkill>,
    prev: number | undefined,
  ) => void,
): TraitScript {
  const switched = (k: Kit, element: number, skillName: string): boolean => {
    if (k.v.forced === 1) return true;
    if (signature.endsWith("Thực") && skillName.startsWith(signature)) return true;
    const last = k.v.lastEl;
    if (last !== undefined && last !== element) return true;
    return k.v.allyRound === k.round && k.v.allyEl !== undefined && k.v.allyEl !== element;
  };
  return {
    name,
    outgoing(k, e) {
      if (!e.skill?.attack || !switched(k, e.skill.element, e.skill.name)) return;
      k.e.sw = 1;
      k.proc("đổi hệ");
      return k.p.bonus;
    },
    onHitDealt(k, e) {
      if (k.e.sw !== 1 || !e.skill) return;
      k.e.sw = 0;
      onSwitch(k, e.target, e.skill, k.v.lastEl);
    },
    afterAction(k, e) {
      if (!e.skill) return;
      if (e.skill.name.startsWith(signature) && !e.skill.attack) {
        k.v.forced = 1;
        k.proc("tích đổi hệ");
        return;
      }
      if (!e.skill.attack) return;
      k.v.forced = 0;
      k.v.lastEl = e.skill.element;
    },
    onOtherAction(k, e) {
      if (!e.isAlly || !e.skill?.attack) return;
      k.v.allyEl = e.skill.element;
      k.v.allyRound = k.round;
    },
  };
}
