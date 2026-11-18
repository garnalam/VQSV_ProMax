import type { PackSkillRow } from "../../../data/GameData";
import {
  BUFF_BANK,
  DEBUFF_BANK,
  RAINBOW_BANK,
  StatusInstance,
  type MutableStat,
  type StatusDefinition,
} from "../StatusState";
import type { DesignTraitUnit } from "../DesignTraits";

/**
 * Bộ kit đặc tính (owner 2026-11-17): mỗi loài có một kịch bản riêng (`TraitScript`), viết bằng các
 * hook dưới đây. Kit được móc vào `DesignTraitProjection` — nơi cả trận 1v1 (`BattleCore`) lẫn 2v2
 * (`DoubleBattleCore`) đi qua — nên một kịch bản chạy giống nhau ở cả hai thể thức. Trong 1v1,
 * `k.ally` là undefined; phần dành cho đồng đội dùng `k.allyOrSelf` hoặc hiệu ứng thay thế.
 */

/** Trạng thái xấu kit gây được, theo tên dễ đọc. */
export type KitStatus =
  | "seed" // Gieo Hạt
  | "daze" // Mê Muội
  | "entangle" // Quấn Quanh
  | "accuracy_down" // giảm chính xác
  | "agility_down" // giảm Linh xảo (Chậm Chạp)
  | "damage_down" // Nhụt Chí: gây ít sát thương hơn
  | "defense_down" // giảm Phòng ngự
  | "ghost" // Quỷ Mị
  | "confusion" // Hỗn Loạn
  | "paralysis" // Tê Liệt
  | "petrify" // Hóa Đá
  | "charm" // Mị Hoặc
  | "bind" // Giam Cầm
  | "corrosion" // Hủ Thực
  | "bleed" // Xé Rách
  | "sleep"; // Ngủ

type StatusSlot = { bank: number; id: number; value: number; sourceSkill: number };

/** bank/id, độ lớn mặc định (giống chiêu gốc gây ra nó) và chiêu nguồn cho vòng đời thường. */
export const KIT_STATUS: Record<KitStatus, StatusSlot> = {
  seed: { bank: DEBUFF_BANK, id: 0, value: 3, sourceSkill: 1 },
  daze: { bank: DEBUFF_BANK, id: 1, value: 20, sourceSkill: 2 },
  entangle: { bank: DEBUFF_BANK, id: 2, value: 10, sourceSkill: 12 },
  accuracy_down: { bank: DEBUFF_BANK, id: 4, value: 15, sourceSkill: 31 },
  agility_down: { bank: DEBUFF_BANK, id: 5, value: 15, sourceSkill: 32 },
  damage_down: { bank: DEBUFF_BANK, id: 6, value: 15, sourceSkill: 33 },
  defense_down: { bank: DEBUFF_BANK, id: 7, value: 12, sourceSkill: 51 },
  ghost: { bank: DEBUFF_BANK, id: 8, value: 40, sourceSkill: 54 },
  confusion: { bank: DEBUFF_BANK, id: 9, value: 50, sourceSkill: 55 },
  paralysis: { bank: DEBUFF_BANK, id: 10, value: 20, sourceSkill: 41 },
  petrify: { bank: RAINBOW_BANK, id: 0, value: 0, sourceSkill: 0 },
  charm: { bank: RAINBOW_BANK, id: 3, value: 0, sourceSkill: 0 },
  bind: { bank: RAINBOW_BANK, id: 4, value: 15, sourceSkill: 0 },
  corrosion: { bank: RAINBOW_BANK, id: 5, value: 0, sourceSkill: 0 },
  bleed: { bank: RAINBOW_BANK, id: 7, value: 4, sourceSkill: 0 },
  sleep: { bank: RAINBOW_BANK, id: 8, value: 0, sourceSkill: 0 },
};

/** Các trạng thái khống chế (mất lượt hoặc bị trói). */
export const CONTROL_STATUSES: readonly KitStatus[] = [
  "sleep",
  "petrify",
  "ghost",
  "confusion",
  "bind",
  "daze",
  "paralysis",
  "entangle",
];

const IMMUNITY_BUFF_ID = 14;
const SHIELD_ID = 15;
/** Tỉ lệ cộng/giảm tối đa của mọi kịch bản gộp lại trên một đòn. */
const MAX_REDUCTION = 80;
const MAX_BONUS = 200;

export function kitStatusOf(definition: StatusDefinition): KitStatus | undefined {
  for (const [name, slot] of Object.entries(KIT_STATUS))
    if (slot.bank === definition.sourceBank && slot.id === definition.sourceNumericId)
      return name as KitStatus;
  return undefined;
}

export type KitSkill = {
  id: number;
  name: string;
  element: number;
  power: number;
  /** Có Power > 0: chiêu tấn công. */
  attack: boolean;
  /** Power = 0: chiêu hỗ trợ/hồi máu/buff/debuff. */
  support: boolean;
  /** Chiêu nhắm phe mình (chính pet hoặc đồng đội). */
  ownSide: boolean;
  /** Cùng hệ với loài của pet đang dùng. */
  sameElement: boolean;
};

export type KitHit = {
  source: DesignTraitUnit;
  target: DesignTraitUnit;
  skill: KitSkill | undefined;
  damage: number;
};

export type KitAction = {
  target: DesignTraitUnit | undefined;
  skill: KitSkill | undefined;
  hit: boolean;
  damaging: boolean;
  /** Máu thực mất của mục tiêu (sau khiên). */
  damage: number;
  actedFirst: boolean;
  /** Trạng thái xấu mới xuất hiện trên mục tiêu sau hành động. */
  newStatuses: KitStatus[];
  /** Số debuff trên mục tiêu/chính pet giảm đi (giải trừ thành công). */
  cleansed: number;
  /** Số buff của mục tiêu bị gỡ. */
  dispelled: number;
};

