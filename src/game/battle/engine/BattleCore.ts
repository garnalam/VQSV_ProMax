import {
  calculateCatchChance,
  decideReserveShare,
  expAward,
  reserveExpAward,
} from "../BattleOutcomeEngine";
import type { BattleRandom } from "../BattleRandom";
import type { BattleRules } from "../BattleRules";
import type { DesignTraitProjection } from "../DesignTraitProjection";
import type { DesignTraitUnit } from "../DesignTraits";
import { resolveP7PostSkill } from "../P7PostSkill";
import { resolveP7Strike } from "../P7Strike";
import type { StatusInstance } from "../StatusState";
import type { StatusWebRules } from "../StatusWebRules";
import type { BattleItem, BattleItems } from "./BattleItems";
import {
  BattleCommandError,
  SKILL_NOT_READY_WARNING,
  TIER_LOCK_WARNING,
  CATCH_NOT_ALLOWED_TEXT,
  ITEMS_NOT_ALLOWED_TEXT,
  OTHER_SIDE,
  RUN_NOT_ALLOWED_TEXT,
  type BattleCommand,
  type BattleEvent,
  type BattleOutcome,
  type BattleRequest,
  type BattleSetup,
  type CombatantSetup,
  type Seat,
  type SideId,
} from "./BattleTypes";
import type { EnemyController, EnemyView } from "./EnemyController";
import { applyCauVongItemRecovery } from "./CauVongItemRecovery";
import {
  KIM_DIEM_LONG_VUONG_SPECIES,
  KimDiemDebuffReflection,
  KimDiemLongAn,
} from "./KimDiemLongAn";
import { PpExhaustion, teamOutOfPp } from "./PpExhaustion";
import type { CharmLoadoutEntry, RainbowCharmBattleState } from "../../charm/RainbowCharmBattle";

/** The projection's seats in a 1v1 (`VqsvBattleRuntime.TRAIT_ENEMY_SLOT` / `TRAIT_PLAYER_SLOT`). */
const SEAT_SLOT: Record<SideId, number> = { enemy: 0, player: 1 };
const EMPTY_SKILL = -1;

/** The tables the core reads that the battle rules do not carry. */
export type BattleCoreDeps = {
  items: BattleItems;
  /** `species.json` relationClass, which the catch formula weighs. */
  relationClass: (speciesId: number) => number;
};

type Side = {
  id: SideId;
  party: DesignTraitUnit[];
  setup: readonly CombatantSetup[];
  /** The party index standing in each seat; one seat in 1v1. */
  active: number[];
};

type Action = { side: SideId; member: number; command: BattleCommand };

/**
 * The battle core: one fight from the first entry to the outcome, as pure logic.
 *
 * `start()` seats both sides; after that the core always has one `request` open — a command for the
 * round, a replacement after a faint, a pivot answer, or the outcome — and `submit()` answers it. Each
 * call returns the events it produced, which the presentation plays in order.
 *
 * A round: both commands are collected (the enemy's from its controller), then switches, items,
 * catches and runs act first, then skills by priority (HV-01 Hỏa Tế Đoạt Tiên jumps a faster foe) and
 * Linh xảo, ties by the fight's roll. Every skill walks the same pipeline the rules were audited on:
 * the owner's turn start (DOTs, regen), the lost-turn check (Ngủ, Hóa Đá, Tê Liệt), Hỗn Loạn/Quỷ Mị,
 * PP, the strike through the characteristic and talent projection, and the owner's turn end. The
 * round closes with the projection's round end (signature statuses, characteristics, talents), then
 * fainted pets are replaced.
 */
export class BattleCore {
  private readonly web: StatusWebRules;
  private readonly sides: Record<SideId, Side>;
  private readonly projection: DesignTraitProjection;
  private readonly inventory: Record<number, number>;
  private readonly log: BattleEvent[] = [];
  private delivered = 0;
  private round = 1;
  private openRequest: BattleRequest | undefined;
  /** The round's actions still to run, kept across a pivot pause. */
  private queue: Action[] = [];
  private acted = new Set<SideId>();
  /** `VqsvBattleRuntime.longAn`: Kim Diễm Long Vương's Long Ấn memory (CV0'). */
  private readonly longAn = new KimDiemLongAn();
  /** Player members that have faced the current enemy pet: they share its EXP. */
  private facing = new Set<number>();
  private readonly experience: number[];

  constructor(
    private readonly rules: BattleRules,
    private readonly deps: BattleCoreDeps,
    private readonly setup: BattleSetup,
    private readonly random: BattleRandom,
    private readonly controller: EnemyController,
  ) {
    if (!rules.web)
      throw new Error("the battle core runs the web rules; load them without {web:false}");
    if (setup.format !== "1v1") throw new Error(`${setup.format} is not resolved yet: 1v1 only`);
    if (setup.player.length === 0 || setup.enemy.length === 0)
      throw new Error("each side needs at least one pet");
    this.web = rules.web;
    this.projection = rules.newTraitProjection((label) => this.random.percent(label));
    this.inventory = { ...(setup.inventory ?? {}) };
    this.experience = setup.player.map(() => 0);
    this.sides = {
      player: this.buildSide("player", setup.player),
      enemy: this.buildSide("enemy", setup.enemy),
    };
  }

  // ------------------------------------------------------------------ reading the fight

