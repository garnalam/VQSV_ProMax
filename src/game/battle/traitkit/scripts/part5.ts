import type { DesignTraitUnit } from "../../DesignTraits";
import { BUFF_BANK, StatusInstance } from "../../StatusState";
import { KIT_STATUS, type Kit, type KitSkill, type KitStatus, type TraitScript } from "../TraitKit";

/** Hệ: 0 Hỏa, 1 Mộc, 2 Thổ, 3 Thủy, 4 Điện (Lôi), 5 Quỷ, 6 Phong. */
const FIRE = 0;
const EARTH = 2;
const ELECTRIC = 4;
const GHOST = 5;
/** Buff Phòng ngự (tầng DEF +7%, 2 lượt, tối đa 3) và khiên chắn. */
const DEF_TIER_ID = 4;
const SHIELD_ID = 15;

/** Chiêu "· Bạo" Power 155 → 190 khi tiêu dấu: +23% sát thương (số của chiêu, không cân bằng ở đây). */
const BURST_BONUS = Math.round((190 / 155 - 1) * 100);

const HEAL_NAME = /Dưỡng|Hồi Sinh|Chữa Lành|Tái Tạo|Thảo nguyện|cầu nguyện/i;
/** Chiêu hồi máu: hỗ trợ, nhắm phe mình, tên hồi máu. */
const isHeal = (s?: KitSkill): boolean => !!s && s.support && s.ownSide && HEAL_NAME.test(s.name);
/** Chiêu hồi máu hoặc phòng thủ: mọi chiêu hỗ trợ nhắm phe mình. */
const isOwnSupport = (s?: KitSkill): boolean => !!s && s.support && s.ownSide;
const isAttack = (s?: KitSkill, element?: number): boolean =>
  !!s?.attack && (element === undefined || s.element === element);
const pct = (amount: number, percent: number): number => Math.trunc((amount * percent) / 100);
const missing = (u: DesignTraitUnit): number => Math.max(0, u.maxHp() - u.hp());

function remaining(unit: DesignTraitUnit | undefined, status: KitStatus): number {
  if (!unit) return 0;
  const slot = KIT_STATUS[status];
  return unit.statuses.get(slot.bank, slot.id)?.remainingTurns ?? 0;
}

/** Thêm `count` tầng Phòng ngự thật (buff 4, chung giới hạn 3 tầng) lên `unit`. */
function addDefenseTiers(k: Kit, unit: DesignTraitUnit, count: number): void {
  if (!unit.alive()) return;
  for (let i = 0; i < count; i++) unit.effects.applySourceBuff(unit, DEF_TIER_ID, 0);
  unit.restoreSourceStatusState();
  k.refresh(unit);
}

/** Phá giáp: 1 tầng (tối đa 3, 2 lượt) trên `target`, mỗi tầng −`per`% DEF. */
function shred(k: Kit, target: DesignTraitUnit | undefined, per: number): number {
  if (!target || !target.alive() || !k.isFoe(target)) return 0;
  const n = k.mark(target, "phá giáp", 2, 3);
  k.statUp(target, "defense", -per * n, 2, `phá giáp${k.self.speciesId}`);
  k.proc("phá giáp", target);
  return n;
}

/** Hút `rate`% của `damage` cho chính pet. */
function drain(k: Kit, damage: number, rate: number, label: string): void {
  const amount = pct(damage, rate);
  if (amount > 0 && k.healAmount(k.self, amount).healed > 0) k.proc(label);
}

/** Pet phe mình có tỉ lệ HP thấp nhất (1v1: chính pet). */
function lowestTeam(k: Kit): DesignTraitUnit {
  let best = k.self;
  for (const u of k.team) if (k.hpPct(u) < k.hpPct(best)) best = u;
  return best;
}

/** Ảnh chụp buff của mục tiêu trước chiêu độc quyền gỡ buff (173). */
const buffSnapshot = new WeakMap<DesignTraitUnit, Map<number, StatusInstance>>();
function snapshotBuffs(k: Kit, target: DesignTraitUnit | undefined): void {
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
}
function copyStatus(to: DesignTraitUnit, old: StatusInstance, turns: number): void {
  to.statuses.put(
    new StatusInstance(
      old.definition,
      turns,
      old.remainingActions,
      old.primaryValue,
      old.secondaryValue,
      old.stackCount,
      to.ownerSide,
      to.formationSlot,
      old.sourceSkillId,
      old.flags,
    ),
  );
  to.restoreSourceStatusState();
}

/** 188: hạn Hủ Thực của pet trên từng đối thủ, và đối thủ pet đang nhìn (1v1). */
const corrosionUntil = new WeakMap<DesignTraitUnit, number>();
const watchedFoe = new WeakMap<DesignTraitUnit, DesignTraitUnit>();
function noteCorrosion(k: Kit): void {
  for (const foe of k.foes)
    if (k.has(foe, "corrosion") && k.marked(foe, "mục lâm") > 0)
      corrosionUntil.set(foe, k.round + Math.max(1, remaining(foe, "corrosion")) - 1);
}
function spreadCorrosion(k: Kit, to: DesignTraitUnit | undefined, from: DesignTraitUnit): void {
  const until = corrosionUntil.get(from);
  corrosionUntil.delete(from);
  if (!to || until === undefined || until < k.round - 1 || k.has(to, "corrosion")) return;
  const turns = Math.max(1, until - k.round + 1);
  if (k.inflict(to, "corrosion", turns, { refresh: false })) {
    k.mark(to, "mục lâm", turns + 1);
    noteCorrosion(k);
    k.proc("lan hủ thực", to);
  }
}
/** 1v1: đối thủ vừa đổi (gục hoặc rút) → Hủ Thực của kẻ cũ lan sang kẻ mới. */
function watchSwap(k: Kit): void {
  if (k.twoVsTwo) return;
  const now = k.foe;
  const old = watchedFoe.get(k.self);
  if (now) watchedFoe.set(k.self, now);
  if (old && now && old !== now) spreadCorrosion(k, now, old);
}

/** 192: khiên đối thủ đã thấy, để cắt phần khiên mới nhận. */
const shieldSeen = new WeakMap<DesignTraitUnit, number>();
function shieldAura(k: Kit): void {
  for (const foe of k.foes) {
    const cur = k.shieldHp(foe);
    const prev = shieldSeen.get(foe) ?? 0;
    if (cur > prev) {
      const inst = foe.statuses.get(BUFF_BANK, SHIELD_ID);
      if (inst) {
        inst.primaryValue = prev + pct(cur - prev, k.p.aura);
        k.proc("hào quang phá khiên", foe);
      }
    }
    shieldSeen.set(foe, k.shieldHp(foe));
  }
}

/** 195: phong ấn chiêu mạnh nhất (giữ PP để trả lại). */
type Seal = { foe: DesignTraitUnit; slot: number; pp: number; until: number };
const seals = new WeakMap<DesignTraitUnit, Seal[]>();
function sealTop(k: Kit, foe: DesignTraitUnit): boolean {
  let best = -1;
  let bestPower = -1;
  let usable = 0;
  for (let slot = 0; slot < foe.skillIds.length; slot++) {
    const id = foe.skillIds[slot];
    if (id < 0 || foe.skillPp[slot] <= 0) continue;
    const row = k.runtime.host.skill(id);
    if (!row) continue;
    usable++;
    if (row.powerPercent > bestPower) {
      bestPower = row.powerPercent;
      best = slot;
    }
  }
  // Xấp xỉ: phong ấn = tạm rút PP của chiêu; chỉ phong khi đối thủ còn chiêu khác để dùng.
  if (best < 0 || usable < 2) return false;
  const list = seals.get(k.self) ?? [];
  if (list.some((s) => s.foe === foe)) return false;
  list.push({ foe, slot: best, pp: foe.skillPp[best], until: k.round + 1 });
  seals.set(k.self, list);
  (foe.skillPp as number[])[best] = 0;
  return true;
}
function releaseSeals(k: Kit, all = false): void {
  const list = seals.get(k.self);
  if (!list) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    const gone = !s.foe.alive() || !k.foes.includes(s.foe);
    const cleansed = !k.has(s.foe, "damage_down");
    if (!all && !gone && !cleansed && k.round < s.until) continue;
    (s.foe.skillPp as number[])[s.slot] = Math.max(s.foe.skillPp[s.slot], s.pp);
    list.splice(i, 1);
    k.proc("hết phong ấn", s.foe);
  }
}

