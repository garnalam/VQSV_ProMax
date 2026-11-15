import type { PackBattleAiProfile } from "../../../data/GameData";
import type { RainbowCharmBattleState } from "../../charm/RainbowCharmBattle";
import { decideReserveShare, expAward, reserveExpAward } from "../BattleOutcomeEngine";
import type { BattleRandom } from "../BattleRandom";
import type { BattleRules } from "../BattleRules";
import type { DesignTraitProjection } from "../DesignTraitProjection";
import type { DesignTraitUnit } from "../DesignTraits";
import { resolveP7PostSkill } from "../P7PostSkill";
import { resolveP7Strike, resolveSelfHitDamage } from "../P7Strike";
import type { StatusInstance, StatusUnit as StatusUnitLike } from "../StatusState";
import type { StatusWebRules } from "../StatusWebRules";
import { BattleAiActorKey } from "../ai/BattleAiActorKey";
import type { BattleAiDecision } from "../ai/BattleAiDecision";
import { BattleAiDecisionEngine, tierOfProfile } from "../ai/BattleAiDecisionEngine";
import type { BattleAiEncounterCatalog } from "../ai/BattleAiEncounterCatalog";
import { BattleAiJointRoundPlanner } from "../ai/BattleAiJointRoundPlanner";
import { BattleAiMemory } from "../ai/BattleAiMemory";
import type { BattleAiEncounterSpec } from "../ai/BattleAiObservation";
import { BattleAiObservationInput, type OwnedUnit } from "../ai/BattleAiObservationFactory";
import type { BattleAiItemOption, BattleAiRulebook } from "../ai/BattleAiRulebook";
import { LiveBattleAiUnit } from "../ai/BattleAiUnit";
import { RUNTIME_MODES, type BattleAiV2RuntimeMode } from "../ai/BattleAiV2RuntimeSelector";
import { BattleAiDecision as AiDecision } from "../ai/BattleAiDecision";
import type { BattleItems } from "./BattleItems";
import { applyCauVongItemRecovery } from "./CauVongItemRecovery";
import {
  BattleCommandError,
  ITEMS_NOT_ALLOWED_TEXT,
  RUN_NOT_ALLOWED_TEXT,
  type CombatantSetup,
  SKILL_NOT_READY_WARNING,
  TIER_LOCK_WARNING,
} from "./BattleTypes";
import {
  MA_MOC,
  MA_MOC_BLOCKED_ITEM_KEYS,
  MA_MOC_SKILL,
  MA_MOC_TEXT,
  applyEnrage,
  applyHoaSpeedPenalty,
  applyLifeSteal,
  clearHoaSpeedPenalty,
  configureMaMocUnit,
  hpPercentValue,
  isHoaTienTu,
  isTanNguyetBoss,
  maMocBattleDeck,
  payHoaRescueCost,
  reduceCorrosionBurn,
  reduceIncomingDamage,
  removeGhostMirror,
  reviveAtHalfHp,
  shareLifeStealWithHoa,
  shouldPrioritizeBaoPhong,
} from "./TanNguyetLongMa";
import type {
  DoubleBattleSetup,
  DoubleCommand,
  DoubleEvent,
  DoubleOccupant,
  DoubleOutcome,
  DoubleRequest,
  DoubleSkillRules,
  DoubleSlot,
  PlayerSlot,
} from "./DoubleBattleTypes";

/** What the 2v2 core reads beyond the battle rules. */
export type DoubleBattleDeps = {
  items: BattleItems;
  skillRules: DoubleSkillRules;
  rulebook: BattleAiRulebook;
  catalog: BattleAiEncounterCatalog;
  /** The AI-v2 runtime mode (`BattleAiV2RuntimeSelector.current()`); all encounters by default. */
  aiMode?: BattleAiV2RuntimeMode;
};

/** `VqsvDoubleBattleRuntime.QueuedAction`. */
type QueuedAction = {
  actorSlot: DoubleSlot;
  targetSlot: DoubleSlot;
  skillId: number;
  actor: DesignTraitUnit;
  /** `groupSecondary`: the group target's second hit — no PP, no control, scaled Power. */
  groupSecondary: boolean;
  secondaryPowerPercent: number;
  itemId: number;
  playerItem: boolean;
  /** The player battle owner a player item is for. */
  itemMember: number;
};

type Continuation = "BEGIN_COMMANDS" | "RESOLVE" | "NEXT_COMMAND";

const SLOTS: readonly DoubleSlot[] = [0, 1, 2, 3];
const OWN_SIDE = (slot: number): readonly DoubleSlot[] => (slot >= 2 ? [2, 3] : [0, 1]);
const OTHER_SIDE = (slot: number): readonly DoubleSlot[] => (slot >= 2 ? [0, 1] : [2, 3]);
const INT_MAX = 2147483647;
const EMPTY_SKILL = -1;

/**
 * The simultaneous 2v2 core: `VqsvDoubleBattleRuntime` as pure logic, without its animation waits.
 *
 * The 2v2 structure is JavaSE's: four formation slots, commands collected slot 2 then slot 3, the
 * companion's and both enemies' AI decisions (the enemy pair reviewed by the AI-v2 joint planner),
 * the queue sorted by priority (`compareQueuedActionOrder`: trait, held item 7, defensive skill), then
 * speed, then slot; legal targets by side; the group target's second hit at 75% Power; forced
 * replacements between actions; the win when both NPC slots and the bench are down, the loss when
 * slots 2 and 3 are; EXP shared by the living entered participants.
 *
 * Statuses run on the web rules exactly as the 1v1 core runs them (owner decision, 2026-11-09): a
 * pet's DOTs and regen tick at the start of its own action, Hóa Đá/Ngủ/Tê Liệt take the action,
 * Quỷ Mị/Hỗn Loạn turn it, Điện áp doubles the PP, Gia Tốc and repeat hits fold into the strike.
 */
export class DoubleBattleCore {
  private readonly web: StatusWebRules;
  private readonly projection: DesignTraitProjection;
  private readonly inventory: Record<number, number>;
  private readonly log: DoubleEvent[] = [];
  private delivered = 0;
  private openRequest: DoubleRequest | undefined;

  private readonly playerUnits: DesignTraitUnit[];
  private readonly companionUnits: DesignTraitUnit[];
  private readonly enemyUnits: DesignTraitUnit[];
  /** Who stands in each slot. */
  private readonly occupants: DoubleOccupant[] = [];
  private readonly participants: number[] = [];

  private turn = 1;
  private readonly selections: (QueuedAction | null)[] = [null, null];
  private actions: QueuedAction[] = [];
  private actionIndex = 0;
  private readonly acted = [false, false, false, false];
  private readonly traitPriority = new Map<number, number>();
  /** What follows the open player replacement. */
  private continuation: Continuation = "RESOLVE";
  /** An owner-turn-end the group target's second hit is still holding back. */
  private readonly deferredTurnEnd = new Set<DesignTraitUnit>();

  // AI
  private readonly mode: BattleAiV2RuntimeMode;
  private readonly spec: BattleAiEncounterSpec | undefined;
  private readonly memory: BattleAiMemory | undefined;
  private readonly joint: BattleAiJointRoundPlanner;
  private readonly live = new Map<DesignTraitUnit, LiveBattleAiUnit>();
  private readonly lastSkill = new Map<DesignTraitUnit, number>();
  private readonly repeatCount = new Map<DesignTraitUnit, number>();
  private enemyItemsRemaining: number;
  private itemOptions?: BattleAiItemOption[];
  /** The joint round lines Java traces (`AI-V2-C simultaneous 2v2 joint round/commit`), for parity checks. */
  readonly jointTrace: string[] = [];

  // charms
  private npcCharms: RainbowCharmBattleState | undefined;
  private readonly fainted = new Set<DesignTraitUnit>();
  private readonly experience: number[];
  private readonly reserveExperience: number[];

  // Tàn Nguyệt Long Ma (`tanNguyetBossBattle` and its four fields)
  private readonly maMoc: boolean;
  private maMocRevived = false;
  private maMocHoaDeathHandled = false;
  private maMocSharedHealTurn = -1;
  private maMocHoaRecoveryActionsRemaining = 0;

  constructor(
    private readonly rules: BattleRules,
    private readonly deps: DoubleBattleDeps,
    private readonly setup: DoubleBattleSetup,
    private readonly random: BattleRandom,
  ) {
    if (!rules.web) throw new Error("the 2v2 core runs the web rules, as the 1v1 core does");
    if (setup.enemy.length < 2) throw new Error("2v2 requires at least two enemy pets");
    if (setup.player.length === 0) throw new Error("2v2 requires a player pet");
    if (!setup.controlsBoth && setup.companion.length === 0)
      throw new Error("2v2 without a second player pet needs a companion roster");
    this.web = rules.web;
    this.maMoc = setup.boss === "tan-nguyet-long-ma";
    this.projection = rules.newTraitProjection((label) => this.random.percent(label), "TWO_V_TWO");
    this.inventory = { ...(setup.inventory ?? {}) };
    // `VqsvDoubleBattleRuntime` builds the player's own pets with `toBattleUnit(pet, 0, badges)`; the
    // companion's lent pets and the enemies come without a badge.
    this.playerUnits = setup.player.slice(0, 6).map((pet) => {
      const unit = this.build(pet, 0);
      if (setup.badgeProfile) unit.applySourceBadgeProfile(setup.badgeProfile, pet.hp ?? -1);
      return unit;
    });
    this.companionUnits = setup.companion.slice(0, 3).map((pet) => this.build(pet, 0));
    this.enemyUnits = setup.enemy.map((pet) => this.build(pet, 1));
    this.experience = this.playerUnits.map(() => 0);
    this.reserveExperience = this.playerUnits.map(() => 0);
    this.mode = deps.aiMode ?? RUNTIME_MODES.ALL_ENCOUNTERS_V2;
    this.spec = setup.encounterKey ? deps.catalog.spec(setup.encounterKey) : undefined;
    this.memory = this.spec ? new BattleAiMemory(this.spec.memoryHorizon) : undefined;
    this.joint = new BattleAiJointRoundPlanner(deps.rulebook, deps.catalog);
    this.enemyItemsRemaining = setup.enemyProfile.itemBudget;
  }

