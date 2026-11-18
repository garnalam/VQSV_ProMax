import type { DesignTraitUnit } from "../../DesignTraits";
import { BUFF_BANK } from "../../StatusState";
import { KIT_STATUS, type Kit, type KitSkill, type KitStatus, type TraitScript } from "../TraitKit";

/** Chiêu hồi máu (Power 0, nhắm phe mình). */
const HEAL_NAME = /Dưỡng|Hồi Sinh|Chữa Lành|Tái Tạo|Thảo nguyện|cầu nguyện|Địa Giới/i;
/** Chiêu phòng thủ (Power 0, nhắm phe mình). */
const GUARD_NAME = /· Thủ|bích|Thạch phu|cầu nguyện|Địa Giới/i;
const isHeal = (s?: KitSkill): boolean => !!s && s.support && s.ownSide && HEAL_NAME.test(s.name);
const isGuard = (s?: KitSkill): boolean => !!s && s.support && s.ownSide && GUARD_NAME.test(s.name);
const isFire = (s?: KitSkill): boolean => !!s && s.attack && s.element === 0;
/** Chiêu gây Ngủ của pet. */
const SLEEP_SKILL = /Mê Vụ|Miên Ca/;
const hasDefenseUp = (u: DesignTraitUnit): boolean => u.currentStats.defense > u.baseStats.defense;
/** Máu tối đa còn thiếu. */
const missing = (u: DesignTraitUnit): number => Math.max(0, u.maxHp() - u.hp());
/** `percent`% của `amount`, làm tròn xuống. */
const pct = (amount: number, percent: number): number => Math.trunc((amount * percent) / 100);

/** Hiệu ứng xấu đối thủ vừa gây lên pet hoặc đồng đội, chờ cuối lượt trả lại (pet 30). */
const pendingReturn = new WeakMap<
  DesignTraitUnit,
  { victim: DesignTraitUnit; source: DesignTraitUnit; status: KitStatus }[]
>();

/** Cuối lượt: hút `sap`% máu từ Gieo Hạt/Hủ Thực do pet gây, tối đa `cap`% HP tối đa mỗi lượt. */
function sap(k: Kit, damage: number): number {
  if (k.e.sapRound !== k.round) {
    k.e.sapRound = k.round;
    k.e.sapGot = 0;
  }
  const room = k.pctOf(k.self, k.p.cap) - k.e.sapGot;
  const amount = Math.max(0, Math.min(pct(damage, k.p.sap), room));
  k.e.sapGot += amount;
  return amount;
}

/** Gai phản (pet 19): mỗi kẻ đánh 1 lần mỗi lượt; mỗi lần kích hoạt gai dài thêm `grow`%. */
function thorn(k: Kit, source: DesignTraitUnit): number {
  if (!k.oncePerRound(`gai:${source.ownerSide}:${source.formationSlot}`)) return 0;
  const percent = Math.min(k.p.cap, k.p.thorn + k.p.grow * (k.e.gai ?? 0));
  k.e.gai = (k.e.gai ?? 0) + 1;
  k.proc("gai", source);
  return k.pctOf(k.self, percent);
}

/** Than (pet 7, 8): mỗi lượt 1 Than khi pet (hoặc đồng đội trúng chiêu Hỏa) bị đánh. */
function ember(k: Kit, label: string, target?: DesignTraitUnit): void {
  if (!k.oncePerRound("than")) return;
  k.stack("than", 1, 3, true);
  k.proc(label, target);
}

/**
 * Khiên củ (pet 24, 25): khiên đặt 3 lượt để còn đọc được ở cuối lượt thứ 2; cuối lượt đó phần còn
 * lại đổi thành máu và khiên bị gỡ — tức khiên hiệu lực đúng 2 lượt.
 */
function rootShield(k: Kit, lead = 0): void {
  // `lead` = 1: đặt ở cuối lượt cho hai lượt kế tiếp (pet 24 làm mới theo nhịp 3 lượt).
  if (k.shield(k.self, k.p.shield, 3 + lead)) {
    k.e.rootEnd = k.round + 1 + lead;
    k.proc("khiên củ");
  }
  allyRootShield(k);
}
/** Khiên cho đồng đội; lúc đầu trận đồng đội có thể chưa vào sân, nên thử lại ở hành động đầu. */
function allyRootShield(k: Kit): void {
  if (!k.ally) {
    k.e.allyPending = 1;
    return;
  }
  k.e.allyPending = 0;
  if (k.shield(k.ally, k.p.allyShield, 2)) k.proc("khiên đồng đội", k.ally);
}
function rootShieldExpire(k: Kit): void {
  if (k.e.rootEnd !== k.round) return;
  k.e.rootEnd = 0;
  const left = k.shieldHp();
  if (left <= 0) return;
  k.self.statuses.remove(BUFF_BANK, 15);
  k.self.restoreSourceStatusState();
  if (k.healAmount(k.self, left).healed > 0) k.proc("củ hồi máu");
}

/** Phá giáp theo tầng (pet 35, 36): mỗi lượt 1 tầng, mục tiêu nhanh hơn thì 2 tầng. Trả số tầng cũ. */
function drill(k: Kit, target: DesignTraitUnit, cap: number): number {
  const before = k.marked(target, "khoan");
  if (!k.oncePerRound(`khoan:${target.ownerSide}:${target.formationSlot}`)) return before;
  // Dấu đếm tầng giữ 3 vòng: dấu bị dọn ở cuối vòng trước khi hết hạn, nên đặt dư 1 để tầng của
  // lượt trước còn đọc được ở lượt sau (tầng giảm DEF vẫn chỉ kéo dài 2 lượt).
  let stacks = k.mark(target, "khoan", 3, cap);
  if (k.faster(k.self, target)) stacks = k.mark(target, "khoan", 3, cap);
  k.statUp(target, "defense", -k.p.shred * stacks, 2, `khoan${k.self.speciesId}`);
  k.proc("phá giáp", target);
  return before;
}

/** Ảo ảnh của pet 4: đòn đầu tiên lên pet mang ảo ảnh lượt này có `miss`% trượt (xấp xỉ: giảm 80%). */
function illusion(k: Kit, holder: DesignTraitUnit): number | void {
  if (k.marked(holder, "ảo ảnh") <= 0) return;
  k.unmark(holder, "ảo ảnh");
  if (!k.chance(k.p.miss, "ảo ảnh")) return;
  k.proc("né", holder);
  return 80;
}

/** Pet 11, 12: +`gain`% sát thương mỗi `step`% Linh xảo vượt mục tiêu, tối đa `cap`%. */
function speedGap(k: Kit, target: DesignTraitUnit, skill: KitSkill | undefined): number | void {
  if (!skill?.attack) return;
  const theirs = Math.max(1, target.currentStats.speed);
  const gap = ((k.self.currentStats.speed - theirs) * 100) / theirs;
  const bonus = Math.min(k.p.cap, Math.trunc(gap / k.p.step) * k.p.gain);
  if (bonus <= 0) return;
  k.proc("vượt tốc", target);
  return bonus;
}

/** Số Vân còn hiệu lực của pet 13. */
function cloud(k: Kit): number {
  return k.round <= (k.e.vanUntil ?? 0) ? (k.e.van ?? 0) : 0;
}

/**
 * Pet 28: ô thép đỡ đòn trực tiếp đầu tiên mỗi lượt nhắm vào `mate` (chính pet, hoặc đồng đội ở 2v2).
 * Cứ 2 lần đỡ, pet vừa được che nhận khiên sau khi đòn trúng (để khiên không ăn luôn đòn vừa đỡ).
 */
function umbrella(k: Kit, mate: DesignTraitUnit, e: { direct?: boolean }): number | void {
  if (e.direct === false || !k.oncePerRound("ô")) return;
  k.e.guards = (k.e.guards ?? 0) + 1;
  if (k.e.guards % 2 === 0) k.e.pend = mate === k.self ? 1 : 2;
  k.proc("ô đỡ", mate);
  return k.p.guard;
}
function umbrellaShield(k: Kit, mate: DesignTraitUnit, who: number): void {
  if (k.e.pend !== who) return;
  k.e.pend = 0;
  if (k.shield(mate, k.p.shield, 2)) k.proc("khiên ô", mate);
}

/** Pet 29 (2v2): đồng đội đánh mục tiêu Ngủ/Mơ Màng do pet gây. Số viết thẳng trong mô tả đã duyệt. */
const ALLY_DREAM_29 = 10;