  get request(): BattleRequest {
    if (!this.openRequest) throw new Error("call start() first");
    return this.openRequest;
  }
  get roundIndex(): number {
    return this.round;
  }
  unit(side: SideId, member: number): DesignTraitUnit {
    return this.sides[side].party[member];
  }
  activeMember(side: SideId): number {
    return this.sides[side].active[0];
  }
  activeUnit(side: SideId): DesignTraitUnit {
    return this.unit(side, this.activeMember(side));
  }
  partySize(side: SideId): number {
    return this.sides[side].party.length;
  }
  /** What a pet was built from: species, level, quality, sprite. */
  setupOf(side: SideId, member: number): CombatantSetup {
    return this.sides[side].setup[member];
  }
  enemySetup(member: number): CombatantSetup {
    return this.setupOf("enemy", member);
  }
  /** Every pet sheet this fight can put on a seat, for loading during the entry transition. */
  spriteIds(): number[] {
    const ids = new Set<number>();
    for (const side of ["player", "enemy"] as const)
      for (const setup of this.sides[side].setup)
        if (setup.spriteId !== undefined && setup.spriteId >= 0) ids.add(setup.spriteId);
    return [...ids];
  }
  bag(): Readonly<Record<number, number>> {
    return this.inventory;
  }
  /** Add stock bought from the in-battle shop to the same bag commands consume and settlement saves. */
  addItem(id: number, quantity: number): void {
    this.inventory[id] = Math.max(0, (this.inventory[id] ?? 0) + quantity);
  }
  /** What the bag item is in a fight (a ball, a recovery), or undefined for one it cannot use. */
  item(id: number): BattleItem | undefined {
    return this.deps.items.get(id);
  }
  /**
   * The charms the HUD shows beside a side's health (`drawRainbowCharmHud` / `drawEnemyCharm`): the
   * player's survival and tactical charms, the NPC's one.
   */
  charmHud(side: SideId): readonly CharmLoadoutEntry[] {
    if (side === "enemy") return this.npcCharms?.loadout.slice(0, 1) ?? [];
    const player = this.setup.charms?.player;
    return player
      ? ([player.slot("SURVIVAL"), player.slot("TACTICAL")].filter(Boolean) as CharmLoadoutEntry[])
      : [];
  }
  /** Every event so far, from the first entry. */
  get events(): readonly BattleEvent[] {
    return this.log;
  }

  // ------------------------------------------------------------------ driving the fight

  /** Seat both sides (`VqsvBattleRuntime`'s entry pass: the enemy first, then the player). */
  start(): BattleEvent[] {
    if (this.openRequest) throw new Error("the fight has already started");
    this.enterCharms();
    for (const side of ["enemy", "player"] as const) {
      const unit = this.activeUnit(side);
      this.projection.onBattleEnter(unit, SEAT_SLOT[side], this.round, 0);
      this.emit({ type: "enter", seat: this.seat(side) });
    }
    this.facing.add(this.activeMember("player"));
    this.emit({ type: "roundStart", round: this.round });
    this.charmHeals();
    this.openRequest = { kind: "command", side: "player", round: this.round };
    return this.flush();
  }

  /** Answer the open request. A refused command throws `BattleCommandError` and changes nothing. */
  submit(answer: BattleCommand | { kind: "member"; member: number | null }): BattleEvent[] {
    const request = this.request;
    switch (request.kind) {
      case "ended":
        throw new BattleCommandError("Trận đấu đã kết thúc.");
      case "command": {
        if (answer.kind === "member") throw new BattleCommandError("Cần một lệnh cho lượt này.");
        this.validate("player", answer);
        const enemy = this.enemyCommand();
        this.queue = this.order([
          { side: "player", member: this.activeMember("player"), command: answer },
          { side: "enemy", member: this.activeMember("enemy"), command: enemy },
        ]);
        this.acted.clear();
        this.runQueue();
        break;
      }
      case "replacement": {
        if (answer.kind !== "member" || answer.member === null)
          throw new BattleCommandError("Chọn một Pet còn sống.");
        this.requireReserve("player", answer.member);
        this.switchTo("player", answer.member, "faint");
        this.nextRound();
        break;
      }
      case "pivot": {
        if (answer.kind !== "member") throw new BattleCommandError("Chọn Pet hoặc ở lại.");
        const active = this.activeUnit("player");
        if (answer.member === null) active.signatureState.pendingPivot = false;
        else {
          this.requireReserve("player", answer.member);
          this.switchTo("player", answer.member, "pivot");
        }
        this.runQueue();
        break;
      }
    }
    return this.flush();
  }

  // ------------------------------------------------------------------ the round

  private runQueue(): void {
    this.openRequest = undefined;
    while (this.queue.length > 0) {
      const action = this.queue.shift()!;
      this.act(action);
      this.restoreBossPp();
      if (this.finished()) return;
      if (this.endOnPpExhaustion(action.side)) return;
      if (this.openRequest) return; // a pivot is waiting for the player
      this.charmHeals();
    }
    this.endRound();
  }

  private act(action: Action): void {
    const side = this.sides[action.side];
    // A pet that left or fell before its turn does nothing.
    if (side.active[0] !== action.member || !side.party[action.member].alive()) return;
    const command = action.command;
    switch (command.kind) {
      case "skill":
        this.skill(action.side, command.slot);
        break;
      case "switch":
        this.switchTo(action.side, command.member, "command");
        break;
      case "item":
        this.useItem(action.side, command);
        break;
      case "catch":
        this.attemptCatch(command.itemId);
        break;
      case "run":
        // `tickRun`: a run that needed no charm still draws the retry it did not use.
        if (!this.charmEscape && this.charms.player?.hasMechanic("ESCAPE_RETRY"))
          this.random.percent("battle.rainbowCharm.escapeRetry");
        this.emit({ type: "run", success: true });
        // JavaSE P10 keeps "Chạy trốn" visible before EXIT_FADE completes. `end` is deliberately
        // last because the presentation replaces its pending queue when that terminal event plays.
        this.end({ winner: "none", reason: "run" });
        break;
    }
    this.acted.add(action.side);
  }