  // ------------------------------------------------------------------ reading the fight

  get request(): DoubleRequest {
    if (!this.openRequest) throw new Error("call start() first");
    return this.openRequest;
  }
  get round(): number {
    return this.turn;
  }
  get events(): readonly DoubleEvent[] {
    return this.log;
  }
  unit(slot: DoubleSlot): DesignTraitUnit {
    const at = this.occupants[slot];
    return at.side === "player"
      ? this.playerUnits[at.index]
      : at.side === "companion"
        ? this.companionUnits[at.index]
        : this.enemyUnits[at.index];
  }
  occupant(slot: DoubleSlot): DoubleOccupant {
    return this.occupants[slot];
  }
  setupOf(slot: DoubleSlot): CombatantSetup {
    const at = this.occupants[slot];
    return (
      at.side === "player"
        ? this.setup.player
        : at.side === "companion"
          ? this.setup.companion
          : this.setup.enemy
    )[at.index];
  }
  /** The battle visual of every pet the fight can seat: both rosters and the lent companions. */
  spriteIds(): number[] {
    const ids = [...this.setup.player, ...this.setup.enemy, ...this.setup.companion]
      .map((pet) => pet.spriteId ?? -1)
      .filter((id) => id >= 0);
    return [...new Set(ids)];
  }
  playerSetup(member: number): CombatantSetup {
    return this.setup.player[member];
  }
  playerUnit(member: number): DesignTraitUnit {
    return this.playerUnits[member];
  }
  get playerCount(): number {
    return this.playerUnits.length;
  }
  bag(): Readonly<Record<number, number>> {
    return this.inventory;
  }
  /** The bag count still free this round (`reservedItemCount` subtracted). */
  freeItemCount(itemId: number): number {
    return (
      (this.inventory[itemId] ?? 0) -
      this.selections.filter((action) => action?.playerItem && action.itemId === itemId).length
    );
  }

  itemsAllowed(): boolean {
    return this.setup.itemsAllowed !== false;
  }

  runAllowed(): boolean {
    return this.setup.runAllowed === true;
  }

  /** `legalTargets`: the living slots of the side the skill aims at. */
  legalTargets(actorSlot: DoubleSlot, skillId: number): DoubleSlot[] {
    const row = this.rules.damage.skillRow(skillId),
      ally = row?.targetSide === 1 || this.scope(skillId) === "ALL_ALLIES";
    return (ally ? OWN_SIDE(actorSlot) : OTHER_SIDE(actorSlot)).filter((slot) =>
      this.unit(slot).alive(),
    );
  }

  // ------------------------------------------------------------------ driving the fight

  /** `enter`: build the field, seat the four slots, open the first round. */
  start(): DoubleEvent[] {
    if (this.openRequest) throw new Error("the fight has already started");
    this.occupants.push({ side: "enemy", index: 0 }, { side: "enemy", index: 1 });
    if (this.maMoc && (!this.maMocBoss() || !this.maMocHoa()))
      throw new Error("Ma Mộc Cộng Sinh requires CV-089 and Tàn Nguyệt Long Ma");
    const first = this.playerUnits.findIndex((unit) => unit.alive());
    if (first < 0) throw new Error("2v2 player roster requires one living pet");
    this.occupants.push({ side: "player", index: first });
    this.participants.push(first);
    if (this.setup.controlsBoth) {
      const second = this.playerUnits.findIndex((unit, index) => index !== first && unit.alive());
      if (second < 0) throw new Error("gym 2v2 requires two living roster pets");
      this.occupants.push({ side: "player", index: second });
      this.participants.push(second);
    } else {
      const companion = this.companionUnits.findIndex((unit) => unit.alive());
      if (companion < 0) throw new Error("2v2 companion roster has no living pet");
      this.occupants.push({ side: "companion", index: companion });
    }
    this.enterCharms();
    for (const slot of SLOTS) {
      const unit = this.unit(slot);
      unit.formationSlot = slot;
      this.projection.onBattleEnter(unit, slot, this.turn, 0);
    }
    this.emit({ type: "enter" });
    this.beginPlayerDecisions();
    return this.flush();
  }

  /** Answer the open request. A refused command throws `BattleCommandError` and changes nothing. */
  submit(answer: DoubleCommand | { kind: "member"; member: number }): DoubleEvent[] {
    const request = this.request;
    switch (request.kind) {
      case "ended":
        throw new BattleCommandError("Trận đấu đã kết thúc.");
      case "command": {
        if (answer.kind === "member") throw new BattleCommandError("Cần một lệnh cho lượt này.");
        this.command(request.slot, answer);
        break;
      }
      case "replacement": {
        if (answer.kind !== "member") throw new BattleCommandError("Chọn một Pet còn sống.");
        this.requireBenched(answer.member);
        this.openRequest = undefined;
        this.replacePlayer(request.slot, answer.member, true);
        this.continueAfterReplacement();
        break;
      }
    }
    return this.flush();
  }

  // ------------------------------------------------------------------ commands

  private command(slot: PlayerSlot, command: DoubleCommand): void {
    const actor = this.unit(slot);
    switch (command.kind) {
      case "skill": {
        const id = actor.skillIds[command.skillIndex];
        if (id === undefined || id < 0) throw new BattleCommandError("Ô Skill trống.");
        if (actor.skillPp[command.skillIndex] <= 0)
          throw new BattleCommandError("Kỹ năng đã hết PP.");
        const row = this.rules.damage.skillRow(id);
        // `VqsvDoubleBattleRuntime` checks Phong Bế's tier lock; a slot Kỹ năng Phong Bế sealed is
        // refused too (Java's 2v2 pick skipped `canUseSourceSkillId` and let a sealed slot through).
        if (row && !actor.canUseSkillTier(row.learnTier))
          throw new BattleCommandError(TIER_LOCK_WARNING);
        if (!this.web.skillUsable(row, actor))
          throw new BattleCommandError(SKILL_NOT_READY_WARNING);
        const targets = this.legalTargets(slot, id);
        if (targets.length === 0) throw new BattleCommandError("Không còn mục tiêu hợp lệ.");
        if (!targets.includes(command.target))
          throw new BattleCommandError("Mục tiêu không hợp lệ.");
        this.openRequest = undefined;
        this.selections[slot - 2] = this.queued(slot, command.target, id);
        this.nextPlayerCommand(slot + 1);
        return;
      }
      case "item": {
        if (!this.itemsAllowed()) throw new BattleCommandError(ITEMS_NOT_ALLOWED_TEXT);
        if (this.isMaMocBlockedItem(command.itemId))
          throw new BattleCommandError(MA_MOC_TEXT.sealedItem);
        if (this.web.switchAndItemsLocked(actor))
          throw new BattleCommandError("Trạng thái bị quấn, không thể sử dụng đạo cụ");
        const item = this.deps.items.get(command.itemId);
        if (!item || item.kind !== "recovery")
          throw new BattleCommandError("Trong chiến đấu không thể sử dụng");
        if (this.freeItemCount(command.itemId) <= 0)
          throw new BattleCommandError("Đã không có đạo này cụ, thỉnh mua sắm");
        const unit = this.playerUnits[command.member];
        if (!unit) throw new BattleCommandError("Sủng vật này không có, không thể sử dụng");
        const why = this.deps.items.refusal(item, unit, undefined, (id) => this.ppMax(id));
        if (why) throw new BattleCommandError(why);
        this.openRequest = undefined;
        this.selections[slot - 2] = {
          ...this.queued(slot, slot, EMPTY_SKILL),
          itemId: command.itemId,
          playerItem: true,
          itemMember: command.member,
        };
        this.nextPlayerCommand(slot + 1);
        return;
      }
      case "switch": {
        if (this.web.switchAndItemsLocked(actor))
          throw new BattleCommandError("Trạng thái bị quấn, không thể đổi sủng vật");
        if (slot === 3 && !this.setup.controlsBoth)
          throw new BattleCommandError("Sủng vật này đã đặt ở vị trí chiến đấu");
        this.requireBenched(command.member);
        this.openRequest = undefined;
        // `openPetSelect(..., NEXT_COMMAND)`: the switch happens now and the slot is done.
        this.replacePlayer(slot, command.member, false);
        this.nextPlayerCommand(slot + 1);
        return;
      }
      case "run":
        if (!this.runAllowed()) throw new BattleCommandError(RUN_NOT_ALLOWED_TEXT);
        this.end("none");
        return;
    }
  }

  /** `beginPlayerDecisions`: revives, forced replacements, then the first command. */
  private beginPlayerDecisions(): void {
    for (const slot of SLOTS) if (!this.unit(slot).alive()) this.charmRevive(slot);
    const enemy = this.firstDeadEnemySlotWithReserve();
    if (enemy >= 0) {
      this.replaceEnemy(enemy as DoubleSlot);
      return this.beginPlayerDecisions();
    }
    const player = this.firstDeadPlayerSlotWithReserve();
    if (player >= 0) {
      if (this.forcedReplacement(player as PlayerSlot, "BEGIN_COMMANDS")) return;
      return this.beginPlayerDecisions();
    }
    if (this.battleFinished()) return;
    this.emit({ type: "roundStart", round: this.turn });
    this.selections.fill(null);
    this.nextPlayerCommand(2);
  }

