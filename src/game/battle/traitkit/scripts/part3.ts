import type { DesignTraitUnit } from "../../DesignTraits";
import { KIT_STATUS, type Kit, type KitSkill, type KitStatus, type TraitScript } from "../TraitKit";

/** Chiêu hồi máu: chiêu hỗ trợ nhắm phe mình mang tên hồi (Dưỡng, Hồi Sinh, Chữa Lành…). */
function isHeal(skill: KitSkill | undefined): boolean {
  return (
    !!skill &&
    skill.support &&
    skill.ownSide &&
    /Dưỡng|Hồi Sinh|Chữa Lành|Tái Tạo|Hồi Tuyền/i.test(skill.name)
  );
}

/** Pet phe mình có tỉ lệ HP thấp nhất (1v1: chính pet). */
function lowestTeam(k: Kit): DesignTraitUnit {
  let best = k.self;
  for (const u of k.team) if (k.hpPct(u) < k.hpPct(best)) best = u;
  return best;
}

/** Đối thủ có tỉ lệ HP cao nhất / thấp nhất. */
function foeByHp(k: Kit, highest: boolean): DesignTraitUnit | undefined {
  let best: DesignTraitUnit | undefined;
  for (const f of k.foes)
    if (!best || (highest ? k.hpPct(f) > k.hpPct(best) : k.hpPct(f) < k.hpPct(best))) best = f;
  return best;
}

/** HP vừa vượt xuống dưới ngưỡng `pct`% trong một lần mất máu. */
function crossed(unit: DesignTraitUnit, before: number, after: number, pct: number): boolean {
  const line = (unit.maxHp() * pct) / 100;
  return before >= line && after < line;
}

/** Hút `pct`% sát thương thực (tối đa `capPct`% HP tối đa của `to` nếu có) về `to`. */
function drain(
  k: Kit,
  damage: number,
  pct: number,
  label: string,
  capPct?: number,
  to: DesignTraitUnit = k.self,
): void {
  if (damage <= 0) return;
  let amount = Math.trunc((damage * pct) / 100);
  if (capPct !== undefined) amount = Math.min(amount, k.pctOf(to, capPct));
  if (k.healAmount(to, amount).healed > 0) k.proc(label, to);
}

/** Con Mồi (95, 96): đánh dấu đối thủ ít HP nhất 3 lượt, giảm Linh xảo. */
function markPrey(k: Kit, key: string): void {
  if (k.e.prey) return;
  const prey = foeByHp(k, false);
  if (!prey) return;
  k.e.prey = 1;
  k.mark(prey, "prey", 3);
  k.statUp(prey, "speed", -k.p.slow, 3, key);
  k.proc("con mồi", prey);
}

/** 96: Con Mồi dưới 35% HP và cú sà đã hồi (3 lượt 1 lần). */
function swoopReady(k: Kit, target: DesignTraitUnit | undefined): boolean {
  return !!target && k.marked(target, "prey") > 0 && k.hpPct(target) < 35 && k.ready("swoop", 3);
}

/** Tiếng gầm (117–119): đối thủ gây ít sát thương hơn `p.roar`% trong 2 lượt (hiệu ứng xấu). */
function roar(k: Kit, foes: DesignTraitUnit[] = k.foes): void {
  for (const foe of foes)
    if (k.inflict(foe, "damage_down", 2, { value: k.p.roar })) k.proc("gầm", foe);
}

/** Gầm khi ra sân; đầu trận đối thủ có thể chưa lên sân, nên bù ở hành động đầu tiên. */
const roarOnEntry: Pick<TraitScript, "onEnter" | "beforeAction"> = {
  onEnter(k) {
    if (k.foes.length === 0) return;
    k.e.roarTried = 1;
    roar(k);
  },
  beforeAction(k) {
    if (k.e.roarTried) return;
    k.e.roarTried = 1;
    roar(k);
  },
};

/** Tầng Rễ đồng đội (100, 103): DEF +`p.allyDef`% mỗi tầng (trần `cap`%), làm mới mỗi lượt. */
function allyRootDef(k: Kit, key: string, tiers: number, cap = Infinity): void {
  const ally = k.ally;
  if (!ally) return;
  if (tiers <= 0) {
    k.clearStat(ally, key);
    return;
  }
  k.statUp(ally, "defense", Math.min(cap, k.p.allyDef * tiers), 2, key);
  k.proc("rễ đồng đội", ally);
}

/** 88: kéo dài 1 lượt một hiệu ứng xấu vừa gây lên đối thủ (mỗi lượt 1 lần, trừ Ngủ). */
function extendDebuff(
  k: Kit,
  target: DesignTraitUnit | undefined,
  fresh: readonly KitStatus[],
): void {
  if (!target || !target.alive() || !k.isFoe(target)) return;
  const status = fresh.find((s) => s !== "sleep");
  if (!status || !k.ready("extend", 1)) return;
  const slot = KIT_STATUS[status];
  const instance = target.statuses.get(slot.bank, slot.id);
  if (!instance) return;
  k.use("extend");
  instance.remainingTurns += 1;
  // Bảng trạng thái cũ là nơi engine đếm lượt: ghi lại từ trạng thái mới.
  target.restoreSourceStatusState();
  k.proc("kéo dài", target);
}

/** 93: khiên cứu nguy cho từng pet phe mình lần đầu tụt dưới 50% HP (mỗi pet 1 lần mỗi lần ra sân). */
function rescue93(k: Kit, unit: DesignTraitUnit): void {
  const key = `rescue:${strikerKey(unit)}`;
  if (k.e[key] || !unit.alive() || k.hpPct(unit) >= 50) return;
  k.e[key] = 1;
  if (k.shield(unit, k.p.rescue, 2)) k.proc("khiên cứu nguy", unit);
}

/** 97: % DEF mỗi tầng của đặc tính (số viết thẳng trong mô tả đã duyệt). */
const SAND_DEF_97 = 7;
/** 97: số tầng DEF của đặc tính còn hiệu lực, nhường chỗ cho tầng DEF từ chiêu (chung trần 3). */
function sandTiers97(k: Kit): number {
  if ((k.e.sandUntil ?? 0) < k.round) return 0;
  return Math.max(0, Math.min(k.e.sand ?? 0, 3 - k.defenseTiers()));
}

/** 88: các hiệu ứng xấu phụ đặc tính có thể gây (loại mục tiêu chưa có). */
const SHAKE_88: readonly KitStatus[] = ["accuracy_down", "agility_down", "damage_down"];

/** Khóa riêng cho từng kẻ đánh (mỗi kẻ đánh 1 lần mỗi lượt). */
const strikerKey = (u: DesignTraitUnit): string => `${u.ownerSide}:${u.formationSlot}`;

const PIVOT_86 = "Hành Giả Hư Bộ · Chuyển";
const TAT_89 = "Tai Tước Không Sát · Tật";
const DUONG_114 = "Tứ Diệp Hồi Tuyền · Dưỡng";