  private skill(sideId: SideId, slot: number): void {
    const actor = this.activeUnit(sideId),
      seat = this.seat(sideId),
      roll = (label: string) => this.random.percent(label);
    // The owner's turn opens: its DOTs bite and its regen heals.
    const tick = this.web.ownerTurnStart(actor, (s) => this.byOwnerSide(s), this.dotSeams(sideId));
    this.protect();
    if (tick.damage > 0 || tick.heal > 0)
      this.emit({ type: "statusTick", seat, damage: tick.damage, heal: tick.heal });
    if (!actor.alive()) return this.checkFaints();
    const block = this.web.beforeAction(actor, roll);
    if (block.blocked) {
      this.emit({ type: "blocked", seat, status: block.status ?? "" });
      this.web.ownerTurnEnd(actor);
      return;
    }
    const control = this.web.controlAction(actor, slot, this.usableSlots(actor), roll);
    if (control.spent)
      this.emit({
        type: "controlled",
        seat,
        status: control.spent,
        skillSlot: control.skillIndex,
        selfHit: control.selfHit,
      });
    slot = control.skillIndex;
    // `selectedSkillFor`: a pick Phong Bế has shut since falls to the first usable slot; with none
    // left the turn passes (`tickSelectExecute`).
    const chosen = actor.skillIds[slot];
    if (
      chosen !== undefined &&
      chosen >= 0 &&
      !control.spent &&
      !this.web.skillUsable(this.rules.damage.skillRow(chosen), actor)
    ) {
      const open = this.usableSlots(actor)[0];
      if (!open) {
        this.emit({ type: "noLegalSkill", seat });
        this.web.ownerTurnEnd(actor);
        return;
      }
      slot = open.index;
    }
    const skillId = actor.skillIds[slot];
    if (skillId === undefined || skillId < 0 || actor.skillPp[slot] <= 0) {
      this.emit({ type: "noPp", seat });
      this.web.ownerTurnEnd(actor);
      return;
    }
    // Điện áp: a skill costs 2 PP while it lasts (never more than the slot has).
    actor.skillPp[slot] = Math.max(0, actor.skillPp[slot] - this.web.ppCost(actor));
    actor.selectedSkillId = skillId;
    // `beginAction` at the P7 prepare: the player's action on the dragon (a self-hit aims at no boss).
    if (sideId === "player" && this.activeUnit("enemy").speciesId === KIM_DIEM_LONG_VUONG_SPECIES)
      this.longAn.beginAction(
        skillId,
        !control.selfHit &&
          (this.rules.damage.skillRow(skillId)?.powerPercent ?? 0) > 0 &&
          this.rules.damage.skillRow(skillId)?.targetSide !== 1,
      );
    if (control.selfHit) this.selfHit(sideId, skillId);
    else this.strike(sideId, slot, skillId);
    this.web.ownerTurnEnd(actor);
    this.checkFaints();
    if (!this.finished()) this.offerPivot(sideId);
  }

  private strike(sideId: SideId, slot: number, skillId: number): void {
    const actor = this.activeUnit(sideId),
      row = this.rules.damage.skillRow(skillId),
      targetSide: SideId = row?.targetSide === 1 ? sideId : OTHER_SIDE[sideId],
      target = this.activeUnit(targetSide),
      // `longAnTarget`: the player's hit landing on Kim Diễm Long Vương.
      longAn =
        sideId === "player" &&
        targetSide === "enemy" &&
        target.speciesId === KIM_DIEM_LONG_VUONG_SPECIES,
      // Long Ấn sends new or changed debuffs on the boss back to the attacker (1v1 only).
      debuffReflection =
        longAn && this.setup.enemy.length === 1 ? new KimDiemDebuffReflection(target) : undefined,
      targetHpBefore = target.hp(),
      trace = resolveP7Strike({
        attacker: actor,
        receiver: target,
        skillId,
        rules: this.rules,
        random: this.random,
        attackerSpriteId: this.sides[sideId].setup[this.activeMember(sideId)].spriteId ?? -2,
        receiverSpriteId:
          this.sides[targetSide].setup[this.activeMember(targetSide)].spriteId ?? -2,
        // Only the player's hit on a catchable pet keeps it alive for the ball (held item 10's floor).
        allowsHpFloor: this.captureAllowed() && sideId === "player" && targetSide === "enemy",
        postSkill: debuffReflection
          ? (step) => {
              // Commit-pending effects return before the separate post-skill effect phase.
              debuffReflection.returnTo(actor);
              const postDebuffs = new KimDiemDebuffReflection(target);
              const outcome = resolveP7PostSkill(step);
              postDebuffs.returnTo(actor);
              return outcome;
            }
          : resolveP7PostSkill,
        charmEvasion: (receiver, sureHit) => {
          const charms = this.charms[targetSide];
          if (!charms) return false;
          const roll = charms.hasMechanic("EVASION")
            ? this.random.percent("battle.rainbowCharm.evasion")
            : -1;
          return charms.tryEvade(receiver, sureHit, roll);
        },
        trait: {
          projection: this.projection,
          attacker: actor,
          receiver: target,
          attackerSlot: SEAT_SLOT[sideId],
          receiverSlot: SEAT_SLOT[targetSide],
          roundIndex: this.round,
          actedFirst: !this.acted.has(OTHER_SIDE[sideId]),
          // `longAn.project` after the incoming projection: a repeated skill lands at 70%.
          incomingDamage: longAn
            ? (receiver, damage, skill) =>
                skill >= 0 && receiver === target ? this.longAn.project(damage) : damage
            : undefined,
          // `commitUnifiedAfterDamage(..., amount -> longAnTarget() ? longAn.project(amount) : amount)`:
          // the unified skill's supplemental hit is cut the same way.
          secondaryDamage: longAn ? (amount) => this.longAn.project(amount) : undefined,
        },
      });
    // `longAn.afterHit(p7CommittedDamage)`: the repeated hit is answered with 120% of what it took.
    const reflect = longAn ? this.longAn.afterHit(Math.max(0, targetHpBefore - target.hp())) : 0;
    this.protect();
    // U Minh Triều hands back the PP it just spent; Tử Thần Xúc Ấn burns every slot to zero.
    const pp = trace.zeroPower ? undefined : trace.unifiedPp;
    if (pp?.exhaust) actor.skillPp.fill(0);
    else if (pp && pp.refund > 0)
      actor.skillPp[slot] = Math.min(this.ppMax(skillId), actor.skillPp[slot] + pp.refund);
    // `afterSkillPp`: Tinh thần công kích / Triều tịch năng lượng on the side that acted.
    const charms = this.charms[sideId];
    if (charms) {
      const drainRoll = charms.hasMechanic("ENEMY_PP_DRAIN")
          ? this.random.percent("battle.rainbowCharm.ppDrain")
          : -1,
        refundRoll = charms.hasMechanic("SELF_PP_REFUND")
          ? this.random.percent("battle.rainbowCharm.ppRefund")
          : -1;
      charms.afterSkillPp(actor, target, skillId, drainRoll, refundRoll, (id) => this.ppMax(id));
    }
    this.emit({
      type: "skill",
      seat: this.seat(sideId),
      skillId,
      target: this.seat(targetSide),
      hit: trace.hit,
      damage: trace.damage,
      crit: trace.critFlag === 1,
      targetHp: target.hp(),
      attackerHp: actor.hp(),
    });
    // `applyLongAnReflect`, once the skill's own effects ran: the attacker takes it as plain damage.
    if (reflect > 0) {
      actor.damage(reflect);
      this.emit({
        type: "longAn",
        seat: this.seat(sideId),
        damage: reflect,
        attackerHp: actor.hp(),
      });
    }
  }