  /** `enterNextPlayerCommand`: the next living commanded slot, or the round. */
  private nextPlayerCommand(from: number): void {
    const last = this.setup.controlsBoth ? 3 : 2;
    for (let slot = Math.max(2, from); slot <= last; slot++) {
      if (!this.unit(slot as DoubleSlot).alive()) continue;
      this.openRequest = { kind: "command", slot: slot as PlayerSlot, round: this.turn };
      return;
    }
    this.buildRoundActions();
    this.resolve();
  }

  // ------------------------------------------------------------------ the round

  /** `buildRoundActions`: player selections, the companion, both enemies (joint), sorted. */
  private buildRoundActions(): void {
    this.actions = [];
    this.acted.fill(false);
    this.selections.forEach((selection) => {
      if (
        selection &&
        this.unit(selection.actorSlot) === selection.actor &&
        selection.actor.alive()
      )
        this.actions.push(selection);
    });
    if (!this.setup.controlsBoth && this.unit(3).alive()) {
      const decision = this.decide(3, this.setup.companionProfile, 0),
        target = this.slotOfLive(decision.target);
      if (decision.type === "SKILL" && decision.skillId >= 0 && target >= 0) {
        this.actions.push(this.queued(3, target as DoubleSlot, decision.skillId));
        this.rememberSkill(this.unit(3), decision.skillId);
      }
    }
    const decisions: (BattleAiDecision | null)[] = [null, null];
    let budget = this.enemyItemsRemaining;
    for (const slot of [0, 1] as const) {
      if (!this.unit(slot).alive()) continue;
      // `chooseAiDecision`: Ma Mộc Cộng Sinh plays its own script instead of the source-v1 brain.
      const decision = this.maMoc
        ? this.chooseMaMocDecision(slot)
        : this.decide(slot, this.setup.enemyProfile, budget);
      decisions[slot] = decision;
      if (decision.type === "ITEM" && this.slotOfLive(decision.target) >= 0)
        budget = Math.max(0, budget - 1);
    }
    let final = decisions;
    if (this.unit(0).alive() && this.unit(1).alive() && decisions[0] && decisions[1])
      final = this.jointRound(decisions as BattleAiDecision[]);
    for (const slot of [0, 1] as const) {
      const decision = final[slot];
      if (!this.unit(slot).alive() || !decision) continue;
      const target = this.slotOfLive(decision.target);
      if (decision.type === "ITEM") {
        if (target < 0) continue;
        this.actions.push({
          ...this.queued(slot, target as DoubleSlot, EMPTY_SKILL),
          itemId: decision.itemId,
        });
        this.enemyItemsRemaining = Math.max(0, this.enemyItemsRemaining - 1);
        this.observeItem(slot, decision.itemId);
      } else if (decision.type === "SKILL" && decision.skillId >= 0 && target >= 0) {
        this.actions.push(this.queued(slot, target as DoubleSlot, decision.skillId));
        this.rememberSkill(this.unit(slot), decision.skillId);
      }
    }
    this.traitPriority.clear();
    for (const action of this.actions) {
      if (action.skillId < 0) continue;
      const target = this.unit(action.targetSlot),
        granted =
          action.actor.alive() &&
          target.alive() &&
          action.actor.ownerSide !== target.ownerSide &&
          this.rules.traits.outranked(action.actor, target);
      this.traitPriority.set(action.actorSlot, granted ? 1 : 0);
    }
    this.actions.sort((a, b) => this.compareQueuedActionOrder(a, b));
    this.actionIndex = 0;
  }

  /** `compareQueuedActionOrder`: priority, then speed, then slot. */
  private compareQueuedActionOrder(a: QueuedAction, b: QueuedAction): number {
    const priority = (action: QueuedAction) =>
      Math.max(
        this.traitPriority.get(action.actorSlot) ?? 0,
        action.actor.hasHeldItem(7) ? 1 : 0,
        this.deps.skillRules.defensivePriority.includes(action.skillId) ? 1 : 0,
      );
    const pa = priority(a),
      pb = priority(b);
    if (pa !== pb) return pb - pa;
    const sa = a.actor.currentStats.speed,
      sb = b.actor.currentStats.speed;
    if (sa !== sb) return sb - sa;
    return a.actorSlot - b.actorSlot;
  }

  /** `tickResolve`, run until the round ends or a player replacement is needed. */
  private resolve(): void {
    for (;;) {
      // `tickResolve` opens with the Ma Mộc state, then the boss's one revive.
      this.updateMaMocState();
      this.reviveFallenMaMocBoss();
      this.resolveGates();
      const enemy = this.firstDeadEnemySlotWithReserve();
      if (enemy >= 0) {
        this.replaceEnemy(enemy as DoubleSlot);
        continue;
      }
      const player = this.firstDeadPlayerSlotWithReserve();
      if (player >= 0) {
        if (this.forcedReplacement(player as PlayerSlot, "RESOLVE")) return;
        continue;
      }
      if (this.actionIndex >= this.actions.length) {
        if (this.battleFinished()) return;
        for (const slot of SLOTS) {
          const unit = this.unit(slot);
          this.projection.tickDesignBleeding(unit, this.turn);
          this.projection.onRoundEnd(unit, slot, this.turn, this.actionIndex);
        }
        this.turn++;
        this.beginPlayerDecisions();
        return;
      }
      const action = this.actions[this.actionIndex++];
      if (this.unit(action.actorSlot) !== action.actor || !action.actor.alive()) continue;
      if (!action.groupSecondary) this.acted[action.actorSlot] = true;
      if (action.itemId >= 0) {
        this.resolveItem(action);
        continue;
      }
      let target: DoubleSlot = action.targetSlot;
      if (!this.unit(target).alive()) {
        const retarget = this.chooseAiTarget(action.actorSlot, action.skillId);
        if (retarget === -1) {
          this.releaseTurnEnd(action.actor);
          continue;
        }
        target = retarget;
      }
      if (action.groupSecondary) this.groupSecondaryHit(action, target);
      else this.skillAction(action, target);
      this.afterMaMocAction(action);
      const pivot = this.pivotSlot(action.actor, action.actorSlot);
      if (pivot >= 0 && this.forcedReplacement(pivot as DoubleSlot, "RESOLVE", true)) return;
    }
  }

  /** The charm gates `tickResolve` opens every step with. */
  private resolveGates(): void {
    const player = this.setup.charms?.player;
    if (player)
      for (const slot of [2, 3] as const) {
        const amount = player.tryEmergencyHeal(this.unit(slot));
        if (amount > 0) {
          this.emit({ type: "charmHeal", slot, amount });
          break;
        }
      }
    const npc = this.npcCharms;
    if (npc)
      for (const slot of [0, 1] as const) {
        if (!this.unit(slot).alive()) this.charmRevive(slot);
        const amount = npc.tryEmergencyHeal(this.unit(slot));
        if (amount > 0) {
          this.projection.afterHealing(this.unit(slot), slot, this.turn);
          this.emit({ type: "charmHeal", slot, amount });
        }
      }
  }

  // ------------------------------------------------------------------ one action

  /** `prepareAction` → P7 → `finishAction` for a declared skill, on the web status rules. */
  private skillAction(action: QueuedAction, declaredTarget: DoubleSlot): void {
    const actor = action.actor,
      slot = action.actorSlot,
      roll = (label: string) => this.random.percent(label);
    // The owner's turn opens: its DOTs bite and its regen heals (web round passes, as in 1v1).
    actor.statusChanceBonus = this.maMocStatusChanceBonus(actor);
    const tick = this.web.ownerTurnStart(
      actor,
      (side, at) => this.resolveSource(side, at),
      this.dotSeams(slot),
    );
    if (tick.damage > 0 || tick.heal > 0)
      this.emit({ type: "statusTick", slot, damage: tick.damage, heal: tick.heal });
    if (!actor.alive()) return this.knockOut(slot);
    const block = this.web.beforeAction(actor, roll);
    if (block.blocked) {
      this.emit({ type: "blocked", slot, status: block.status ?? "" });
      this.web.ownerTurnEnd(actor, this.maMocHealGate(actor));
      return;
    }
    let skillIndex = actor.skillIds.indexOf(action.skillId);
    if (skillIndex < 0) skillIndex = 0;
    const control = this.web.controlAction(actor, skillIndex, this.usableSlots(actor), roll);
    if (control.spent)
      this.emit({ type: "controlled", slot, status: control.spent, selfHit: control.selfHit });
    skillIndex = control.skillIndex;
    const skillId = actor.skillIds[skillIndex];
    if (skillId === undefined || skillId < 0 || actor.skillPp[skillIndex] <= 0) {
      this.emit({ type: "noPp", slot });
      this.web.ownerTurnEnd(actor, this.maMocHealGate(actor));
      return;
    }
    let target: DoubleSlot = declaredTarget;
    // Hỗn Loạn picked another skill: it aims where `chooseAiTarget` sends that skill.
    if (skillId !== action.skillId) {
      const retarget = this.chooseAiTarget(slot, skillId);
      if (retarget !== -1) target = retarget;
    }
    actor.skillPp[skillIndex] = Math.max(0, actor.skillPp[skillIndex] - this.web.ppCost(actor));
    actor.selectedSkillId = skillId;
    const receiver = control.selfHit ? slot : target;
    if (control.selfHit) this.selfHit(slot, skillId, !this.acted[target]);
    else this.strike(action, target, skillId, undefined);
    const receiverUnit = this.unit(receiver);
    this.observeAction(slot, receiver, skillId);
    if (!receiverUnit.alive()) this.charmRevive(receiver);
    // `queueActionFollowUp`: the group target's second hit, queued right behind this one.
    let followUp = false;
    if (!control.selfHit) {
      const second = this.groupSecondaryTarget(slot, target, skillId);
      if (second >= 0) {
        const scale =
          this.scope(skillId) === "ALL_ENEMIES" && this.powerPercent(skillId) > 0 ? 75 : 100;
        this.actions.splice(this.actionIndex, 0, {
          ...this.queued(slot, second as DoubleSlot, skillId),
          groupSecondary: true,
          secondaryPowerPercent: this.secondaryPowerPercent(
            actor,
            this.unit(second as DoubleSlot),
            skillId,
            scale,
          ),
        });
        followUp = true;
      }
    }
    if (!receiverUnit.alive()) this.knockOut(receiver);
    if (!actor.alive()) this.knockOut(slot);
    if (followUp) this.deferredTurnEnd.add(actor);
    else this.web.ownerTurnEnd(actor, this.maMocHealGate(actor));
  }