/** Một kịch bản đặc tính. Mọi hook đều tùy chọn; `k.self` là pet mang đặc tính. */
export type TraitScript = {
  /** Tên đặc tính (khớp bản phác thảo). */
  name: string;
  /**
   * Các con số chỉnh được (cân bằng): % sát thương, % hồi máu, % khiên, % tỉ lệ… Kịch bản đọc qua
   * `k.p.<tên>`; bảng cân bằng (`tuning.json`) có thể ghi đè từng số theo loài.
   */
  params?: Record<string, number>;
  /** Mô tả trong game, số chỉnh được viết dạng `{tên}` (ví dụ "hút {lifesteal}% sát thương"). */
  text?: string;
  /** Phần 2v2 của mô tả (bỏ trống khi giống 1v1), cùng cú pháp `{tên}`. */
  text2v2?: string;
  /** Khi ra sân (đầu trận hoặc đổi vào). */
  onEnter?(k: Kit): void;
  /** Khi rời sân (đổi ra). */
  onLeave?(k: Kit, e: { next?: DesignTraitUnit; fainted: boolean }): void;
  /**
   * 2v2 (hút đòn/khiêu khích): một đối thủ sắp đánh đơn mục tiêu vào `target` (đồng đội của pet).
   * Trả true để đòn chuyển sang chính pet.
   */
  redirect?(
    k: Kit,
    e: { attacker: DesignTraitUnit; target: DesignTraitUnit; skill?: KitSkill },
  ): boolean | void;
  /** Mở hành động của chính pet, trước khi tính sát thương. */
  beforeAction?(
    k: Kit,
    e: { target?: DesignTraitUnit; skill?: KitSkill; actedFirst: boolean },
  ): void;
  /** Pet tấn công trực tiếp: trả về % sát thương cộng thêm (âm là giảm). */
  outgoing?(k: Kit, e: KitHit & { actedFirst: boolean }): number | void;
  /** Đồng đội của pet tấn công trực tiếp: % cộng thêm cho đòn của đồng đội. */
  allyOutgoing?(k: Kit, e: KitHit): number | void;
  /** Pet nhận đòn trực tiếp (hoặc gián tiếp nếu `direct` false): % sát thương giảm. */
  incoming?(k: Kit, e: KitHit & { direct: boolean }): number | void;
  /** Đồng đội nhận đòn trực tiếp: % giảm cho đồng đội (chỉ có ở 2v2). */
  guardAlly?(k: Kit, e: KitHit): number | void;
  /** % Phòng ngự của mục tiêu bị bỏ qua. */
  pierce?(k: Kit, e: { target: DesignTraitUnit; skill?: KitSkill }): number | void;
  /** Pet vừa đánh trúng trực tiếp (đã trừ máu). */
  onHitDealt?(k: Kit, e: KitHit): void;
  /** Pet vừa bị đánh trúng trực tiếp. Trả số > 0 để phản sát thương đó về kẻ đánh. */
  onHitTaken?(k: Kit, e: KitHit): number | void;
  /** Đồng đội vừa bị đánh trúng trực tiếp. */
  onAllyHitTaken?(k: Kit, e: KitHit): void;
  /** Đồng đội vừa đánh trúng trực tiếp. */
  onAllyHitDealt?(k: Kit, e: KitHit): void;
  /** Pet mất máu vì bất kỳ nguồn nào (đòn, phản, độc). */
  onDamaged?(
    k: Kit,
    e: { before: number; after: number; source?: DesignTraitUnit; direct: boolean },
  ): void;
  /** Kết thúc một hành động của chính pet. */
  afterAction?(k: Kit, e: KitAction): void;
  /** Một pet khác (đồng đội hoặc đối thủ) vừa hành động xong. */
  onOtherAction?(k: Kit, e: KitAction & { actor: DesignTraitUnit; isAlly: boolean }): void;
  /** Đồng đội gục. */
  onAllyFaint?(k: Kit, e: { ally: DesignTraitUnit }): void;
  /** Một đối thủ gục; `byMe` khi pet là kẻ ra đòn cuối. */
  onFoeFaint?(k: Kit, e: { foe: DesignTraitUnit; byMe: boolean }): void;
  /** Cuối mỗi lượt (vòng), khi pet còn trên sân. */
  roundEnd?(k: Kit): void;
  /** Một hiệu ứng sát thương theo lượt do pet gây vừa trừ máu mục tiêu. */
  onDotTick?(k: Kit, e: { target: DesignTraitUnit; status: KitStatus; damage: number }): void;
  /** Pet được ra đòn trước đối thủ này trong lượt (ưu tiên). */
  priority?(k: Kit, e: { opponent: DesignTraitUnit; skill?: KitSkill }): boolean | void;
  /** % chỉ số gốc cộng thêm (âm là giảm), đọc liên tục. */
  statBonus?(k: Kit, stat: MutableStat): number | void;
  /** Pet dùng chiêu hồi máu lên `target`: trả lượng hồi cộng thêm. */
  healOut?(k: Kit, e: { target: DesignTraitUnit; amount: number }): number | void;
  /** Pet nhận hồi máu: trả lượng hồi mới (mặc định giữ nguyên). */
  healIn?(k: Kit, e: { source?: DesignTraitUnit; amount: number }): number | void;
  /** Có nhận trạng thái này không (false = chặn). Dùng `k.chance` cho kháng theo tỉ lệ. */
  admits?(k: Kit, e: { status: KitStatus }): boolean | void;
};