  /** Quỷ Mị / Hỗn Loạn turned the skill on its user: its own damage, none of its effects. */
  private selfHit(sideId: SideId, skillId: number): void {
    const self = this.activeUnit(sideId),
      combatant = {
        speciesId: self.speciesId,
        attack: self.currentStats.attack,
        defense: self.currentStats.defense,
        visualSpriteId: this.sides[sideId].setup[this.activeMember(sideId)].spriteId ?? -2,
        unit: self,
      },
      outcome = this.rules.damage.damage({
        attacker: combatant,
        target: combatant,
        skillId,
        randomPercent: (label) => this.random.percent(`battle.selfHit.${label}`),
        unifiedPower: this.rules.web?.selfHitPower(skillId),
      });
    self.damage(outcome.damage);
    this.protect();
    const seat = this.seat(sideId);
    this.emit({
      type: "skill",
      seat,
      skillId,
      target: seat,
      hit: true,
      damage: outcome.damage,
      crit: outcome.critFlag === 1,
      targetHp: self.hp(),
      attackerHp: self.hp(),
    });
  }

  /** "sau đòn chọn đổi sang 1 pet còn sống": open the switch, or drop it when it cannot happen. */
  private offerPivot(sideId: SideId): void {
    const actor = this.activeUnit(sideId);
    if (!actor.signatureState.pendingPivot) return;
    const reserves = this.reserves(sideId);
    if (!actor.alive() || reserves.length === 0 || this.web.switchAndItemsLocked(actor)) {
      actor.signatureState.pendingPivot = false;
      return;
    }
    if (sideId === "player") {
      this.openRequest = { kind: "pivot", side: "player" };
      return;
    }
    this.switchTo("enemy", this.controller.replacement(this.enemyView(), reserves), "pivot");
  }

  private switchTo(sideId: SideId, member: number, reason: "command" | "pivot" | "faint"): void {
    const side = this.sides[sideId],
      from = side.active[0],
      previous = side.party[from],
      next = side.party[member];
    // `onSwitch` carries a pivot's shield across, clears what leaves with the pet, and seats the next.
    this.projection.onSwitch(previous, next, SEAT_SLOT[sideId], this.round, 0, reason === "faint");
    previous.signatureState.pendingPivot = false;
    side.active[0] = member;
    // `longAn.interrupt()` on the player's switch commit.
    if (sideId === "player" && reason === "command") this.longAn.interrupt();
    // `setPlayer`: a pet entering takes the player's charm modifiers once.
    if (sideId === "player") this.charms.player?.applyUnitModifiers(next, this.charmRoll);
    if (sideId === "player") this.facing.add(member);
    else this.facing = new Set([this.activeMember("player")]);
    this.emit({ type: "switch", side: sideId, from, to: member, reason });
  }

  private useItem(sideId: SideId, command: BattleCommand & { kind: "item" }): void {
    const item = this.deps.items.get(command.itemId)!,
      member = command.member ?? this.activeMember(sideId),
      unit = this.unit(sideId, member);
    if (item.kind !== "recovery") return;
    if (sideId === "player") this.inventory[command.itemId]--;
    // `longAn.interrupt()`: a player's item breaks the repeated-skill chain.
    if (sideId === "player") this.longAn.interrupt();
    const result = this.deps.items.apply(
      item,
      unit,
      command.skillSlot,
      (id) => this.ppMax(id),
      (amount) =>
        this.projection.projectReceivedHealing(
          undefined,
          -1,
          unit,
          SEAT_SLOT[sideId],
          this.round,
          0,
          amount,
        ),
      this.rules.status,
    );
    this.emit({ type: "item", seat: { side: sideId, member }, itemId: command.itemId, ...result });
    // `vg_CauVongItemRecovery_apply`: a Cầu Vồng trainer answers the player's item with one recovery.
    if (sideId === "player") {
      const recovery = applyCauVongItemRecovery(
        this.setup,
        item,
        [this.activeUnit("enemy")],
        this.sides.enemy.party,
        (id) => this.ppMax(id),
      );
      if (recovery) {
        const { target, ...gained } = recovery;
        if (target === this.activeUnit("enemy") && gained.hpGained > 0)
          this.projection.afterHealing(target, SEAT_SLOT.enemy, this.round);
        this.emit({
          type: "item",
          seat: { side: "enemy", member: this.sides.enemy.party.indexOf(target) },
          itemId: command.itemId,
          ...gained,
        });
      }
    }
  }