  /** The group target's second hit: no PP, no control, the scaled Power, the skill's post effects. */
  private groupSecondaryHit(action: QueuedAction, target: DoubleSlot): void {
    this.strike(action, target, action.skillId, action.secondaryPowerPercent);
    const receiver = this.unit(target);
    if (!receiver.alive()) {
      this.charmRevive(target);
      if (!receiver.alive()) this.knockOut(target);
    }
    if (!action.actor.alive()) this.knockOut(action.actorSlot);
    this.releaseTurnEnd(action.actor);
  }

  private releaseTurnEnd(actor: DesignTraitUnit): void {
    if (!this.deferredTurnEnd.delete(actor)) return;
    this.web.ownerTurnEnd(actor, this.maMocHealGate(actor));
  }

  /** The P7 walk over two formation slots. */
  private strike(
    action: QueuedAction,
    targetSlot: DoubleSlot,
    skillId: number,
    secondaryPower: number | undefined,
  ): void {
    const actor = action.actor,
      slot = action.actorSlot,
      target = this.unit(targetSlot),
      secondary = secondaryPower !== undefined,
      targetCharms = this.charmsFor(target),
      hpBefore = target.hp();
    actor.statusChanceBonus = this.maMocStatusChanceBonus(actor);
    const trace = resolveP7Strike({
      attacker: actor,
      receiver: target,
      skillId,
      rules: this.rules,
      random: this.random,
      attackerSpriteId: this.setupOf(slot).spriteId ?? -2,
      receiverSpriteId: this.setupOf(targetSlot).spriteId ?? -2,
      // No capture in a 2v2: held item 10's floor never lifts a target.
      allowsHpFloor: false,
      postSkill: resolveP7PostSkill,
      charmEvasion: (receiver, sureHit) => {
        if (!targetCharms) return false;
        const roll = targetCharms.hasMechanic("EVASION")
          ? this.random.percent("battle.2v2.rainbowCharm.evasion")
          : -1;
        return targetCharms.tryEvade(receiver, sureHit, roll);
      },
      trait: {
        projection: this.projection,
        attacker: actor,
        receiver: target,
        attackerSlot: slot,
        receiverSlot: targetSlot,
        roundIndex: this.turn,
        actedFirst: !this.acted[targetSlot],
        ...(this.maMoc
          ? {
              incomingDamage: (receiver: StatusUnitLike, damage: number, skill: number) =>
                this.projectMaMocDamage(
                  receiver === target ? actor : target,
                  skill,
                  receiver,
                  damage,
                ),
              healingGate: (source: StatusUnitLike, amount: number) =>
                this.maMocHealing(source, amount),
            }
          : {}),
      },
      powerOverridePercent: secondaryPower,
      suppressSkillEffects: secondary,
    });
    actor.statusChanceBonus = 0;
    if (!secondary) {
      const pp = trace.zeroPower ? undefined : trace.unifiedPp,
        index = actor.skillIds.indexOf(skillId);
      if (pp?.exhaust) actor.skillPp.fill(0);
      else if (pp && pp.refund > 0 && index >= 0)
        actor.skillPp[index] = Math.min(this.ppMax(skillId), actor.skillPp[index] + pp.refund);
      const charms = this.charmsFor(actor);
      if (charms) {
        const drain = charms.hasMechanic("ENEMY_PP_DRAIN")
            ? this.random.percent("battle.2v2.rainbowCharm.ppDrain")
            : -1,
          refund = charms.hasMechanic("SELF_PP_REFUND")
            ? this.random.percent("battle.2v2.rainbowCharm.ppRefund")
            : -1;
        charms.afterSkillPp(actor, target, skillId, drain, refund, (id) => this.ppMax(id));
      }
    }
    this.emit({
      type: "strike",
      slot,
      target: targetSlot,
      receiver: targetSlot,
      skillId,
      hit: trace.hit,
      damage: trace.damage,
      crit: trace.critFlag === 1,
      receiverHp: target.hp(),
      actorHp: actor.hp(),
      secondary,
    });
    // `applyActionPostEffects` → `applyTanNguyetLongMaLifeSteal`, on every landed hit, the second one too.
    if (trace.hit) this.applyMaMocLifeSteal(slot, Math.max(0, hpBefore - target.hp()));
  }

  /** Quỷ Mị / Hỗn Loạn turned the skill on its user: its own damage, none of its effects. */
  private selfHit(slot: DoubleSlot, skillId: number, actedFirst: boolean): void {
    const self = this.unit(slot),
      outcome = resolveSelfHitDamage(
        this.rules,
        self,
        skillId,
        this.setupOf(slot).spriteId ?? -2,
        actedFirst,
        (label) => this.random.percent(`battle.2v2.selfHit.${label}`),
      ),
      landed = this.maMoc
        ? this.projectMaMocDamage(self, skillId, self, outcome.damage)
        : outcome.damage;
    self.damage(landed);
    this.emit({
      type: "strike",
      slot,
      target: slot,
      receiver: slot,
      skillId,
      hit: true,
      damage: landed,
      crit: outcome.critFlag === 1,
      receiverHp: self.hp(),
      actorHp: self.hp(),
      secondary: false,
    });
  }

  /** A queued item resolves: the player's from the bag (re-checked), the NPC's virtually. */
  private resolveItem(action: QueuedAction): void {
    const targetUnit = action.playerItem
        ? this.playerUnits[action.itemMember]
        : this.unit(action.targetSlot),
      targetSlot = this.slotOfUnit(targetUnit),
      item = this.deps.items.get(action.itemId);
    // `tickAction`: a sealed item is refused without touching the bag.
    if (action.playerItem && this.isMaMocBlockedItem(action.itemId)) {
      this.emit({ type: "sealedItem", slot: action.actorSlot, itemId: action.itemId });
      return;
    }
    if (action.playerItem) {
      const why =
        (this.inventory[action.itemId] ?? 0) <= 0
          ? "Đã không có đạo này cụ, thỉnh mua sắm"
          : item
            ? this.deps.items.refusal(item, targetUnit, undefined, (id) => this.ppMax(id))
            : "Trong chiến đấu không thể sử dụng";
      if (why) {
        this.emit({
          type: "item",
          slot: action.actorSlot,
          target: targetSlot,
          itemId: action.itemId,
          hpGained: 0,
          ppGained: 0,
          revived: false,
          refused: why,
        });
        return;
      }
    }
    if (!item || item.kind !== "recovery") return;
    const healSlot = targetSlot >= 0 ? targetSlot : action.actorSlot,
      result = this.deps.items.apply(
        item,
        targetUnit,
        undefined,
        (id) => this.ppMax(id),
        (amount) =>
          this.projection.projectReceivedHealing(
            action.actor,
            action.actorSlot,
            targetUnit,
            healSlot,
            this.turn,
            this.actionIndex,
            amount,
          ),
        this.rules.status,
      );
    if (result.hpGained > 0) this.projection.afterHealing(targetUnit, healSlot, this.turn);
    if (action.playerItem) this.inventory[action.itemId]--;
    this.emit({
      type: "item",
      slot: action.actorSlot,
      target: targetSlot,
      itemId: action.itemId,
      ...result,
    });
    if (action.playerItem) {
      const recovery = applyCauVongItemRecovery(this.setup, item, [this.unit(0), this.unit(1)], this.enemyUnits, (id) => this.ppMax(id));
      if (recovery) {
        const { target, ...gained } = recovery;
        const slot = this.slotOfUnit(target);
        if (slot >= 0 && gained.hpGained > 0) this.projection.afterHealing(target, slot, this.turn);
        this.emit({ type: "item", slot: action.actorSlot, target: slot, itemId: action.itemId, cauVongRecovery: { speciesId: target.speciesId }, ...gained });
      }
    }
  }

  // ------------------------------------------------------------------ targets and power

  private scope(skillId: number): "ALL_ENEMIES" | "ALL_ALLIES" | "SINGLE" {
    return this.deps.skillRules.scopes[String(skillId)] ?? "SINGLE";
  }

  private powerPercent(skillId: number): number {
    return this.rules.damage.skillRow(skillId)?.powerPercent ?? 0;
  }