/** Kịch bản đặc tính, phần 3. */
export const PART_3: Record<number, TraitScript> = {
  // 80 Độc nhãn quái
  80: {
    name: "Độc nhãn hậu phán",
    params: { eye: 20, revenge: 25 },
    text: "Kẻ đầu tiên đánh trúng pet sau mỗi lần ra sân bị gắn Mắt Ác 2 lượt: nó gây ít hơn {eye}% sát thương lên pet và đồng đội của pet. Nếu pet ra đòn sau mục tiêu và vừa bị nó đánh trong lượt, chiêu tấn công +{revenge}% sát thương và làm mới Mắt Ác. Điều kiện vừa bị đánh cũng tính khi mục tiêu đánh đồng đội của pet.",
    onHitTaken(k, e) {
      // Kẻ đầu tiên đánh trúng pet mỗi lần ra sân bị gắn Mắt Ác 2 lượt.
      k.mark(e.source, "hit", 1);
      if (!k.e.eye) {
        k.e.eye = 1;
        k.mark(e.source, "eye", 2);
        k.proc("mắt ác", e.source);
      }
    },
    onAllyHitTaken(k, e) {
      // 2v2: đánh đồng đội cũng tính là "vừa bị nó đánh".
      k.mark(e.source, "hit", 1);
    },
    incoming(k, e) {
      if (e.direct && k.marked(e.source, "eye") > 0) {
        k.proc("mắt ác giảm", e.source);
        return k.p.eye;
      }
    },
    guardAlly(k, e) {
      // 2v2: Mắt Ác bảo vệ cả đồng đội.
      if (k.marked(e.source, "eye") > 0) {
        k.proc("mắt ác che đồng đội", e.target);
        return k.p.eye;
      }
    },
    outgoing(k, e) {
      // Ra đòn sau mục tiêu và vừa bị nó đánh trong lượt: cộng sát thương và làm mới Mắt Ác.
      if (!e.actedFirst && e.skill?.attack && k.marked(e.target, "hit") > 0) {
        k.mark(e.target, "eye", 2);
        k.proc("hậu phán", e.target);
        return k.p.revenge;
      }
    },
  },

  // 81 Độc nhãn cự thần
  81: {
    name: "Cự thần phán nhãn",
    params: { judge: 25, penalty: 6 },
    text: "Đòn đánh trúng gắn Mắt Phán Quyết 2 lượt (3 lượt 1 lần): mục tiêu gây ít hơn {judge}% sát thương. Mỗi khi mục tiêu mang dấu đánh trúng pet, nó mất {penalty}% HP tối đa của chính nó (mỗi lượt 1 lần). Mắt Phán Quyết giảm sát thương của mục tiêu lên cả hai pet phe mình, và phạt {penalty}% kích khi mục tiêu đánh bất kỳ pet nào phe mình.",
    onHitDealt(k, e) {
      // Đòn trúng gắn Mắt Phán Quyết 2 lượt (3 lượt 1 lần).
      if (k.tryUse("judge", 3)) {
        k.mark(e.target, "judge", 2);
        k.proc("mắt phán quyết", e.target);
      }
    },
    incoming(k, e) {
      if (e.direct && k.marked(e.source, "judge") > 0) {
        k.proc("phán quyết giảm", e.source);
        return k.p.judge;
      }
    },
    guardAlly(k, e) {
      // 2v2: giảm sát thương của mục tiêu lên cả đồng đội.
      if (k.marked(e.source, "judge") > 0) {
        k.proc("phán quyết che đồng đội", e.target);
        return k.p.judge;
      }
    },
    onHitTaken(k, e) {
      // Mục tiêu mang dấu đánh trúng pet: mất % HP tối đa của chính nó (mỗi lượt 1 lần).
      if (k.marked(e.source, "judge") > 0 && k.oncePerRound("judgePenalty"))
        if (k.damage(e.source, k.pctOf(e.source, k.p.penalty)) > 0) k.proc("phạt", e.source);
    },
    onAllyHitTaken(k, e) {
      // 2v2: phạt cả khi mục tiêu đánh đồng đội.
      if (k.marked(e.source, "judge") > 0 && k.oncePerRound("judgePenalty"))
        if (k.damage(e.source, k.pctOf(e.source, k.p.penalty)) > 0) k.proc("phạt", e.source);
    },
  },

  // 82 Túi quỷ
  82: {
    name: "Miệng túi khóa hồn",
    params: { bonus: 20, lifesteal: 20, ally: 10 },
    text: "Chiêu tấn công đầu tiên đánh trúng mỗi lần ra sân gây Giam Cầm 2 lượt nếu mục tiêu chưa có. Đánh mục tiêu đang bị Giam Cầm +{bonus}% sát thương và hồi {lifesteal}% sát thương gây ra. Giam Cầm của pet khóa đổi pet của đối thủ; đồng đội đánh mục tiêu bị Giam Cầm cũng được +{ally}% sát thương.",
    beforeAction(k, e) {
      k.e.bound = e.skill?.attack && k.has(e.target, "bind") ? 1 : 0;
    },
    onHitDealt(k, e) {
      // Chiêu tấn công đầu tiên trúng mỗi lần ra sân: Giam Cầm 2 lượt nếu chưa có.
      if (!e.skill?.attack || k.e.firstBind) return;
      k.e.firstBind = 1;
      if (!k.has(e.target, "bind") && k.inflict(e.target, "bind", 2)) k.proc("giam cầm", e.target);
    },
    outgoing(k, e) {
      if (e.skill?.attack && k.e.bound) {
        k.proc("giam cầm +sát thương", e.target);
        return k.p.bonus;
      }
    },
    afterAction(k, e) {
      if (k.e.bound && e.hit) drain(k, e.damage, k.p.lifesteal, "hút giam cầm");
      k.e.bound = 0;
    },
    allyOutgoing(k, e) {
      // 2v2: đồng đội đánh mục tiêu bị Giam Cầm cũng được cộng.
      if (k.has(e.target, "bind")) {
        k.proc("đồng đội +sát thương", e.source);
        return k.p.ally;
      }
    },
  },

  // 83 Thi Đại Quỷ
  83: {
    name: "Tà đại hoán mệnh",
    params: { bonus: 20, heal: 20, drain: 20 },
    text: "Đánh mục tiêu đang bị Giam Cầm +{bonus}% sát thương. Mỗi trận 1 lần, khi HP pet lần đầu xuống dưới 35%, pet hoán mệnh với đối thủ có tỉ lệ HP cao nhất: pet hồi {heal}% HP tối đa của mình, đối thủ mất {drain}% HP tối đa của nó.",
    outgoing(k, e) {
      if (e.skill?.attack && k.has(e.target, "bind")) {
        k.proc("giam cầm +sát thương", e.target);
        return k.p.bonus;
      }
    },
    onDamaged(k, e) {
      // Mỗi trận 1 lần, lần đầu xuống dưới 35%: hoán mệnh với đối thủ có tỉ lệ HP cao nhất.
      if (k.v.swap || !crossed(k.self, e.before, e.after, 35)) return;
      k.v.swap = 1;
      const foe = foeByHp(k, true);
      k.heal(k.self, k.p.heal);
      if (foe) k.damage(foe, k.pctOf(foe, k.p.drain));
      k.proc("hoán mệnh", foe);
    },
  },

  // 84 Kính ma
  84: {
    name: "Kính hấp ảnh quang",
    params: { store: 40, cap: 25, allyStore: 20 },
    text: "Mỗi khi bị đòn trực tiếp đánh trúng, gương tích {store}% sát thương nhận được (tối đa {cap}% HP tối đa của pet). Chiêu tấn công kế tiếp của pet cộng thêm toàn bộ lượng đã tích thành sát thương, rồi gương trống. Khi có đồng đội trên sân, đòn trúng đồng đội cũng nạp gương {allyStore}% sát thương; pet xả vào bất kỳ đối thủ nào.",
    onHitTaken(k, e) {
      // Tích % sát thương nhận (có trần theo HP tối đa).
      const stored = (k.e.mirror ?? 0) + Math.trunc((e.damage * k.p.store) / 100);
      k.e.mirror = Math.min(k.pctOf(k.self, k.p.cap), stored);
      k.proc("nạp gương");
    },
    onAllyHitTaken(k, e) {
      // 2v2: đòn trúng đồng đội cũng nạp gương.
      const stored = (k.e.mirror ?? 0) + Math.trunc((e.damage * k.p.allyStore) / 100);
      k.e.mirror = Math.min(k.pctOf(k.self, k.p.cap), stored);
      k.proc("nạp gương đồng đội", e.target);
    },
    onHitDealt(k, e) {
      // Chiêu tấn công kế tiếp xả toàn bộ lượng đã tích.
      if (!e.skill?.attack || !(k.e.mirror > 0)) return;
      const amount = k.e.mirror;
      k.e.mirror = 0;
      if (k.damage(e.target, amount) > 0) k.proc("xả gương", e.target);
    },
  },

  // 85 Phá kính tà linh
  85: {
    name: "Kính vỡ thành gươm",
    params: { reflect: 30, pierce: 25 },
    text: "Mỗi lượt, đòn trực tiếp đầu tiên làm pet mất ≥10% HP tối đa bị phản {reflect}% lượng đó. Khi HP lần đầu xuống dưới 60%, gương vỡ: 2 chiêu tấn công kế tiếp bỏ qua {pierce}% DEF mục tiêu.",
    onHitTaken(k, e) {
      // Đòn trực tiếp đầu tiên trong lượt làm mất ≥10% HP tối đa: phản một phần.
      if (k.hitsTakenThisRound !== 1 || e.damage < k.pctOf(k.self, 10)) return;
      if (!k.oncePerRound("reflect")) return;
      k.proc("phản đòn", e.source);
      return Math.trunc((e.damage * k.p.reflect) / 100);
    },
    onDamaged(k, e) {
      // Lần đầu xuống dưới 60%: 2 chiêu tấn công kế tiếp xuyên DEF.
      if (k.v.broke || !crossed(k.self, e.before, e.after, 60)) return;
      k.v.broke = 1;
      k.v.pierce = 2;
      k.proc("gương vỡ");
    },
    pierce(k, e) {
      if (k.v.pierce > 0 && e.skill?.attack) return k.p.pierce;
    },
    afterAction(k, e) {
      if (k.v.pierce > 0 && e.skill?.attack) {
        k.v.pierce--;
        k.proc("xuyên giáp", e.target);
      }
    },
  },

  // 86 Hư không hành giả
  86: {
    name: "Hư bộ khai lộ",
    params: { guard: 45, shield: 15, firstHit: 20, allyShield: 8 },
    text: "Đòn tấn công đầu tiên trúng pet mỗi lần ra sân giảm {guard}% sát thương (chờ 3 lượt). Khi pet rời sân bằng Hành Giả Hư Bộ · Chuyển, pet vào sân nhận khiên {shield}% HP tối đa trong 2 lượt và đòn đầu của nó +{firstHit}% sát thương. Khi pet Chuyển, đồng đội đang trên sân cũng nhận khiên {allyShield}% HP tối đa.",
    incoming(k, e) {
      // Đòn tấn công đầu tiên trúng pet mỗi lần ra sân được giảm (chờ 3 lượt).
      if (!e.direct || !e.skill?.attack || k.e.guarded || !k.ready("guard", 3)) return;
      k.e.guarded = 1;
      k.use("guard");
      k.proc("hư bộ", e.source);
      return k.p.guard;
    },
    afterAction(k, e) {
      // Rời sân bằng · Chuyển: pet vào nhận khiên 2 lượt; 2v2: đồng đội cũng nhận khiên.
      // Xấp xỉ: "đòn đầu của pet vào sân +firstHit%" chưa làm được (pet đã rời sân thì hết hook).
      if (e.skill?.name !== PIVOT_86 || !e.hit) return;
      const state = k.self.signatureState;
      if (state.pendingPivot) {
        state.pivotShieldPct = Math.max(state.pivotShieldPct, k.p.shield);
        state.pivotShieldDuration = Math.max(state.pivotShieldDuration, 2);
        k.proc("khai lộ");
      }
      if (k.ally && k.shield(k.ally, k.p.allyShield, 2)) k.proc("khiên đồng đội", k.ally);
    },
  },

  // 87 Minh vương Long
  87: {
    name: "Minh vương thu hồn",
    params: { bonus: 30, lifesteal: 60, cap: 30, soulAtk: 15, soulHeal: 15 },
    text: "Đánh đối thủ dưới 40% HP: +{bonus}% sát thương và hồi {lifesteal}% sát thương gây ra (tối đa {cap}% HP tối đa; 2 lượt 1 lần). Mỗi đối thủ gục dưới tay pet để lại 1 Hồn: ATK +{soulAtk}% và hồi {soulHeal}% HP (tối đa 2 Hồn, giữ tới hết trận).",
    outgoing(k, e) {
      // Đối thủ dưới 40% HP: cộng sát thương và hút máu (2 lượt 1 lần).
      if (!e.skill?.attack || k.hpPct(e.target) >= 40 || !k.ready("reap", 2)) return;
      k.use("reap");
      k.e.reap = 1;
      k.proc("thu hồn", e.target);
      return k.p.bonus;
    },
    afterAction(k, e) {
      if (k.e.reap) drain(k, e.damage, k.p.lifesteal, "hút hồn", k.p.cap);
      k.e.reap = 0;
    },
    onFoeFaint(k, e) {
      // Đối thủ gục dưới tay pet để lại 1 Hồn: ATK và hồi máu (tối đa 2, giữ hết trận).
      if (!e.byMe) return;
      k.stack("soul", 1, 2);
      k.heal(k.self, k.p.soulHeal);
      k.proc("hồn", e.foe);
    },
    statBonus(k, stat) {
      if (stat === "attack") return k.p.soulAtk * (k.v.soul ?? 0);
    },
  },

  // 88 Lắc lắc
  88: {
    name: "Chấn âm kéo dài",
    params: { chance: 35, bonus: 25 },
    text: "Chiêu tấn công đánh trúng có {chance}% gây thêm một hiệu ứng xấu 2 lượt (Giảm chính xác, Giảm Linh xảo hoặc Giảm sát thương, loại mục tiêu chưa có). Hiệu ứng xấu do pet gây kéo dài thêm 1 lượt (mỗi lượt kích 1 lần). Chiêu tấn công đánh mục tiêu đang mang từ 2 hiệu ứng xấu trở lên +{bonus}% sát thương. Hiệu ứng xấu do đồng đội gây lên đối thủ cũng được kéo dài 1 lượt (chung giới hạn mỗi lượt 1 lần).",
    onHitDealt(k, e) {
      // Đòn trúng: chance% gây 1 hiệu ứng xấu phụ 2 lượt (loại mục tiêu chưa có), rồi kéo dài nó.
      if (!e.skill?.attack || !e.target.alive()) return;
      const open = SHAKE_88.filter((s) => !k.has(e.target, s));
      if (open.length === 0 || !k.chance(k.p.chance, "chấn âm")) return;
      // Xoay vòng theo lượt giữa các loại còn thiếu.
      const status = open[k.round % open.length];
      if (!k.inflict(e.target, status, 2)) return;
      k.proc("chấn âm phụ", e.target);
      extendDebuff(k, e.target, [status]);
    },
    afterAction(k, e) {
      extendDebuff(k, e.target, e.newStatuses);
    },
    onOtherAction(k, e) {
      // 2v2: hiệu ứng xấu đồng đội gây cũng kéo dài (chung giới hạn mỗi lượt 1 lần).
      if (e.isAlly) extendDebuff(k, e.target, e.newStatuses);
    },
    outgoing(k, e) {
      if (e.skill?.attack && k.debuffs(e.target) >= 2) {
        k.proc("chấn âm", e.target);
        return k.p.bonus;
      }
    },
  },

  // 89 Chim xanh
  89: {
    name: "Tước ảnh lướt gió",
    params: { cut: 25, boosted: 35 },
    text: "Lượt nào pet ra đòn trước đối thủ, đòn đầu tiên đánh trúng pet trong lượt đó giảm {cut}% sát thương. Tai Tước Không Sát · Tật đánh trúng thì mức giảm thành {boosted}% cho lượt kế tiếp.",
    beforeAction(k, e) {
      if (e.actedFirst) k.e.first = k.round;
    },
    onHitDealt(k, e) {
      // Tai Tước Không Sát · Tật trúng: mức giảm tăng cho lượt kế tiếp.
      if (e.skill?.name === TAT_89) {
        k.v[`boost:${k.round + 1}`] = 1;
        k.proc("tật", e.target);
      }
    },
    incoming(k, e) {
      // Lượt pet ra đòn trước: đòn đầu tiên trúng pet trong lượt được giảm.
      if (!e.direct || k.e.first !== k.round || k.hitsTakenThisRound > 0) return;
      const boosted = k.v[`boost:${k.round}`] === 1;
      k.proc(boosted ? "lướt gió mạnh" : "lướt gió", e.source);
      return boosted ? k.p.boosted : k.p.cut;
    },
  },

  // 90 Tai tước
  90: {
    name: "Không sát phục kích",
    params: { bonus: 30, cut: 20 },
    text: "Nếu lượt trước pet không mất HP (kể cả lượt vừa vào sân), chiêu tấn công +{bonus}% sát thương. Lượt nào pet ra đòn trước đối thủ, đòn đầu tiên trúng pet trong lượt đó giảm {cut}% sát thương.",
    beforeAction(k, e) {
      if (e.actedFirst) k.e.first = k.round;
    },
    outgoing(k, e) {
      // Lượt trước không mất HP (kể cả lượt vừa vào sân): cộng sát thương.
      if (e.skill?.attack && !k.lostHpLastRound) {
        k.proc("phục kích", e.target);
        return k.p.bonus;
      }
    },
    incoming(k, e) {
      if (!e.direct || k.e.first !== k.round || k.hitsTakenThisRound > 0) return;
      k.proc("đi trước giảm", e.source);
      return k.p.cut;
    },
  },

  // 91 Hải âu
  91: {
    name: "Cánh âu che sóng",
    params: { cut: 35, heal: 6 },
    text: "Lượt pet dùng chiêu không gây sát thương, pet nhận ít hơn {cut}% sát thương trong lượt đó và xóa 1 hiệu ứng xấu trên đồng đội ít HP nhất (không có đồng đội thì chính mình). Cuối lượt đó pet hồi {heal}% HP tối đa.",
    beforeAction(k, e) {
      // Lượt dùng chiêu không gây sát thương: giảm sát thương nhận trong lượt, xóa 1 hiệu ứng xấu
      // của pet phe mình ít HP nhất (1v1: chính mình). Xấp xỉ: tính từ lúc pet hành động.
      if (!e.skill || e.skill.attack) return;
      k.e.calm = k.round;
      k.proc("che sóng");
      const who = lowestTeam(k);
      if (k.cleanse(who, 1) > 0) k.proc("giải trừ", who);
    },
    incoming(k) {
      if (k.e.calm === k.round) {
        k.proc("che sóng giảm");
        return k.p.cut;
      }
    },
    roundEnd(k) {
      if (k.e.calm !== k.round) return;
      k.heal(k.self, k.p.heal);
      k.proc("hồi cuối lượt");
    },
  },

  // 92 Dực thần
  92: {
    name: "Thánh phong dưỡng dực",
    params: { cap: 15, lifesteal: 30 },
    text: "Lượng hồi từ chiêu của pet vượt quá HP tối đa của mục tiêu được đổi thành khiên (tối đa {cap}% HP tối đa, 2 lượt). Chiêu tấn công của pet hồi cho đồng đội ít HP nhất {lifesteal}% sát thương gây ra (không có đồng đội thì chính mình).",
    healOut(k, e) {
      // Hồi tràn quá HP tối đa thành khiên (có trần, 2 lượt).
      const over = e.target.hp() + e.amount - e.target.maxHp();
      if (over <= 0) return;
      if (k.shieldAmount(e.target, Math.min(over, k.pctOf(e.target, k.p.cap)), 2))
        k.proc("khiên tràn", e.target);
    },
    afterAction(k, e) {
      // Chiêu tấn công hồi cho pet phe mình ít HP nhất một phần sát thương gây ra.
      if (e.skill?.attack && e.hit)
        drain(k, e.damage, k.p.lifesteal, "hút cho đồng đội", undefined, lowestTeam(k));
    },
  },

  // 93 Hồng nhạn
  93: {
    name: "Nhạn dẫn đàn",
    params: { shield: 10, rescue: 20, heal: 8 },
    text: "Khi ra sân, pet và đồng đội nhận khiên {shield}% HP tối đa trong 2 lượt. Mỗi lần ra sân, lần đầu một pet phe mình tụt dưới 50% HP, pet đó nhận khiên {rescue}% HP tối đa trong 2 lượt. Chiêu hồi máu của pet hồi thêm {heal}% HP tối đa.",
    onEnter(k) {
      // Ra sân: pet và đồng đội nhận khiên 2 lượt.
      for (const u of k.team) if (k.shield(u, k.p.shield, 2)) k.proc("khiên vào sân", u);
      if (k.ally) k.e.allyShield = 1;
    },
    beforeAction(k) {
      // Đầu trận 2v2 đồng đội có thể ra sân sau pet: bù khiên vào sân cho nó.
      if (!k.e.allyShield && k.ally && k.roundsOnField === 0) {
        k.e.allyShield = 1;
        if (k.shield(k.ally, k.p.shield, 2)) k.proc("khiên vào sân", k.ally);
      }
    },
    onDamaged(k) {
      rescue93(k, k.self);
    },
    onAllyHitTaken(k, e) {
      rescue93(k, e.target);
    },
    roundEnd(k) {
      // Đồng đội mất máu không qua đòn trực tiếp (độc…): kiểm lại cuối lượt.
      if (k.ally) rescue93(k, k.ally);
    },
    healOut(k, e) {
      // healOut chỉ chạy với chiêu hồi máu của pet.
      k.proc("hồi thêm", e.target);
      return k.pctOf(e.target, k.p.heal);
    },
  },

  // 94 Phi Dực Thú
  94: {
    name: "Cuồng vũ hộ dực",
    params: { cut: 25, bonus: 10 },
    text: "Mỗi lượt pet ra đòn trước đối thủ, pet nhận 1 Lông Vũ (tối đa 2). Khi bị đòn trực tiếp đánh trúng, tiêu 1 Lông Vũ để giảm {cut}% sát thương đòn đó. Còn Lông Vũ thì chiêu tấn công +{bonus}% sát thương. Khi đồng đội bị đòn trực tiếp mà pet còn Lông Vũ, pet có thể tiêu 1 lông để giảm {cut}% đòn đó cho đồng đội.",
    afterAction(k, e) {
      // Lượt ra đòn trước: +1 Lông Vũ (tối đa 2).
      if (e.actedFirst && k.oncePerRound("feather")) {
        k.stack("feather", 1, 2);
        k.proc("lông vũ");
      }
    },
    incoming(k, e) {
      if (!e.direct || !(k.v.feather > 0)) return;
      k.stack("feather", -1, 2);
      k.proc("tiêu lông", e.source);
      return k.p.cut;
    },
    guardAlly(k, e) {
      // 2v2: tiêu 1 lông giảm đòn trúng đồng đội.
      if (!(k.v.feather > 0)) return;
      k.stack("feather", -1, 2);
      k.proc("lông che đồng đội", e.target);
      return k.p.cut;
    },
    outgoing(k, e) {
      if (e.skill?.attack && k.v.feather > 0) {
        k.proc("lông cộng sát thương", e.target);
        return k.p.bonus;
      }
    },
  },

  // 95 Đậu ưng
  95: {
    name: "Ưng nhãn khóa mồi",
    params: { slow: 15, bonus: 15, ally: 8 },
    text: "Khi ra sân, pet đánh dấu đối thủ có tỉ lệ HP thấp nhất làm Con Mồi 3 lượt: Con Mồi −{slow}% Linh xảo, và chiêu tấn công của pet lên nó +{bonus}% sát thương. Đồng đội đánh Con Mồi cũng được +{ally}% sát thương.",
    onEnter(k) {
      markPrey(k, "prey95");
    },
    beforeAction(k) {
      markPrey(k, "prey95");
    },
    outgoing(k, e) {
      if (e.skill?.attack && k.marked(e.target, "prey") > 0) {
        k.proc("đánh con mồi", e.target);
        return k.p.bonus;
      }
    },
    allyOutgoing(k, e) {
      if (k.marked(e.target, "prey") > 0) {
        k.proc("đồng đội đánh con mồi", e.source);
        return k.p.ally;
      }
    },
  },

  // 96 Liệt ưng
  96: {
    name: "Liệt ưng sà kích",
    params: { slow: 15, bonus: 15, ally: 8 },
    text: "Khi ra sân, pet đánh dấu đối thủ có tỉ lệ HP thấp nhất làm Con Mồi 3 lượt (−{slow}% Linh xảo; pet đánh nó +{bonus}%). Khi Con Mồi dưới 35% HP, chiêu tấn công kế tiếp của pet lên nó được ưu tiên ra đòn trước (3 lượt 1 lần). Đồng đội đánh Con Mồi cũng được +{ally}% sát thương.",
    onEnter(k) {
      markPrey(k, "prey96");
    },
    beforeAction(k, e) {
      markPrey(k, "prey96");
      // Cú sà được tiêu khi chiêu tấn công lên Con Mồi dưới 35% HP ra đòn.
      if (e.skill?.attack && swoopReady(k, e.target)) {
        k.use("swoop");
        k.proc("sà kích", e.target);
      }
    },
    priority(k, e) {
      if (e.skill && !e.skill.attack) return false;
      return swoopReady(k, e.opponent);
    },
    outgoing(k, e) {
      if (e.skill?.attack && k.marked(e.target, "prey") > 0) {
        k.proc("đánh con mồi", e.target);
        return k.p.bonus;
      }
    },
    allyOutgoing(k, e) {
      if (k.marked(e.target, "prey") > 0) {
        k.proc("đồng đội đánh con mồi", e.source);
        return k.p.ally;
      }
    },
  },

  // 97 Quáng thạch dực long
  97: {
    name: "Bão cát mù cánh",
    params: { daze: 25, tier: 5 },
    text: "Chiêu hệ Thổ đánh trúng có thêm {daze}% gây Mê Muội 1 lượt và cho pet 1 tầng DEF +7% trong 2 lượt (tối đa 3 tầng, dùng chung với tầng DEF từ chiêu). Mỗi tầng DEF đang có giúp pet nhận ít hơn {tier}% sát thương.",
    onHitDealt(k, e) {
      if (!e.skill?.attack || e.skill.element !== 2) return;
      // Chiêu hệ Thổ trúng: thêm daze% gây Mê Muội 1 lượt…
      if (e.target.alive() && k.chance(k.p.daze, "daze") && k.inflict(e.target, "daze", 1))
        k.proc("mê muội", e.target);
      // …và 1 tầng DEF +7% trong 2 lượt (tối đa 3, chung tầng DEF của chiêu).
      k.e.sand = Math.min(3, (k.e.sandUntil ?? 0) >= k.round ? (k.e.sand ?? 0) + 1 : 1);
      k.e.sandUntil = k.round + 1;
      k.refresh();
      k.proc("tầng DEF");
    },
    statBonus(k, stat) {
      if (stat !== "defense") return;
      return SAND_DEF_97 * sandTiers97(k);
    },
    incoming(k, e) {
      // Mỗi tầng DEF đang có (đặc tính + chiêu, tối đa 3): nhận ít hơn tier%.
      const tiers = Math.min(3, sandTiers97(k) + k.defenseTiers());
      if (!e.direct || tiers <= 0) return;
      k.proc("giáp cát", e.source);
      return k.p.tier * tiers;
    },
  },

  // 98 Tà ma dực long
  98: {
    name: "Tà dực liệt giáp",
    params: { def: 8, shieldBonus: 40 },
    text: "Mỗi chiêu tấn công đánh trúng gắn 1 tầng Liệt Giáp lên mục tiêu: DEF −{def}% trong 3 lượt (tối đa 3 tầng). Đánh mục tiêu đang có khiên thì sát thương vào khiên +{shieldBonus}%.",
    onHitDealt(k, e) {
      // Mỗi chiêu tấn công trúng: 1 tầng Liệt Giáp, giảm DEF trong 3 lượt (tối đa 3).
      if (!e.skill?.attack || !e.target.alive()) return;
      const tiers = k.mark(e.target, "armor", 3, 3);
      k.statUp(e.target, "defense", -k.p.def * tiers, 3, "liệt giáp 98");
      k.proc("liệt giáp", e.target);
    },
    outgoing(k, e) {
      // Sát thương vào khiên được cộng (chỉ phần đánh vào khiên).
      const shield = k.shieldHp(e.target);
      if (!e.skill?.attack || shield <= 0 || e.damage <= 0) return;
      k.proc("phá khiên", e.target);
      return Math.trunc((k.p.shieldBonus * Math.min(shield, e.damage)) / e.damage);
    },
  },

  // 99 Tinh Vân Hạc
  99: {
    name: "Tinh hà dẫn lộ",
    params: { bonus: 12, cut: 8, extra: 50 },
    text: "Mỗi lượt pet ra đòn trước mọi đối thủ, nhận 1 Tinh Quang (tối đa 3): mỗi tầng +{bonus}% sát thương và giảm {cut}% sát thương nhận. Đủ 3 tầng, chiêu tấn công đánh thêm một hit {extra}% Power lên đối thủ còn lại (không có đối thủ thứ hai thì cùng mục tiêu). Bị ra đòn trước hoặc rời sân thì mất hết tầng.",
    onOtherAction(k, e) {
      // Bị đối thủ ra đòn trước trong lượt: mất hết Tinh Quang.
      if (e.isAlly || k.e.acted === k.round) return;
      k.e.foeFirst = k.round;
      if (k.e.star > 0) {
        k.stack("star", -3, 3, true);
        k.proc("mất tinh quang");
      }
    },
    beforeAction(k) {
      // Ra đòn trước mọi đối thủ: +1 Tinh Quang (tối đa 3).
      k.e.acted = k.round;
      if (k.e.foeFirst !== k.round && k.oncePerRound("star")) {
        k.stack("star", 1, 3, true);
        k.proc("tinh quang");
      }
    },
    outgoing(k, e) {
      if (e.skill?.attack && k.e.star > 0) return k.p.bonus * k.e.star;
    },
    incoming(k, e) {
      if (e.direct && k.e.star > 0) return k.p.cut * k.e.star;
    },
    onHitDealt(k, e) {
      // Đủ 3 tầng: hit phụ lên đối thủ còn lại (1v1: cùng mục tiêu).
      // Xấp xỉ: "% Power" tính bằng % sát thương thực của đòn chính.
      if (!e.skill?.attack || (k.e.star ?? 0) < 3) return;
      const other = k.otherFoe(e.target) ?? e.target;
      if (k.damage(other, Math.trunc((e.damage * k.p.extra) / 100)) > 0) k.proc("hit phụ", other);
    },
  },

  // 100 Thụ quái
  100: {
    name: "Mầm rễ bám đất",
    params: { def: 8, heal: 3, allyDef: 3, allyCap: 9 },
    text: "Cuối mỗi lượt pet ở trên sân, nhận 1 tầng Rễ (tối đa 3): mỗi tầng DEF +{def}% và hồi {heal}% HP tối đa ngay khi nhận. Rời sân thì mất hết Rễ. Mỗi tầng Rễ cũng cho đồng đội DEF +{allyDef}% (tối đa +{allyCap}%).",
    roundEnd(k) {
      // Cuối lượt: +1 Rễ (tối đa 3), DEF mỗi tầng, hồi máu khi nhận.
      const before = k.e.root ?? 0;
      const now = k.stack("root", 1, 3, true);
      if (now > before) {
        k.heal(k.self, k.p.heal);
        k.proc("rễ");
      }
      allyRootDef(k, "root100", now, k.p.allyCap);
    },
    onLeave(k) {
      allyRootDef(k, "root100", 0);
    },
    statBonus(k, stat) {
      if (stat === "defense") return k.p.def * (k.e.root ?? 0);
    },
  },

  // 101 Bụi gai
  101: {
    name: "Bụi gai cắm rễ",
    params: { def: 8, thorn: 4 },
    text: "Mỗi lần bị đòn trực tiếp đánh trúng, pet nhận 1 tầng Rễ (tối đa 2, mất khi rời sân): mỗi tầng DEF +{def}%. Khi bị đánh trúng mà Rễ đạt đủ 2 tầng, rễ gai bật ra: kẻ đánh mất {thorn}% HP tối đa của pet và pet mất hết Rễ. Sau 3 lần gai bật trong một lần ra sân, bụi gai cạn sức và không mọc Rễ nữa cho tới lần ra sân sau. Khi có đồng đội trên sân, đòn trúng đồng đội cũng cho pet 1 tầng Rễ (mỗi lượt 1 lần).",
    onHitTaken(k, e) {
      // Bị đánh trúng: +1 Rễ (tối đa 2); đủ 2 Rễ thì gai bật ra và tiêu hết Rễ (3 lần mỗi lần ra sân).
      if ((k.e.bursts ?? 0) >= 3 || k.stack("root", 1, 2, true) < 2) return;
      k.stack("root", -2, 2, true);
      k.e.bursts = (k.e.bursts ?? 0) + 1;
      k.proc("rễ gai", e.source);
      return k.pctOf(k.self, k.p.thorn);
    },
    onAllyHitTaken(k, e) {
      // 2v2: đòn trúng đồng đội cũng cho 1 Rễ (mỗi lượt 1 lần).
      if ((k.e.bursts ?? 0) >= 3 || !k.oncePerRound("allyRoot")) return;
      k.stack("root", 1, 2, true);
      k.proc("rễ từ đồng đội", e.target);
    },
    statBonus(k, stat) {
      if (stat === "defense") return k.p.def * (k.e.root ?? 0);
    },
  },

  // 102 Cây chứa dịch độc
  102: {
    name: "Rễ hút dịch độc",
    params: { bonus: 10, heal: 3 },
    text: "Mỗi khi Gieo Hạt hoặc Hủ Thực do pet gây ra làm đối thủ mất HP, pet nhận 1 tầng Rễ (tối đa 3): mỗi tầng chiêu tấn công +{bonus}% sát thương và hồi {heal}% HP tối đa ngay khi nhận.",
    onDotTick(k, e) {
      // Gieo Hạt / Hủ Thực của pet làm đối thủ mất HP: +1 Rễ (tối đa 3), hồi máu khi nhận.
      if (e.status !== "seed" && e.status !== "corrosion") return;
      const before = k.v.root ?? 0;
      if (k.stack("root", 1, 3) > before) {
        k.heal(k.self, k.p.heal);
        k.proc("rễ độc", e.target);
      }
    },
    outgoing(k, e) {
      if (e.skill?.attack && k.v.root > 0) {
        k.proc("rễ cộng sát thương", e.target);
        return k.p.bonus * k.v.root;
      }
    },
  },

  // 103 Cổ Thụ Chi Vương
  103: {
    name: "Vương mộc thâm căn",
    params: { def: 6, burst: 25, allyDef: 3 },
    text: "Cuối mỗi lượt pet ở trên sân, nhận 1 tầng Rễ (tối đa 3): mỗi tầng DEF +{def}%. Khi có 3 tầng, chiêu Mộc kế tiếp tiêu hết Rễ và cộng thêm sát thương bằng {burst}% DEF hiện có của pet. Mỗi tầng Rễ cũng cho đồng đội DEF +{allyDef}%; khi xả, đồng đội mất phần cộng đó cho tới khi Rễ mọc lại.",
    roundEnd(k) {
      // Cuối lượt: +1 Rễ (tối đa 3), DEF mỗi tầng.
      const before = k.e.root ?? 0;
      const now = k.stack("root", 1, 3, true);
      if (now > before) k.proc("rễ");
      allyRootDef(k, "root103", now);
    },
    onLeave(k) {
      allyRootDef(k, "root103", 0);
    },
    statBonus(k, stat) {
      if (stat === "defense") return k.p.def * (k.e.root ?? 0);
    },
    onHitDealt(k, e) {
      // Đủ 3 Rễ: chiêu Mộc kế tiếp tiêu hết Rễ, cộng sát thương theo % DEF hiện có.
      if (!e.skill?.attack || e.skill.element !== 1 || (k.e.root ?? 0) < 3) return;
      const bonus = Math.trunc((k.self.currentStats.defense * k.p.burst) / 100);
      k.stack("root", -3, 3, true);
      allyRootDef(k, "root103", 0);
      k.damage(e.target, bonus);
      k.proc("xả rễ", e.target);
    },
  },

  // 104 Cỏ thơm
  104: {
    name: "Hương cỏ an thần",
    params: { heal: 8, charm: 30, cut: 15 },
    text: "Chiêu hồi máu của pet hồi thêm {heal}% HP tối đa và được ưu tiên ra đòn trước. Khi pet bị đánh trúng, kẻ đánh có {charm}% bị Mị Hoặc 2 lượt (gây ít hơn {cut}% sát thương), 2 lượt 1 lần.",
    priority(k, e) {
      // Chiêu hồi máu được ra đòn trước.
      if (!isHeal(e.skill)) return;
      if (k.oncePerRound("ưu tiên")) k.proc("hồi ưu tiên");
      return true;
    },
    healOut(k, e) {
      k.proc("hồi thêm", e.target);
      return k.pctOf(e.target, k.p.heal);
    },
    onHitTaken(k, e) {
      // Bị đánh trúng: kẻ đánh charm% Mị Hoặc 2 lượt (2 lượt 1 lần).
      const foe = e.source;
      if (!foe.alive() || k.has(foe, "charm") || !k.ready("mị hoặc", 2)) return;
      if (!k.chance(k.p.charm, "charm") || !k.inflict(foe, "charm", 2, { value: k.p.cut })) return;
      k.use("mị hoặc");
      k.proc("mị hoặc", foe);
    },
  },

  // 105 Hoa ngũ sắc
  105: {
    name: "Ngũ sắc khai hoa",
    params: { atk: 15, def: 15, spd: 15, shield: 10, lifesteal: 15 },
    text: "Chiêu hồi máu của pet tặng mục tiêu 1 cánh hoa ngẫu nhiên trong 2 lượt: ATK +{atk}%, DEF +{def}%, Linh xảo +{spd}%, khiên {shield}% HP tối đa, hoặc xóa 1 hiệu ứng xấu. Chiêu tấn công của pet hút {lifesteal}% sát thương gây ra.",
    healOut(k, e) {
      // Chiêu hồi tặng mục tiêu 1 cánh hoa ngẫu nhiên trong 2 lượt.
      const roll = Math.max(0, k.runtime.host.draw("kit.105.petal"));
      const pick = Math.min(4, Math.floor((roll * 5) / 100));
      if (pick === 0) k.statUp(e.target, "attack", k.p.atk, 2, "petal105");
      else if (pick === 1) k.statUp(e.target, "defense", k.p.def, 2, "petal105");
      else if (pick === 2) k.statUp(e.target, "speed", k.p.spd, 2, "petal105");
      else if (pick === 3) k.shield(e.target, k.p.shield, 2);
      else k.cleanse(e.target, 1);
      k.proc(`cánh hoa ${pick}`, e.target);
    },
    afterAction(k, e) {
      // Chiêu tấn công hút máu.
      if (e.skill?.attack && e.hit) drain(k, e.damage, k.p.lifesteal, "hút máu");
    },
  },

  // 106 Hoa ăn thịt người
  106: {
    name: "Bẫy hương ăn thịt",
    params: { charm: 30, cut: 15, drain: 25 },
    text: "Chiêu tấn công đánh trúng có {charm}% gây Mị Hoặc 2 lượt (mục tiêu gây ít hơn {cut}% sát thương) nếu chưa có. Đánh mục tiêu đang Mị Hoặc hoặc dưới 50% HP thì hút {drain}% sát thương gây ra. Mị Hoặc giảm sát thương của mục tiêu lên cả đồng đội, và đồng đội có Ma Thần Giáng Thế cũng tận dụng được Mị Hoặc do pet gây.",
    beforeAction(k, e) {
      // Điều kiện hút đọc trước đòn (Mị Hoặc gây ở đòn này không tính).
      const t = e.target;
      k.e.prey = e.skill?.attack && t && (k.has(t, "charm") || k.hpPct(t) < 50) ? 1 : 0;
    },
    onHitDealt(k, e) {
      // Chiêu tấn công trúng: charm% Mị Hoặc 2 lượt nếu chưa có.
      if (!e.skill?.attack || !e.target.alive() || k.has(e.target, "charm")) return;
      if (k.chance(k.p.charm, "charm") && k.inflict(e.target, "charm", 2, { value: k.p.cut }))
        k.proc("mị hoặc", e.target);
    },
    afterAction(k, e) {
      if (k.e.prey && e.hit) drain(k, e.damage, k.p.drain, "hút mồi");
      k.e.prey = 0;
    },
  },

  // 107 Thảo quả
  107: {
    name: "Hạt lửa nảy mầm",
    params: { bonus: 15, burn: 4 },
    text: "Khi Gieo Hạt hoặc Hủ Thực do pet gây ra làm đối thủ mất HP, hạt bén lửa: mục tiêu bị Thiêu Đốt 2 lượt nếu chưa có (mỗi lượt 1 lần). Chiêu hệ Hỏa đánh mục tiêu đang Gieo Hạt +{bonus}% sát thương.",
    onDotTick(k, e) {
      // Độc của pet trừ máu: Thiêu Đốt 2 lượt nếu chưa có (mỗi lượt 1 lần).
      if (e.status !== "seed" && e.status !== "corrosion") return;
      if (k.marked(e.target, "burn") > 0 || !k.oncePerRound("ignite")) return;
      k.mark(e.target, "burn", 2);
      k.proc("bén lửa", e.target);
    },
    roundEnd(k) {
      // Xấp xỉ Thiêu Đốt (kit chưa có trạng thái này): dấu riêng đốt % HP tối đa mỗi cuối lượt.
      for (const foe of k.foes)
        if (k.marked(foe, "burn") > 0 && k.damage(foe, k.pctOf(foe, k.p.burn)) > 0)
          k.proc("thiêu đốt", foe);
    },
    outgoing(k, e) {
      if (e.skill?.attack && e.skill.element === 0 && k.has(e.target, "seed")) {
        k.proc("hỏa lên gieo hạt", e.target);
        return k.p.bonus;
      }
    },
  },

  // 108 Mạn đà la
  108: {
    name: "Mạn đà ác mộng",
    params: { bonus: 40, heal: 5 },
    text: "Đòn tấn công của pet đánh thức mục tiêu đang Ngủ thì +{bonus}% sát thương và mục tiêu bị Mê Muội 1 lượt. Mỗi khi pet gây được một hiệu ứng xấu mới, pet hồi {heal}% HP tối đa (mỗi lượt 1 lần).",
    beforeAction(k, e) {
      k.e.wake = e.skill?.attack && k.has(e.target, "sleep") ? 1 : 0;
    },
    outgoing(k, e) {
      // Đánh thức mục tiêu đang Ngủ: cộng sát thương.
      if (k.e.wake && e.skill?.attack) {
        k.proc("đánh thức", e.target);
        return k.p.bonus;
      }
    },
    onHitDealt(k, e) {
      if (!k.e.wake) return;
      k.e.wake = 0;
      if (k.inflict(e.target, "daze", 1)) k.proc("mê muội", e.target);
    },
    afterAction(k, e) {
      // Gây được hiệu ứng xấu mới: hồi máu (mỗi lượt 1 lần).
      k.e.wake = 0;
      if (e.newStatuses.length > 0 && k.oncePerRound("heal")) {
        k.heal(k.self, k.p.heal);
        k.proc("hồi máu");
      }
    },
  },

  // 109 Hoa Mạn đà la
  109: {
    name: "Huyễn hỏa mạn đà",
    params: { haze: 35, per: 10, cap: 30 },
    text: "Chiêu tấn công đánh trúng có {haze}% phủ khói mạn đà: mục tiêu Giảm chính xác 2 lượt. Mỗi loại hiệu ứng xấu khác nhau đang có trên mục tiêu làm chiêu tấn công của pet +{per}% sát thương (tối đa +{cap}%). Hiệu ứng xấu do đồng đội gây cũng được đếm.",
    outgoing(k, e) {
      // Mỗi loại hiệu ứng xấu trên mục tiêu (ai gây cũng tính) cộng sát thương, có trần.
      const kinds = k.debuffs(e.target);
      if (!e.skill?.attack || kinds <= 0) return;
      k.proc("huyễn hỏa", e.target);
      return Math.min(k.p.cap, k.p.per * kinds);
    },
    onHitDealt(k, e) {
      // Đòn trúng: haze% phủ khói, mục tiêu Giảm chính xác 2 lượt.
      if (!e.skill?.attack || !e.target.alive() || !k.chance(k.p.haze, "khói")) return;
      if (k.inflict(e.target, "accuracy_down", 2)) k.proc("khói mạn đà", e.target);
    },
  },

  // 110 Tiên Nhân Chưởng
  110: {
    name: "Gai sa mạc",
    params: { shield: 9, thorn: 5 },
    text: "Khi ra sân, pet nhận khiên {shield}% HP tối đa trong 2 lượt. Khi bị đòn trực tiếp đánh trúng, kẻ tấn công mất {thorn}% HP tối đa của pet (2 lượt 1 lần, mỗi lần ra sân tối đa 2 lần).",
    onEnter(k) {
      if (k.shield(k.self, k.p.shield, 2)) k.proc("khiên vào sân");
    },
    onHitTaken(k, e) {
      // Bị đánh trực tiếp: kẻ đánh mất % HP tối đa của pet (2 lượt 1 lần, tối đa 2 lần mỗi lần ra sân).
      if ((k.e.thorns ?? 0) >= 2 || !k.tryUse("thorn", 2)) return;
      k.e.thorns = (k.e.thorns ?? 0) + 1;
      k.proc("gai", e.source);
      return k.pctOf(k.self, k.p.thorn);
    },
  },

  // 111 Gai khổng lồ
  111: {
    name: "Gai mọc theo đòn",
    params: { thorn: 4, grow: 2, cap: 8 },
    text: "Gai bắt đầu ở {thorn}%. Mỗi lần bị đòn trực tiếp đánh trúng, gai dài thêm +{grow}% (tối đa {cap}%). Gai đâm 2 lượt 1 lần: kẻ đánh trực tiếp pet mất HP bằng độ dài gai hiện có (theo % HP tối đa của pet), rồi gai gãy về {thorn}%. Rời sân thì gai về {thorn}%. Khi có đồng đội trên sân, đòn trúng đồng đội cũng làm gai dài thêm (không gây sát thương gai).",
    onHitTaken(k, e) {
      // Gai đâm 2 lượt 1 lần theo độ dài hiện có rồi gãy về mức gốc; lượt khác gai dài thêm.
      const pct = k.e.spike ?? k.p.thorn;
      if (!k.tryUse("gai", 2)) {
        k.e.spike = Math.min(k.p.cap, pct + k.p.grow);
        return;
      }
      k.e.spike = k.p.thorn;
      k.proc(`gai ${pct}%`, e.source);
      return k.pctOf(k.self, pct);
    },
    onAllyHitTaken(k, e) {
      // 2v2: đòn trúng đồng đội cũng làm gai dài thêm.
      k.e.spike = Math.min(k.p.cap, (k.e.spike ?? k.p.thorn) + k.p.grow);
      k.proc("gai dài", e.target);
    },
  },

  // 112 Gai độc
  112: {
    name: "Gai độc kịch thứ",
    params: { thorn: 6, rot: 40, lifesteal: 15 },
    text: "Mỗi lần bị đòn trực tiếp đánh trúng, kẻ tấn công mất {thorn}% HP tối đa của pet và có {rot}% bị Hủ Thực 2 lượt nếu chưa có (mỗi lượt 1 lần). Chiêu tấn công của pet lên mục tiêu đang Hủ Thực hút {lifesteal}% sát thương gây ra.",
    beforeAction(k, e) {
      k.e.rot = e.skill?.attack && k.has(e.target, "corrosion") ? 1 : 0;
    },
    onHitTaken(k, e) {
      // Bị đánh trực tiếp: kẻ đánh mất % HP tối đa của pet và Hủ Thực 3 lượt nếu chưa có
      // (mỗi lượt 1 lần, riêng từng kẻ đánh).
      if (!k.oncePerRound(`thorn:${strikerKey(e.source)}`)) return;
      if (
        !k.has(e.source, "corrosion") &&
        k.chance(k.p.rot, "hủ") &&
        k.inflict(e.source, "corrosion", 2)
      )
        k.proc("hủ thực", e.source);
      k.proc("gai độc", e.source);
      return k.pctOf(k.self, k.p.thorn);
    },
    afterAction(k, e) {
      // Đánh mục tiêu đang Hủ Thực: hút máu.
      if (k.e.rot && e.hit) drain(k, e.damage, k.p.lifesteal, "hút hủ thực");
      k.e.rot = 0;
    },
  },

  // 113 Quả Tử Tiểu Tả
  113: {
    name: "Diệp phong rắc độc",
    params: { rot: 40, bonus: 20 },
    text: "Lượt nào pet ra đòn trước mục tiêu, chiêu tấn công có {rot}% gây Hủ Thực 2 lượt lên nó nếu chưa có. Chiêu hệ Phong đánh mục tiêu đang Hủ Thực +{bonus}% sát thương.",
    onHitDealt(k, e) {
      // Ra đòn trước mục tiêu: Hủ Thực 3 lượt nếu chưa có.
      if (!e.skill?.attack || !k.self.designTraitState.actedFirst) return;
      if (
        !k.has(e.target, "corrosion") &&
        k.chance(k.p.rot, "hủ") &&
        k.inflict(e.target, "corrosion", 2)
      )
        k.proc("rắc độc", e.target);
    },
    outgoing(k, e) {
      if (e.skill?.attack && e.skill.element === 6 && k.has(e.target, "corrosion")) {
        k.proc("phong lên hủ thực", e.target);
        return k.p.bonus;
      }
    },
  },

  // 114 Tứ Diệp Tiểu Tả
  114: {
    name: "Tứ diệp may mắn",
    params: { cut: 6, heal: 4 },
    text: "Mỗi khi pet dùng chiêu hồi máu hoặc chiêu hệ Thủy đánh trúng, nhận 1 Lá (tối đa 4); mỗi Lá giảm {cut}% sát thương pet nhận. Tứ Diệp Hồi Tuyền · Dưỡng tiêu hết Lá: mỗi Lá hồi thêm {heal}% HP tối đa và đủ 4 Lá thì xóa 1 hiệu ứng xấu. Nếu Tứ Diệp Hồi Tuyền · Dưỡng nhắm đồng đội, các Lá được trao cho đồng đội đó (giữ 2 lượt) thay vì hồi thêm.",
    afterAction(k, e) {
      // Chiêu hồi (trừ · Dưỡng, chiêu tiêu Lá) hoặc chiêu Thủy trúng: +1 Lá (tối đa 4).
      const heal = isHeal(e.skill) && e.skill?.name !== DUONG_114;
      const water = !!e.skill?.attack && e.skill.element === 3 && e.hit && e.damage > 0;
      if (!heal && !water) return;
      k.stack("leaf", 1, 4);
      k.proc("lá");
    },
    incoming(k, e) {
      if (!e.direct || !(k.v.leaf > 0)) return;
      k.proc("lá giảm", e.source);
      return k.p.cut * k.v.leaf;
    },
    healOut(k, e) {
      // · Dưỡng tiêu hết Lá: mỗi Lá hồi thêm, đủ 4 Lá xóa 1 hiệu ứng xấu.
      // 2v2: nhắm đồng đội thì Lá trao cho đồng đội (giữ 2 lượt) thay vì hồi thêm.
      if (k.skill(k.self.selectedSkillId)?.name !== DUONG_114) return;
      const leaves = k.v.leaf ?? 0;
      if (leaves <= 0) return;
      k.stack("leaf", -4, 4);
      if (e.target !== k.self) {
        k.e.gift = leaves;
        k.e.giftUntil = k.round + 1;
        k.proc("trao lá", e.target);
        return;
      }
      if (leaves >= 4 && k.cleanse(e.target, 1) > 0) k.proc("lá xóa xấu", e.target);
      k.proc("tiêu lá", e.target);
      return k.pctOf(e.target, k.p.heal * leaves);
    },
    guardAlly(k) {
      if ((k.e.giftUntil ?? 0) >= k.round && k.e.gift > 0) {
        k.proc("lá che đồng đội");
        return k.p.cut * k.e.gift;
      }
    },
  },

  // 115 Bá Vương Hoa
  115: {
    name: "Hấp nhật quang hợp",
    params: { bonus: 12, heal: 15 },
    text: "Khi HP trên 60%, chiêu hệ Hỏa +{bonus}% sát thương. Mỗi khi chiêu của pet kích nổ hoặc xóa Gieo Hạt trên đối thủ, pet hồi {heal}% HP tối đa. Gieo Hạt do đồng đội đặt cũng tính khi pet kích nổ.",
    beforeAction(k, e) {
      k.e.seeded = k.isFoe(e.target) && k.has(e.target, "seed") ? 1 : 0;
    },
    outgoing(k, e) {
      // HP trên 60%: chiêu Hỏa cộng sát thương.
      if (e.skill?.attack && e.skill.element === 0 && k.hpPct() > 60) {
        k.proc("quang hợp", e.target);
        return k.p.bonus;
      }
    },
    afterAction(k, e) {
      // Chiêu của pet kích nổ / xóa Gieo Hạt trên đối thủ (kể cả hạt của đồng đội): hồi máu.
      if (k.e.seeded && e.target && !k.has(e.target, "seed")) {
        k.heal(k.self, k.p.heal);
        k.proc("hấp hạt", e.target);
      }
      k.e.seeded = 0;
    },
  },

  // 116 Ái Tâm Thảo
  116: {
    name: "Tâm điện tiếp sức",
    params: { bonus: 25, paralysis: 20, cut: 25 },
    text: "Chiêu hồi máu của pet sạc Tim Điện cho mục tiêu: chiêu tấn công kế tiếp của nó trong 2 lượt +{bonus}% sát thương và thêm {paralysis}% gây Tê Liệt 1 lượt. Lượt pet dùng chiêu hồi máu, pet nhận ít hơn {cut}% sát thương.",
    beforeAction(k, e) {
      if (isHeal(e.skill)) k.e.healRound = k.round;
    },
    incoming(k) {
      // Lượt dùng chiêu hồi: nhận ít sát thương hơn. Xấp xỉ: tính từ lúc pet hành động.
      if (k.e.healRound === k.round) {
        k.proc("tâm điện giảm");
        return k.p.cut;
      }
    },
    healOut(k, e) {
      // Chiêu hồi sạc Tim Điện cho mục tiêu (2 lượt).
      k.mark(e.target, "heart", 2);
      k.proc("tim điện", e.target);
    },
    outgoing(k, e) {
      if (!e.skill?.attack || k.marked(k.self, "heart") <= 0) return;
      k.unmark(k.self, "heart");
      k.e.zap = 1;
      k.proc("tim điện xả", e.target);
      return k.p.bonus;
    },
    onHitDealt(k, e) {
      if (!k.e.zap) return;
      k.e.zap = 0;
      if (k.chance(k.p.paralysis, "zap") && k.inflict(e.target, "paralysis", 1))
        k.proc("tê liệt", e.target);
    },
    allyOutgoing(k, e) {
      if (k.marked(e.source, "heart") <= 0) return;
      k.unmark(e.source, "heart");
      k.e.allyZap = 1;
      k.proc("tim điện đồng đội", e.source);
      return k.p.bonus;
    },
    onAllyHitDealt(k, e) {
      if (!k.e.allyZap) return;
      k.e.allyZap = 0;
      if (k.chance(k.p.paralysis, "zap") && k.inflict(e.target, "paralysis", 1))
        k.proc("tê liệt", e.target);
    },
  },

  // 117 Bạch Liệt Sư
  117: {
    name: "Tiếng gầm non",
    params: { roar: 10, bonus: 10 },
    text: "Khi ra sân, pet gầm: đối thủ gây ít hơn {roar}% sát thương trong 2 lượt (tính là hiệu ứng xấu). Chiêu tấn công lên mục tiêu đang mang hiệu ứng xấu +{bonus}% sát thương.",
    ...roarOnEntry,
    outgoing(k, e) {
      if (e.skill?.attack && k.debuffs(e.target) > 0) {
        k.proc("đánh mục tiêu mang xấu", e.target);
        return k.p.bonus;
      }
    },
  },

  // 118 Vương Sư
  118: {
    name: "Vương sư nộ hống",
    params: { roar: 12, rage: 8 },
    text: "Khi ra sân, pet gầm: đối thủ gây ít hơn {roar}% sát thương trong 2 lượt. Mỗi lần bị đòn trực tiếp đánh trúng, pet nhận 1 tầng Nộ: ATK +{rage}% (tối đa 3 tầng, mất khi rời sân).",
    ...roarOnEntry,
    onHitTaken(k, e) {
      // Bị đánh trực tiếp: +1 Nộ, ATK (tối đa 3, mất khi rời sân).
      k.stack("rage", 1, 3, true);
      k.proc("nộ", e.source);
    },
    statBonus(k, stat) {
      if (stat === "attack") return k.p.rage * (k.e.rage ?? 0);
    },
  },

  // 119 Đế Vương Sư
  119: {
    name: "Đế vương uy áp",
    params: { roar: 12, heal: 10 },
    text: "Khi ra sân, pet gầm: đối thủ gây ít hơn {roar}% sát thương trong 2 lượt (tính là hiệu ứng xấu). Khi pet hạ gục một đối thủ, pet gầm lại lên các đối thủ còn lại và hồi {heal}% HP tối đa.",
    ...roarOnEntry,
    onFoeFaint(k, e) {
      // Hạ gục một đối thủ: gầm lại lên các đối thủ còn lại và hồi máu.
      if (!e.byMe) return;
      roar(
        k,
        k.foes.filter((f) => f !== e.foe),
      );
      k.heal(k.self, k.p.heal);
      k.proc("uy áp", e.foe);
    },
  },
};