/** 198: đối thủ đang mang Mị Hoặc do pet gây. */
const charmed = new WeakMap<DesignTraitUnit, DesignTraitUnit>();
function charmEnd(k: Kit): void {
  const foe = charmed.get(k.self);
  if (!foe) return;
  if (foe.alive() && k.foes.includes(foe) && k.has(foe, "charm")) return;
  charmed.delete(k.self);
  if (foe.alive() && k.stealBuff(foe)) {
    k.proc("cướp buff", foe);
    return;
  }
  k.statUp(k.self, "attack", k.p.atk, 2, "hồ ly");
  k.proc("hồ ly +sức mạnh");
}

/** Dòng heo (160, 161): lần đầu HP tụt tới ngưỡng mà chưa gục. */
function lastStand(k: Kit, after: number, threshold: number): boolean {
  if (k.v.stand || after <= 0 || (after * 100) / k.self.maxHp() > threshold) return false;
  k.v.stand = 1;
  return true;
}

/** Dòng Kình (169, 170): tích Triều khi bị đánh, hồi cuối lượt. */
function tideHit(k: Kit): void {
  k.stack("triều", 1, 3, true);
  k.proc("tích triều");
}
function tideRegen(k: Kit): void {
  const n = k.e["triều"] ?? 0;
  if (n > 0 && k.heal(k.self, n * k.p.regen).healed > 0) k.proc("triều hồi");
}

/** Dấu Đà/Điện tích: dùng chiêu tấn công khác chiêu lượt trước. */
const switchedSkill = (k: Kit, s?: KitSkill): boolean =>
  !!s?.attack && k.lastSkill >= 0 && k.lastSkill !== s.id;

/** Dòng Sói (196, 197): mục tiêu vừa bị đồng đội đánh trong lượt (1v1: dưới 60% HP). */
function packBonus(k: Kit, target: DesignTraitUnit): number | void {
  const ok = k.ally ? k.marked(target, "vây") > 0 : k.hpPct(target) < 60;
  if (!ok) return;
  k.proc("vây mồi", target);
  return k.p.pack;
}

/** 199: đối thủ dưới 50% HP hoặc đang Xé Rách/Gieo Hạt. */
function bloodScent(k: Kit, foe: DesignTraitUnit): boolean {
  return k.hpPct(foe) < 50 || k.has(foe, "bleed") || k.has(foe, "seed");
}

const PIVOT_165 = "Mị Ảnh Hư Chuyển · Chuyển";
const LOCK_170 = "Yếu Tắc Hải Thành · Tỏa";
const BREAK_173 = "Đế Cụt Hải Trảm · Phá";
const PIVOT_183 = "Hải Đồn Tật Chuyển · Chuyển";
const BURST_184 = "Chiến Mã Liệt Xung · Bạo";