/** Một lần đặc tính kích hoạt, cho test và nhật ký trận. */
export type KitProc = {
  speciesId: number;
  side: number;
  label: string;
  round: number;
  /** Pet bị/được tác động (nếu có). */
  targetSpecies?: number;
  targetSide?: number;
};

type StatMod = { stat: MutableStat; percent: number; until: number; key: string };
type Mark = { key: string; owner: DesignTraitUnit; until: number; stacks: number };

/** Trạng thái kit gắn trên từng pet, sống suốt trận. */
export class KitUnitState {
  runtime: TraitKitRuntime | undefined;
  /** Biến của kịch bản, giữ suốt trận. */
  readonly v: Record<string, number> = {};
  /** Biến của kịch bản, xóa mỗi lần ra sân. */
  e: Record<string, number> = {};
  readonly mods: StatMod[] = [];
  readonly marks: Mark[] = [];
  enteredRound = 1;
  /** Vòng gần nhất pet mất máu; -100 khi chưa từng. */
  lossRound = -100;
  lossThisRound = 0;
  allyLossThisRound = 0;
  lossRoundKey = -1;
  /** Đòn trực tiếp thứ mấy pet nhận trong vòng hiện tại. */
  hitsTakenThisRound = 0;
  actionsThisRound = 0;
  lastSkill = -1;
  lastSkillRound = -100;
}

export type KitUnitHost = DesignTraitUnit & { kit?: KitUnitState };

export function kitState(unit: DesignTraitUnit): KitUnitState {
  const host = unit as KitUnitHost;
  if (!host.kit) host.kit = new KitUnitState();
  return host.kit;
}

/** Những gì kit cần từ projection của trận. */
export type KitHost = {
  units(): DesignTraitUnit[];
  draw(label: string): number;
  skill(id: number): PackSkillRow | undefined;
  elementOf(speciesId: number): number;
  definition(bank: number, id: number): StatusDefinition;
  /** Lượng hồi sau các tầng chỉnh hồi máu của trận (thiên phú…). */
  healProjection(source: DesignTraitUnit, target: DesignTraitUnit, amount: number): number;
  /** Gây sát thương gián tiếp đi qua projection (khiên, giảm sát thương, ngưỡng HP). */
  damage(
    source: DesignTraitUnit,
    target: DesignTraitUnit,
    amount: number,
    pierceShield?: boolean,
  ): number;
  /** Ghi chủ của hiệu ứng sát thương theo lượt. */
  ownDot(source: DesignTraitUnit, target: DesignTraitUnit, bank: number, id: number): void;
  twoVsTwo: boolean;
};

/**
 * `k` trong mọi hook: pet mang đặc tính, các pet trên sân và bộ hành động. Mọi số % là % của HP tối
 * đa hoặc chỉ số gốc của pet được nói tới, trừ khi tên hàm nói khác.
 */
export class Kit {
  constructor(
    readonly runtime: TraitKitRuntime,
    readonly self: DesignTraitUnit,
  ) {}

  get round(): number {
    return this.runtime.round;
  }
  get twoVsTwo(): boolean {
    return this.runtime.host.twoVsTwo;
  }
  /** Biến giữ suốt trận. */
  get v(): Record<string, number> {
    return kitState(this.self).v;
  }
  /** Biến xóa mỗi lần ra sân. */
  get e(): Record<string, number> {
    return kitState(this.self).e;
  }
  /** Tham số của kịch bản sau bảng cân bằng. */
  get p(): Record<string, number> {
    return this.runtime.paramsOf(this.self);
  }
  get state(): KitUnitState {
    return kitState(this.self);
  }

  /** Đồng đội còn sống trên sân (2v2), hoặc undefined. */
  get ally(): DesignTraitUnit | undefined {
    return this.runtime.allyOf(this.self);
  }
  /** Đồng đội nếu có, không thì chính pet (luật 1v1 của bản phác thảo). */
  get allyOrSelf(): DesignTraitUnit {
    return this.ally ?? this.self;
  }
  /** Phe mình còn sống trên sân (pet + đồng đội). */
  get team(): DesignTraitUnit[] {
    return this.runtime.units().filter((u) => u.alive() && u.ownerSide === this.self.ownerSide);
  }
  /** Các đối thủ còn sống trên sân. */
  get foes(): DesignTraitUnit[] {
    return this.runtime.foesOf(this.self);
  }
  /** Đối thủ đầu tiên còn sống (1v1: đối thủ duy nhất). */
  get foe(): DesignTraitUnit | undefined {
    return this.foes[0];
  }
  /** Đối thủ còn lại ngoài `unit` (2v2), hoặc undefined. */
  otherFoe(unit: DesignTraitUnit | undefined): DesignTraitUnit | undefined {
    return this.foes.find((f) => f !== unit);
  }
  isAlly(unit: DesignTraitUnit | undefined): boolean {
    return !!unit && unit !== this.self && unit.ownerSide === this.self.ownerSide;
  }
  isFoe(unit: DesignTraitUnit | undefined): boolean {
    return !!unit && unit.ownerSide !== this.self.ownerSide;
  }

  // ---------------------------------------------------------------- đọc trạng thái