  /** `groupSecondaryTarget`: the other living slot of the side a group skill covers. */
  private groupSecondaryTarget(
    actorSlot: DoubleSlot,
    primary: DoubleSlot,
    skillId: number,
  ): number {
    // Tàn Nguyệt Long Ma's every damaging skill sweeps both player slots.
    if (
      this.maMoc &&
      actorSlot < 2 &&
      isTanNguyetBoss(this.unit(actorSlot)) &&
      this.powerPercent(skillId) > 0
    )
      return ([2, 3] as const).find((slot) => slot !== primary && this.unit(slot).alive()) ?? -1;
    const scope = this.scope(skillId);
    if (scope === "SINGLE") return -1;
    const side = scope === "ALL_ALLIES" ? OWN_SIDE(actorSlot) : OTHER_SIDE(actorSlot);
    return side.find((slot) => slot !== primary && this.unit(slot).alive()) ?? -1;
  }

  /** `BattleUnit.secondarySkillPowerPercent`: the resolved Power scaled, rounded half up, at least 1. */
  private secondaryPowerPercent(
    attacker: DesignTraitUnit,
    target: DesignTraitUnit,
    skillId: number,
    fraction: number,
  ): number {
    const row = this.rules.damage.skillRow(skillId);
    if (!row || row.powerPercent <= 0) return 0;
    const resolved =
      this.rules.damage.lietHoaResolvedPower(skillId, {
        speciesId: target.speciesId,
        attack: target.currentStats.attack,
        defense: target.currentStats.defense,
        visualSpriteId: -2,
        unit: target,
      }) ??
      this.web.rainbow?.resolvedPower(attacker, target, skillId) ??
      row.powerPercent;
    return Math.max(1, Math.trunc((resolved * Math.max(0, fraction) + 50) / 100));
  }

  /** `chooseAiTarget`: the legal target `(turn + slot) mod n`. */
  private chooseAiTarget(actorSlot: DoubleSlot, skillId: number): DoubleSlot | -1 {
    const targets = this.legalTargets(actorSlot, skillId);
    return targets.length === 0
      ? -1
      : targets[(((this.turn + actorSlot) % targets.length) + targets.length) % targets.length];
  }

  // ------------------------------------------------------------------ replacements

  private firstDeadEnemySlotWithReserve(): number {
    if (this.firstLivingEnemyReserve() < 0) return -1;
    if (!this.unit(0).alive()) return 0;
    return this.unit(1).alive() ? -1 : 1;
  }

  private firstDeadPlayerSlotWithReserve(): number {
    if (!this.unit(2).alive() && this.hasLivingPlayerReserve()) return 2;
    if (!this.unit(3).alive() && this.setup.controlsBoth && this.hasLivingPlayerReserve()) return 3;
    return !this.unit(3).alive() &&
      !this.setup.controlsBoth &&
      this.firstLivingCompanionReserve() >= 0
      ? 3
      : -1;
  }

  private firstLivingEnemyReserve(): number {
    const active = [this.occupants[0].index, this.occupants[1].index];
    return this.enemyUnits.findIndex((unit, index) => !active.includes(index) && unit.alive());
  }

  private firstLivingCompanionReserve(): number {
    const active = this.occupants[3]?.side === "companion" ? this.occupants[3].index : -1;
    return this.companionUnits.findIndex((unit, index) => index !== active && unit.alive());
  }

  private benched(member: number): boolean {
    return !(
      (this.occupants[2]?.side === "player" && this.occupants[2].index === member) ||
      (this.occupants[3]?.side === "player" && this.occupants[3].index === member)
    );
  }

  private hasLivingPlayerReserve(): boolean {
    return this.playerUnits.some((unit, member) => this.benched(member) && unit.alive());
  }

  private requireBenched(member: number): void {
    const unit = this.playerUnits[member];
    if (!unit) throw new BattleCommandError("Không có sủng vật có thể thay đổi");
    if (!this.benched(member))
      throw new BattleCommandError("Sủng vật này đã đặt ở vị trí chiến đấu");
    if (!unit.alive()) throw new BattleCommandError("Sủng vật này không thể tham chiến");
  }

  /**
   * `beginForcedReplacement`: an NPC slot or the companion's is refilled at once; a player slot asks.
   * True while the fight now waits for the player.
   */
  private forcedReplacement(slot: DoubleSlot, then: Continuation, pivot = false): boolean {
    if (slot < 2) {
      if (this.firstLivingEnemyReserve() >= 0) this.replaceEnemy(slot);
      return false;
    }
    if (slot === 3 && !this.setup.controlsBoth) {
      const next = this.firstLivingCompanionReserve();
      if (next >= 0) this.replaceCompanion(next, true);
      return false;
    }
    if (pivot && !this.hasLivingPlayerReserve()) return false;
    this.continuation = then;
    this.openRequest = { kind: "replacement", slot: slot as PlayerSlot };
    return true;
  }

  private continueAfterReplacement(): void {
    const then = this.continuation;
    if (then === "BEGIN_COMMANDS") this.beginPlayerDecisions();
    else this.resolve();
  }

  /** `startReplacement`: a benched player pet takes slot 2 or 3. */
  private replacePlayer(slot: PlayerSlot, member: number, forced: boolean): void {
    const from = this.occupants[slot],
      previous = this.unit(slot),
      next = this.playerUnits[member];
    this.occupants[slot] = { side: "player", index: member };
    next.formationSlot = slot;
    if (!this.participants.includes(member)) this.participants.push(member);
    this.selections[slot - 2] = null;
    this.projection.onSwitch(previous, next, slot, this.turn, this.actionIndex, !previous.alive());
    previous.signatureState.pendingPivot = false;
    this.emit({ type: "replacement", slot, from, to: this.occupants[slot], forced });
  }

  private replaceCompanion(index: number, forced: boolean): void {
    const from = this.occupants[3],
      previous = this.unit(3),
      next = this.companionUnits[index];
    this.occupants[3] = { side: "companion", index };
    next.formationSlot = 3;
    this.projection.onSwitch(previous, next, 3, this.turn, this.actionIndex, !previous.alive());
    this.emit({ type: "replacement", slot: 3, from, to: this.occupants[3], forced });
  }

  /** `startEnemyReplacement`: the first living benched NPC pet. */
  private replaceEnemy(slot: DoubleSlot): void {
    const index = this.firstLivingEnemyReserve();
    if (index < 0) return;
    const from = this.occupants[slot],
      previous = this.unit(slot),
      next = this.enemyUnits[index];
    this.occupants[slot] = { side: "enemy", index };
    next.formationSlot = slot;
    this.projection.onSwitch(previous, next, slot, this.turn, this.actionIndex, !previous.alive());
    previous.signatureState.pendingPivot = false;
    this.emit({ type: "replacement", slot, from, to: this.occupants[slot], forced: true });
  }

  /** `finishAction`'s pivot: a signature that pulls its user out after the hit, when a bench is there. */
  private pivotSlot(actor: DesignTraitUnit, slot: DoubleSlot): number {
    if (!actor.signatureState.pendingPivot) return -1;
    if (!actor.alive() || this.unit(slot) !== actor) {
      actor.signatureState.pendingPivot = false;
      return -1;
    }
    const reserve =
      slot >= 2
        ? slot === 2 || this.setup.controlsBoth
          ? this.hasLivingPlayerReserve()
          : this.firstLivingCompanionReserve() >= 0
        : this.firstLivingEnemyReserve() >= 0;
    if (!reserve) {
      actor.signatureState.pendingPivot = false;
      return -1;
    }
    return slot;
  }

  // ------------------------------------------------------------------ faints and the end

  private knockOut(slot: DoubleSlot): void {
    const unit = this.unit(slot);
    if (unit.alive() || this.fainted.has(unit)) return;
    // The fall the boss's one revive answers before its death plays (`tryTanNguyetLongMaRevive`).
    if (this.tryMaMocRevive(slot)) return;
    this.fainted.add(unit);
    unit.clearStatusesOnDeath();
    this.emit({ type: "faint", slot });
  }

  /** `tryRainbowCharmRevive`. */
  private charmRevive(slot: DoubleSlot): void {
    const unit = this.unit(slot),
      charms = this.charmsFor(unit);
    if (!charms || unit.alive()) return;
    const roll = charms.hasMechanic("BATTLE_REVIVE")
        ? this.random.percent("battle.2v2.rainbowCharm.revive")
        : -1,
      hp = charms.tryRevive(unit, roll);
    if (hp <= 0) return;
    this.fainted.delete(unit);
    if (unit.ownerSide === 1) this.projection.afterHealing(unit, slot, this.turn);
    this.emit({ type: "charmRevive", slot, hp });
  }

  /** `battleFinished`: both NPC slots and the bench down, or both player slots down. */
  private battleFinished(): boolean {
    if (this.npcCharms) for (const slot of [0, 1] as const) this.charmRevive(slot);
    if (this.reviveFallenMaMocBoss()) return false;
    if (!this.unit(0).alive() && !this.unit(1).alive() && this.firstLivingEnemyReserve() < 0) {
      if (this.setup.experienceAllowed !== false) this.awardExperience();
      this.end("player");
      return true;
    }
    if (!this.unit(2).alive() && !this.unit(3).alive()) {
      this.end("enemy");
      return true;
    }
    return false;
  }