/** Kịch bản đặc tính, phần 5. */
export const PART_5: Record<number, TraitScript> = {
  // 160 Heo răng nanh khổng lồ
  160: {
    name: "Nanh heo cuồng nộ",
    params: { shield: 55, atk: 20, late: 8 },
    text: "Lần đầu mỗi trận HP tụt xuống 35% trở xuống mà chưa gục, nhận khiên chắn {shield}% HP tối đa và Sức mạnh +{atk}% trong 2 lượt. Ra đòn sau đối thủ thì gây thêm {late}% sát thương.",
    onDamaged(k, e) {
      if (!lastStand(k, e.after, 35)) return;
      k.shield(k.self, k.p.shield, 2);
      k.statUp(k.self, "attack", k.p.atk, 2, "cuồng nộ");
      k.proc("cuồng nộ");
    },
    outgoing(k, e) {
      if (e.actedFirst || !e.skill?.attack) return;
      k.proc("ra sau +sát thương");
      return k.p.late;
    },
  },

  // 161 Trư Vương
  161: {
    name: "Trư vương bất khuất",
    params: { shield: 60, reflect: 20 },
    text: "Lần đầu mỗi trận HP tụt xuống 40% trở xuống mà chưa gục, nhận khiên chắn {shield}% HP tối đa và 3 tầng DEF +7% trong 2 lượt. Khi khiên này còn, đòn trực tiếp đánh trúng pet bị phản {reflect}% lượng sát thương nhận.",
    onDamaged(k, e) {
      if (!lastStand(k, e.after, 40)) return;
      if (k.shield(k.self, k.p.shield, 2)) k.v.wall = 1;
      addDefenseTiers(k, k.self, 3);
      k.proc("bất khuất");
    },
    incoming(k, e) {
      // Ghi sát thương trước khiên (khiên ăn phần lớn nên máu mất không phản ánh đòn).
      k.e.inDmg = e.direct ? e.damage : 0;
      k.e.wallUp = k.v.wall === 1 && k.shieldHp() > 0 ? 1 : 0;
    },
    onHitTaken(k, e) {
      const up = k.e.wallUp === 1;
      k.e.wallUp = 0;
      if (k.shieldHp() <= 0) k.v.wall = 0;
      if (!up) return;
      const amount = pct(Math.max(e.damage, k.e.inDmg ?? 0), k.p.reflect);
      if (amount <= 0) return;
      k.proc("phản đòn", e.source);
      return amount;
    },
  },

  // 162 Heo đốm
  162: {
    name: "Đốm trư đảo nhịp",
    params: { daze: 25 },
    text: "Chiêu hệ Thổ đánh trúng có {daze}% gây Mê Muội 2 lượt (cứ 3 lượt 1 lần, không làm mới). Khi đối thủ đang Mê Muội, Giam Cầm hoặc Ngủ, pet được ưu tiên ra đòn trước khi đánh nó. Đối thủ bị đồng đội làm Ngủ hoặc Giam Cầm cũng mở lượt ưu tiên cho pet.",
    onHitDealt(k, e) {
      if (!isAttack(e.skill, EARTH) || k.has(e.target, "daze") || !k.ready("mê", 3)) return;
      if (!k.chance(k.p.daze, "mê")) return;
      if (k.inflict(e.target, "daze", 2, { refresh: false })) {
        k.use("mê");
        k.proc("mê muội", e.target);
      }
    },
    priority(k, e) {
      // Xấp xỉ: lúc xếp lượt chưa biết mục tiêu, nên xét từng đối thủ đang bị khống chế.
      if (!k.has(e.opponent, "daze") && !k.has(e.opponent, "bind") && !k.has(e.opponent, "sleep"))
        return;
      k.proc("ưu tiên", e.opponent);
      return true;
    },
  },

  // 163 Sơn báo
  163: {
    name: "Nanh kiếm rạch thịt",
    params: { bleed: 4, bonus: 12 },
    text: "Đòn đưa mục tiêu từ trên 50% xuống 50% HP trở xuống gây Xé Rách 2 lượt (mất {bleed}% HP tối đa cuối mỗi lượt). Đánh mục tiêu đang Xé Rách gây thêm {bonus}% sát thương. Đòn của đồng đội đẩy mục tiêu qua ngưỡng 50% HP không tính.",
    outgoing(k, e) {
      k.e.above = k.hpPct(e.target) > 50 ? 1 : 0;
      if (!e.skill?.attack || !k.has(e.target, "bleed")) return;
      k.proc("rạch thịt +sát thương", e.target);
      return k.p.bonus;
    },
    onHitDealt(k, e) {
      const above = k.e.above === 1;
      k.e.above = 0;
      if (!above || k.hpPct(e.target) > 50) return;
      if (k.inflict(e.target, "bleed", 2, { value: k.p.bleed })) k.proc("xé rách", e.target);
    },
  },

  // 164 Beo răng kiếm
  164: {
    name: "Kiếm nha tuyệt sát",
    params: { bleed: 4 },
    text: "Đòn đưa mục tiêu xuống 50% HP trở xuống gây Xé Rách 2 lượt. Khi đánh mục tiêu dưới 35% HP, pet được ưu tiên ra đòn trước. Mục tiêu bị đồng đội đánh xuống dưới 35% HP cũng được pet ưu tiên ra đòn.",
    outgoing(k, e) {
      k.e.above = k.hpPct(e.target) > 50 ? 1 : 0;
    },
    onHitDealt(k, e) {
      const above = k.e.above === 1;
      k.e.above = 0;
      if (!above || k.hpPct(e.target) > 50) return;
      if (k.inflict(e.target, "bleed", 2, { value: k.p.bleed })) k.proc("xé rách", e.target);
    },
    priority(k, e) {
      if (k.hpPct(e.opponent) >= 35) return;
      k.proc("ưu tiên kết liễu", e.opponent);
      return true;
    },
  },

  // 165 Mị Ảnh
  165: {
    name: "Mị ảnh phân thân",
    params: { guard: 35, pivotShield: 10 },
    text: "Lượt pet ra đòn trước đối thủ, đòn trực tiếp đầu tiên nhắm vào pet trong lượt đó giảm {guard}% sát thương; cứ 2 lượt 1 lần. Rời sân bằng Mị Ảnh Hư Chuyển thì pet vào thay nhận ngay hiệu ứng này.",
    beforeAction(k, e) {
      if (!e.actedFirst || !k.tryUse("ảnh", 2)) return;
      k.e.veil = k.round;
      k.e.veilHit = 0;
      k.proc("mị ảnh");
    },
    incoming(k, e) {
      if (!e.direct || k.e.veil !== k.round || k.e.veilHit) return;
      k.e.veilHit = 1;
      k.proc("mị ảnh giảm", e.source);
      return k.p.guard;
    },
    afterAction(k, e) {
      if (e.skill?.name === PIVOT_165 && e.hit) k.v.pivot = k.round;
    },
    onLeave(k, e) {
      // Xấp xỉ: kit không gắn được hook lên pet vào thay → cho nó khiên pivotShield% HP 1 lượt.
      if (e.fainted || !e.next || k.v.pivot !== k.round) return;
      if (k.shield(e.next, k.p.pivotShield, 1)) k.proc("ảo ảnh che", e.next);
    },
  },

  // 166 Dị Thú
  166: {
    name: "Dị lôi luân chuyển",
    params: { per: 7 },
    text: "Mỗi lượt dùng chiêu tấn công khác chiêu lượt trước, pet nhận 1 tầng Điện tích (tối đa 3; mỗi tầng +{per}% sát thương). Dùng lại đúng chiêu lượt trước thì mất 1 tầng; rời sân mất hết.",
    outgoing(k, e) {
      const n = k.e["điện"] ?? 0;
      if (!e.skill?.attack || n <= 0) return;
      k.proc("điện tích +sát thương");
      return n * k.p.per;
    },
    afterAction(k, e) {
      if (!e.skill?.attack || k.lastSkill < 0) return;
      if (switchedSkill(k, e.skill)) {
        k.stack("điện", 1, 3, true);
        k.proc("tích điện");
      } else if ((k.e["điện"] ?? 0) > 0) {
        k.stack("điện", -1, 3, true);
        k.proc("mất điện");
      }
    },
  },

  // 167 Chân Dị Thú
  167: {
    name: "Chân dị lôi đà",
    params: { per: 12, para: 35 },
    text: "Mỗi lần bị đánh trúng, pet tích 1 dấu Đà (tối đa 3, mất khi rời sân). Chiêu tấn công kế tiếp tiêu hết dấu: mỗi dấu +{per}% sát thương; tiêu đủ 3 dấu thì đòn đó có {para}% gây Tê Liệt 2 lượt. Khi có đồng đội trên sân, đồng đội bị đánh trúng cũng cho pet 1 dấu Đà.",
    onHitTaken(k) {
      k.stack("đà", 1, 3, true);
      k.proc("tích đà");
    },
    onAllyHitTaken(k) {
      k.stack("đà", 1, 3, true);
      k.proc("tích đà");
    },
    outgoing(k, e) {
      const n = k.e["đà"] ?? 0;
      if (!e.skill?.attack || n <= 0) return;
      k.e.spent = n;
      k.stack("đà", -n, 3, true);
      k.proc("tiêu đà");
      return n * k.p.per;
    },
    onHitDealt(k, e) {
      if ((k.e.spent ?? 0) >= 3 && k.chance(k.p.para) && k.inflict(e.target, "paralysis", 2))
        k.proc("tê liệt", e.target);
    },
    afterAction(k) {
      k.e.spent = 0;
    },
  },

  // 168 Tiểu Lam Kình
  168: {
    name: "Bọt nước hộ thân",
    params: { shield: 15 },
    text: "Lượt dùng chiêu hồi máu hoặc phòng thủ, pet nhận khiên chắn {shield}% HP tối đa trong 2 lượt ngay đầu lượt (trước đòn đối thủ). Khiên hết hạn mà chưa vỡ thì phần còn lại hồi thành HP.",
    beforeAction(k, e) {
      // Xấp xỉ: kit chỉ biết chiêu lúc pet hành động, nên khiên bật đầu hành động của pet.
      if (!isOwnSupport(e.skill)) return;
      k.shield(k.self, k.p.shield, 2);
      if (k.shieldHp() <= 0) return;
      k.v.bubbleCast = k.round;
      k.v.bubbleLeft = k.shieldHp();
      k.proc("bọt nước");
    },
    // Ghi phần khiên còn lại sau mỗi hành động: khiên hết hạn bị engine gỡ trước `roundEnd`.
    afterAction(k) {
      if (k.v.bubbleCast !== undefined) k.v.bubbleLeft = k.shieldHp();
    },
    onOtherAction(k) {
      if (k.v.bubbleCast !== undefined) k.v.bubbleLeft = k.shieldHp();
    },
    roundEnd(k) {
      // Khiên 2 lượt: hết hạn ở cuối lượt kế sau lượt bật (bật lại thì gia hạn).
      const cast = k.v.bubbleCast;
      if (cast === undefined) return;
      if (k.round < cast + 1) {
        k.v.bubbleLeft = k.shieldHp();
        return;
      }
      const live = k.shieldHp();
      const left = live > 0 ? live : (k.v.bubbleLeft ?? 0);
      delete k.v.bubbleCast;
      delete k.v.bubbleLeft;
      if (left <= 0) return;
      if (live > 0) {
        k.self.statuses.remove(BUFF_BANK, SHIELD_ID);
        k.self.restoreSourceStatusState();
      }
      if (k.healAmount(k.self, left).healed > 0) k.proc("bọt hóa máu");
    },
  },

  // 169 Cá Kình khổng lồ
  169: {
    name: "Kình triều dâng",
    params: { regen: 9 },
    text: "Mỗi lần bị đánh trúng, pet tích 1 tầng Triều (tối đa 3, mất khi rời sân). Cuối mỗi lượt, pet hồi {regen}% HP tối đa cho mỗi tầng Triều đang có.",
    onHitTaken(k) {
      tideHit(k);
    },
    roundEnd(k) {
      tideRegen(k);
    },
  },

  // 170 Cá Kình một sừng
  170: {
    name: "Kình hống phá lãng",
    params: { regen: 9, per: 20 },
    text: "Mỗi lần bị đánh trúng tích 1 tầng Triều (tối đa 3); cuối lượt hồi {regen}% HP tối đa mỗi tầng. Yếu Tắc Hải Thành · Tỏa tiêu toàn bộ Triều: mỗi tầng giúp đòn đó gây thêm {per}% sát thương.",
    onHitTaken(k) {
      tideHit(k);
    },
    roundEnd(k) {
      tideRegen(k);
    },
    outgoing(k, e) {
      const n = k.e["triều"] ?? 0;
      if (e.skill?.name !== LOCK_170 || n <= 0) return;
      k.stack("triều", -n, 3, true);
      k.proc("xả triều", e.target);
      return n * k.p.per;
    },
  },

  // 171 Yếu Tắc Kình
  171: {
    name: "Yếu tắc hải thành",
    params: { guard: 8, regen: 9 },
    text: "Mỗi lần pet bị đánh trúng, và lần đầu mỗi lượt đồng đội bị đánh trúng, pet tích 1 tầng Triều (tối đa 3). Mỗi tầng giúp pet giảm {guard}% sát thương nhận. Cuối lượt, khi đã đủ 3 tầng, Triều rút: pet tiêu hết Triều, pet và đồng đội mỗi bên hồi {regen}% HP tối đa cho mỗi tầng đã tiêu.",
    onHitTaken(k) {
      tideHit(k);
    },
    onAllyHitTaken(k, e) {
      if (!k.oncePerRound("triều đồng đội")) return;
      k.stack("triều", 1, 3, true);
      k.proc("tích triều đồng đội", e.target);
    },
    incoming(k, e) {
      const n = k.e["triều"] ?? 0;
      if (!e.direct || n <= 0) return;
      k.proc("hải thành giảm");
      return n * k.p.guard;
    },
    roundEnd(k) {
      const n = k.e["triều"] ?? 0;
      if (n < 3) return;
      k.stack("triều", -n, 3, true);
      k.proc("triều rút");
      for (const u of k.team)
        if (k.heal(u, n * k.p.regen).healed > 0)
          k.proc(u === k.self ? "triều hồi" : "triều hồi đồng đội", u);
    },
  },

  // 172 Tiểu Cánh Cụt
  172: {
    name: "Băng nhận rạch giáp",
    params: { shred: 6 },
    text: "Mỗi đòn trực tiếp trúng làm mục tiêu giảm {shred}% DEF trong 2 lượt (tối đa 3 tầng). Nếu mục tiêu đang có buff DEF, đòn đó xóa buff DEF thay vì thêm tầng (cứ 3 lượt 1 lần).",
    onHitDealt(k, e) {
      if (!e.target.alive()) return;
      if (e.target.statuses.has(BUFF_BANK, DEF_TIER_ID) && k.tryUse("xóa giáp", 3)) {
        e.target.statuses.remove(BUFF_BANK, DEF_TIER_ID);
        e.target.restoreSourceStatusState();
        k.proc("xóa buff DEF", e.target);
        return;
      }
      shred(k, e.target, k.p.shred);
    },
  },

  // 173 Đao Phong Cánh Cụt
  173: {
    name: "Đao phong đoạt bảo",
    params: { shred: 8 },
    text: "Mỗi đòn trực tiếp trúng làm mục tiêu giảm {shred}% DEF trong 2 lượt (tối đa 3 tầng). Trạng thái có lợi bị Đế Cụt Hải Trảm · Phá gỡ được chuyển sang pet trong 2 lượt.",
    beforeAction(k, e) {
      if (e.skill?.name === BREAK_173) snapshotBuffs(k, e.target);
      else buffSnapshot.delete(k.self);
    },
    onHitDealt(k, e) {
      shred(k, e.target, k.p.shred);
    },
    afterAction(k, e) {
      const snap = buffSnapshot.get(k.self);
      buffSnapshot.delete(k.self);
      if (!snap || !e.target) return;
      for (const [id, old] of snap) {
        if (e.target.statuses.has(BUFF_BANK, id)) continue;
        copyStatus(k.self, old, 2);
        k.proc("đoạt buff", e.target);
        return;
      }
    },
  },

  // 174 Đế Vương Cánh Cụt
  174: {
    name: "Đế cụt băng triều",
    params: { shred: 8, bonus: 15 },
    text: "Mỗi đòn trực tiếp trúng làm mục tiêu giảm {shred}% DEF trong 2 lượt (tối đa 3 tầng). Đánh mục tiêu đã đủ 3 tầng thì đòn đó gây thêm {bonus}% sát thương, và đối thủ còn lại (nếu có) nhận 1 tầng.",
    outgoing(k, e) {
      k.e.full = 0;
      if (!e.skill?.attack || k.marked(e.target, "phá giáp") < 3) return;
      k.e.full = 1;
      k.proc("giáp vỡ +sát thương", e.target);
      return k.p.bonus;
    },
    onHitDealt(k, e) {
      shred(k, e.target, k.p.shred);
      if (k.e.full !== 1) return;
      k.e.full = 0;
      const other = k.otherFoe(e.target);
      if (other && shred(k, other, k.p.shred) > 0) k.proc("lan phá giáp", other);
    },
  },

  // 175 Hải Quy
  175: {
    name: "Mai rùa song thế",
    params: { guard: 15 },
    text: "Khi HP trên 50%, giảm {guard}% sát thương nhận. Khi HP từ 50% trở xuống, mỗi lần bị đánh trúng nhận 1 tầng DEF +7% trong 2 lượt (tối đa 3 tầng).",
    incoming(k, e) {
      if (!e.direct || k.hpPct() <= 50) return;
      k.proc("mai rùa giảm");
      return k.p.guard;
    },
    onHitTaken(k) {
      if (k.hpPct() > 50) return;
      addDefenseTiers(k, k.self, 1);
      k.proc("mai rùa giáp");
    },
  },

  // 176 Rùa trinh sát
  176: {
    name: "Huyền giáp trinh sát",
    params: { shield: 14, acc: 15 },
    text: "Bị đánh trúng thì nhận khiên chắn {shield}% HP tối đa trong 2 lượt; cứ 3 lượt kích hoạt 1 lần, tối đa 2 lần mỗi trận. Kẻ làm vỡ khiên này bị giảm {acc}% chính xác trong 2 lượt.",
    incoming(k, e) {
      if (e.direct) k.e.shUp = k.v.myShield === 1 && k.shieldHp() > 0 ? 1 : 0;
    },
    onHitTaken(k, e) {
      if (k.e.shUp && k.shieldHp() <= 0) {
        k.v.myShield = 0;
        if (k.inflict(e.source, "accuracy_down", 2, { value: k.p.acc }))
          k.proc("vỡ khiên mù", e.source);
      }
      k.e.shUp = 0;
      if ((k.v.shields ?? 0) >= 2 || !k.ready("huyền giáp", 3)) return;
      if (k.shield(k.self, k.p.shield, 2)) {
        k.use("huyền giáp");
        k.v.shields = (k.v.shields ?? 0) + 1;
        k.v.myShield = 1;
        k.proc("huyền giáp");
      }
    },
  },

  // 177 Rùa ma biển sâu
  177: {
    name: "U minh hủ giáp",
    params: { shield: 15 },
    text: "Bị đánh trúng thì nhận khiên chắn {shield}% HP tối đa trong 2 lượt; cứ 2 lượt 1 lần. Khi khiên này còn, kẻ đánh trực tiếp vào pet bị Hủ Thực 3 lượt nếu chưa có.",
    incoming(k, e) {
      if (e.direct) k.e.shUp = k.v.myShield === 1 && k.shieldHp() > 0 ? 1 : 0;
    },
    onHitTaken(k, e) {
      if (k.e.shUp && !k.has(e.source, "corrosion")) {
        if (k.inflict(e.source, "corrosion", 3, { refresh: false })) k.proc("hủ giáp", e.source);
      }
      if (k.shieldHp() <= 0) k.v.myShield = 0;
      k.e.shUp = 0;
      if (!k.ready("hủ giáp khiên", 2)) return;
      if (k.shield(k.self, k.p.shield, 2)) {
        k.use("hủ giáp khiên");
        k.v.myShield = 1;
        k.proc("khiên u minh");
      }
    },
  },

  // 178 Rùa khổng lồ biển sâu
  178: {
    name: "Địa thành cự quy",
    params: { guard: 20, per: 8, cap: 24 },
    text: "Mỗi lượt, đòn trực tiếp đầu tiên đánh trúng pet giảm {guard}% sát thương. Mỗi tầng DEF đang có giúp đòn của pet gây thêm {per}% sát thương (tối đa +{cap}%).",
    incoming(k, e) {
      if (!e.direct || k.hitsTakenThisRound > 0 || !k.oncePerRound("đòn đầu")) return;
      k.proc("địa thành giảm", e.source);
      return k.p.guard;
    },
    outgoing(k, e) {
      const tiers = k.defenseTiers();
      if (!e.skill?.attack || tiers <= 0) return;
      k.proc("giáp +sát thương");
      return Math.min(tiers * k.p.per, k.p.cap);
    },
  },

  // 179 Cua vàng
  179: {
    name: "Kim giáp lột xác",
    params: { guard: 10 },
    text: "Chiêu hồi máu của pet cho mục tiêu được chữa 2 tầng DEF +7% trong 2 lượt (chung giới hạn 3 tầng). Khi pet có từ 2 tầng DEF trở lên, giảm {guard}% sát thương nhận.",
    healOut(k, e) {
      if (!k.oncePerRound("kim giáp")) return;
      addDefenseTiers(k, e.target, 2);
      k.proc("kim giáp", e.target);
    },
    incoming(k, e) {
      if (!e.direct || k.defenseTiers() < 2) return;
      k.proc("kim giáp giảm");
      return k.p.guard;
    },
  },

  // 180 Cua vân Bạc
  180: {
    name: "Ngân giáp tái sinh",
    params: { regen: 3, cap: 9, reflect: 11 },
    text: "Khi HP từ 50% trở xuống, cuối lượt mỗi tầng DEF đang có hồi {regen}% HP tối đa (tối đa {cap}%); cứ 2 lượt 1 lần. Khi đang có đủ 3 tầng DEF, đòn trực tiếp đầu tiên mỗi lượt đánh trúng pet bị phản {reflect}% lượng HP vừa mất.",
    roundEnd(k) {
      if (k.hpPct() > 50 || !k.ready("ngân giáp hồi", 2)) return;
      const tiers = k.defenseTiers();
      if (tiers > 0 && k.heal(k.self, Math.min(tiers * k.p.regen, k.p.cap)).healed > 0) {
        k.use("ngân giáp hồi");
        k.proc("ngân giáp hồi");
      }
    },
    onHitTaken(k, e) {
      if (k.defenseTiers() < 3) return;
      const amount = pct(e.damage, k.p.reflect);
      if (amount <= 0 || !k.oncePerRound("ngân giáp phản")) return;
      k.proc("ngân giáp phản", e.source);
      return amount;
    },
  },

  // 181 Cua thiên sứ
  181: {
    name: "Thiên giải hồi giáp",
    params: { regen: 4, cap: 12 },
    text: "Chiêu hồi máu của pet cho mục tiêu 2 tầng DEF +7% trong 2 lượt. Cuối mỗi lượt, pet và đồng đội mỗi bên hồi {regen}% HP tối đa cho mỗi tầng DEF do pet trao đang có (tối đa {cap}%).",
    healOut(k, e) {
      if (!k.oncePerRound("trao giáp")) return;
      addDefenseTiers(k, e.target, 2);
      k.mark(e.target, "giáp trao", 2);
      k.proc("trao giáp", e.target);
    },
    roundEnd(k) {
      for (const u of k.team) {
        if (k.marked(u, "giáp trao") <= 0) continue;
        const tiers = Math.min(3, k.defenseTiers(u));
        if (tiers > 0 && k.heal(u, Math.min(tiers * k.p.regen, k.p.cap)).healed > 0)
          k.proc(u === k.self ? "giáp hồi" : "giáp hồi đồng đội", u);
      }
    },
  },

  // 182 Cá heo
  182: {
    name: "Âm lôi lan tỏa",
    params: { para: 20, bonus: 15, splash: 30 },
    text: "Chiêu hệ Lôi đánh trúng có {para}% gây Tê Liệt 2 lượt (không làm mới). Đánh đối thủ đang Tê Liệt hoặc Giam Cầm gây thêm {bonus}% sát thương; nếu có đối thủ thứ hai, đòn đó còn giật lan {splash}% sát thương sang nó.",
    outgoing(k, e) {
      k.e.bound = 0;
      if (!e.skill?.attack || (!k.has(e.target, "paralysis") && !k.has(e.target, "bind"))) return;
      k.e.bound = 1;
      k.proc("âm lôi +sát thương", e.target);
      return k.p.bonus;
    },
    onHitDealt(k, e) {
      if (k.e.bound === 1) {
        k.e.bound = 0;
        const other = k.otherFoe(e.target);
        if (other && k.damage(other, pct(e.damage, k.p.splash)) > 0) k.proc("giật lan", other);
      }
      if (!isAttack(e.skill, ELECTRIC) || k.has(e.target, "paralysis")) return;
      if (k.chance(k.p.para, "tê") && k.inflict(e.target, "paralysis", 2, { refresh: false }))
        k.proc("tê liệt", e.target);
    },
  },

  // 183 Cá heo tốc độ
  183: {
    name: "Hải đồn tiếp sức",
    params: { shield: 15, first: 20, speed: 10 },
    text: "Rời sân bằng Hải Đồn Tật Chuyển: pet vào thay nhận khiên {shield}% HP tối đa 2 lượt và đòn đầu tiên của nó gây thêm {first}%. Không đổi được (không còn pet dự bị hoặc bị Giam Cầm) thì chính pet nhận hiệu ứng đó. Đồng đội đứng cạnh pet được Linh xảo +{speed}%.",
    onEnter(k) {
      const ally = k.ally;
      if (!ally) return;
      k.statUp(ally, "speed", k.p.speed, 2, "hải đồn");
      k.proc("đồng đội nhanh", ally);
    },
    roundEnd(k) {
      // Đổi không thành (không có dự bị, bị Giam Cầm): pet vẫn trên sân cuối lượt → tự nhận hiệu ứng.
      if (k.e.relay === k.round) {
        k.e.relay = 0;
        k.shield(k.self, k.p.shield, 2);
        k.e.first = 1;
        k.proc("tự tiếp sức");
      }
      const ally = k.ally;
      if (!ally) return;
      k.statUp(ally, "speed", k.p.speed, 2, "hải đồn");
      k.proc("đồng đội nhanh", ally);
    },
    afterAction(k, e) {
      if (e.skill?.name !== PIVOT_183 || !e.hit) return;
      k.v.pivot = k.round;
      k.e.relay = k.round;
    },
    outgoing(k, e) {
      if (k.e.first !== 1 || !e.skill?.attack || e.skill.name === PIVOT_183) return;
      k.e.first = 0;
      k.proc("đòn tiếp sức", e.target);
      return k.p.first;
    },
    onLeave(k, e) {
      if (e.fainted || !e.next || k.v.pivot !== k.round) return;
      // Xấp xỉ: chỉ trao được khiên; đòn đầu +first% của pet vào thay cần hook trên pet đó.
      k.shield(e.next, k.p.shield, 2);
      k.proc("tiếp sức", e.next);
    },
  },

  // 184 Ngựa chiến
  184: {
    name: "Chiến mã xung phong",
    params: { per: 8 },
    text: "Ra đòn trước đối thủ hoặc đánh trúng đối thủ đang Gieo Hạt/Xé Rách thì nhận 1 dấu Đà (tối đa 2; mỗi dấu +{per}% sát thương). Chiến Mã Liệt Xung · Bạo tiêu dấu lên Power 190. Hạ gục đối thủ thì giữ nguyên Đà. Gieo Hạt/Xé Rách do đồng đội gây ra cũng cho dấu Đà.",
    outgoing(k, e) {
      k.e.spent = 0;
      k.e.dot = k.has(e.target, "seed") || k.has(e.target, "bleed") ? 1 : 0;
      const n = k.v["đà"] ?? 0;
      if (!e.skill?.attack || n <= 0) return;
      let bonus = n * k.p.per;
      if (e.skill.name === BURST_184) {
        k.e.spent = n;
        k.stack("đà", -n, 2);
        bonus += BURST_BONUS;
        k.proc("tiêu đà");
      } else k.proc("đà +sát thương");
      return bonus;
    },
    onHitDealt(k, e) {
      if (!e.skill?.attack || (k.e.spent ?? 0) > 0) return;
      if (!k.self.designTraitState.actedFirst && k.e.dot !== 1) return;
      if (!k.oncePerRound("đà")) return;
      k.stack("đà", 1, 2);
      k.proc("tích đà");
    },
    onFoeFaint(k, e) {
      // Hạ gục bằng đòn tiêu dấu: dấu được giữ lại.
      const spent = k.e.spent ?? 0;
      if (!e.byMe || spent <= 0) return;
      k.e.spent = 0;
      k.stack("đà", spent, 2);
      k.proc("giữ đà");
    },
  },

  // 185 Quỷ Vương Địa Phủ (dạng công; chủ dự án 2026-11-18 đổi từ khiên thủ sang ghi sổ + phán quyết)
  185: {
    name: "Phán quyết Sổ Sinh Tử",
    params: { mark: 10, judge: 40, low: 40, drain: 50 },
    text: "Mỗi đòn tấn công trúng ghi tên đối thủ vào Sổ Sinh Tử (1 tầng, tối đa 3, giữ 3 lượt); mỗi tầng giúp đòn của pet lên đối thủ đó gây thêm {mark}% sát thương. Đòn hệ Quỷ vào đối thủ đủ 3 tầng hoặc còn từ {low}% HP trở xuống là Phán quyết (cứ 2 lượt 1 lần): tiêu hết tầng, gây thêm {judge}% sát thương và hút {drain}% sát thương gây ra. Mỗi trận 1 lần, đòn lẽ ra hạ gục pet khi còn trên 50% HP thì pet trụ lại với 1 HP.",
    outgoing(k, e) {
      if (!e.skill?.attack) return;
      const n = k.marked(e.target, "sổ sinh tử");
      let bonus = n * k.p.mark;
      const due = n >= 3 || k.hpPct(e.target) <= k.p.low;
      if (isAttack(e.skill, GHOST) && due && k.ready("phán quyết", 2)) {
        k.use("phán quyết");
        k.unmark(e.target, "sổ sinh tử");
        k.e.judge = 1;
        bonus += k.p.judge;
        k.proc("phán quyết", e.target);
      }
      return bonus;
    },
    onHitDealt(k, e) {
      if (k.e.judge === 1 || !e.target.alive()) return;
      k.mark(e.target, "sổ sinh tử", 3, 3);
      k.proc("ghi sổ", e.target);
    },
    afterAction(k, e) {
      if (k.e.judge !== 1) return;
      k.e.judge = 0;
      if (e.damage > 0) drain(k, e.damage, k.p.drain, "hút hồn");
    },
    incoming(k, e) {
      // Đòn lẽ ra hạ gục khi đang trên 50% HP: khiên tạm đỡ phần vượt để pet còn 1 HP.
      if (!e.direct || k.v.judged || k.hpPct() <= 50) return;
      const hp = k.self.hp();
      if (e.damage < hp) return;
      k.v.judged = 1;
      k.shieldAmount(k.self, e.damage - (hp - 1), 1);
      k.proc("trụ lại");
    },
  },

  // 186 Quỷ Vương Địa Phủ (Hồn Liệp)
  186: {
    name: "Địa phủ câu hồn",
    params: { drain: 80, heal: 25 },
    text: "Đánh đối thủ dưới 50% HP thì hút {drain}% sát thương gây ra (cứ 2 lượt 1 lần; sát thương vào khiên không tính). Hạ gục đối thủ thì pet hồi {heal}% HP tối đa và lượt kế được ưu tiên ra đòn trước. Trong trận đôi, lượt ưu tiên đó có thể dùng để đánh đối thủ còn lại hoặc pet vào thay.",
    outgoing(k, e) {
      if (!e.skill?.attack || k.hpPct(e.target) >= 50 || !k.tryUse("câu hồn", 2)) return;
      k.e.reap = 1;
    },
    afterAction(k, e) {
      // e.damage là máu thực mất (sau khiên).
      if (k.e.reap === 1) drain(k, e.damage, k.p.drain, "câu hồn");
      // Lượt ưu tiên đã dùng (hành động ở lượt sau lượt hạ gục).
      if (k.v.prio !== undefined && k.round > k.v.prio) delete k.v.prio;
      k.e.reap = 0;
    },
    onFoeFaint(k, e) {
      if (!e.byMe) return;
      k.heal(k.self, k.p.heal);
      k.v.prio = k.round;
      k.proc("thu hồn", e.foe);
    },
    priority(k, e) {
      if (k.v.prio === undefined) return;
      k.proc("ưu tiên thu hồn", e.opponent);
      return true;
    },
  },

  // 187 Cáp Cáp Thụ
  187: {
    name: "Rễ mục hút sinh",
    params: { heal: 10 },
    text: "Khi Hủ Thực do pet gây ra làm đối thủ mất HP cuối lượt, pet hồi {heal}% HP tối đa (mỗi lượt 1 lần); nếu đồng đội thấp máu hơn thì lượng hồi dành cho đồng đội.",
    onDotTick(k, e) {
      if (e.status !== "corrosion" || e.damage <= 0 || !k.oncePerRound("rễ mục")) return;
      const to = lowestTeam(k);
      if (k.heal(to, k.p.heal).healed > 0)
        k.proc(to === k.self ? "rễ mục hồi" : "rễ mục hồi đồng đội", to);
    },
  },

  // 188 Thụ tinh ngàn năm
  188: {
    name: "Ngàn năm mục lâm",
    params: { heal: 8 },
    text: "Mỗi tick Hủ Thực do pet gây ra hồi cho pet {heal}% HP tối đa và cho 1 tầng DEF +7% trong 2 lượt. Khi đối thủ mang Hủ Thực của pet rời sân hoặc gục, Hủ Thực lan sang đối thủ đứng cạnh hoặc pet vào thay, giữ số lượt còn lại.",
    onEnter(k) {
      watchSwap(k);
    },
    beforeAction(k) {
      watchSwap(k);
    },
    onDotTick(k, e) {
      if (e.status !== "corrosion") return;
      k.mark(e.target, "mục lâm", 2);
      noteCorrosion(k);
      k.heal(k.self, k.p.heal);
      addDefenseTiers(k, k.self, 1);
      k.proc("mục lâm hồi");
    },
    afterAction(k, e) {
      if (e.target && e.newStatuses.includes("corrosion")) k.mark(e.target, "mục lâm", 4);
      noteCorrosion(k);
    },
    onOtherAction(k) {
      watchSwap(k);
      noteCorrosion(k);
    },
    onFoeFaint(k, e) {
      if (!k.twoVsTwo) return;
      spreadCorrosion(k, k.otherFoe(e.foe), e.foe);
    },
    roundEnd(k) {
      watchSwap(k);
      noteCorrosion(k);
    },
  },

  // 189 Hoa Tiên Tử
  189: {
    name: "Hoa tiên tịnh thế",
    params: { regen: 6, bonus: 30, cap: 25 },
    text: "Cuối mỗi lượt, pet và đồng đội mỗi bên hồi {regen}% HP tối đa; cứ 2 lượt xóa thêm 1 hiệu ứng xấu trên mỗi bên. Chiêu hồi máu của pet hồi thêm {bonus}%, phần vượt HP tối đa thành khiên chắn (tối đa {cap}% HP, 2 lượt).",
    roundEnd(k) {
      const team = k.team;
      for (const u of team)
        if (k.heal(u, k.p.regen).healed > 0)
          k.proc(u === k.self ? "tiên hồi" : "tiên hồi đồng đội", u);
      if (!k.ready("tịnh thế", 2) || !team.some((u) => k.debuffs(u) > 0)) return;
      k.use("tịnh thế");
      for (const u of team) if (k.cleanse(u, 1) > 0) k.proc("tịnh thế", u);
    },
    healOut(k, e) {
      const extra = pct(e.amount, k.p.bonus);
      const over = e.amount + extra - missing(e.target);
      if (over > 0 && k.shieldAmount(e.target, Math.min(over, k.pctOf(e.target, k.p.cap)), 2))
        k.proc("hồi tràn thành khiên", e.target);
      k.proc("tiên dưỡng", e.target);
      return extra;
    },
  },

  // 190 Cá Chép Rồng
  190: {
    name: "Lân sắt tích giáp",
    params: { reflect: 15 },
    text: "Mỗi lần bị đánh trúng, nhận 1 tầng DEF +7% trong 2 lượt (chung giới hạn 3 tầng). Khi có đủ 3 tầng, đòn trực tiếp đánh trúng pet bị phản {reflect}% lượng HP vừa mất.",
    onHitTaken(k, e) {
      const full = k.defenseTiers() >= 3;
      addDefenseTiers(k, k.self, 1);
      k.proc("lân sắt");
      if (!full) return;
      const amount = pct(e.damage, k.p.reflect);
      if (amount <= 0) return;
      k.proc("lân sắt phản", e.source);
      return amount;
    },
  },

  // 191 Cá Chép Rồng sắt
  191: {
    name: "Vượt long môn",
    params: { heal: 6, atk: 10 },
    text: "Mỗi lần bị đánh trúng, nhận 1 tầng DEF +7% trong 2 lượt (chung giới hạn 3 tầng). Lần đầu HP xuống dưới 50%, pet hóa rồng: tiêu toàn bộ tầng DEF, mỗi tầng hồi {heal}% HP tối đa, và Sức mạnh +{atk}% mỗi tầng đã tiêu đến khi rời sân.",
    onHitTaken(k) {
      addDefenseTiers(k, k.self, 1);
      k.proc("vảy giáp");
    },
    onDamaged(k, e) {
      if (k.v.dragon || (e.after * 100) / k.self.maxHp() >= 50) return;
      k.v.dragon = 1;
      const n = k.defenseTiers();
      if (n > 0) {
        k.self.statuses.remove(BUFF_BANK, DEF_TIER_ID);
        k.self.restoreSourceStatusState();
        k.heal(k.self, n * k.p.heal);
      }
      k.e.dragon = n;
      k.refresh();
      k.proc("hóa rồng");
    },
    statBonus(k, stat) {
      if (stat === "attack" && (k.e.dragon ?? 0) > 0) return k.e.dragon * k.p.atk;
    },
  },

  // 192 Phá Hư Thần
  192: {
    name: "Phá hư đoạn luật",
    params: { pierce: 25, bonus: 50, aura: 50 },
    text: "Đòn trực tiếp của pet bỏ qua {pierce}% DEF và mọi tầng tăng DEF của mục tiêu. Nếu mục tiêu có trạng thái có lợi hoặc khiên, đòn hệ Quỷ gây thêm {bonus}% và xóa 1 trạng thái có lợi. Khi pet trên sân, khiên đối thủ nhận được chỉ còn {aura}% giá trị.",
    onEnter(k) {
      for (const foe of k.foes) shieldSeen.set(foe, k.shieldHp(foe));
    },
    pierce(k, e) {
      // Tầng tăng DEF: phần DEF hiện tại vượt DEF gốc, đổi thành % bỏ qua thêm.
      const cur = e.target.currentStats.defense;
      const base = e.target.baseStats.defense;
      const up = cur > base ? Math.trunc(((cur - base) * 100) / cur) : 0;
      if (up > 0) k.proc("bỏ qua tầng DEF", e.target);
      return k.p.pierce + up;
    },
    outgoing(k, e) {
      shieldAura(k);
      k.e.purge = 0;
      if (!isAttack(e.skill, GHOST)) return;
      if (k.buffs(e.target) <= 0 && k.shieldHp(e.target) <= 0) return;
      k.e.purge = 1;
      k.proc("đoạn luật +sát thương", e.target);
      return k.p.bonus;
    },
    onHitDealt(k, e) {
      if (k.e.purge === 1) {
        k.e.purge = 0;
        if (k.dispel(e.target, 1) > 0) k.proc("xóa buff", e.target);
      }
      shieldSeen.set(e.target, k.shieldHp(e.target));
    },
    onOtherAction(k) {
      shieldAura(k);
    },
    roundEnd(k) {
      shieldAura(k);
    },
  },

  // 193 Bạch Thiên Sử
  193: {
    name: "Thánh quang trừng phạt",
    params: { smite: 40, cap: 12, guard: 20 },
    text: "Mỗi lần chiêu hồi máu của pet hồi HP, mọi đối thủ trên sân chịu sát thương hệ Hỏa bằng {smite}% lượng hồi (tối đa {cap}% HP tối đa của pet). Lượt dùng chiêu hồi máu, pet giảm {guard}% sát thương nhận.",
    beforeAction(k, e) {
      // Xấp xỉ: giảm sát thương từ lúc pet hành động tới hết lượt (kit chưa biết chiêu sớm hơn).
      if (isHeal(e.skill)) k.e.healTurn = k.round;
      k.e.healed = 0;
    },
    healOut(k, e) {
      k.e.healed = (k.e.healed ?? 0) + Math.min(e.amount, missing(e.target));
    },
    afterAction(k) {
      const healed = k.e.healed ?? 0;
      k.e.healed = 0;
      if (healed <= 0) return;
      const amount = Math.min(pct(healed, k.p.smite), k.pctOf(k.self, k.p.cap));
      const foes = k.twoVsTwo ? k.foes : k.foe ? [k.foe] : [];
      for (const foe of foes) if (k.damage(foe, amount) > 0) k.proc("thánh quang", foe);
    },
    incoming(k, e) {
      if (!e.direct || k.e.healTurn !== k.round) return;
      k.proc("thánh quang giảm");
      return k.p.guard;
    },
  },

  // 194 Thiên Sử Trường
  194: {
    name: "Thiên sứ song dực",
    params: { fire: 12, drain: 20, heal: 10 },
    text: "Khi HP trên 60%: chiêu hệ Hỏa gây thêm {fire}% sát thương. Khi HP từ 60% trở xuống: đòn tấn công hút {drain}% sát thương gây ra. Lần đầu chuyển xuống dưới 60%, pet hồi ngay {heal}% HP tối đa.",
    outgoing(k, e) {
      k.e.low = k.hpPct() <= 60 ? 1 : 0;
      if (k.e.low || !isAttack(e.skill, FIRE)) return;
      k.proc("cánh sáng +sát thương");
      return k.p.fire;
    },
    afterAction(k, e) {
      const low = k.e.low === 1;
      k.e.low = 0;
      if (low && e.skill?.attack && e.damage > 0) drain(k, e.damage, k.p.drain, "cánh tối hút máu");
    },
    onDamaged(k, e) {
      if (k.v.fell || (e.after * 100) / k.self.maxHp() >= 60) return;
      k.v.fell = 1;
      if (k.heal(k.self, k.p.heal).healed > 0) k.proc("song dực hồi");
    },
  },

  // 195 Phi Thiên Huyền Nữ
  195: {
    name: "Huyền nữ định hồn",
    params: { weaken: 30 },
    text: "Chiêu tấn công trúng đối thủ thì phong ấn chiêu có uy lực cao nhất của nó trong 2 lượt và đối thủ gây ít hơn {weaken}% sát thương trong 2 lượt; cứ 3 lượt 1 lần. Đối thủ đổi pet hoặc được giải trừ thì hết phong ấn.",
    onHitDealt(k, e) {
      if (!e.skill?.attack || !e.target.alive() || !k.ready("định hồn", 3)) return;
      k.use("định hồn");
      if (k.inflict(e.target, "damage_down", 2, { value: k.p.weaken }))
        k.proc("định hồn", e.target);
      if (sealTop(k, e.target)) k.proc("phong ấn", e.target);
    },
    afterAction(k) {
      releaseSeals(k);
    },
    onOtherAction(k) {
      releaseSeals(k);
    },
    roundEnd(k) {
      releaseSeals(k);
    },
    onLeave(k) {
      releaseSeals(k, true);
    },
  },

  // 196 Sói mặt trăng
  196: {
    name: "Sói non vây mồi",
    params: { pack: 15, drain: 15 },
    text: "Đánh mục tiêu đã bị đồng đội đánh trúng trong cùng lượt gây thêm {pack}% sát thương (không có đồng đội thì áp dụng khi mục tiêu dưới 60% HP). Đánh mục tiêu đang bị giảm Linh xảo hoặc Xé Rách thì hút {drain}% sát thương.",
    onAllyHitDealt(k, e) {
      k.mark(e.target, "vây", 1);
    },
    outgoing(k, e) {
      k.e.prey = k.has(e.target, "agility_down") || k.has(e.target, "bleed") ? 1 : 0;
      if (!e.skill?.attack) return;
      return packBonus(k, e.target);
    },
    afterAction(k, e) {
      const prey = k.e.prey === 1;
      k.e.prey = 0;
      if (prey && e.skill?.attack && e.damage > 0) drain(k, e.damage, k.p.drain, "hút mồi");
    },
  },

  // 197 Sói Vương Cao Ngạo
  197: {
    name: "Ngạo nguyệt tru",
    params: { pack: 15, atk: 20, heal: 10 },
    text: "Đánh mục tiêu đã bị đồng đội đánh trúng trong cùng lượt gây thêm {pack}% sát thương (không có đồng đội thì áp dụng khi mục tiêu dưới 60% HP). Hạ gục đối thủ thì pet hú: pet và đồng đội Sức mạnh +{atk}% trong 2 lượt, pet hồi {heal}% HP tối đa.",
    onAllyHitDealt(k, e) {
      k.mark(e.target, "vây", 1);
    },
    outgoing(k, e) {
      if (!e.skill?.attack) return;
      return packBonus(k, e.target);
    },
    onFoeFaint(k, e) {
      if (!e.byMe) return;
      for (const u of k.team) k.statUp(u, "attack", k.p.atk, 2, "nguyệt tru");
      k.heal(k.self, k.p.heal);
      k.proc("nguyệt tru");
      if (k.ally) k.proc("nguyệt tru đồng đội", k.ally);
    },
  },

  // 198 Ngân Hồ Vương Tử
  198: {
    name: "Cửu vĩ hoán pháp",
    params: { atk: 20 },
    text: "Đòn trực tiếp trúng gây Mị Hoặc 2 lượt (đối thủ giảm 15% sát thương) nếu chưa có; cứ 2 lượt 1 lần. Khi Mị Hoặc do pet gây kết thúc (hết hạn hoặc bị xóa), pet đánh cắp 1 trạng thái có lợi của mục tiêu; không có thì nhận Sức mạnh +{atk}% trong 2 lượt.",
    onHitDealt(k, e) {
      if (!e.target.alive() || k.has(e.target, "charm") || !k.ready("mị", 2)) return;
      if (charmed.get(k.self)) return;
      if (k.inflict(e.target, "charm", 2, { refresh: false })) {
        k.use("mị");
        charmed.set(k.self, e.target);
        k.proc("mị hoặc", e.target);
      }
    },
    afterAction(k) {
      charmEnd(k);
    },
    onOtherAction(k) {
      charmEnd(k);
    },
    roundEnd(k) {
      charmEnd(k);
    },
  },

  // 199 Tê Lợi Sa
  199: {
    name: "Khứu huyết cuồng sa",
    params: { speed: 20, bonus: 10 },
    text: "Khi đối thủ dưới 50% HP hoặc đang Xé Rách/Gieo Hạt, pet được Linh xảo +{speed}% và đòn của pet gây thêm {bonus}% sát thương. Đối thủ bị đồng đội đánh xuống dưới 50% HP hoặc dính Gieo Hạt cũng kích hoạt hiệu ứng này.",
    statBonus(k, stat) {
      if (stat === "speed" && k.foes.some((f) => bloodScent(k, f))) return k.p.speed;
    },
    outgoing(k, e) {
      if (!e.skill?.attack || !bloodScent(k, e.target)) return;
      k.proc("khứu huyết +sát thương", e.target);
      return k.p.bonus;
    },
    afterAction(k) {
      k.refresh();
    },
    onOtherAction(k) {
      k.refresh();
    },
    roundEnd(k) {
      k.refresh();
      if (k.foes.some((f) => bloodScent(k, f))) k.proc("khứu huyết linh xảo");
    },
  },
};