  hpPct(unit: DesignTraitUnit = this.self): number {
    return (unit.hp() * 100) / Math.max(1, unit.maxHp());
  }
  pctOf(unit: DesignTraitUnit, percent: number): number {
    return Math.trunc((unit.maxHp() * Math.max(0, percent)) / 100);
  }
  has(unit: DesignTraitUnit | undefined, status: KitStatus): boolean {
    if (!unit) return false;
    const slot = KIT_STATUS[status];
    return unit.statuses.has(slot.bank, slot.id);
  }
  /** Mục tiêu đang bị khống chế (Ngủ, Hóa Đá, Quỷ Mị, Hỗn Loạn, Giam Cầm, Mê Muội, Tê Liệt, Quấn Quanh). */
  controlled(unit: DesignTraitUnit | undefined): boolean {
    return CONTROL_STATUSES.some((s) => this.has(unit, s));
  }
  debuffs(unit: DesignTraitUnit | undefined): number {
    return unit ? unit.activeDebuffCount() : 0;
  }
  buffs(unit: DesignTraitUnit | undefined): number {
    return unit ? unit.activeBuffCount() : 0;
  }
  /** Số tầng Phòng ngự (buff 4) đang có. */
  defenseTiers(unit: DesignTraitUnit = this.self): number {
    return unit.statuses.get(BUFF_BANK, 4)?.stackCount ?? 0;
  }
  shieldHp(unit: DesignTraitUnit = this.self): number {
    return unit.shieldHp();
  }
  /** Linh xảo hiện tại của pet cao hơn `other`. */
  faster(other: DesignTraitUnit | undefined, unit: DesignTraitUnit = this.self): boolean {
    return !!other && unit.currentStats.speed > other.currentStats.speed;
  }
  skill(id: number): KitSkill | undefined {
    return this.runtime.skillOf(this.self, id);
  }
  /** Hệ của loài pet (0 Hỏa, 1 Mộc, 2 Thổ, 3 Thủy, 4 Điện, 5 Quỷ, 6 Phong). */
  elementOf(unit: DesignTraitUnit = this.self): number {
    return this.runtime.host.elementOf(unit.speciesId);
  }
  /** Số vòng pet đã ở trên sân lần này (vòng ra sân = 0). */
  get roundsOnField(): number {
    return this.round - this.state.enteredRound;
  }
  /** Pet có mất máu trong vòng trước không. */
  get lostHpLastRound(): boolean {
    return this.state.lossRound === this.round - 1;
  }
  /** Máu pet đã mất trong vòng hiện tại. */
  get hpLostThisRound(): number {
    return this.state.lossRoundKey === this.round ? this.state.lossThisRound : 0;
  }
  /** Máu đồng đội đã mất trong vòng hiện tại. */
  get allyHpLostThisRound(): number {
    return this.state.lossRoundKey === this.round ? this.state.allyLossThisRound : 0;
  }
  /** Số đòn trực tiếp pet đã nhận trong vòng hiện tại. */
  get hitsTakenThisRound(): number {
    return this.state.lossRoundKey === this.round ? this.state.hitsTakenThisRound : 0;
  }
  /** Chiêu pet dùng ở hành động trước (-1 nếu chưa có). */
  get lastSkill(): number {
    return this.state.lastSkill;
  }

  // ---------------------------------------------------------------- nhịp và ngẫu nhiên

  /** Tỉ lệ `percent`% (0..100), rút từ dòng ngẫu nhiên của trận. */
  chance(percent: number, label = "chance"): boolean {
    if (percent >= 100) return true;
    if (percent <= 0) return false;
    const roll = this.runtime.host.draw(`kit.${this.self.speciesId}.${label}`);
    return roll >= 0 && roll < percent;
  }
  /** Hồi chiêu: đúng khi đã qua ít nhất `interval` vòng kể từ lần `use(key)` trước. */
  ready(key: string, interval: number): boolean {
    const last = this.v[`cd:${key}`];
    return last === undefined || this.round - last >= interval;
  }
  use(key: string): void {
    this.v[`cd:${key}`] = this.round;
  }
  /** `ready` rồi `use` trong một lần gọi. */
  tryUse(key: string, interval: number): boolean {
    if (!this.ready(key, interval)) return false;
    this.use(key);
    return true;
  }
  /** Mỗi vòng một lần cho `key`. */
  oncePerRound(key: string): boolean {
    return this.tryUse(`r:${key}`, 1);
  }
  /** Cộng dồn biến suốt trận, giới hạn [0, cap]. Trả giá trị mới. */
  stack(key: string, delta: number, cap: number, perEntry = false): number {
    const bag = perEntry ? this.e : this.v;
    const next = Math.max(0, Math.min(cap, (bag[key] ?? 0) + delta));
    bag[key] = next;
    this.refresh();
    return next;
  }

  // ---------------------------------------------------------------- tác động

  /** Ghi một lần kích hoạt (test, nhật ký). */
  proc(label: string, target?: DesignTraitUnit): void {
    this.runtime.log.push({
      speciesId: this.self.speciesId,
      side: this.self.ownerSide,
      label,
      round: this.round,
      targetSpecies: target?.speciesId,
      targetSide: target?.ownerSide,
    });
  }