  private attemptCatch(itemId: number): void {
    const ball = this.deps.items.get(itemId)!,
      target = this.activeUnit("enemy"),
      thrower = this.activeUnit("player"),
      member = this.activeMember("enemy"),
      setup = this.sides.enemy.setup[member];
    if (ball.kind !== "capture") return;
    this.inventory[itemId]--;
    const chance = ball.guaranteed
        ? 100
        : calculateCatchChance({
            itemId,
            itemParamA: ball.multiplier,
            enemyHp: target.hp(),
            enemyMaxHp: target.maxHp(),
            enemyNature: setup.nature,
            targetDebuff1: target.hasDebuff(1),
            targetDebuff2: target.hasDebuff(2),
            targetDebuff10: target.hasDebuff(10),
            attackerHeldItem11: thrower.hasHeldItem(11),
            heldItem11Bonus: thrower.hasHeldItem(11) ? thrower.heldItemParam(11, 5, 0) : 0,
            captureBonusPoints:
              (this.setup.captureBonusPoints ?? 0) +
              (this.charms.player?.captureFailureBonusPoints() ?? 0),
            web: true,
            enemyRelationClass: this.deps.relationClass(setup.speciesId),
            enemyLevel: setup.level,
            roll: 0,
            forceFail: false,
          }),
      forced = this.setup.script?.forcedCatch?.(++this.catchAttempts, itemId),
      caught = forced ?? this.random.percent("battle.catch") < chance;
    this.emit({ type: "catch", target: this.seat("enemy"), itemId, chance, caught });
    if (caught) this.end({ winner: "player", reason: "catch", caught: member });
    // Thân hòa thiên sứ: a missed ball leaves the next one easier (not in the scripted bunny catch).
    else if (!this.setup.script) this.charms.player?.recordCaptureFailureBonus();
  }

  private endRound(): void {
    const before = {
      player: this.activeUnit("player").hp(),
      enemy: this.activeUnit("enemy").hp(),
    };
    for (const side of ["player", "enemy"] as const) {
      const unit = this.activeUnit(side);
      if (unit.alive()) this.projection.tickDesignBleeding(unit, this.round);
    }
    for (const side of ["player", "enemy"] as const) {
      const unit = this.activeUnit(side);
      if (unit.alive()) this.projection.onRoundEnd(unit, SEAT_SLOT[side], this.round, 0);
    }
    // `applySourceBadgeRoundGrowth`: U Linh grows the active player pet once the round has ended.
    this.activeUnit("player").advanceSourceBadgeRoundGrowth();
    this.protect();
    // The bleed and the round-end regen move HP without a skill: the screen hears it as a tick.
    for (const side of ["player", "enemy"] as const) {
      const change = this.activeUnit(side).hp() - before[side];
      if (change !== 0)
        this.emit({
          type: "statusTick",
          seat: this.seat(side),
          damage: Math.max(0, -change),
          heal: Math.max(0, change),
        });
    }
    this.checkFaints();
    this.emit({ type: "roundEnd", round: this.round });
    if (this.finished()) return;
    // Fainted actives are replaced before the next round: the enemy picks, the player is asked.
    if (!this.activeUnit("enemy").alive())
      this.switchTo(
        "enemy",
        this.controller.replacement(this.enemyView(), this.reserves("enemy")),
        "faint",
      );
    if (!this.activeUnit("player").alive()) {
      this.openRequest = { kind: "replacement", side: "player" };
      return;
    }
    this.nextRound();
  }

  private nextRound(): void {
    this.round++;
    this.emit({ type: "roundStart", round: this.round });
    this.charmHeals();
    this.openRequest = { kind: "command", side: "player", round: this.round };
  }

  /** Report every active pet that has just fallen, award its EXP, and end the fight if a side is out. */
  /** The story script's floor: an unkillable side stops at 1 HP, before anything reports a faint. */
  private protect(): void {
    const unkillable = this.setup.script?.unkillable;
    if (unkillable)
      for (const unit of this.sides[unkillable].party) if (!unit.alive()) unit.setHp(1);
  }

  private checkFaints(): void {
    this.protect();
    for (const sideId of ["enemy", "player"] as const) {
      const member = this.activeMember(sideId),
        unit = this.unit(sideId, member);
      if (unit.alive() || this.fainted.has(unit)) continue;
      if (this.charmRevive(sideId, member, unit)) continue;
      this.fainted.add(unit);
      this.emit({ type: "faint", seat: { side: sideId, member } });
      if (sideId === "enemy" && this.setup.experienceAllowed !== false)
        this.awardExperience(member);
    }
    if (this.reserves("player").length === 0 && !this.activeUnit("player").alive())
      this.end({ winner: "enemy", reason: "knockout" });
    else if (this.reserves("enemy").length === 0 && !this.activeUnit("enemy").alive())
      this.end({ winner: "player", reason: "knockout" });
  }
  private readonly fainted = new Set<DesignTraitUnit>();
  private readonly ppExhaustion = new PpExhaustion();

  /** ProMax: the Kim Diễm encounter's enemy team never runs out, even after a PP drain. */
  private restoreBossPp(): void {
    if (this.setup.boss !== "kim-diem-long-vuong") return;
    for (const unit of this.sides.enemy.party)
      unit.skillIds.forEach((id, slot) => {
        unit.skillPp[slot] = id < 0 ? 0 : this.ppMax(id);
      });
  }

  /** Web rule: both teams out of PP; the one that ran dry first loses (see `PpExhaustion`). */
  private endOnPpExhaustion(actor: SideId): boolean {
    const loser = this.ppExhaustion.observe(this.sides.player.party, this.sides.enemy.party, actor);
    if (!loser) return false;
    this.emit({ type: "ppExhausted", side: loser });
    this.end({ winner: OTHER_SIDE[loser], reason: "ppExhausted" });
    return true;
  }
  private catchAttempts = 0;