/** Pet 29: mục tiêu pet ru Ngủ vừa tỉnh → Mơ Màng 2 lượt (dấu "mơ"). */
function dreamCheck(k: Kit, atRoundEnd = false): void {
  for (const foe of k.foes) {
    if (k.marked(foe, "ngủ") <= 0 || k.has(foe, "sleep")) continue;
    k.unmark(foe, "ngủ");
    // Ở cuối lượt, dấu đặt 3 để còn đủ 2 lượt kế tiếp.
    k.mark(foe, "mơ", atRoundEnd ? 3 : 2);
    k.proc("tỉnh mơ màng", foe);
  }
}

/** Pet 2: thêm `n` tầng giận (tối đa 3); tầng giữ 3 lượt kể từ tầng mới nhất. */
function rage(k: Kit, n: number): void {
  if (k.round > (k.e.rageUntil ?? 0)) k.e.rage = 0;
  k.e.rageUntil = k.round + 2;
  k.stack("rage", n, 3, true);
}

/** Kịch bản đặc tính, phần 1. */
export const PART_1: Record<number, TraitScript> = {
  // 0 Nhiên Dực Bức
  0: {
    name: "Cánh tro hút nhiệt",
    params: { lifesteal: 20, cap: 8, ally: 10 },
    text: "Lượt pet ra đòn trước đối thủ, chiêu tấn công đặt Gieo Hạt 2 lượt lên mục tiêu (nếu chưa có). Đánh mục tiêu đang bị Gieo Hạt thì pet hút {lifesteal}% sát thương thực gây ra (tối đa {cap}% HP tối đa mỗi đòn).",
    onHitDealt(k, e) {
      // Lượt ra đòn trước: chiêu tấn công đặt Gieo Hạt 2 lượt (nếu chưa có).
      if (
        k.self.designTraitState.actedFirst &&
        !k.has(e.target, "seed") &&
        k.inflict(e.target, "seed", 2, { refresh: false })
      ) {
        k.mark(e.target, "seed", 2);
        k.proc("gieo hạt", e.target);
      }
    },
    afterAction(k, e) {
      // Đánh mục tiêu đang bị Gieo Hạt: hút sát thương thực, có trần theo HP tối đa.
      if (!e.target || !e.hit || e.damage <= 0 || !k.has(e.target, "seed")) return;
      if (e.newStatuses.includes("seed")) return;
      const amount = Math.min(pct(e.damage, k.p.lifesteal), k.pctOf(k.self, k.p.cap));
      if (k.healAmount(k.self, amount).healed > 0) k.proc("hút máu");
    },
    allyOutgoing(k, e) {
      // 2v2: đồng đội đánh mục tiêu đang bị Gieo Hạt do pet này đặt.
      if (k.marked(e.target, "seed") > 0 && k.has(e.target, "seed")) {
        k.proc("đồng đội +10%", e.source);
        return k.p.ally;
      }
    },
  },

  // 1 Bom tinh nghịch
  1: {
    name: "Ngòi nổ dây chuyền",
    params: { fuse: 12, blast: 10, perFuse: 8 },
    text: "Mỗi lần pet tự trả HP (như Bộc Tâm Phá Trận · Hiến), nhận 1 Ngòi (tối đa 3, giữ đến khi rời sân); mỗi Ngòi +{fuse}% sát thương. Khi pet gục, nó phát nổ: kẻ hạ gục mất HP bằng {blast}% HP tối đa của pet cộng {perFuse}% cho mỗi Ngòi. Trong trận đôi, vụ nổ khi gục chia đều lên cả hai đối thủ (mỗi bên một nửa).",
    afterAction(k, e) {
      // Tự trả HP (Bộc Tâm Phá Trận · Hiến): +1 Ngòi (tối đa 3, mất khi rời sân).
      if (e.hit && e.skill?.name === "Bộc Tâm Phá Trận · Hiến") {
        k.stack("ngòi", 1, 3, true);
        k.proc("ngòi");
      }
    },
    outgoing(k, e) {
      const fuses = k.e["ngòi"] ?? 0;
      if (fuses > 0 && e.skill?.attack) {
        k.proc("ngòi +sát thương", e.target);
        return fuses * k.p.fuse;
      }
    },
    incoming(k, e) {
      // Khi gục: nổ lên kẻ hạ gục (2v2: chia đôi cho hai đối thủ). Kit không có hook "chính pet gục":
      // nổ ngay khi đòn sắp tới đủ hạ pet.
      if (k.e.boom || e.damage < k.self.hp()) return;
      k.e.boom = 1;
      const amount = k.pctOf(k.self, k.p.blast + k.p.perFuse * (k.e["ngòi"] ?? 0));
      const foes = k.foes;
      if (foes.length > 1) {
        for (const foe of foes) if (k.damage(foe, Math.trunc(amount / 2)) > 0) k.proc("nổ", foe);
      } else {
        const killer = k.isFoe(e.source) ? e.source : k.foe;
        if (k.damage(killer, amount) > 0) k.proc("nổ", killer);
      }
    },
  },

  // 2 Nhiên Liệp Sư
  2: {
    name: "Bờm sư cuồng nộ",
    params: { atk: 12, burst: 20 },
    text: "Mỗi lần bị đánh trúng, Sức mạnh +{atk}% trong 3 lượt (tối đa 3 tầng, mỗi lượt 1 tầng). Khi đủ 3 tầng, chiêu tấn công kế tiếp tiêu hết tầng, chắc chắn gây Xé Rách 2 lượt và gây thêm {burst}% sát thương. Khi đồng đội bị hạ gục, pet nhận ngay 2 tầng.",
    statBonus(k, stat) {
      if (stat === "attack" && k.round <= (k.e.rageUntil ?? 0)) return (k.e.rage ?? 0) * k.p.atk;
    },
    onHitTaken(k, e) {
      if (!k.oncePerRound("giận")) return;
      rage(k, 1);
      k.proc("giận", e.source);
    },
    outgoing(k, e) {
      // Đủ 3 tầng: chiêu tấn công kế tiếp tiêu hết tầng, cộng sát thương.
      if ((k.e.rage ?? 0) >= 3 && k.round <= (k.e.rageUntil ?? 0) && e.skill?.attack) {
        k.e.burst = 1;
        k.proc("bùng nộ", e.target);
        return k.p.burst;
      }
    },
    onHitDealt(k, e) {
      // ...và chắc chắn gây Xé Rách 2 lượt.
      if (!k.e.burst) return;
      k.e.burst = 0;
      k.e.rage = 0;
      k.refresh();
      if (k.inflict(e.target, "bleed", 2)) k.proc("xé rách", e.target);
    },
    onAllyFaint(k, e) {
      // 2v2: đồng đội gục → nhận ngay 2 tầng giận.
      rage(k, 2);
      k.proc("trả thù", e.ally);
    },
  },

  // 3 Hắc Thán Báo
  3: {
    name: "Bóng than liên sát",
    params: { per: 3, cap: 27, killHeal: 15, killBonus: 15 },
    text: "Chiêu tấn công gây thêm {per}% sát thương cho mỗi 10% HP mục tiêu đã mất (tối đa +{cap}%). Khi pet hạ gục đối thủ, pet hồi {killHeal}% HP tối đa, lượt kế tiếp được ưu tiên ra đòn trước và chiêu tấn công lượt đó gây thêm {killBonus}%.",
    outgoing(k, e) {
      if (!e.skill?.attack) return;
      let bonus = 0;
      // Mỗi 10% HP mục tiêu đã mất: +per% (trần cap%).
      const tens = Math.trunc((100 - k.hpPct(e.target)) / 10);
      const wear = Math.min(k.p.cap, tens * k.p.per);
      if (wear > 0) {
        bonus += wear;
        k.proc("đánh mòn", e.target);
      }
      if (k.v.killRound === k.round) {
        bonus += k.p.killBonus;
        k.proc("truy sát", e.target);
      }
      return bonus;
    },
    onFoeFaint(k, e) {
      if (!e.byMe) return;
      if (k.heal(k.self, k.p.killHeal).healed > 0) k.proc("hồi khi hạ gục");
      k.v.killRound = k.round + 1;
      k.v.rush = 1;
      k.proc("hạ gục", e.foe);
    },
    beforeAction(k) {
      // Ưu tiên chỉ dành cho lượt kế tiếp sau khi hạ gục.
      if (k.v.rush && k.round >= (k.v.killRound ?? 0)) k.v.rush = 0;
    },
    priority(k) {
      if (!k.v.rush) return;
      if (k.oncePerRound("ưu tiên")) k.proc("ưu tiên");
      return true;
    },
  },

  // 4 Hỏa Diễm Hồ
  4: {
    name: "Hồ hỏa ảo ảnh",
    params: { miss: 35, bleed: 15 },
    text: "Lượt pet ra đòn trước đối thủ, pet để lại một ảo ảnh: đòn đơn mục tiêu đầu tiên nhắm vào pet trong lượt đó có {miss}% đánh trượt. Đánh mục tiêu đang bị Xé Rách thì gây thêm {bleed}% sát thương. Khi có đồng đội trên sân, có thể đặt ảo ảnh lên đồng đội thay vì bản thân (chọn khi ra lệnh).",
    afterAction(k, e) {
      // Ra đòn trước: ảo ảnh lên pet (2v2: lên đồng đội).
      if (!e.actedFirst || k.e.illusionRound === k.round) return;
      k.e.illusionRound = k.round;
      const holder = k.ally ?? k.self;
      k.mark(holder, "ảo ảnh", 1);
      k.proc("ảo ảnh", holder);
    },
    incoming(k, e) {
      if (e.direct) return illusion(k, k.self);
    },
    guardAlly(k, e) {
      return illusion(k, e.target);
    },
    outgoing(k, e) {
      if (k.has(e.target, "bleed")) {
        k.proc("xé rách +15%", e.target);
        return k.p.bleed;
      }
    },
  },

  // 5 Viêm Ma
  5: {
    name: "Ma diễm hồi chấn",
    params: { reflect: 30, allyReflect: 15 },
    text: "Khi trúng đòn làm mất từ 10% HP tối đa trở lên, pet phản lại kẻ tấn công {reflect}% lượng HP vừa mất (mỗi lượt 1 lần). Lần phản thứ hai trở đi trong mỗi lần ra sân còn gây Xé Rách 2 lượt. Khi đồng đội trúng đòn mất từ 15% HP tối đa trở lên, pet phản thay {allyReflect}% lượng HP đó (dùng chung lượt 1 lần với phản của bản thân).",
    onHitTaken(k, e) {
      if (e.damage < k.pctOf(k.self, 10) || !k.oncePerRound("phản")) return;
      const count = k.stack("phản", 1, 99, true);
      k.proc("phản", e.source);
      if (count >= 2 && k.inflict(e.source, "bleed", 2)) k.proc("xé rách", e.source);
      return pct(e.damage, k.p.reflect);
    },
    onAllyHitTaken(k, e) {
      if (e.damage < k.pctOf(e.target, 15) || !k.oncePerRound("phản")) return;
      if (k.damage(e.source, pct(e.damage, k.p.allyReflect)) > 0) k.proc("phản thay", e.source);
    },
  },

  // 6 Long bảo bối
  6: {
    name: "Lò lửa non",
    params: { heal: 10, fire: 25, resist: 15 },
    text: "Lần đầu bị đánh trúng sau mỗi lần ra sân, pet nuốt lửa: hồi {heal}% HP tối đa và chiêu Hỏa kế tiếp trong 2 lượt gây thêm {fire}% sát thương. Sát thương nhận từ chiêu hệ Hỏa giảm {resist}%.",
    onHitTaken(k) {
      if (k.e.oven) return;
      k.e.oven = 1;
      k.e.fireUntil = k.round + 1;
      k.heal(k.self, k.p.heal);
      k.proc("nuốt lửa");
    },
    outgoing(k, e) {
      if (k.e.oven === 1 && k.round <= (k.e.fireUntil ?? 0) && isFire(e.skill)) {
        k.e.oven = 2;
        k.proc("lửa +25%", e.target);
        return k.p.fire;
      }
    },
    incoming(k, e) {
      if (e.direct && isFire(e.skill)) {
        k.proc("kháng hỏa");
        return k.p.resist;
      }
    },
  },

  // 7 Phệ Hỏa Thú
  7: {
    name: "Dạ dày phệ hỏa",
    params: { ember: 8, resist: 25 },
    text: "Mỗi lượt bị đánh trúng, pet tích 1 Than (tối đa 3, mất khi rời sân); mỗi Than giúp chiêu Hỏa gây thêm {ember}% sát thương. Sát thương nhận từ chiêu hệ Hỏa giảm {resist}%. Than cũng tích khi đồng đội bị chiêu Hỏa đánh trúng (vẫn mỗi lượt 1 Than).",
    onHitTaken(k, e) {
      ember(k, "than", e.source);
    },
    onAllyHitTaken(k, e) {
      if (isFire(e.skill)) ember(k, "than đồng đội", e.target);
    },
    outgoing(k, e) {
      const embers = k.e.than ?? 0;
      if (embers > 0 && isFire(e.skill)) {
        k.proc("than +sát thương", e.target);
        return embers * k.p.ember;
      }
    },
    incoming(k, e) {
      if (e.direct && isFire(e.skill)) {
        k.proc("kháng hỏa");
        return k.p.resist;
      }
    },
  },

  // 8 Bạo Long Thú
  8: {
    name: "Bạo long lò luyện",
    params: { ember: 10, heal: 15, resist: 20 },
    text: "Mỗi lượt bị đánh trúng, tích 1 Than (tối đa 3); mỗi Than +{ember}% sát thương chiêu Hỏa. Đủ 3 Than: chiêu Hỏa kế tiếp tiêu hết Than, đặt Gieo Hạt 3 lượt và hồi {heal}% HP tối đa. Nhận ít hơn {resist}% sát thương từ chiêu Hỏa. Khi có đồng đội trên sân, Than cũng tích khi đồng đội bị chiêu Hỏa đánh; nếu có đồng đội dưới 40% HP, lượng hồi {heal}% chuyển cho đồng đội thấp máu nhất thay vì bản thân.",
    onHitTaken(k, e) {
      ember(k, "than", e.source);
    },
    onAllyHitTaken(k, e) {
      if (isFire(e.skill)) ember(k, "than đồng đội", e.target);
    },
    outgoing(k, e) {
      const embers = k.e.than ?? 0;
      if (embers <= 0 || !isFire(e.skill)) return;
      if (embers >= 3) k.e.vent = 1;
      k.proc("than +sát thương", e.target);
      return embers * k.p.ember;
    },
    onHitDealt(k, e) {
      if (!k.e.vent) return;
      k.e.vent = 0;
      k.e.than = 0;
      k.inflict(e.target, "seed", 3);
      const mender = k.ally && k.hpPct(k.ally) < 40 ? k.ally : k.self;
      k.heal(mender, k.p.heal);
      k.proc("xả than", e.target);
      if (mender !== k.self) k.proc("hồi đồng đội", mender);
    },
    incoming(k, e) {
      if (e.direct && isFire(e.skill)) {
        k.proc("kháng hỏa");
        return k.p.resist;
      }
    },
  },

  // 9 Ly Ngưu Ngưu
  9: {
    name: "Ngưu giáp húc trả",
    params: { ram: 35, tier: 4, tierCap: 12, allyShare: 50 },
    text: "Lượt pet ra đòn sau đối thủ và đã bị đánh mất HP trong lượt đó, chiêu tấn công gây thêm sát thương bằng {ram}% lượng HP vừa mất. Mỗi tầng Phòng ngự đang có giúp pet nhận ít hơn {tier}% sát thương (tối đa {tierCap}%). Trong trận đôi, lượng HP đồng đội mất trong lượt đó cũng được tính ({allyShare}% lượng).",
    onHitDealt(k, e) {
      if (k.self.designTraitState.actedFirst) return;
      const lost = k.hpLostThisRound + pct(k.allyHpLostThisRound, k.p.allyShare);
      if (lost <= 0 || !e.skill?.attack) return;
      if (!k.oncePerRound("húc trả")) return;
      if (k.damage(e.target, pct(lost, k.p.ram)) > 0) k.proc("húc trả", e.target);
    },
    incoming(k) {
      const reduction = Math.min(k.p.tierCap, k.defenseTiers() * k.p.tier);
      if (reduction > 0) k.proc("giáp tầng");
      return reduction;
    },
  },

  // 10 Ly Ngưu Thản Khắc
  10: {
    name: "Thản khắc phản xung",
    params: { ram: 34, tier: 5, tierCap: 11, petrify: 23, allyShare: 38 },
    text: "Lượt pet ra đòn sau và đã bị đánh mất HP, chiêu tấn công gây thêm sát thương bằng {ram}% lượng HP vừa mất (3 lượt 1 lần). Mỗi tầng Phòng ngự giúp nhận ít hơn {tier}% sát thương (tối đa {tierCap}%); đủ 3 tầng thì đòn húc trả còn có {petrify}% gây Hóa Đá 1 lượt (mỗi trận 1 lần). Khi có đồng đội trên sân, lượng HP vừa mất tính thêm {allyShare}% HP đồng đội mất trong lượt đó.",
    onHitDealt(k, e) {
      if (k.self.designTraitState.actedFirst || !e.skill?.attack) return;
      const lost = k.hpLostThisRound + pct(k.allyHpLostThisRound, k.p.allyShare);
      if (lost <= 0 || !k.tryUse("húc trả", 3)) return;
      if (k.damage(e.target, pct(lost, k.p.ram)) > 0) k.proc("húc trả", e.target);
      if (
        !k.v.petrified &&
        k.defenseTiers() >= 3 &&
        k.chance(k.p.petrify, "hóa đá") &&
        k.inflict(e.target, "petrify", 1)
      ) {
        k.v.petrified = 1;
        k.proc("hóa đá", e.target);
      }
    },
    incoming(k) {
      const reduction = Math.min(k.p.tierCap, k.defenseTiers() * k.p.tier);
      if (reduction > 0) k.proc("giáp tầng");
      return reduction;
    },
  },

  // 11 Nhiệt Bạo Phong Tốc Khuyển
  11: {
    name: "Truy phong khoảng cách",
    params: { gain: 1, step: 4, cap: 18, slow: 15 },
    text: "Chiêu tấn công gây thêm {gain}% sát thương cho mỗi {step}% Linh xảo pet vượt mục tiêu (tối đa +{cap}%). Đòn đầu tiên trúng đích mỗi lần ra sân giảm {slow}% Linh xảo mục tiêu trong 2 lượt.",
    outgoing(k, e) {
      return speedGap(k, e.target, e.skill);
    },
    onHitDealt(k, e) {
      if (k.e.firstHit) return;
      k.e.firstHit = 1;
      k.statUp(e.target, "speed", -k.p.slow, 2, "tp11");
      k.proc("giảm tốc", e.target);
    },
  },

  // 12 Tuyệt Đối Linh Độ Khuyển
  12: {
    name: "Tuyệt đối truy phong",
    params: { gain: 1, step: 4, cap: 22, slow: 15, teamSlow: 10 },
    text: "Chiêu tấn công gây thêm {gain}% sát thương cho mỗi {step}% Linh xảo pet vượt mục tiêu (tối đa +{cap}%). Đánh mục tiêu đang bị Giam Cầm thì đòn không thể trượt và mục tiêu bị giảm {slow}% Linh xảo 2 lượt. Mục tiêu bị Giam Cầm do pet gây cũng bị giảm {teamSlow}% Linh xảo với đồng đội của pet.",
    outgoing(k, e) {
      return speedGap(k, e.target, e.skill);
    },
    afterAction(k, e) {
      if (e.target && e.newStatuses.includes("bind")) k.mark(e.target, "bind", 2);
    },
    onHitDealt(k, e) {
      // Mục tiêu đang Giam Cầm: (không trượt — chưa có cờ) giảm Linh xảo 2 lượt.
      if (!k.has(e.target, "bind")) return;
      k.statUp(e.target, "speed", -k.p.slow, 2, "tp12");
      k.proc("giam cầm chậm", e.target);
      if (k.ally && k.marked(e.target, "bind") > 0) {
        k.statUp(e.target, "speed", -k.p.teamSlow, 2, "tp12team");
        k.proc("cả đội vượt tốc", e.target);
      }
    },
  },

  // 13 Hỏa Diễm Tường Vân Khuyển
  13: {
    name: "Tường vân hộ thể",
    params: { guard: 8, burst: 25 },
    text: "Mỗi lần đánh trúng, pet nhận 1 Vân (tối đa 2, giữ 3 lượt); mỗi Vân giúp nhận ít hơn {guard}% sát thương. Khi có 2 Vân, chiêu tấn công kế tiếp tiêu hết Vân và gây thêm {burst}% sát thương. Khi pet tiêu Vân, đồng đội nhận 1 Vân (giảm {guard}% sát thương nhận trong 2 lượt).",
    outgoing(k, e) {
      if (cloud(k) >= 2 && e.skill?.attack) {
        k.e.spend = 1;
        k.proc("tiêu vân", e.target);
        return k.p.burst;
      }
    },
    onHitDealt(k) {
      if (k.e.spend) {
        k.e.spend = 0;
        k.e.van = 0;
        // Đồng đội (1v1: chính pet) nhận 1 Vân 2 lượt.
        if (k.ally) k.mark(k.ally, "vân", 2);
        else {
          k.e.van = 1;
          k.e.vanUntil = k.round + 1;
        }
        k.proc("vân đồng đội", k.allyOrSelf);
        return;
      }
      k.e.van = Math.min(2, cloud(k) + 1);
      k.e.vanUntil = k.round + 2;
      k.proc("vân");
    },
    incoming(k, e) {
      const n = cloud(k);
      if (n > 0 && e.direct) {
        k.proc("vân chắn");
        return n * k.p.guard;
      }
    },
    guardAlly(k, e) {
      if (k.marked(e.target, "vân") > 0) {
        k.proc("vân chắn đồng đội", e.target);
        return k.p.guard;
      }
    },
  },

  // 14 Tà Vân Khuyển Thần
  14: {
    name: "Tà vân ấn hồn",
    params: { per: 12, heal: 6, ally: 8 },
    text: "Mỗi chiêu tấn công đánh trúng khắc 1 Tà Ấn lên mục tiêu (tối đa 3, giữ 3 lượt). Chiêu hệ Hỏa đánh mục tiêu có Tà Ấn sẽ tiêu hết ấn: mỗi ấn +{per}% sát thương và hồi {heal}% sát thương thực gây ra. Tà Ấn tính là 'dấu tích từ đặc tính' cho Khuyển Thần Hỏa Phán · Bạo. Đồng đội hệ Hỏa đánh mục tiêu có Tà Ấn cũng tiêu được ấn (+{ally}% mỗi ấn).",
    onHitDealt(k, e) {
      // Đòn Hỏa vừa tiêu ấn: hồi theo sát thương thực, không khắc ấn mới.
      if (k.e.sealSpent) {
        k.e.sealSpent = 0;
        k.unmark(e.target, "tà ấn");
        if (k.healAmount(k.self, pct(e.damage, k.p.heal)).healed > 0) k.proc("hút ấn");
        return;
      }
      if (e.skill?.attack && e.target.alive()) {
        k.mark(e.target, "tà ấn", 3, 3);
        k.proc("tà ấn", e.target);
      }
    },
    outgoing(k, e) {
      const seals = k.marked(e.target, "tà ấn");
      if (seals > 0 && isFire(e.skill)) {
        k.e.sealSpent = 1;
        k.proc("tiêu ấn", e.target);
        return seals * k.p.per;
      }
    },
    allyOutgoing(k, e) {
      const seals = k.marked(e.target, "tà ấn");
      if (seals > 0 && isFire(e.skill)) {
        k.unmark(e.target, "tà ấn");
        k.proc("đồng đội tiêu ấn", e.source);
        return seals * k.p.ally;
      }
    },
  },

  // 15 Hỏa Phượng Hoàng
  15: {
    name: "Niết bàn hỏa phượng",
    params: { revive: 50, fire: 25, healBonus: 10, allyHeal: 20 },
    text: "Mỗi trận một lần, khi bị hạ gục, pet tái sinh cuối lượt đó với {revive}% HP tối đa và xóa mọi hiệu ứng xấu; sau tái sinh chiêu Hỏa +{fire}% sát thương trong 3 lượt. Chiêu hồi máu của pet hồi thêm {healBonus}% HP tối đa cho mục tiêu. Khi tái sinh, lửa niết bàn hồi {allyHeal}% HP tối đa cho đồng đội và đặt Gieo Hạt 2 lượt lên cả hai đối thủ.",
    incoming(k, e) {
      // Kit không hồi sinh được pet đã gục: khi đòn sắp tới đủ hạ pet, pet giữ mạng rồi tái sinh ngay.
      if (k.v.reborn || e.damage < k.self.hp()) return;
      k.v.reborn = 1;
      k.e.rising = 1;
      k.self.setHp(k.self.maxHp());
    },
    onDamaged(k) {
      if (!k.e.rising) return;
      k.e.rising = 0;
      k.self.setHp(Math.max(1, k.pctOf(k.self, k.p.revive)));
      k.cleanse(k.self, 99);
      k.v.fireUntil = k.round + 2;
      k.refresh();
      k.proc("tái sinh");
      if (k.ally && k.heal(k.ally, k.p.allyHeal).healed > 0) k.proc("lửa hồi đồng đội", k.ally);
      for (const foe of k.foes) if (k.inflict(foe, "seed", 2)) k.proc("niết bàn gieo hạt", foe);
    },
    outgoing(k, e) {
      if (k.round <= (k.v.fireUntil ?? 0) && isFire(e.skill)) {
        k.proc("hỏa +25%", e.target);
        return k.p.fire;
      }
    },
    healOut(k, e) {
      k.proc("hồi thêm", e.target);
      return k.pctOf(e.target, k.p.healBonus);
    },
  },

  // 16 Diệp Tán Oa
  16: {
    name: "Rễ con hút nhựa",
    params: { sap: 100, cap: 6 },
    text: "Cuối mỗi lượt, khi Gieo Hạt hoặc Hủ Thực do pet gây làm đối thủ mất HP, pet hồi lượng HP bằng {sap}% số HP đối thủ vừa mất (tối đa {cap}% HP tối đa của pet). Trong trận đôi, tính tick trên cả hai đối thủ (vẫn tối đa {cap}% HP tối đa mỗi lượt).",
    onDotTick(k, e) {
      if (e.status !== "seed" && e.status !== "corrosion") return;
      if (k.healAmount(k.self, sap(k, e.damage)).healed > 0) k.proc("hút nhựa", e.target);
    },
  },

  // 17 Thụ Tán Oa
  17: {
    name: "Tán rễ giam căn",
    params: { sap: 100, cap: 8 },
    text: "Cuối lượt, khi Gieo Hạt/Hủ Thực do pet gây làm đối thủ mất HP, pet hồi lượng bằng {sap}% số HP đó (tối đa {cap}% HP tối đa). Đối thủ đang bị Gieo Hạt hoặc Hủ Thực của pet không thể đổi pet. Khóa đổi pet áp lên mọi đối thủ đang trúng độc của pet.",
    onDotTick(k, e) {
      if (e.status !== "seed" && e.status !== "corrosion") return;
      if (k.healAmount(k.self, sap(k, e.damage)).healed > 0) k.proc("hút nhựa", e.target);
      // Khóa đổi pet: kit chưa có — chỉ ghi nhận.
      k.proc("khóa đổi pet", e.target);
    },
  },

  // 18 Long Oa
  18: {
    name: "Long căn cộng sinh",
    params: { sap: 100, cap: 10 },
    text: "Cuối lượt, khi Gieo Hạt/Hủ Thực do pet gây làm đối thủ mất HP, pet hồi lượng bằng {sap}% số HP đó (tối đa {cap}% HP tối đa); phần dư khi đầy máu thành khiên 2 lượt. Đối thủ trúng độc của pet không thể đổi pet. Khi có đồng đội thấp máu hơn pet, lượng hồi chia đôi cho đồng đội.",
    onDotTick(k, e) {
      if (e.status !== "seed" && e.status !== "corrosion") return;
      const amount = sap(k, e.damage);
      if (amount <= 0) return;
      let own = amount;
      if (k.ally && k.hpPct(k.ally) < k.hpPct()) {
        own = Math.trunc(amount / 2);
        if (k.healAmount(k.ally, amount - own).healed > 0) k.proc("nuôi đồng đội", k.ally);
      }
      const { healed, overflow } = k.healAmount(k.self, own);
      if (healed > 0) k.proc("hút nhựa", e.target);
      if (overflow > 0 && k.shieldAmount(k.self, Math.min(overflow, k.pctOf(k.self, k.p.cap)), 2))
        k.proc("khiên rễ");
      k.proc("khóa đổi pet", e.target);
    },
  },

  // 19 Tiên Nhân Cầu Bảo Bảo
  19: {
    name: "Gai non mọc dần",
    params: { thorn: 6, grow: 1, cap: 9 },
    text: "Mỗi lần bị đánh mất HP, kẻ tấn công mất HP bằng {thorn}% HP tối đa của pet (mỗi lượt 1 lần); mỗi lần gai kích hoạt, gai dài thêm {grow}% (tối đa {cap}%, đến khi rời sân).",
    onHitTaken(k, e) {
      if (e.damage > 0) return thorn(k, e.source);
    },
  },

  // 20 Tiên Nhân Chưởng Thú
  20: {
    name: "Gai độc chưởng",
    params: { thorn: 5 },
    text: "Mỗi lần bị đánh mất HP, kẻ tấn công mất HP bằng {thorn}% HP tối đa của pet (2 lượt 1 lần). Kẻ tấn công đang bị Hủ Thực thì Hủ Thực được kéo dài thêm 1 lượt.",
    onHitTaken(k, e) {
      if (e.damage <= 0 || !k.tryUse("gai độc", 2)) return;
      k.proc("gai", e.source);
      const amount = k.pctOf(k.self, k.p.thorn);
      if (amount > 0 && k.has(e.source, "corrosion")) {
        const slot = KIT_STATUS.corrosion;
        const status = e.source.statuses.get(slot.bank, slot.id);
        if (status) {
          status.remainingTurns += 1;
          k.proc("kéo hủ thực", e.source);
        }
      }
      return amount;
    },
  },

  // 21 Thiết Tý Phách Vương Thụ
  21: {
    name: "Phách vương thứ giáp",
    params: { thorn: 8, poisonThorn: 10, drain: 50, allyThorn: 4 },
    text: "Mỗi lần bị đánh mất HP, kẻ tấn công mất HP bằng {thorn}% HP tối đa của pet (mỗi lượt 1 lần). Lượt pet đặt được Hủ Thực, gai lượt đó tăng lên {poisonThorn}% và pet hồi {drain}% lượng gai gây ra. Khi đồng đội bị đánh mất HP, kẻ đánh cũng mất {allyThorn}% HP tối đa của pet (mỗi lượt 1 lần chung).",
    afterAction(k, e) {
      if (e.newStatuses.includes("corrosion")) k.e.corrRound = k.round;
    },
    onHitTaken(k, e) {
      if (e.damage <= 0 || !k.oncePerRound("gai")) return;
      const poisoned = k.e.corrRound === k.round;
      const amount = k.pctOf(k.self, poisoned ? k.p.poisonThorn : k.p.thorn);
      k.proc("gai", e.source);
      if (poisoned && k.healAmount(k.self, pct(amount, k.p.drain)).healed > 0)
        k.proc("gai hồi máu");
      return amount;
    },
    onAllyHitTaken(k, e) {
      if (e.damage <= 0 || !k.oncePerRound("gai")) return;
      if (k.damage(e.source, k.pctOf(k.self, k.p.allyThorn)) > 0) k.proc("gai bảo kê", e.source);
    },
  },

  // 22 Khẩu Đại Thảo
  22: {
    name: "Hàm bẫy chờ mồi",
    params: { bite: 22, ally: 10 },
    text: "Lần đầu bị đánh trúng sau mỗi lần ra sân, kẻ tấn công bị Quấn Quanh 2 lượt. Đánh mục tiêu đang bị Quấn Quanh hoặc Giam Cầm thì gây thêm {bite}% sát thương. Trong trận đôi, bẫy bắt kẻ đầu tiên đánh vào pet, kể cả đòn lan; đồng đội đánh mục tiêu bị Quấn Quanh do pet gây được +{ally}% sát thương.",
    onHitTaken(k, e) {
      if (k.e.trap) return;
      k.e.trap = 1;
      if (k.inflict(e.source, "entangle", 2)) {
        k.mark(e.source, "bẫy", 2);
        k.proc("bẫy", e.source);
      }
    },
    outgoing(k, e) {
      if (k.has(e.target, "entangle") || k.has(e.target, "bind")) {
        k.proc("cắn mồi", e.target);
        return k.p.bite;
      }
    },
    allyOutgoing(k, e) {
      if (k.marked(e.target, "bẫy") > 0 && k.has(e.target, "entangle")) {
        k.proc("đồng đội +10%", e.source);
        return k.p.ally;
      }
    },
  },

  // 23 Khốc Tị Mộc Linh
  23: {
    name: "Huyết chủng ký sinh",
    params: { guard: 25, drain: 30 },
    text: "Khi dùng chiêu hồi máu, pet đặt Gieo Hạt 3 lượt lên đối thủ (nếu chưa có) và lượt đó nhận ít hơn {guard}% sát thương. Pet đánh mục tiêu đang bị Gieo Hạt thì hồi {drain}% sát thương thực gây ra. Khi hồi máu cho đồng đội, Gieo Hạt đặt lên đối thủ có HP cao nhất và đồng đội được che {guard}% sát thương thay cho pet.",
    afterAction(k, e) {
      if (isHeal(e.skill)) {
        const foe = [...k.foes].sort((a, b) => k.hpPct(b) - k.hpPct(a))[0];
        if (foe && !k.has(foe, "seed") && k.inflict(foe, "seed", 3, { refresh: false }))
          k.proc("gieo hạt", foe);
        k.e.guardRound = k.round;
        k.e.guardAlly = e.target && k.isAlly(e.target) ? 1 : 0;
        return;
      }
      if (!e.target || !e.hit || e.damage <= 0 || !k.has(e.target, "seed")) return;
      if (e.newStatuses.includes("seed")) return;
      if (k.healAmount(k.self, pct(e.damage, k.p.drain)).healed > 0) k.proc("hút huyết");
    },
    incoming(k, e) {
      if (e.direct && k.e.guardRound === k.round && !k.e.guardAlly) {
        k.proc("che 25%");
        return k.p.guard;
      }
    },
    guardAlly(k, e) {
      if (k.e.guardRound === k.round && k.e.guardAlly) {
        k.proc("che đồng đội", e.target);
        return k.p.guard;
      }
    },
  },

  // 24 La Phục Thảo
  24: {
    name: "Củ dự trữ",
    params: { shield: 12, healBonus: 8, allyShield: 6 },
    text: "Khi ra sân và cứ mỗi 3 lượt trên sân, pet nhận khiên {shield}% HP tối đa trong 2 lượt; khiên hết hạn mà chưa vỡ thì phần còn lại thành hồi máu. Khi pet đang có khiên, chiêu hồi máu của pet hồi thêm {healBonus}% HP tối đa. Khiên còn tồn tại tính là 'dự trữ' cho La Phục Dưỡng Căn. Mỗi lần pet nhận khiên củ, đồng đội cũng nhận khiên {allyShield}% HP tối đa trong 2 lượt.",
    onEnter(k) {
      rootShield(k);
    },
    beforeAction(k) {
      if (k.e.allyPending && k.ally) allyRootShield(k);
    },
    roundEnd(k) {
      rootShieldExpire(k);
      // Cứ mỗi 3 lượt trên sân (lượt 4, 7… kể từ lượt ra sân): khiên củ mới cho hai lượt kế tiếp.
      if ((k.roundsOnField + 1) % 3 === 0) rootShield(k, 1);
    },
    healOut(k, e) {
      if (k.shieldHp() <= 0) return;
      k.proc("củ hồi thêm", e.target);
      return k.pctOf(e.target, k.p.healBonus);
    },
  },

  // 25 La phục Oa Oa
  25: {
    name: "Củ già bọc thân",
    params: { shield: 18, allyShield: 9 },
    text: "Khi ra sân nhận khiên {shield}% HP tối đa trong 2 lượt; khiên hết hạn mà chưa vỡ thì phần còn lại thành hồi máu. Dùng chiêu hồi máu hoặc phòng thủ sẽ làm mới khiên này (3 lượt 1 lần). Khi ra sân và khi làm mới, đồng đội cũng nhận khiên {allyShield}% HP tối đa.",
    onEnter(k) {
      rootShield(k);
    },
    beforeAction(k) {
      if (k.e.allyPending && k.ally) allyRootShield(k);
    },
    afterAction(k, e) {
      if ((isHeal(e.skill) || isGuard(e.skill)) && k.tryUse("làm mới", 3)) {
        k.self.statuses.remove(BUFF_BANK, 15);
        k.self.restoreSourceStatusState();
        rootShield(k);
        k.proc("làm mới khiên");
      }
    },
    roundEnd(k) {
      rootShieldExpire(k);
    },
  },

  // 26 Tây Quan Tiểu Hương Trư
  26: {
    name: "Gạc non thủ thế",
    params: { guard: 20, defHit: 20, allyDef: 10 },
    text: "Lượt pet dùng chiêu phòng thủ hoặc hồi máu, pet nhận ít hơn {guard}% sát thương trong lượt đó. Khi đang có tăng Phòng ngự, chiêu tấn công cộng thêm sát thương bằng {defHit}% Phòng ngự hiện tại của pet. Khi pet được tăng Phòng ngự, đồng đội cũng được DEF +{allyDef}% trong 3 lượt.",
    beforeAction(k, e) {
      if (isGuard(e.skill) || isHeal(e.skill)) k.e.guardRound = k.round;
    },
    incoming(k, e) {
      if (e.direct && k.e.guardRound === k.round) {
        k.proc("thủ thế");
        return k.p.guard;
      }
    },
    onHitDealt(k, e) {
      if (!e.skill?.attack || !hasDefenseUp(k.self)) return;
      if (k.damage(e.target, pct(k.self.currentStats.defense, k.p.defHit)) > 0)
        k.proc("gạc húc", e.target);
    },
    afterAction(k, e) {
      // Đằng chi bích lũy: đồng đội (1v1: chính pet) DEF +% 3 lượt.
      if (e.skill?.name !== "Đằng chi bích lũy") return;
      k.statUp(k.allyOrSelf, "defense", k.p.allyDef, 3, "gạc26");
      k.proc("đồng đội DEF", k.allyOrSelf);
    },
  },

  // 27 Trư Lộc Điệp
  27: {
    name: "Lộc giác phá tuyến",
    params: { defHit: 28, guard: 20, heal: 6, allyDef: 10, allyDmg: 8 },
    text: "Khi đang có tăng Phòng ngự, chiêu tấn công cộng thêm sát thương bằng {defHit}% Phòng ngự hiện tại của pet. Lượt pet dùng chiêu phòng thủ, pet nhận ít hơn {guard}% sát thương và hồi {heal}% HP tối đa. Khi pet được tăng Phòng ngự, đồng đội cũng được DEF +{allyDef}% trong 3 lượt, và đồng đội đang được tăng DEF nhờ pet còn được +{allyDmg}% sát thương.",
    beforeAction(k, e) {
      if (!isGuard(e.skill)) return;
      k.e.guardRound = k.round;
      if (k.heal(k.self, k.p.heal).healed > 0) k.proc("hồi 6%");
    },
    incoming(k, e) {
      if (e.direct && k.e.guardRound === k.round) {
        k.proc("thủ thế");
        return k.p.guard;
      }
    },
    onHitDealt(k, e) {
      if (!e.skill?.attack || !hasDefenseUp(k.self)) return;
      if (k.damage(e.target, pct(k.self.currentStats.defense, k.p.defHit)) > 0)
        k.proc("gạc húc", e.target);
    },
    afterAction(k, e) {
      if (e.skill?.name !== "Đằng chi bích lũy") return;
      const mate = k.allyOrSelf;
      k.statUp(mate, "defense", k.p.allyDef, 3, "lộc27");
      k.mark(mate, "lộc", 3);
      k.proc("đồng đội DEF", mate);
    },
    allyOutgoing(k, e) {
      if (k.marked(e.source, "lộc") > 0) {
        k.proc("đồng đội +8%", e.source);
        return k.p.allyDmg;
      }
    },
    outgoing(k, e) {
      // 1v1: phần "đồng đội" áp lên chính pet.
      if (!k.ally && k.marked(k.self, "lộc") > 0 && e.skill?.attack) {
        k.proc("đồng đội +8%", k.self);
        return k.p.allyDmg;
      }
    },
  },

  // 28 Cương Tán Ma Cô
  28: {
    name: "Ô thép đổi gác",
    params: { guard: 20, shield: 10, pivotShield: 20 },
    text: "Mỗi lượt, đòn trực tiếp đầu tiên đánh trúng pet bị ô thép đỡ {guard}% sát thương. Cứ mỗi 2 lần ô đỡ được đòn, pet nhận khiên {shield}% HP tối đa trong 2 lượt. Khi pet rời sân bằng Thiết Tán Hồi Chuyển · Chuyển, pet vào thay nhận khiên {pivotShield}% HP tối đa trong 2 lượt. Trong trận đôi, ô thép che cả đồng đội: đòn trực tiếp đầu tiên mỗi lượt nhắm vào bất kỳ pet nào phe mình đều bị đỡ {guard}%, khiên tích lũy trao cho pet vừa được che.",
    incoming(k, e) {
      return umbrella(k, k.self, e);
    },
    guardAlly(k, e) {
      return umbrella(k, e.target, {});
    },
    onHitTaken(k) {
      umbrellaShield(k, k.self, 1);
    },
    onAllyHitTaken(k, e) {
      umbrellaShield(k, e.target, 2);
    },
    afterAction(k, e) {
      if (e.skill?.name === "Thiết Tán Hồi Chuyển · Chuyển") k.v.pivot = k.round;
    },
    onLeave(k, e) {
      if (e.fainted || !e.next || k.v.pivot !== k.round) return;
      if (k.shield(e.next, k.p.pivotShield, 2)) k.proc("khiên đổi gác", e.next);
    },
  },

  // 29 Uy Qua Đệ Đệ
  29: {
    name: "Mộng sâu bí ngô",
    params: { doze: 20, sleepChance: 20, dream: 20 },
    text: "Chiêu tấn công của pet đánh trúng có {doze}% ru Ngủ mục tiêu 1 lượt (3 lượt 1 lần). Chiêu gây Ngủ của pet có thêm {sleepChance}% tỉ lệ. Mục tiêu bị pet ru Ngủ còn Mơ Màng 2 lượt sau khi tỉnh: gây ít hơn {dream}% sát thương. Đồng đội đánh mục tiêu đang Ngủ hoặc Mơ Màng do pet gây được +10% sát thương.",
    onHitDealt(k, e) {
      dreamCheck(k);
      if (!e.skill?.attack || !e.target.alive() || k.has(e.target, "sleep")) return;
      if (!k.ready("ru ngủ", 3) || !k.chance(k.p.doze, "ru ngủ")) return;
      if (!k.inflict(e.target, "sleep", 1)) return;
      k.use("ru ngủ");
      k.mark(e.target, "ngủ", 9);
      k.proc("ru ngủ", e.target);
    },
    afterAction(k, e) {
      if (e.target && e.newStatuses.includes("sleep") && k.marked(e.target, "ngủ") <= 0) {
        // Chiêu gây Ngủ của pet thành công.
        k.mark(e.target, "ngủ", 9);
        k.proc("ru ngủ", e.target);
      } else if (
        e.target &&
        e.hit &&
        e.skill &&
        SLEEP_SKILL.test(e.skill.name) &&
        !k.has(e.target, "sleep") &&
        k.chance(k.p.sleepChance, "ngủ") &&
        k.inflict(e.target, "sleep", 1)
      ) {
        k.mark(e.target, "ngủ", 9);
        k.proc("ru ngủ thêm tỉ lệ", e.target);
      }
      dreamCheck(k);
    },
    onOtherAction(k) {
      dreamCheck(k);
    },
    roundEnd(k) {
      dreamCheck(k, true);
    },
    incoming(k, e) {
      if (k.marked(e.source, "mơ") > 0) {
        k.proc("mơ màng", e.source);
        return k.p.dream;
      }
    },
    guardAlly(k, e) {
      if (k.marked(e.source, "mơ") > 0) {
        k.proc("mơ màng", e.source);
        return k.p.dream;
      }
    },
    allyOutgoing(k, e) {
      const asleep = k.has(e.target, "sleep") && k.marked(e.target, "ngủ") > 0;
      if (asleep || k.marked(e.target, "mơ") > 0) {
        k.proc("đồng đội +10%", e.source);
        return ALLY_DREAM_29;
      }
    },
  },

  // 30 Thảo Diệp Cô
  30: {
    name: "Tịnh diệp phản ương",
    params: { heal: 5 },
    text: "Khi bị đối thủ gây hiệu ứng xấu, cuối lượt pet tự xóa hiệu ứng đó và trả nó lại kẻ gây với thời hạn còn lại (2 lượt 1 lần). Cuối lượt, nếu pet không có hiệu ứng xấu nào, pet hồi {heal}% HP tối đa. Khi đồng đội bị gây hiệu ứng xấu, pet có thể dùng lượt phản thay cho đồng đội (dùng chung hồi chiêu).",
    onOtherAction(k, e) {
      if (e.isAlly || !e.target || e.newStatuses.length === 0) return;
      if (e.target !== k.self && !k.isAlly(e.target)) return;
      const list = pendingReturn.get(k.self) ?? [];
      for (const status of e.newStatuses) list.push({ victim: e.target, source: e.actor, status });
      pendingReturn.set(k.self, list);
    },
    roundEnd(k) {
      const list = pendingReturn.get(k.self) ?? [];
      pendingReturn.delete(k.self);
      const item = list.find((p) => p.victim.alive() && k.has(p.victim, p.status));
      if (item && k.ready("phản ương", 2)) {
        const slot = KIT_STATUS[item.status];
        const turns = item.victim.statuses.get(slot.bank, slot.id)?.remainingTurns ?? 1;
        if (k.remove(item.victim, item.status)) {
          k.use("phản ương");
          k.proc(item.victim === k.self ? "phản ương" : "phản ương thay", item.victim);
          if (k.inflict(item.source, item.status, Math.max(1, turns)))
            k.proc("trả ương", item.source);
        }
      }
      if (k.debuffs(k.self) === 0 && k.heal(k.self, k.p.heal).healed > 0) k.proc("tịnh diệp");
    },
  },

  // 31 Linh Quang Lộc
  31: {
    name: "Linh quang chiếu phúc",
    params: { cap: 35, blessing: 30 },
    text: "Lượng hồi máu vượt HP tối đa từ chiêu của pet chuyển thành khiên chắn (tối đa {cap}% HP tối đa, 2 lượt). Lượt pet dùng chiêu hồi máu, chiêu tấn công kế tiếp của mục tiêu được hồi gây thêm {blessing}% sát thương.",
    healOut(k, e) {
      const overflow = e.amount - missing(e.target);
      if (
        overflow > 0 &&
        k.shieldAmount(e.target, Math.min(overflow, k.pctOf(e.target, k.p.cap)), 2)
      )
        k.proc("khiên tràn", e.target);
      k.mark(e.target, "phúc", 3);
      k.proc("chúc phúc", e.target);
      return 0;
    },
    outgoing(k, e) {
      if (e.skill?.attack && k.marked(k.self, "phúc") > 0) {
        k.unmark(k.self, "phúc");
        k.proc("phúc +30%", k.self);
        return k.p.blessing;
      }
    },
    allyOutgoing(k, e) {
      if (e.skill?.attack && k.marked(e.source, "phúc") > 0) {
        k.unmark(e.source, "phúc");
        k.proc("phúc +30%", e.source);
        return k.p.blessing;
      }
    },
  },

  // 32 Kim Chỉ Ốc
  32: {
    name: "Vỏ xoắn chặn đòn nặng",
    params: { block: 25, def: 7 },
    text: "Mỗi lượt, đòn trực tiếp đầu tiên làm pet mất từ 15% HP tối đa trở lên bị giảm {block}% sát thương. Mỗi lần chặn, pet nhận 1 tầng Phòng ngự +{def}% trong 2 lượt (tối đa 3).",
    incoming(k, e) {
      if (!e.direct || e.damage < k.pctOf(k.self, 15) || !k.oncePerRound("vỏ")) return;
      // Tầng giữ 2 lượt kể từ lần chặn mới nhất (tối đa 3 tầng).
      const live = k.round <= (k.e.shellUntil ?? -1);
      k.e.shell = Math.min(3, (live ? (k.e.shell ?? 0) : 0) + 1);
      k.e.shellUntil = k.round + 1;
      k.refresh();
      k.proc("vỏ chặn", e.source);
      return k.p.block;
    },
    statBonus(k, stat) {
      if (stat !== "defense" || k.round > (k.e.shellUntil ?? -1)) return;
      return k.p.def * (k.e.shell ?? 0);
    },
  },

  // 33 Mèo YeDoon
  33: {
    name: "Mèo vờn hoán nhịp",
    params: { daze: 25, bonus: 20, ally: 10 },
    text: "Chiêu tấn công của pet đánh trúng có {daze}% gây Mê Muội 2 lượt (3 lượt 1 lần). Khi mục tiêu đang Mê Muội, pet luôn được ưu tiên ra đòn trước nó và chiêu tấn công gây thêm {bonus}% sát thương. Đồng đội đánh mục tiêu đang Mê Muội do pet gây cũng gây thêm {ally}% sát thương.",
    onHitDealt(k, e) {
      if (!e.skill?.attack || !e.target.alive() || k.has(e.target, "daze")) return;
      if (!k.ready("mê", 3) || !k.chance(k.p.daze, "mê")) return;
      if (!k.inflict(e.target, "daze", 2)) return;
      k.use("mê");
      k.mark(e.target, "mê", 3);
      k.proc("mê muội", e.target);
    },
    afterAction(k, e) {
      // Chiêu gây Mê Muội của chính pet cũng tính là "do pet gây".
      if (e.target && e.newStatuses.includes("daze")) k.mark(e.target, "mê", 3);
    },
    allyOutgoing(k, e) {
      // 2v2: đồng đội đánh mục tiêu đang Mê Muội do pet gây.
      if (!e.skill?.attack || !k.has(e.target, "daze") || k.marked(e.target, "mê") <= 0) return;
      k.proc("đồng đội vờn", e.target);
      return k.p.ally;
    },
    priority(k, e) {
      if (k.has(e.opponent, "daze")) {
        if (k.oncePerRound("ưu tiên")) k.proc("ưu tiên", e.opponent);
        return true;
      }
    },
    outgoing(k, e) {
      if (k.has(e.target, "daze") && e.skill?.attack) {
        k.proc("vờn", e.target);
        return k.p.bonus;
      }
    },
  },

  // 34 Thỏ Di Lặc Bunny
  34: {
    name: "Thiên luân hai tư thế",
    params: { calm: 18, fury: 25, speed: 20, heal: 10, allySpeed: 10 },
    text: "HP trên 50%: Tĩnh tư thế, nhận ít hơn {calm}% sát thương. HP từ 50% trở xuống: Động tư thế, chiêu tấn công +{fury}% sát thương và Linh xảo +{speed}%. Lần đầu chuyển sang Động mỗi lần ra sân, pet hồi {heal}% HP tối đa. Khi pet chuyển sang Động, đồng đội cũng được Linh xảo +{allySpeed}% trong 2 lượt.",
    incoming(k, e) {
      if (e.direct && k.hpPct() > 50) {
        k.proc("tĩnh");
        return k.p.calm;
      }
    },
    outgoing(k, e) {
      if (k.hpPct() <= 50 && e.skill?.attack) {
        k.proc("động", e.target);
        return k.p.fury;
      }
    },
    statBonus(k, stat) {
      if (stat === "speed" && k.hpPct() <= 50) return k.p.speed;
    },
    onDamaged(k) {
      k.refresh();
      if (k.e.moved || k.hpPct() > 50) return;
      k.e.moved = 1;
      k.heal(k.self, k.p.heal);
      k.proc("chuyển động");
      // Đồng đội (1v1: chính pet) Linh xảo +% 2 lượt.
      k.statUp(k.allyOrSelf, "speed", k.p.allySpeed, 2, "thỏ34");
      k.proc("đồng đội tốc", k.allyOrSelf);
    },
  },

  // 35 Toản Địa Khâu Dẫn
  35: {
    name: "Khoan nứt địa tầng",
    params: { shred: 8 },
    text: "Mỗi lần đánh trúng, mục tiêu bị giảm {shred}% Phòng ngự trong 2 lượt (tối đa 2 tầng, mỗi lượt 1 tầng). Đánh mục tiêu nhanh hơn pet thì cộng 2 tầng một lần. Đồng đội đánh mục tiêu đang bị giảm Phòng ngự cũng được hưởng.",
    onHitDealt(k, e) {
      if (e.skill?.attack) drill(k, e.target, 2);
    },
  },

  // 36 Toái nham Khâu Dẫn
  36: {
    name: "Toái nham phá giáp",
    params: { shred: 10 },
    text: "Mỗi lần đánh trúng, mục tiêu bị giảm {shred}% Phòng ngự 2 lượt (tối đa 3 tầng; đánh mục tiêu nhanh hơn thì cộng 2 tầng). Đánh trúng mục tiêu đã đủ 3 tầng thì gỡ thêm 1 hiệu ứng tăng chỉ số của nó. Tầng giảm Phòng ngự dùng chung cho đồng đội.",
    onHitDealt(k, e) {
      if (!e.skill?.attack) return;
      const before = drill(k, e.target, 3);
      if (before >= 3 && k.dispel(e.target, 1) > 0) k.proc("gỡ buff", e.target);
    },
  },

  // 37 Nham Nham Quy
  37: {
    name: "Mai nham rụt cổ",
    params: { shield: 9, def: 8 },
    text: "Sau khi bị đánh mất HP, pet nhận khiên chắn bằng {shield}% HP tối đa trong 2 lượt (3 lượt 1 lần, tối đa 3 lần mỗi trận). Khi đang có khiên này, Phòng ngự +{def}%.",
    onDamaged(k, e) {
      if (!e.direct || !k.isFoe(e.source) || !k.ready("mai", 3) || (k.v.mai ?? 0) >= 3) return;
      if (!k.shield(k.self, k.p.shield, 2)) return;
      k.use("mai");
      k.v.mai = (k.v.mai ?? 0) + 1;
      k.e.shellUntil = k.round + 1;
      k.refresh();
      k.proc("rụt cổ");
    },
    statBonus(k, stat) {
      if (stat === "defense" && k.round <= (k.e.shellUntil ?? 0) && k.shieldHp() > 0)
        return k.p.def;
    },
  },

  // 38 Kiếm Giáp Hạn Quy
  38: {
    name: "Kiếm giáp phản chấn",
    params: { shield: 11, burst: 75, cap: 11 },
    text: "Sau khi bị đánh mất HP mà còn dưới 50% HP, pet nhận khiên chắn bằng {shield}% HP tối đa trong 2 lượt (3 lượt 1 lần, tối đa 2 lần mỗi trận). Khi khiên này bị đánh vỡ, kẻ phá khiên mất HP bằng {burst}% lượng khiên đã chặn (tối đa {cap}% HP tối đa của pet, mỗi trận 1 lần).",
    onDamaged(k, e) {
      if (!e.direct || !k.isFoe(e.source) || !k.ready("kiếm giáp", 3) || (k.v.giap ?? 0) >= 2)
        return;
      if (k.hpPct() >= 50) return;
      const amount = k.pctOf(k.self, k.p.shield);
      if (!k.shieldAmount(k.self, amount, 2)) return;
      k.use("kiếm giáp");
      k.v.giap = (k.v.giap ?? 0) + 1;
      k.e.bladeUntil = k.round + 1;
      k.e.blade = amount;
      k.proc("kiếm giáp");
    },
    onHitTaken(k, e) {
      // Khiên bị đánh vỡ: kẻ phá khiên mất HP theo lượng khiên đã chặn.
      if (!k.e.blade || k.round > (k.e.bladeUntil ?? 0) || k.shieldHp() > 0) return;
      if (k.v.burst) return;
      const amount = Math.min(pct(k.e.blade, k.p.burst), k.pctOf(k.self, k.p.cap));
      k.e.blade = 0;
      k.v.burst = 1;
      k.proc("khiên nổ", e.source);
      return amount;
    },
  },

  // 39 Bạch Châm Bảo Bảo
  39: {
    name: "Kim dự phòng",
    params: { needle: 3 },
    text: "Mỗi lượt bị đánh trúng, pet nhận 1 Kim (tối đa 3). Chiêu tấn công kế tiếp bắn hết Kim: mỗi Kim gây thêm sát thương bằng {needle}% HP tối đa của mục tiêu. Kim cũng tích khi đồng đội bị đánh trúng (vẫn mỗi lượt 1 Kim).",
    onHitTaken(k, e) {
      if (k.oncePerRound("kim")) {
        k.stack("kim", 1, 3);
        k.proc("kim", e.source);
      }
    },
    onAllyHitTaken(k, e) {
      if (k.oncePerRound("kim")) {
        k.stack("kim", 1, 3);
        k.proc("kim đồng đội", e.target);
      }
    },
    onHitDealt(k, e) {
      const needles = k.v.kim ?? 0;
      if (needles <= 0 || !e.skill?.attack) return;
      k.v.kim = 0;
      if (k.damage(e.target, k.pctOf(e.target, k.p.needle * needles)) > 0)
        k.proc("bắn kim", e.target);
    },
  },
};