  /** Hồi `percent`% HP tối đa của `target`. Trả {healed, overflow}. */
  heal(target: DesignTraitUnit | undefined, percent: number): { healed: number; overflow: number } {
    return target
      ? this.healAmount(target, this.pctOf(target, percent))
      : { healed: 0, overflow: 0 };
  }
  /** Hồi một lượng tuyệt đối; phần dư khi đầy máu trả về ở `overflow`. */
  healAmount(target: DesignTraitUnit, amount: number): { healed: number; overflow: number } {
    if (!target.alive() || amount <= 0) return { healed: 0, overflow: 0 };
    let projected = this.runtime.host.healProjection(this.self, target, Math.trunc(amount));
    projected = this.runtime.healIn(target, this.self, projected);
    const before = target.hp();
    target.heal(projected);
    const healed = Math.max(0, target.hp() - before);
    if (healed > 0) target.restoreStatsForCheck();
    return { healed, overflow: Math.max(0, projected - healed) };
  }
  /** Khiên `percent`% HP tối đa của `target` trong `turns` vòng (khiên lớn hơn thay khiên nhỏ). */
  shield(target: DesignTraitUnit | undefined, percent: number, turns = 2): boolean {
    return target ? this.shieldAmount(target, this.pctOf(target, percent), turns) : false;
  }
  shieldAmount(target: DesignTraitUnit, amount: number, turns = 2): boolean {
    if (!target.alive() || amount <= 0) return false;
    const old = target.statuses.get(BUFF_BANK, SHIELD_ID);
    if (old && old.primaryValue >= amount) {
      old.remainingTurns = Math.max(old.remainingTurns, turns);
      return false;
    }
    this.runtime.put(
      target,
      BUFF_BANK,
      SHIELD_ID,
      turns,
      amount,
      this.self,
      3000 + this.self.speciesId,
    );
    return true;
  }
  /** Sát thương gián tiếp `amount` lên `target` (qua khiên và các tầng giảm của trận). Trả máu thực mất. */
  damage(
    target: DesignTraitUnit | undefined,
    amount: number,
    options: { pierceShield?: boolean } = {},
  ): number {
    if (!target || !target.alive() || amount <= 0) return 0;
    return this.runtime.host.damage(this.self, target, Math.trunc(amount), options.pierceShield);
  }
  /** Sát thương bằng `percent`% HP tối đa của chính pet. */
  damagePctOfSelf(target: DesignTraitUnit | undefined, percent: number): number {
    return this.damage(target, this.pctOf(this.self, percent));
  }
  /** Trả máu của chính pet (không tự gục: còn ít nhất 1). */
  payHp(percent: number): number {
    const before = this.self.hp();
    this.self.setHp(Math.max(1, before - this.pctOf(this.self, percent)));
    return before - this.self.hp();
  }
  /**
   * Gây trạng thái xấu. `turns` là số vòng; `value` mặc định như chiêu gốc. Bị chặn khi mục tiêu miễn
   * nhiễm, đã có bản mạnh hơn, hoặc trượt tỉ lệ kháng của đồ cầm. Trả true khi gây được.
   */
  inflict(
    target: DesignTraitUnit | undefined,
    status: KitStatus,
    turns: number,
    options: { value?: number; refresh?: boolean } = {},
  ): boolean {
    if (!target || !target.alive() || target.ownerSide === this.self.ownerSide) return false;
    if (target.hasBuff(IMMUNITY_BUFF_ID)) return false;
    const slot = KIT_STATUS[status];
    const value = options.value ?? slot.value;
    const old = target.statuses.get(slot.bank, slot.id);
    if (old && (options.refresh === false || old.primaryValue > value)) return false;
    const definition = this.runtime.host.definition(slot.bank, slot.id);
    if (target.statuses.admit && !target.statuses.admit(definition)) return false;
    const chance = Math.max(0, Math.min(100, target.projectIncomingStatusChance(100)));
    if (chance < 100 && !this.chance(chance, `resist.${status}`)) return false;
    const duration = Math.max(1, target.incomingDebuffTurns(Math.max(1, turns)));
    this.runtime.put(target, slot.bank, slot.id, duration, value, this.self, slot.sourceSkill);
    if (status === "seed" || status === "corrosion" || status === "bleed")
      this.runtime.host.ownDot(this.self, target, slot.bank, slot.id);
    return true;
  }
  /** Gỡ trạng thái `status` khỏi `unit`. */
  remove(unit: DesignTraitUnit, status: KitStatus): boolean {
    const slot = KIT_STATUS[status];
    const removed = unit.statuses.remove(slot.bank, slot.id);
    if (removed) unit.restoreSourceStatusState();
    return removed;
  }
  /** Xóa tối đa `count` hiệu ứng xấu khỏi `unit`. Trả số đã xóa. */
  cleanse(unit: DesignTraitUnit | undefined, count = 1): number {
    if (!unit) return 0;
    let removed = 0;
    for (const bank of [DEBUFF_BANK, RAINBOW_BANK])
      for (const id of unit.activeStatusIds(bank)) {
        if (removed >= count) break;
        if (unit.statuses.remove(bank, id)) removed++;
      }
    if (removed > 0) unit.restoreSourceStatusState();
    return removed;
  }
  /** Gỡ tối đa `count` buff (bank 0, id < 15) khỏi `unit`. Trả số đã gỡ. */
  dispel(unit: DesignTraitUnit | undefined, count = 1): number {
    if (!unit) return 0;
    let removed = 0;
    for (const id of unit.activeStatusIds(BUFF_BANK)) {
      if (removed >= count) break;
      if (id < 15 && unit.statuses.remove(BUFF_BANK, id)) removed++;
    }
    if (removed > 0) unit.restoreSourceStatusState();
    return removed;
  }
  /** Lấy 1 buff của `from` sang pet. Trả true nếu lấy được. */
  stealBuff(from: DesignTraitUnit | undefined): boolean {
    if (!from) return false;
    for (const id of from.activeStatusIds(BUFF_BANK)) {
      if (id >= 15) continue;
      const old = from.statuses.get(BUFF_BANK, id);
      if (!old) continue;
      from.statuses.remove(BUFF_BANK, id);
      from.restoreSourceStatusState();
      this.self.statuses.put(
        new StatusInstance(
          old.definition,
          Math.max(1, old.remainingTurns),
          old.remainingActions,
          old.primaryValue,
          old.secondaryValue,
          old.stackCount,
          this.self.ownerSide,
          this.self.formationSlot,
          old.sourceSkillId,
          old.flags,
        ),
      );
      this.self.restoreSourceStatusState();
      return true;
    }
    return false;
  }
  /**
   * Tăng/giảm `percent`% chỉ số gốc của `unit` trong `turns` vòng (tính cả vòng hiện tại). Cùng `key`
   * trên cùng pet thì thay bản cũ (không cộng dồn).
   */
  statUp(
    unit: DesignTraitUnit,
    stat: MutableStat,
    percent: number,
    turns: number,
    key: string,
  ): void {
    const mods = kitState(unit).mods;
    const index = mods.findIndex((m) => m.key === key && m.stat === stat);
    if (index >= 0) mods.splice(index, 1);
    mods.push({ stat, percent, until: this.round + Math.max(1, turns) - 1, key });
    unit.restoreStatsForCheck();
  }
  clearStat(unit: DesignTraitUnit, key: string): void {
    const mods = kitState(unit).mods;
    for (let i = mods.length - 1; i >= 0; i--) if (mods[i].key === key) mods.splice(i, 1);
    unit.restoreStatsForCheck();
  }
  /** Gắn dấu riêng `key` của pet lên `target` trong `turns` vòng; cộng tầng tới `cap`. Trả số tầng. */
  mark(target: DesignTraitUnit | undefined, key: string, turns: number, cap = 1): number {
    if (!target || !target.alive()) return 0;
    const marks = kitState(target).marks;
    const until = this.round + Math.max(1, turns) - 1;
    const old = marks.find((m) => m.key === key && m.owner === this.self);
    if (old) {
      old.until = until;
      old.stacks = Math.min(cap, old.stacks + 1);
      return old.stacks;
    }
    marks.push({ key, owner: this.self, until, stacks: 1 });
    return 1;
  }
  /** Số tầng dấu `key` của pet đang còn trên `target` (0 nếu không có). */
  marked(target: DesignTraitUnit | undefined, key: string, anyOwnerOnTeam = false): number {
    if (!target) return 0;
    const mark = kitState(target).marks.find(
      (m) =>
        m.key === key &&
        m.until >= this.round &&
        (m.owner === this.self || (anyOwnerOnTeam && m.owner.ownerSide === this.self.ownerSide)),
    );
    return mark ? mark.stacks : 0;
  }
  unmark(target: DesignTraitUnit | undefined, key: string): void {
    if (!target) return;
    const marks = kitState(target).marks;
    for (let i = marks.length - 1; i >= 0; i--)
      if (marks[i].key === key && marks[i].owner === this.self) marks.splice(i, 1);
  }
  /** Hoàn `amount` PP cho chiêu `skillId` của pet. */
  restorePp(skillId: number, amount: number): void {
    this.self.restoreSkillPpForId(skillId, amount);
  }
  /** Tính lại chỉ số sau khi đổi biến mà `statBonus` đọc. */
  refresh(unit: DesignTraitUnit = this.self): void {
    unit.restoreStatsForCheck();
  }
}