  /**
   * `BattleOutcomeEngine.expAward` for every living player pet that faced the fallen one, each with
   * its own held item (Mật Phong Sào) and talent multiplier (Học Giả Thực Chiến / Ký Ức Mơ Hồ).
   */
  private awardExperience(enemyMember: number): void {
    const enemy = this.sides.enemy.setup[enemyMember],
      earners = [...this.facing].filter((member) => this.unit("player", member).alive());
    for (const member of earners) {
      const unit = this.unit("player", member),
        trait = this.projection.projectExperience(unit, SEAT_SLOT.player, this.round, 0),
        amount = expAward({
          enemyLevel: enemy.level,
          enemyNature: enemy.nature,
          levelFactorLevel: this.sides.player.setup[member].level,
          participantCount: earners.length,
          divisor: 1000,
          heldItem5: unit.hasHeldItem(5),
          heldItem5Multiplier: unit.hasHeldItem(5) ? unit.heldItemParam(5, 5, 0) : 0,
          experienceMultiplierPercent: trait.multiplierPercent,
          experienceMultiplierStackable: trait.stackable,
        });
      this.experience[member] += amount;
      this.emit({
        type: "experience",
        member,
        amount,
        from: { side: "enemy", member: enemyMember },
      });
    }
    // Bug fix: the 1v1 never paid the bench. Java's `awardExp` gives a living pet that did not face
    // the foe but holds Ký Cư Giải Xác (held item 6) its share at the last participant's level,
    // exactly as the 2v2 core already does.
    const lastLevel =
      earners.length === 0 ? 1 : this.sides.player.setup[earners[earners.length - 1]].level;
    this.sides.player.party.forEach((unit, member) => {
      if (this.facing.has(member) || !unit.alive()) return;
      // Hoàng Kim Chương (ProMax): 30% for a reserve without Ký Cư Giải Xác, which keeps its whole share.
      const share = decideReserveShare({
        globalShare: false,
        goldenSharePercent: this.setup.goldenPartyExperiencePercent,
        heldItem6: unit.hasHeldItem(6),
      });
      if (share.outcome === "SKIP") return;
      const trait = this.projection.projectExperience(unit, SEAT_SLOT.player, this.round, 0),
        amount = reserveExpAward(
          {
            enemyLevel: enemy.level,
            enemyNature: enemy.nature,
            levelFactorLevel: lastLevel,
            participantCount: earners.length,
            divisor: share.divisor,
            heldItem5: false,
            heldItem5Multiplier: 0,
            experienceMultiplierPercent: trait.multiplierPercent,
            experienceMultiplierStackable: trait.stackable,
          },
          share,
        );
      this.experience[member] += amount;
      this.emit({
        type: "experience",
        member,
        amount,
        from: { side: "enemy", member: enemyMember },
      });
    });
    if (earners.length > 0 && !this.setup.script) this.postExpBadgeHeal();
  }

  /**
   * `applySourcePostExpPassiveHeal`: with Liệt Hỏa enhanced, every living player pet heals a share of
   * its species' base HP once the knockout's EXP is in, through the received-healing projection. The
   * engine only persists it; the active pet's bar follows as a silent tick.
   */
  private postExpBadgeHeal(): void {
    const heal = this.setup.postExpBadgeHeal;
    if (!heal) return;
    this.sides.player.party.forEach((unit, member) => {
      const amount = heal(unit.speciesId);
      if (amount === undefined || !unit.alive()) return;
      const before = unit.hp(),
        slot = SEAT_SLOT.player;
      unit.heal(
        this.projection.projectReceivedHealing(unit, slot, unit, slot, this.round, 0, amount),
      );
      this.projection.afterHealing?.(unit, slot, this.round);
      if (member === this.activeMember("player") && unit.hp() !== before)
        this.emit({
          type: "statusTick",
          seat: this.seat("player"),
          damage: 0,
          heal: unit.hp() - before,
        });
    });
  }

  private end(result: Omit<BattleOutcome, "experience">): void {
    const outcome: BattleOutcome = { ...result, experience: [...this.experience] };
    this.queue = [];
    this.openRequest = { kind: "ended", outcome };
    this.emit({ type: "end", outcome });
  }
  private finished(): boolean {
    return this.openRequest?.kind === "ended";
  }

  // ------------------------------------------------------------------ order and validation

  /**
   * Switches, items, catches and runs before any skill, the player's first. Skills: a pet whose
   * characteristic outranks a faster foe (HV-01) first, then the higher Linh xảo, ties by a roll.
   */
  private order(actions: Action[]): Action[] {
    const tier = (action: Action) => (action.command.kind === "skill" ? 1 : 0);
    const tieRoll = this.random.percent("battle.order.tie");
    return [...actions].sort((a, b) => {
      if (tier(a) !== tier(b)) return tier(a) - tier(b);
      if (tier(a) === 0) return a.side === "player" ? -1 : 1;
      const ua = this.activeUnit(a.side),
        ub = this.activeUnit(b.side),
        // Bug fix: Linh Trùng Thi Hài (held item 7) is the same priority 1 as the characteristic in
        // Java's `unifiedPlayerSkillActsFirst`; the 1v1 only read the characteristic.
        pa = this.rules.traits.outranked(ua, ub) || ua.hasHeldItem(7) ? 1 : 0,
        pb = this.rules.traits.outranked(ub, ua) || ub.hasHeldItem(7) ? 1 : 0;
      if (pa !== pb) return pb - pa;
      const sa = ua.currentStats.speed,
        sb = ub.currentStats.speed;
      if (sa !== sb) return sb - sa;
      return (a.side === "player") === tieRoll < 50 ? -1 : 1;
    });
  }