  /**
   * `awardExp`: every living entered participant earns the whole defeated roster, shared by the
   * living count; a benched pet with held item 6 earns its share at the last participant's level.
   */
  private awardExperience(): void {
    const living = this.participants.filter((member) => this.playerUnits[member].alive());
    if (living.length === 0) return;
    for (const member of living) {
      const unit = this.playerUnits[member],
        held5 = unit.hasHeldItem(5),
        trait = this.projection.projectExperience(
          unit,
          unit.formationSlot,
          this.turn,
          this.actionIndex,
        );
      let amount = 0;
      this.setup.enemy.forEach((enemy) => {
        amount += expAward({
          enemyLevel: enemy.level,
          enemyNature: enemy.nature,
          levelFactorLevel: this.setup.player[member].level,
          participantCount: living.length,
          divisor: 1000,
          heldItem5: held5,
          heldItem5Multiplier: held5 ? unit.heldItemParam(5, 5, 0) : 0,
          experienceMultiplierPercent: trait.multiplierPercent,
          experienceMultiplierStackable: trait.stackable,
        });
      });
      this.experience[member] += amount;
      this.emit({ type: "experience", member, amount, reserve: false });
    }
    const lastLevel = this.setup.player[living[living.length - 1]].level;
    this.playerUnits.forEach((unit, member) => {
      if (this.participants.includes(member) || !unit.alive()) return;
      const share = decideReserveShare({ globalShare: false, goldenSharePercent: this.setup.goldenPartyExperiencePercent, heldItem6: unit.hasHeldItem(6) });
      if (share.outcome === "SKIP") return;
      const trait = this.projection.projectExperience(
        unit,
        unit.formationSlot,
        this.turn,
        this.actionIndex,
      );
      let amount = 0;
      this.setup.enemy.forEach((enemy) => {
        amount += reserveExpAward({
          enemyLevel: enemy.level,
          enemyNature: enemy.nature,
          levelFactorLevel: lastLevel,
          participantCount: living.length,
          divisor: share.divisor,
          heldItem5: false,
          heldItem5Multiplier: 0,
          experienceMultiplierPercent: trait.multiplierPercent,
          experienceMultiplierStackable: trait.stackable,
        }, share);
      });
      this.reserveExperience[member] += amount;
      this.emit({ type: "experience", member, amount, reserve: true });
    });
  }

  private end(winner: DoubleOutcome["winner"]): void {
    for (const unit of [...this.playerUnits, ...this.companionUnits, ...this.enemyUnits])
      unit.clearBuffsAtBattleEnd();
    const outcome: DoubleOutcome = {
      winner,
      experience: [...this.experience],
      reserveExperience: [...this.reserveExperience],
    };
    this.actions = [];
    this.openRequest = { kind: "ended", outcome };
    this.emit({ type: "end", outcome });
  }

  // ------------------------------------------------------------------ AI

  private liveOf(unit: DesignTraitUnit, level: number): LiveBattleAiUnit {
    let live = this.live.get(unit);
    if (!live) {
      live = new LiveBattleAiUnit(unit, level, this.rules.status, this.deps.rulebook);
      this.live.set(unit, live);
    }
    return live;
  }

  private liveSlot(slot: DoubleSlot): LiveBattleAiUnit {
    return this.liveOf(this.unit(slot), this.setupOf(slot).level);
  }

  private slotOfLive(target: unknown): number {
    for (const slot of SLOTS) if (this.live.get(this.unit(slot)) === target) return slot;
    return -1;
  }

  private slotOfUnit(unit: DesignTraitUnit): DoubleSlot | -1 {
    return SLOTS.find((slot) => this.unit(slot) === unit) ?? -1;
  }

  /** `chooseAiDecision`: the source-v1 engine over both allies and both opponents. */
  private decide(slot: DoubleSlot, profile: PackBattleAiProfile, budget: number): BattleAiDecision {
    const own = OWN_SIDE(slot).map((at) => this.liveSlot(at)),
      opponents = OTHER_SIDE(slot).map((at) => this.liveSlot(at)),
      actor = this.unit(slot),
      tier = tierOfProfile(profile);
    return new BattleAiDecisionEngine(this.deps.rulebook).decide({
      actor: this.liveSlot(slot),
      allies: own,
      opponents,
      reserves: [],
      profile,
      itemOptions: budget > 0 ? (this.itemOptions ??= this.deps.rulebook.itemLoadoutOptions()) : [],
      itemBudgetRemaining: budget,
      lastSkillId: this.lastSkill.get(actor) ?? -1,
      repeatedUses: this.repeatCount.get(actor) ?? 0,
      turn: this.turn,
      turnsSinceSwitch: INT_MAX,
      roller: {
        nextInt: (label, bound) =>
          this.random.next(`battle.ai.2v2.${tier}.slot${slot}.${label}`, bound),
      },
    });
  }

  private rememberSkill(unit: DesignTraitUnit, skillId: number): void {
    const repeated =
      (this.lastSkill.get(unit) ?? -1) === skillId ? (this.repeatCount.get(unit) ?? 0) + 1 : 1;
    this.lastSkill.set(unit, skillId);
    this.repeatCount.set(unit, repeated);
  }

  /** `inspectAiV2JointRound`: the coordinated pair, or both source decisions unchanged. */
  private jointRound(decisions: BattleAiDecision[]): (BattleAiDecision | null)[] {
    if (!this.mode.shadowEnabled || !this.spec || !this.memory || !this.setup.encounterKey)
      return decisions;
    const inputs = [this.aiInput(0), this.aiInput(1)],
      keys = [this.actionKey(decisions[0]), this.actionKey(decisions[1])];
    try {
      const proposal = this.joint.inspect(inputs, decisions, keys),
        selected = proposal.selectedCandidate;
      this.jointTrace.push(
        `joint round candidates=${proposal.rankedCandidates.length} selectedV2=${selected?.jointActionKey ?? "none"} individualUtility=${selected?.individualUtility ?? "none"} coordinationUtility=${selected?.coordinationUtility ?? "none"}`,
      );
      if (!this.mode.gameplayCommitEnabled) return decisions;
      const commit = this.joint.project(this.mode, this.deps.catalog, inputs, proposal, decisions);
      this.jointTrace.push(`joint commit reason=${commit.reason}`);
      return [...commit.decisions];
    } catch (error) {
      if (!this.mode.gameplayCommitEnabled) throw error;
      return decisions;
    }
  }

  /** `aiV2Input(slot)`: the whole NPC roster, both player slots visible. */
  private aiInput(slot: 0 | 1): BattleAiObservationInput {
    const own: OwnedUnit[] = this.enemyUnits.map((unit, index) => ({
      actorKey: BattleAiActorKey.npcMember(index + 1),
      memberSlot: index + 1,
      unit: this.liveOf(unit, this.setup.enemy[index].level),
      active: index === this.occupants[0].index || index === this.occupants[1].index,
    }));
    return new BattleAiObservationInput(
      this.spec!,
      Math.max(1, this.turn),
      this.actorKey(slot),
      own,
      [
        { actorKey: this.actorKey(2), unit: this.liveSlot(2) },
        { actorKey: this.actorKey(3), unit: this.liveSlot(3) },
      ],
      this.memory!,
      this.deps.catalog.items(this.setup.encounterKey!),
    );
  }

  /** `aiV2ActorKey`. */
  private actorKey(slot: DoubleSlot): BattleAiActorKey {
    const at = this.occupants[slot];
    if (slot < 2) return BattleAiActorKey.npcMember(at.index + 1);
    if (at.side === "player") return BattleAiActorKey.playerMember(at.index + 1);
    return BattleAiActorKey.playerMember(Math.max(1, slot - 2 + 1));
  }

  /** `aiV2ProductionActionKey`. */
  private actionKey(decision: BattleAiDecision): string {
    const slot = this.slotOfLive(decision.target);
    if (decision.type === "SKILL") {
      const key = this.deps.rulebook.unifiedSkill(decision.skillId)?.stableKey;
      return slot < 0 || !key ? "" : `SKILL:${key}:${this.actorKey(slot as DoubleSlot).toString()}`;
    }
    if (decision.type === "ITEM") {
      const key = this.deps.rulebook.bagItemKey(decision.itemId);
      return slot >= 0 && key ? `ITEM:${key}:${this.actorKey(slot as DoubleSlot).toString()}` : "";
    }
    return "";
  }

  /** `observeAiV2ResolvedAction`. */
  private observeAction(actorSlot: DoubleSlot, receiverSlot: DoubleSlot, skillId: number): void {
    const memory = this.memory;
    if (!memory) return;
    const turn = Math.max(1, this.turn),
      actor = this.actorKey(actorSlot),
      receiverKey = this.actorKey(receiverSlot),
      receiver = this.unit(receiverSlot),
      last = this.log[this.log.length - 1],
      committed = last?.type === "strike" && last.hit ? last.damage : 0,
      key = this.deps.rulebook.unifiedSkill(skillId)?.stableKey;
    if (key) memory.observeSkill(turn, actor, key, committed > 0);
    if (committed > 0) memory.observeDamage(turn, actor, receiverKey, committed);
    const pad = (id: number) => String(id).padStart(2, "0");
    for (const id of receiver.activeStatusIds(0))
      memory.observeStatus(turn, actor, receiverKey, `BUFF-${pad(id)}`);
    for (const id of receiver.activeStatusIds(1))
      memory.observeStatus(turn, actor, receiverKey, `DEBUFF-${pad(id)}`);
    for (const id of receiver.activeStatusIds(2))
      memory.observeStatus(turn, actor, receiverKey, `RAINBOW-${pad(id)}`);
    if (!receiver.alive()) memory.observeKnockout(turn, receiverKey);
  }

  private observeItem(slot: DoubleSlot, itemId: number): void {
    const key = this.deps.rulebook.bagItemKey(itemId);
    if (this.memory && key)
      this.memory.observeItem(Math.max(1, this.turn), this.actorKey(slot), key);
  }