/**
 * Bộ máy kit của một trận: giữ nhật ký, vòng hiện tại và chuyển mỗi sự kiện của projection tới kịch
 * bản của từng pet liên quan.
 */
/** Bảng cân bằng: id loài → tham số ghi đè. */
let tuning: Readonly<Record<number, Readonly<Record<string, number>>>> = {};

export function setTraitTuning(
  table: Readonly<Record<number, Readonly<Record<string, number>>>>,
): void {
  tuning = table;
}

export function traitTuning(): Readonly<Record<number, Readonly<Record<string, number>>>> {
  return tuning;
}

/** Tham số của loài sau bảng cân bằng. */
export function traitParams(speciesId: number, script: TraitScript): Record<string, number> {
  return { ...(script.params ?? {}), ...(tuning[speciesId] ?? {}) };
}

/** Thay `{tên}` trong mô tả bằng tham số đã cân bằng. */
export function renderTraitText(
  speciesId: number,
  script: TraitScript,
  text: string | undefined = script.text,
): string | undefined {
  if (text === undefined) return undefined;
  const params = traitParams(speciesId, script);
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

export class TraitKitRuntime {
  round = 1;
  readonly log: KitProc[] = [];
  private depth = 0;

  constructor(
    readonly host: KitHost,
    private readonly script: (unit: DesignTraitUnit) => TraitScript | undefined,
  ) {}

  units(): DesignTraitUnit[] {
    return this.host.units();
  }
  paramsOf(unit: DesignTraitUnit): Record<string, number> {
    const script = this.script(unit);
    return script ? traitParams(unit.speciesId, script) : {};
  }
  allyOf(unit: DesignTraitUnit): DesignTraitUnit | undefined {
    return this.units().find((u) => u !== unit && u.alive() && u.ownerSide === unit.ownerSide);
  }
  foesOf(unit: DesignTraitUnit): DesignTraitUnit[] {
    return this.units().filter((u) => u.alive() && u.ownerSide !== unit.ownerSide);
  }
  skillOf(unit: DesignTraitUnit, id: number): KitSkill | undefined {
    const row = this.host.skill(id);
    if (!row) return undefined;
    return {
      id,
      name: row.name,
      element: row.elementFamily,
      power: row.powerPercent,
      attack: row.powerPercent > 0,
      support: row.powerPercent <= 0,
      ownSide: row.targetSide !== 0,
      sameElement: row.elementFamily === this.host.elementOf(unit.speciesId),
    };
  }

  put(
    target: DesignTraitUnit,
    bank: number,
    id: number,
    turns: number,
    value: number,
    source: DesignTraitUnit,
    sourceSkill: number,
  ): void {
    const definition = this.host.definition(bank, id);
    const actions = definition.consumePolicy === "ACTION" ? 1 : 0;
    target.statuses.put(
      new StatusInstance(
        definition,
        Math.max(1, turns),
        actions,
        Math.max(0, value),
        0,
        1,
        source.ownerSide,
        source.formationSlot,
        sourceSkill,
        0,
      ),
    );
    target.restoreSourceStatusState();
  }

  private with<T>(
    unit: DesignTraitUnit | undefined,
    run: (s: TraitScript, k: Kit) => T,
  ): T | undefined {
    if (!unit) return undefined;
    const script = this.script(unit);
    if (!script) return undefined;
    kitState(unit).runtime = this;
    if (this.depth > 3) return undefined;
    this.depth++;
    try {
      return run(script, new Kit(this, unit));
    } finally {
      this.depth--;
    }
  }

  setRound(round: number): void {
    this.round = round;
  }

  // ---------------------------------------------------------------- sự kiện từ projection

  enter(unit: DesignTraitUnit, round: number): void {
    this.round = round;
    const state = kitState(unit);
    state.runtime = this;
    state.e = {};
    state.enteredRound = round;
    const hadMods = state.mods.length > 0;
    state.mods.length = 0;
    this.with(unit, (s, k) => s.onEnter?.(k));
    // Chỉ tính lại chỉ số cho pet kit đụng tới: pet khác giữ đúng nhịp tính của engine cũ.
    if (hadMods || this.script(unit)) unit.restoreStatsForCheck();
  }

  /** 2v2: đòn đơn mục tiêu của `attacker` vào `target` có bị pet khác cùng phe hút về không. */
  redirect(
    attacker: DesignTraitUnit,
    target: DesignTraitUnit,
    skillId: number,
  ): DesignTraitUnit | undefined {
    if (attacker.ownerSide === target.ownerSide) return undefined;
    for (const guard of this.units()) {
      if (guard === target || !guard.alive() || guard.ownerSide !== target.ownerSide) continue;
      const taken = this.with(guard, (s, k) =>
        s.redirect?.(k, { attacker, target, skill: this.skillOf(attacker, skillId) }),
      );
      if (taken === true) return guard;
    }
    return undefined;
  }

  leave(unit: DesignTraitUnit, next?: DesignTraitUnit, fainted = false): void {
    this.with(unit, (s, k) => s.onLeave?.(k, { next, fainted }));
    const state = kitState(unit);
    const hadMods = state.mods.length > 0;
    state.mods.length = 0;
    state.e = {};
    if (hadMods || this.script(unit)) unit.restoreStatsForCheck();
  }

  beginAction(
    actor: DesignTraitUnit,
    target: DesignTraitUnit | undefined,
    skillId: number,
    actedFirst: boolean,
  ): void {
    this.with(actor, (s, k) =>
      s.beforeAction?.(k, { target, skill: this.skillOf(actor, skillId), actedFirst }),
    );
  }

  /** Đòn trực tiếp: cộng % của kẻ đánh và đồng đội nó, giảm % của người nhận và đồng đội người nhận. */
  projectDirect(
    source: DesignTraitUnit,
    receiver: DesignTraitUnit,
    damage: number,
    skillId: number,
  ): number {
    if (damage <= 0 || source.ownerSide === receiver.ownerSide) return damage;
    const skill = this.skillOf(source, skillId);
    const hit: KitHit = { source, target: receiver, skill, damage };
    let bonus = 0;
    let reduction = 0;
    bonus += num(
      this.with(source, (s, k) =>
        s.outgoing?.(k, { ...hit, actedFirst: source.designTraitState.actedFirst }),
      ),
    );
    const sourceAlly = this.allyOf(source);
    bonus += num(this.with(sourceAlly, (s, k) => s.allyOutgoing?.(k, hit)));
    reduction += num(this.with(receiver, (s, k) => s.incoming?.(k, { ...hit, direct: true })));
    const receiverAlly = this.allyOf(receiver);
    reduction += num(this.with(receiverAlly, (s, k) => s.guardAlly?.(k, hit)));
    if (bonus === 0 && reduction === 0) return damage;
    bonus = Math.max(-90, Math.min(MAX_BONUS, bonus));
    reduction = Math.max(-100, Math.min(MAX_REDUCTION, reduction));
    const scaled = Math.trunc((damage * (100 + bonus) * (100 - reduction)) / 10000);
    return Math.max(1, scaled);
  }

  /** Sát thương gián tiếp (độc, phản đòn…): chỉ hook `incoming` của người nhận với `direct` false. */
  projectIndirect(
    source: DesignTraitUnit | undefined,
    receiver: DesignTraitUnit,
    damage: number,
  ): number {
    if (damage <= 0) return damage;
    const reduction = num(
      this.with(receiver, (s, k) =>
        s.incoming?.(k, {
          source: source ?? receiver,
          target: receiver,
          skill: undefined,
          damage,
          direct: false,
        }),
      ),
    );
    if (reduction === 0) return damage;
    const r = Math.max(-100, Math.min(MAX_REDUCTION, reduction));
    return Math.max(1, Math.trunc((damage * (100 - r)) / 100));
  }

  pierce(actor: DesignTraitUnit, target: DesignTraitUnit, skillId: number): number {
    return Math.max(
      0,
      Math.min(
        80,
        num(
          this.with(actor, (s, k) =>
            s.pierce?.(k, { target, skill: this.skillOf(actor, skillId) }),
          ),
        ),
      ),
    );
  }

  /** Đòn trực tiếp vừa trúng. Trả lượng phản về kẻ đánh. */
  afterDirect(
    attacker: DesignTraitUnit,
    receiver: DesignTraitUnit,
    skillId: number,
    damage: number,
  ): number {
    if (attacker.ownerSide === receiver.ownerSide) return 0;
    const hit: KitHit = {
      source: attacker,
      target: receiver,
      skill: this.skillOf(attacker, skillId),
      damage,
    };
    const state = kitState(receiver);
    this.rollRound(state);
    state.hitsTakenThisRound++;
    this.with(attacker, (s, k) => s.onHitDealt?.(k, hit));
    this.with(this.allyOf(attacker), (s, k) => s.onAllyHitDealt?.(k, hit));
    let reflect = 0;
    if (receiver.alive()) reflect += num(this.with(receiver, (s, k) => s.onHitTaken?.(k, hit)));
    this.with(this.allyOf(receiver), (s, k) => s.onAllyHitTaken?.(k, hit));
    return Math.max(0, Math.trunc(reflect));
  }

  /** Máu đã trừ (mọi loại). Ghi sổ mất máu, gọi `onDamaged`, rồi các sự kiện gục. */
  afterDamage(
    source: DesignTraitUnit | undefined,
    receiver: DesignTraitUnit,
    before: number,
    direct: boolean,
  ): void {
    const after = receiver.hp();
    if (after >= before) return;
    const lost = before - after;
    const state = kitState(receiver);
    this.rollRound(state);
    state.lossRound = this.round;
    state.lossThisRound += lost;
    const ally = this.allyOf(receiver);
    if (ally) {
      const allyState = kitState(ally);
      this.rollRound(allyState);
      allyState.allyLossThisRound += lost;
    }
    if (receiver.alive())
      this.with(receiver, (s, k) => s.onDamaged?.(k, { before, after, source, direct }));
    if (!receiver.alive()) this.fainted(receiver, source);
  }

  private fainted(unit: DesignTraitUnit, killer: DesignTraitUnit | undefined): void {
    for (const other of this.units()) {
      if (other === unit || !other.alive()) continue;
      if (other.ownerSide === unit.ownerSide)
        this.with(other, (s, k) => s.onAllyFaint?.(k, { ally: unit }));
      else this.with(other, (s, k) => s.onFoeFaint?.(k, { foe: unit, byMe: killer === other }));
    }
  }

  afterAction(
    actor: DesignTraitUnit,
    _target: DesignTraitUnit | undefined,
    skillId: number,
    action: Omit<KitAction, "skill">,
  ): void {
    const event: KitAction = { ...action, skill: this.skillOf(actor, skillId) };
    const state = kitState(actor);
    this.with(actor, (s, k) => s.afterAction?.(k, event));
    state.lastSkill = skillId;
    state.lastSkillRound = this.round;
    for (const other of this.units()) {
      if (other === actor || !other.alive()) continue;
      this.with(other, (s, k) =>
        s.onOtherAction?.(k, { ...event, actor, isAlly: other.ownerSide === actor.ownerSide }),
      );
    }
  }

  roundEnd(unit: DesignTraitUnit, round: number): void {
    this.round = round;
    if (unit.alive()) this.with(unit, (s, k) => s.roundEnd?.(k));
    const state = kitState(unit);
    const hadMods = state.mods.length > 0;
    for (let i = state.mods.length - 1; i >= 0; i--)
      if (state.mods[i].until <= round) state.mods.splice(i, 1);
    for (let i = state.marks.length - 1; i >= 0; i--)
      if (state.marks[i].until <= round) state.marks.splice(i, 1);
    if (hadMods || this.script(unit)) unit.restoreStatsForCheck();
  }

  dotTick(
    source: DesignTraitUnit,
    target: DesignTraitUnit,
    bank: number,
    id: number,
    damage: number,
  ): void {
    const status = (Object.entries(KIT_STATUS).find(
      ([, s]) => s.bank === bank && s.id === id,
    )?.[0] ?? "seed") as KitStatus;
    this.with(source, (s, k) => s.onDotTick?.(k, { target, status, damage }));
  }

  /** `skillId`: chiêu pet đã chọn cho lượt này (xếp thứ tự chạy trước khi pet ra đòn). */
  priority(unit: DesignTraitUnit, opponent: DesignTraitUnit, skillId?: number): boolean {
    const skill = skillId === undefined ? undefined : this.skillOf(unit, skillId);
    return this.with(unit, (s, k) => s.priority?.(k, { opponent, skill })) === true;
  }

  statBonus(unit: DesignTraitUnit, stat: MutableStat): number {
    const state = kitState(unit);
    let percent = 0;
    for (const mod of state.mods)
      if (mod.stat === stat && mod.until >= this.round) percent += mod.percent;
    percent += num(this.with(unit, (s, k) => s.statBonus?.(k, stat)));
    return percent;
  }

  healOut(source: DesignTraitUnit, target: DesignTraitUnit, amount: number): number {
    return (
      amount + Math.max(0, num(this.with(source, (s, k) => s.healOut?.(k, { target, amount }))))
    );
  }

  healIn(target: DesignTraitUnit, source: DesignTraitUnit | undefined, amount: number): number {
    const answer = this.with(target, (s, k) => s.healIn?.(k, { source, amount }));
    return typeof answer === "number" ? Math.max(0, Math.trunc(answer)) : amount;
  }

  admits(unit: DesignTraitUnit, definition: StatusDefinition): boolean {
    const status = kitStatusOf(definition);
    if (!status) return true;
    return this.with(unit, (s, k) => s.admits?.(k, { status })) !== false;
  }

  private rollRound(state: KitUnitState): void {
    if (state.lossRoundKey === this.round) return;
    state.lossRoundKey = this.round;
    state.lossThisRound = 0;
    state.allyLossThisRound = 0;
    state.hitsTakenThisRound = 0;
  }
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