  /** Every rule a command must pass before anything is spent; the reason is the player's sentence. */
  private validate(sideId: SideId, command: BattleCommand): void {
    const active = this.activeUnit(sideId),
      refuse = (message: string): never => {
        throw new BattleCommandError(message);
      };
    switch (command.kind) {
      case "skill": {
        const id = active.skillIds[command.slot];
        if (id === undefined || id < 0) refuse("Ô Skill trống.");
        // With every slot dry the pet may still pick one: the turn passes on "noPp".
        if (active.skillPp[command.slot] <= 0 && this.usableSlots(active).length > 0)
          refuse("Kỹ năng không còn PP.");
        const row = this.rules.damage.skillRow(id);
        // `VqsvBattleRuntime` P3: the player's pick checks Phong Bế's tier lock first (even under
        // Kỹ năng Phong Bế, whose seal rides on the same status), then `canUseSourceSkillId`.
        if (sideId === "player" && row && !active.canUseSkillTier(row.learnTier))
          refuse(TIER_LOCK_WARNING);
        if (!this.web.skillUsable(row, active)) refuse(SKILL_NOT_READY_WARNING);
        return;
      }
      case "switch":
        if (this.web.switchAndItemsLocked(active)) refuse("Đang bị Giam Cầm: không thể đổi Pet.");
        this.requireReserve(sideId, command.member);
        return;
      case "item": {
        if (!this.itemsAllowed()) refuse(ITEMS_NOT_ALLOWED_TEXT);
        if (this.web.switchAndItemsLocked(active))
          refuse("Đang bị Giam Cầm: không thể dùng vật phẩm.");
        if (sideId === "player" && (this.inventory[command.itemId] ?? 0) <= 0)
          refuse("Hết vật phẩm.");
        const item = this.deps.items.get(command.itemId);
        if (!item) refuse("Vật phẩm này không dùng được trong trận.");
        if (item!.kind === "capture") refuse("Cầu bắt Pet dùng bằng lệnh bắt.");
        const member = command.member ?? this.activeMember(sideId),
          unit = this.sides[sideId].party[member];
        if (!unit) refuse("Không có Pet này.");
        const why = this.deps.items.refusal(item!, unit, command.skillSlot, (id) => this.ppMax(id));
        if (why) refuse(why);
        return;
      }
      case "catch": {
        if (!this.captureAllowed()) refuse(CATCH_NOT_ALLOWED_TEXT);
        if (this.web.switchAndItemsLocked(active))
          refuse("Đang bị Giam Cầm: không thể dùng vật phẩm.");
        if ((this.inventory[command.itemId] ?? 0) <= 0) refuse("Hết cầu.");
        if (this.deps.items.get(command.itemId)?.kind !== "capture")
          refuse("Đây không phải cầu bắt Pet.");
        return;
      }
      case "run":
        if (!this.runAllowed() && !this.charmEscapeRoll()) refuse(RUN_NOT_ALLOWED_TEXT);
        return;
    }
  }

  private enemyCommand(): BattleCommand {
    this.restoreBossPp();
    // Web rule (with `PpExhaustion`): a dry pet hands over to a reserve that still has PP, or the
    // fight could stall on a team that is not out of PP but never fields the pet that has it.
    const active = this.activeUnit("enemy");
    if (teamOutOfPp([active]) && !this.web.switchAndItemsLocked(active)) {
      const fresh = this.reserves("enemy").find(
        (member) => !teamOutOfPp([this.unit("enemy", member)]),
      );
      if (fresh !== undefined) return { kind: "switch", member: fresh };
    }
    const command = this.controller.command(this.enemyView());
    try {
      this.validate("enemy", command);
      return command;
    } catch (error) {
      if (!(error instanceof BattleCommandError)) throw error;
      // A controller that asks for something illegal loses the choice, not the turn.
      const slots = this.usableSlots(this.activeUnit("enemy"));
      return { kind: "skill", slot: slots[0]?.index ?? 0 };
    }
  }

  private requireReserve(sideId: SideId, member: number): void {
    if (!this.reserves(sideId).includes(member))
      throw new BattleCommandError("Chọn một Pet còn sống đang ở dự bị.");
  }

  // ------------------------------------------------------------------ team charms

  /** Each side's charms (`rainbowCharms` / `enemyRainbowCharms`). */
  private get charms(): { player?: RainbowCharmBattleState; enemy?: RainbowCharmBattleState } {
    return { player: this.setup.charms?.player, enemy: this.npcCharms };
  }
  /** `enemyRainbowCharms`, drawn by `enterCharms`. */
  private npcCharms: RainbowCharmBattleState | undefined;
  /** The fight's `sourceRandomPercent` for a charm-owned draw. */
  private readonly charmRoll = (label: string): number => this.random.percent(label);
  /** Set when Chạy trối chết chuyên gia let a restricted run through this round. */
  private charmEscape = false;

  /**
   * `enterBattle`'s charm pass: an NPC's modifiers reach its whole team, the player's reach the pet
   * that enters; then an NPC's Phong Bế rolls for every player pet and the player's for every enemy.
   */
  private enterCharms(): void {
    this.npcCharms = this.setup.charms?.enemy?.(
      (bound) => this.random.next("battle.npcCharm.select", bound),
      this.sides.enemy.setup.map((setup) => setup.speciesId),
    );
    const { player, enemy } = this.charms;
    if (enemy)
      for (const unit of this.sides.enemy.party) enemy.applyUnitModifiers(unit, this.charmRoll);
    player?.applyUnitModifiers(this.activeUnit("player"), this.charmRoll);
    const usable = (unit: DesignTraitUnit, slot: number) =>
      this.web.skillUsable(this.rules.damage.skillRow(unit.skillIds[slot]), unit);
    if (enemy?.hasMechanic("SKILL_SEAL"))
      for (const unit of this.sides.player.party)
        enemy.trySeal(unit, this.random.percent("battle.npcCharm.skillSeal"), usable);
    if (player)
      this.sides.enemy.party.forEach((unit, index) => {
        const roll = player.hasMechanic("SKILL_SEAL")
          ? this.random.percent(`battle.rainbowCharm.skillSeal.enemy${index}`)
          : -1;
        player.trySeal(unit, roll, usable);
      });
  }

  /** `tickDispatch`'s charm heals: the player's active pet, then the NPC's. */
  private charmHeals(): void {
    for (const side of ["player", "enemy"] as const) {
      const charms = this.charms[side];
      if (!charms) continue;
      const unit = this.activeUnit(side),
        amount = charms.tryEmergencyHeal(unit);
      if (amount > 0) {
        this.projection.afterHealing?.(unit, SEAT_SLOT[side], this.round);
        this.emit({ type: "charmHeal", seat: this.seat(side), amount });
      }
    }
  }

  /** The KO handler's revive roll: true when the charm brought the pet back. */
  private charmRevive(sideId: SideId, member: number, unit: DesignTraitUnit): boolean {
    const charms = this.charms[sideId];
    if (!charms) return false;
    const roll = charms.hasMechanic("BATTLE_REVIVE")
      ? this.random.percent(
          sideId === "player" ? "battle.rainbowCharm.revive" : "battle.npcCharm.revive",
        )
      : -1;
    // `clearStatusesOnDeath` runs before the revive is tried.
    if (roll >= 0) unit.clearStatusesOnDeath();
    const hp = charms.tryRevive(unit, roll);
    if (hp <= 0) return false;
    this.projection.afterHealing?.(unit, SEAT_SLOT[sideId], this.round);
    this.emit({ type: "charmRevive", seat: { side: sideId, member }, hp });
    return true;
  }