  // ------------------------------------------------------------------ charms

  private charmsFor(unit: DesignTraitUnit): RainbowCharmBattleState | undefined {
    return unit.ownerSide === 1 ? this.npcCharms : this.setup.charms?.player;
  }

  /**
   * `enter`'s charm pass: the NPC's set drawn and applied to its roster, the player's applied to every
   * battle owner; the NPC's Phong Bế rolls for every player pet and companion, the player's for the
   * two opening NPC slots.
   */
  private enterCharms(): void {
    const charmRoll = (label: string) => this.random.percent(label);
    this.npcCharms = this.setup.charms?.enemy?.(
      (bound) => this.random.next("battle.2v2.npcCharm.select", bound),
      this.setup.enemy.map((pet) => pet.speciesId),
    );
    if (this.npcCharms)
      for (const unit of this.enemyUnits) this.npcCharms.applyUnitModifiers(unit, charmRoll);
    const player = this.setup.charms?.player;
    if (player) for (const unit of this.playerUnits) player.applyUnitModifiers(unit, charmRoll);
    const usable = (unit: DesignTraitUnit, slot: number) =>
      this.web.skillUsable(this.rules.damage.skillRow(unit.skillIds[slot]), unit);
    if (this.npcCharms) {
      if (player)
        for (const unit of this.companionUnits) player.applyUnitModifiers(unit, charmRoll);
      if (this.npcCharms.hasMechanic("SKILL_SEAL"))
        for (const unit of [...this.playerUnits, ...this.companionUnits])
          this.npcCharms.trySeal(
            unit,
            this.random.percent("battle.2v2.npcCharm.skillSeal"),
            usable,
          );
    }
    if (player)
      for (const slot of [0, 1] as const) {
        const roll = player.hasMechanic("SKILL_SEAL")
          ? this.random.percent(`battle.2v2.rainbowCharm.skillSeal.slot${slot}`)
          : -1;
        player.trySeal(this.unit(slot), roll, usable);
      }
  }

  // ------------------------------------------------------------------ Tàn Nguyệt Long Ma

  /** `maMocBoss` / `maMocHoa`: the boss and Hoa Tiên Tử in the NPC slots. */
  private maMocBoss(): DesignTraitUnit | undefined {
    return ([0, 1] as const).map((slot) => this.unit(slot)).find((unit) => isTanNguyetBoss(unit));
  }
  private maMocHoa(): DesignTraitUnit | undefined {
    return ([0, 1] as const).map((slot) => this.unit(slot)).find((unit) => isHoaTienTu(unit));
  }
  /** `maMocBothAlive`: Ma Mộc Cộng Sinh holds while both stand. */
  private maMocBothAlive(): boolean {
    if (!this.maMoc) return false;
    const boss = this.maMocBoss(),
      hoa = this.maMocHoa();
    return !!boss && boss.alive() && !!hoa && hoa.alive();
  }

  /** `projectMaMocIncomingDamage`. */
  private projectMaMocIncoming(target: StatusUnitLike, damage: number, skillId = -1): number {
    if (!this.maMoc) return damage;
    return reduceIncomingDamage(target, damage, this.maMocBothAlive(), skillId);
  }

  /**
   * `projectMaMocHoaFireNeutralDamage` then `projectMaMocIncomingDamage`: a Hỏa hit that finds Hoa
   * Tiên Tử's weakness lands for a third, and the boss takes its reduction.
   */
  private projectMaMocDamage(
    attacker: StatusUnitLike,
    skillId: number,
    target: StatusUnitLike,
    damage: number,
  ): number {
    let projected = Math.max(0, damage);
    if (this.maMoc && isHoaTienTu(target) && projected > 0) {
      const row = this.rules.damage.skillRow(skillId),
        explicitFire = !!row && row.elementFamily === 0,
        legacyFire =
          !!row &&
          row.damageBranch === "liet-hoa" &&
          this.rules.damage.speciesRelation(attacker.speciesId, target.speciesId) === 0;
      if (
        (explicitFire || legacyFire) &&
        this.rules.damage.relationFor(attacker.speciesId, target.speciesId, skillId) === 0
      )
        projected = Math.max(1, Math.trunc(projected / 3));
    }
    return this.projectMaMocIncoming(target, projected, skillId);
  }

  /** `projectBattleHealing`'s gate: Hoa Tiên Tử heals nothing while it pays for the rescue. */
  private maMocHealing(source: StatusUnitLike, amount: number): number {
    return this.maMoc && isHoaTienTu(source) && this.maMocHoaRecoveryActionsRemaining > 0
      ? 0
      : amount;
  }
  private maMocHealGate(unit: StatusUnitLike): ((amount: number) => number) | undefined {
    return this.maMoc ? (amount) => this.maMocHealing(unit, amount) : undefined;
  }

  /** `maMocStatusAttemptBridge`: Hoa Tiên Tử's control lands 20 points likelier while both stand. */
  private maMocStatusChanceBonus(actor: StatusUnitLike): number {
    return this.maMoc && this.maMocBothAlive() && isHoaTienTu(actor)
      ? MA_MOC.hoaControlChanceBonus
      : 0;
  }

  /** `applyTanNguyetLongMaLifeSteal`, with Hoa Tiên Tử's share once a round. */
  private applyMaMocLifeSteal(actorSlot: DoubleSlot, committed: number): void {
    if (!this.maMoc || committed <= 0) return;
    const actor = this.unit(actorSlot),
      bothAlive = this.maMocBothAlive(),
      healed = applyLifeSteal(actor, committed, bothAlive);
    if (healed <= 0) return;
    let shared = 0,
      sharedSlot: DoubleSlot | -1 = -1;
    if (bothAlive && this.maMocSharedHealTurn !== this.turn) {
      const hoa = this.maMocHoa();
      shared = shareLifeStealWithHoa(hoa, healed);
      this.maMocSharedHealTurn = this.turn;
      if (shared > 0 && hoa) sharedSlot = this.slotOfUnit(hoa);
    }
    this.emit({ type: "lifeSteal", slot: actorSlot, amount: healed, shared, sharedSlot });
  }

  /** `tryTanNguyetLongMaRevive`: once, at half HP; Hoa Tiên Tử pays 30% HP and its speed if it stands. */
  private tryMaMocRevive(slot: DoubleSlot): boolean {
    if (!this.maMoc) return false;
    const unit = this.unit(slot),
      hoa = this.maMocHoa(),
      rescued = isTanNguyetBoss(unit) && !this.maMocRevived && !!hoa && hoa.alive();
    let cost = 0;
    if (rescued && hoa) {
      cost = payHoaRescueCost(hoa);
      applyHoaSpeedPenalty(hoa);
      this.maMocHoaRecoveryActionsRemaining = MA_MOC.hoaRescuePenaltyActions;
    }
    const restored = reviveAtHalfHp(unit, this.maMocRevived);
    if (restored <= 0) return false;
    this.maMocRevived = true;
    this.fainted.delete(unit);
    this.emit({
      type: "bossRevive",
      slot,
      hp: restored,
      hoaSlot: rescued && hoa ? this.slotOfUnit(hoa) : -1,
      hoaCost: cost,
    });
    return true;
  }

  /** The gate `tickResolve` and `battleFinished` open with: a fallen boss takes its one revive. */
  private reviveFallenMaMocBoss(): boolean {
    if (!this.maMoc) return false;
    const boss = this.maMocBoss();
    if (!boss || boss.alive()) return false;
    const slot = this.slotOfUnit(boss);
    return slot >= 0 && this.tryMaMocRevive(slot as DoubleSlot);
  }

  /** `updateMaMocState`: Hoa Tiên Tử fell — the boss turns Cuồng Nộ to the end, once. */
  private updateMaMocState(): void {
    if (!this.maMoc || this.maMocHoaDeathHandled) return;
    const hoa = this.maMocHoa(),
      boss = this.maMocBoss();
    if (!hoa || !boss || hoa.alive()) return;
    this.maMocHoaDeathHandled = true;
    if (!boss.alive()) return;
    applyEnrage(boss);
    const slot = this.slotOfUnit(boss);
    if (slot !== -1) this.emit({ type: "bossEnrage", slot });
  }

  /**
   * `finishAction`'s boss steps: the boss sheds Quỷ Kính, the Ma Mộc state is read again, and Hoa
   * Tiên Tử's own action counts down its rescue penalty (`afterMaMocActorAction`).
   */
  private afterMaMocAction(action: QueuedAction): void {
    if (!this.maMoc) return;
    for (const slot of SLOTS) removeGhostMirror(this.unit(slot));
    this.updateMaMocState();
    if (action.groupSecondary || !isHoaTienTu(action.actor)) return;
    if (this.maMocHoaRecoveryActionsRemaining <= 0) return;
    this.maMocHoaRecoveryActionsRemaining--;
    if (this.maMocHoaRecoveryActionsRemaining === 0) clearHoaSpeedPenalty(action.actor);
  }

  /** `isMaMocBlockedItem`. */
  private isMaMocBlockedItem(itemId: number): boolean {
    return this.maMoc && MA_MOC_BLOCKED_ITEM_KEYS.includes(this.deps.rulebook.bagItemKey(itemId));
  }