  /**
   * `tickRun`'s charm bypass: in a catchable wild fight that forbids running, Chạy trối chết chuyên
   * gia rolls to let the run through.
   */
  private charmEscapeRoll(): boolean {
    const charms = this.charms.player;
    this.charmEscape = false;
    if (!charms?.hasMechanic("ESCAPE_RETRY") || !this.captureAllowed() || this.setup.script)
      return false;
    this.charmEscape = charms.guaranteesWildEscape(
      this.random.percent("battle.rainbowCharm.escapeRetry"),
    );
    return this.charmEscape;
  }

  // ------------------------------------------------------------------ helpers

  /**
   * Java's two boundaries, which are not one question: `captureForbidden()` reads the enemy's owner
   * and op32's first mode word, `tickRun`'s `battleModeRestricted` reads op32's second. A fight
   * authored by an event record supplies both from its descriptor; one built straight from a party
   * and an encounter leaves them to `kind`, which is why they are optional on the setup.
   */
  captureAllowed(): boolean {
    return this.setup.captureAllowed ?? this.setup.kind === "wild";
  }

  runAllowed(): boolean {
    return this.setup.runAllowed ?? this.setup.kind === "wild";
  }

  itemsAllowed(): boolean {
    return this.setup.itemsAllowed !== false;
  }

  private buildSide(id: SideId, setups: readonly CombatantSetup[]): Side {
    // Long Uy: against Kim Diễm Long Vương alone, the player's pets fight without their traits.
    const longUy =
      id === "player" &&
      this.setup.enemy.length === 1 &&
      this.setup.enemy[0].speciesId === KIM_DIEM_LONG_VUONG_SPECIES;
    const party = setups.map((setup) => {
      const unit = this.rules.traits.unit({
        speciesId: setup.speciesId,
        ownerSide: id === "player" ? 0 : 1,
        formationSlot: SEAT_SLOT[id],
        base: setup.stats,
        wideStats: setup.wideStats,
        physicalTraitId: longUy ? undefined : setup.physicalTraitId,
        heldItemId: setup.heldItemId,
      });
      if (longUy) unit.designTraitState.enabled = false;
      unit.restoreStatsForCheck();
      if (setup.statFactors) this.projection.applyEncounterStatFactors(unit, setup.statFactors);
      if (setup.hp !== undefined) unit.setHp(Math.max(0, Math.min(unit.maxHp(), setup.hp)));
      // `PetBattleAdapter.toBattleUnit(pet, 0, badges)`: the badge lands on a player pet as it is built.
      if (id === "player" && this.setup.badgeProfile)
        unit.applySourceBadgeProfile(this.setup.badgeProfile, setup.hp ?? -1);
      for (let slot = 0; slot < unit.skillIds.length; slot++) {
        const skillId = setup.skillIds[slot] ?? EMPTY_SKILL;
        unit.skillIds[slot] = skillId;
        unit.skillPp[slot] = skillId < 0 ? 0 : (setup.skillPp?.[slot] ?? this.ppMax(skillId));
      }
      return unit;
    });
    const first = party.findIndex((unit) => unit.alive());
    if (first < 0) throw new Error(`the ${id} side has no living pet`);
    return { id, party, setup: setups, active: [first] };
  }

  private reserves(sideId: SideId): number[] {
    const side = this.sides[sideId];
    return side.party.flatMap((unit, member) =>
      unit.alive() && !side.active.includes(member) ? [member] : [],
    );
  }

  private usableSlots(unit: DesignTraitUnit): { index: number; damaging: boolean }[] {
    return unit.skillIds.flatMap((id, index) => {
      if (id < 0 || unit.skillPp[index] <= 0) return [];
      const row = this.rules.damage.skillRow(id);
      if (!row || !this.web.skillUsable(row, unit)) return [];
      return [{ index, damaging: row.powerPercent > 0 }];
    });
  }

  private enemyView(): EnemyView {
    const enemy = this.sides.enemy;
    return {
      round: this.round,
      party: enemy.party,
      active: enemy.active[0],
      foe: this.activeUnit("player"),
      foeMember: this.activeMember("player"),
      level: (side, member) => this.sides[side].setup[member].level,
      maySwitch: !this.web.switchAndItemsLocked(this.activeUnit("enemy")),
      roll: (label) => this.random.percent(label),
      next: (label, bound) => this.random.next(label, bound),
    };
  }

  /** `VqsvBattleRuntime`'s DOT arm: project the tick, then tell the planter and the receiver. */
  private dotSeams(sideId: SideId) {
    const unit = this.activeUnit(sideId),
      slot = SEAT_SLOT[sideId];
    return {
      damageProjection: (amount: number) =>
        this.projection.beforeDamage(
          undefined,
          -1,
          unit,
          slot,
          this.round,
          0,
          -1,
          amount,
          "TURN_DAMAGE",
        ),
      ticked: (status: StatusInstance, damage: number, hpBefore: number) => {
        this.projection.designDotTick(unit, status, damage, this.round);
        this.projection.afterDamage(
          undefined,
          -1,
          unit,
          slot,
          this.round,
          0,
          hpBefore,
          "TURN_DAMAGE",
        );
      },
    };
  }

  /** A status names its planter by the owner side it stored (0 player, 1 enemy). */
  private byOwnerSide(ownerSide: number): DesignTraitUnit {
    return this.activeUnit(ownerSide === 0 ? "player" : "enemy");
  }

  private ppMax(skillId: number): number {
    return this.rules.damage.skillRow(skillId)?.ppMax ?? 0;
  }

  private seat(side: SideId): Seat {
    return { side, member: this.activeMember(side) };
  }

  private emit(event: BattleEvent): void {
    this.log.push(event);
  }

  private flush(): BattleEvent[] {
    const fresh = this.log.slice(this.delivered);
    this.delivered = this.log.length;
    this.controller.observe?.(fresh, this.round);
    return fresh;
  }
}