  /** `chooseMaMocDecision`: the boss pair's script. */
  private chooseMaMocDecision(slot: 0 | 1): BattleAiDecision {
    const actor = this.unit(slot),
      targetSlot = this.lowestHpLivingPlayer(false);
    if (!actor.alive() || targetSlot < 0) return AiDecision.none("ma-moc-no-legal-action");
    const target = this.unit(targetSlot as DoubleSlot),
      live = (at: number) => this.liveSlot(at as DoubleSlot);
    if (isHoaTienTu(actor)) {
      if (
        shouldPrioritizeBaoPhong(target) &&
        this.maMocCanUse(actor, MA_MOC_SKILL.baoPhongToanTran)
      )
        return AiDecision.skill(
          MA_MOC_SKILL.baoPhongToanTran,
          live(targetSlot),
          600,
          "ma-moc-finish-low-hp-with-bao-phong",
        );
      const boss = this.maMocBoss(),
        bothAlive = this.maMocBothAlive(),
        allySlot = (unit: DesignTraitUnit | undefined) => (unit ? this.slotOfUnit(unit) : -1);
      if (this.maMocHoaRecoveryActionsRemaining <= 0) {
        const healing = bothAlive ? boss : actor;
        if (
          healing &&
          hpPercentValue(healing) <= 70 &&
          this.maMocCanUse(actor, MA_MOC_SKILL.thaoNguyenThuat)
        )
          return AiDecision.skill(
            MA_MOC_SKILL.thaoNguyenThuat,
            live(allySlot(healing)),
            500,
            "ma-moc-heal-low-hp",
          );
      }
      const buff = bothAlive ? boss : actor;
      if (
        buff &&
        (this.turn === 1 || this.turn % 3 === 1) &&
        this.maMocCanUse(actor, MA_MOC_SKILL.dangChiBichLuy)
      )
        return AiDecision.skill(
          MA_MOC_SKILL.dangChiBichLuy,
          live(allySlot(buff)),
          450,
          "ma-moc-defense-reflect",
        );
      const control = this.turn % 2 === 0 ? MA_MOC_SKILL.vanMocTanThuc : MA_MOC_SKILL.dangPhuoc;
      return this.maMocSkillDecision(actor, control, targetSlot, "ma-moc-control");
    }
    if (isTanNguyetBoss(actor)) {
      const ghost = this.lowestHpLivingPlayer(true);
      if (ghost >= 0 && this.maMocCanUse(actor, MA_MOC_SKILL.toanTinhLietPha))
        return AiDecision.skill(
          MA_MOC_SKILL.toanTinhLietPha,
          live(ghost),
          700,
          "ma-moc-pierce-ghost-target",
        );
      const skill =
        actor.activeDebuffCount() > 0
          ? MA_MOC_SKILL.thanhDucXaToi
          : hpPercentValue(target) <= 50
            ? MA_MOC_SKILL.loiNguyenCuoiCung
            : this.turn === 1 || this.turn % 3 === 0
              ? MA_MOC_SKILL.chuPhuocQuyLao
              : MA_MOC_SKILL.longQuyenPhongToa;
      return this.maMocSkillDecision(actor, skill, targetSlot, "ma-moc-long-ma-assault");
    }
    return AiDecision.none("ma-moc-unknown-actor");
  }

  /** `maMocSkillDecision`: the wanted skill, or the first usable one when it cannot be cast. */
  private maMocSkillDecision(
    actor: DesignTraitUnit,
    preferred: number,
    targetSlot: number,
    rationale: string,
  ): BattleAiDecision {
    const skill = this.maMocCanUse(actor, preferred) ? preferred : this.firstUsableSkillId(actor);
    return skill < 0
      ? AiDecision.none("ma-moc-no-pp")
      : AiDecision.skill(skill, this.liveSlot(targetSlot as DoubleSlot), 400, rationale);
  }

  /** `maMocCanUse`: PP left on that skill and nothing sealing it. */
  private maMocCanUse(actor: DesignTraitUnit, skillId: number): boolean {
    const slot = actor.skillIds.indexOf(skillId);
    return (
      slot >= 0 &&
      actor.skillPp[slot] > 0 &&
      this.web.skillUsable(this.rules.damage.skillRow(skillId), actor)
    );
  }

  /** `usableSkillIdAt(0)`: the first skill with PP that may be cast, or -1. */
  private firstUsableSkillId(actor: DesignTraitUnit): number {
    const usable = this.usableSlots(actor)[0];
    return usable ? actor.skillIds[usable.index] : -1;
  }

  /** `lowestHpLivingPlayer` / `lowestHpLivingGhostPlayer`: slot 2 first on a tie. */
  private lowestHpLivingPlayer(ghostOnly: boolean): number {
    let result = -1;
    for (const slot of [2, 3] as const) {
      const unit = this.unit(slot);
      if (!unit.alive()) continue;
      if (ghostOnly && this.deps.rulebook.elementForSpecies(unit.speciesId) !== MA_MOC.ghostElement)
        continue;
      if (result < 0 || hpPercentValue(unit) < hpPercentValue(this.unit(result as DoubleSlot)))
        result = slot;
    }
    return result;
  }

  // ------------------------------------------------------------------ helpers

  private build(pet: CombatantSetup, ownerSide: number): DesignTraitUnit {
    const unit = this.rules.traits.unit({
      speciesId: pet.speciesId,
      ownerSide,
      formationSlot: -1,
      base: pet.stats,
      wideStats: pet.wideStats,
      physicalTraitId: pet.physicalTraitId,
      heldItemId: pet.heldItemId,
    });
    if (this.setup.permanentStatsApplied) unit.traitBattleState.markPermanentStatsApplied();
    unit.restoreStatsForCheck();
    if (pet.statFactors) this.projection.applyEncounterStatFactors(unit, pet.statFactors);
    if (pet.hp !== undefined) unit.setHp(Math.max(0, Math.min(unit.maxHp(), pet.hp)));
    for (let slot = 0; slot < unit.skillIds.length; slot++) {
      const skillId = pet.skillIds[slot] ?? EMPTY_SKILL;
      unit.skillIds[slot] = skillId;
      unit.skillPp[slot] = skillId < 0 ? 0 : (pet.skillPp?.[slot] ?? this.ppMax(skillId));
    }
    // `enter` → `configureEncounterUnit`: the talent's permanent share first (`enemyFromEncounter`),
    // then the boss stats and the authored deck on top, at full HP and full PP.
    const deck = this.maMoc && ownerSide === 1 ? maMocBattleDeck(unit.speciesId) : undefined;
    if (deck) {
      if (!this.setup.permanentStatsApplied) this.projection.applyPermanentStatsBeforeEntry(unit);
      configureMaMocUnit(unit);
      for (let slot = 0; slot < unit.skillIds.length; slot++) {
        const skillId = deck[slot] ?? EMPTY_SKILL;
        unit.skillIds[slot] = skillId;
        unit.skillPp[slot] = skillId < 0 ? 0 : this.ppMax(skillId);
      }
    }
    return unit;
  }

  private queued(actorSlot: DoubleSlot, targetSlot: DoubleSlot, skillId: number): QueuedAction {
    return {
      actorSlot,
      targetSlot,
      skillId,
      actor: this.unit(actorSlot),
      groupSecondary: false,
      secondaryPowerPercent: 0,
      itemId: -1,
      playerItem: false,
      itemMember: -1,
    };
  }

  private usableSlots(unit: DesignTraitUnit): { index: number; damaging: boolean }[] {
    return unit.skillIds.flatMap((id, index) => {
      if (id < 0 || unit.skillPp[index] <= 0) return [];
      const row = this.rules.damage.skillRow(id);
      if (!row || !this.web.skillUsable(row, unit)) return [];
      return [{ index, damaging: row.powerPercent > 0 }];
    });
  }

  /** `resolveDebuffSource`: the slot a status names, if its owner still stands there. */
  private resolveSource(sourceSide: number, sourceSlot: number): DesignTraitUnit | undefined {
    if (sourceSlot < 0 || sourceSlot > 3) return undefined;
    const unit = this.unit(sourceSlot as DoubleSlot);
    return unit.ownerSide === sourceSide && sourceSlot >= 2 === (sourceSide === 0)
      ? unit
      : undefined;
  }

  private dotSeams(slot: DoubleSlot) {
    const unit = this.unit(slot);
    return {
      // The DOT goes through the projection, then Ma Mộc's reduction (`projectMaMocIncomingDamage`).
      damageProjection: (amount: number) =>
        this.projectMaMocIncoming(
          unit,
          this.projection.beforeDamage(
            undefined,
            -1,
            unit,
            slot,
            this.turn,
            this.actionIndex,
            -1,
            amount,
            "TURN_DAMAGE",
          ),
        ),
      // Hủ Thực (Cầu Vồng 3 and 5) bites the boss for a quarter, then Ma Mộc's reduction.
      rainbowDamageProjection: (statusId: number, amount: number) =>
        statusId === 3 || statusId === 5
          ? this.projectMaMocIncoming(unit, reduceCorrosionBurn(unit, amount))
          : amount,
      healProjection: this.maMocHealGate(unit),
      ticked: (status: StatusInstance, damage: number, hpBefore: number) => {
        this.projection.designDotTick(unit, status, damage, this.turn);
        this.projection.afterDamage(
          undefined,
          -1,
          unit,
          slot,
          this.turn,
          this.actionIndex,
          hpBefore,
          "TURN_DAMAGE",
        );
      },
    };
  }

  private ppMax(skillId: number): number {
    return this.rules.damage.skillRow(skillId)?.ppMax ?? 0;
  }

  private emit(event: DoubleEvent): void {
    this.log.push(event);
  }

  private flush(): DoubleEvent[] {
    const fresh = this.log.slice(this.delivered);
    this.delivered = this.log.length;
    return fresh;
  }
}
