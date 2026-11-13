import type { PackBattleAiProfile } from "../../../data/GameData";
import type { BattleRules } from "../BattleRules";
import type { DesignTraitUnit } from "../DesignTraits";
import { BattleAiActorKey } from "../ai/BattleAiActorKey";
import { BattleAiCanaryDecisionAdapter } from "../ai/BattleAiCanaryDecisionAdapter";
import { BattleAiDecision } from "../ai/BattleAiDecision";
import { BattleAiDecisionEngine, tierOfProfile } from "../ai/BattleAiDecisionEngine";
import type { BattleAiEncounterCatalog } from "../ai/BattleAiEncounterCatalog";
import { BattleAiMemory } from "../ai/BattleAiMemory";
import type { BattleAiEncounterSpec } from "../ai/BattleAiObservation";
import { BattleAiObservationInput, type OwnedUnit } from "../ai/BattleAiObservationFactory";
import type { BattleAiItemOption, BattleAiRulebook } from "../ai/BattleAiRulebook";
import { BattleAiShadowPlanner } from "../ai/BattleAiShadowPlanner";
import { LiveBattleAiUnit, type BattleAiUnit } from "../ai/BattleAiUnit";
import { RUNTIME_MODES, type BattleAiV2RuntimeMode } from "../ai/BattleAiV2RuntimeSelector";
import type { BattleCommand, BattleEvent } from "./BattleTypes";
import type { EnemyController, EnemyView } from "./EnemyController";

/** What a controller of the AI v2 kind reports about its last choice (for logs and tests). */
export type AiV2Trace = {
  production: string;
  committed: string;
  fromV2: boolean;
  /** Whether the production pick came from the v1 engine rather than the basic AI. */
  fromV1: boolean;
  reason: string;
};

/**
 * The enemy turn the way `VqsvBattleRuntime` runs it: a source-v1 production decision first (the
 * everyday bot brain — urgent item, petrification, tactical switch, then every skill scored), then
 * the shadow planner ranks every legal candidate for the encounter, and the canary adapter decides
 * whether v2 may replace the production pick — a mode that commits, a commissioned encounter and
 * policy, a candidate that is still legal.
 *
 * A fight with no descriptor profile has no v1 answer, so `base` decides for it; a fight with no
 * catalog encounter keeps its v1 pick untouched, because the shadow is only a reviewer.
 *
 * Memory is fed from the fight's own events: the player's revealed skills, the damage it dealt, its
 * switches and the knockouts — the same tokens the golden rows script. The bookkeeping the v1 engine
 * reads (item budget left, last skill per pet, the turn of its last tactical switch) is updated when
 * a decision is executed, exactly where Java's `executeEnemyAiDecision` does it.
 */
export class AiV2EnemyController implements EnemyController {
  private readonly spec: BattleAiEncounterSpec | undefined;
  private readonly memory: BattleAiMemory | undefined;
  private readonly planner: BattleAiShadowPlanner;
  private readonly canary: BattleAiCanaryDecisionAdapter;
  private readonly live = new Map<DesignTraitUnit, LiveBattleAiUnit>();
  private itemOptions?: BattleAiItemOption[];
  /** `enemyAiItemsRemaining`: one draw per item the bot actually spends. */
  private itemsRemaining: number;
  /** `aiLastSkill` and `aiRepeatCount`, both keyed by the pet itself, not by its slot. */
  private readonly lastSkill = new Map<DesignTraitUnit, number>();
  private readonly repeatCount = new Map<DesignTraitUnit, number>();
  /** `enemyLastTacticalSwitchTurn`, and Java's sentinel is what makes turn one look ancient. */
  private lastTacticalSwitchTurn = -999;
  /** The player pet each event names, kept so memory can key it after it has left the field. */
  private playerKey = BattleAiActorKey.playerMember(1);
  lastTrace: AiV2Trace | null = null;

  constructor(
    private readonly rules: BattleRules,
    private readonly rulebook: BattleAiRulebook,
    private readonly catalog: BattleAiEncounterCatalog,
    private readonly encounterKey: string | undefined,
    private readonly base: EnemyController,
    private readonly mode: BattleAiV2RuntimeMode = RUNTIME_MODES.ALL_ENCOUNTERS_V2,
    /** The descriptor's `aiProfile`; without it this controller has no v1 brain to run. */
    private readonly profile?: PackBattleAiProfile,
  ) {
    this.spec = encounterKey ? catalog.spec(encounterKey) : undefined;
    this.memory = this.spec ? new BattleAiMemory(this.spec.memoryHorizon) : undefined;
    this.planner = new BattleAiShadowPlanner(rulebook, catalog);
    this.canary = new BattleAiCanaryDecisionAdapter(catalog);
    this.itemsRemaining = profile?.itemBudget ?? 0;
  }

  command(view: EnemyView): BattleCommand {
    const actorKey = (member: number) => BattleAiActorKey.npcMember(member + 1),
      own: OwnedUnit[] = view.party.map((unit, member) => ({
        actorKey: actorKey(member),
        memberSlot: member + 1,
        unit: this.liveOf(unit, view.level("enemy", member)),
        active: member === view.active,
      })),
      foe = this.liveOf(view.foe, view.level("player", view.foeMember)),
      self = own[view.active].unit;
    this.playerKey = BattleAiActorKey.playerMember(view.foeMember + 1);

    const fallback = this.firstUsable(view),
      // Java's production decision is the v1 engine; without a profile this fight has no v1 answer.
      produced = this.profile ? this.runV1(view, own, self) : undefined,
      production = produced ? this.commandOf(produced, view, fallback) : this.base.command(view);
    if (!this.spec || !this.memory || !this.mode.shadowEnabled || this.encounterKey === undefined) {
      this.remember(produced, production, view);
      this.lastTrace = {
        production: describe(production),
        committed: describe(production),
        fromV2: false,
        fromV1: !!produced,
        reason: "no-encounter",
      };
      return production;
    }
    const input = new BattleAiObservationInput(
      this.spec,
      view.round,
      actorKey(view.active),
      own,
      [{ actorKey: this.playerKey, unit: foe }],
      this.memory,
      this.catalog.items(this.encounterKey),
    );
    const decision = produced ?? this.decisionOf(production, view, self, foe),
      shadow = this.planner.inspect(
        input,
        decision,
        this.actionKeyOf(decision, own, foe),
        view.roll("ai.v2.seed"),
      ),
      canary = this.mode.gameplayCommitEnabled
        ? this.canary.project(this.mode, input, shadow, decision)
        : null,
      committed = canary?.controlsGameplay ? canary.decision : decision,
      command = this.commandOf(committed, view, production);
    this.remember(canary?.controlsGameplay ? committed : decision, command, view);
    this.lastTrace = {
      production: describe(production),
      committed: describe(command),
      fromV2: !!canary?.controlsGameplay,
      fromV1: !!produced,
      reason: canary?.reason ?? "shadow-only",
    };
    return command;
  }

  replacement(view: EnemyView, choices: readonly number[]): number {
    return this.base.replacement(view, choices);
  }

  observe(events: readonly BattleEvent[], round: number): void {
    const memory = this.memory;
    if (!memory) return;
    const turn = Math.max(1, round);
    for (const event of events) {
      if (event.type === "skill" && event.seat.side === "player") {
        const key = this.rulebook.unifiedSkill(event.skillId)?.stableKey;
        if (key) memory.observeSkill(turn, this.playerKey, key, event.damage > 0);
        if (event.target.side === "enemy" && event.damage > 0)
          memory.observeDamage(
            turn,
            this.playerKey,
            BattleAiActorKey.npcMember(event.target.member + 1),
            event.damage,
          );
      } else if (event.type === "switch" && event.side === "player") {
        const incoming = BattleAiActorKey.playerMember(event.to + 1);
        memory.observeSwitch(turn, BattleAiActorKey.playerMember(event.from + 1), incoming);
        this.playerKey = incoming;
      } else if (event.type === "faint") {
        memory.observeKnockout(
          turn,
          event.seat.side === "player"
            ? BattleAiActorKey.playerMember(event.seat.member + 1)
            : BattleAiActorKey.npcMember(event.seat.member + 1),
        );
      }
    }
  }

  // ------------------------------------------------------------------ translation

  private liveOf(unit: DesignTraitUnit, level: number): LiveBattleAiUnit {
    let live = this.live.get(unit);
    if (!live) {
      live = new LiveBattleAiUnit(unit, level, this.rules.status, this.rulebook);
      this.live.set(unit, live);
    }
    return live;
  }

  // ------------------------------------------------------------------ source v1

  /**
   * `VqsvBattleRuntime.selectEnemyAiDecision`'s engine call, over this fight's live units.
   *
   * The four unit lists are Java's, not a choice: the active pet is both the actor and the only ally,
   * the player standing opposite is the only opponent the enemy may act on, and the reserves are the
   * whole party — Java hands the array it was given, and the switch loop is the thing that skips the
   * active pet and anything fainted. The draw labels carry the tier because Java's trace keys them by
   * tier, and two different bots in one fight then cannot share a draw.
   */
  private runV1(view: EnemyView, own: OwnedUnit[], self: BattleAiUnit): BattleAiDecision {
    const profile = this.profile!,
      actor = view.party[view.active],
      tier = tierOfProfile(profile);
    return new BattleAiDecisionEngine(this.rulebook).decide({
      actor: self,
      allies: [self],
      opponents: [this.liveOf(view.foe, view.level("player", view.foeMember))],
      reserves: own.map((member) => member.unit),
      profile,
      itemOptions: (this.itemOptions ??= this.rulebook.itemLoadoutOptions()),
      itemBudgetRemaining: this.itemsRemaining,
      lastSkillId: this.lastSkill.get(actor) ?? -1,
      repeatedUses: this.repeatCount.get(actor) ?? 0,
      turn: view.round,
      turnsSinceSwitch: view.round - this.lastTacticalSwitchTurn,
      roller: {
        nextInt: (label, bound) => view.next(`battle.ai.1v1.${tier}.${label}`, bound),
      },
    });
  }

  /**
   * `executeEnemyAiDecision`'s bookkeeping, run for the decision the fight actually executed.
   *
   * The guard on the returned command is what keeps this honest: a decision the core could not carry
   * out — a switch under Giam Cầm, a skill whose slot went dry — spends nothing, so it must not shift
   * the repetition count, the switch cooldown or the item budget.
   */
  private remember(
    decision: BattleAiDecision | undefined,
    command: BattleCommand,
    view: EnemyView,
  ) {
    const actor = view.party[view.active];
    if (decision === undefined) return;
    if (decision.type === "SKILL" && command.kind === "skill") {
      if (actor.skillIds[command.slot] !== decision.skillId) return;
      const repeated =
        (this.lastSkill.get(actor) ?? -1) === decision.skillId
          ? (this.repeatCount.get(actor) ?? 0) + 1
          : 1;
      this.lastSkill.set(actor, decision.skillId);
      this.repeatCount.set(actor, repeated);
    } else if (decision.type === "SWITCH" && command.kind === "switch") {
      this.lastTacticalSwitchTurn = view.round;
    } else if (decision.type === "ITEM" && command.kind === "item") {
      this.itemsRemaining = Math.max(0, this.itemsRemaining - 1);
    }
  }

  /**
   * The turn a bot with nothing legal still takes: the first slot with a skill and PP left, else slot
   * zero, which is the dry turn the core lets through and the turn the reference game loses the same
   * way. `NONE` never counts as a remembered skill, exactly as in Java's switch.
   */
  private firstUsable(view: EnemyView): BattleCommand {
    const unit = view.party[view.active],
      slot = unit.skillIds.findIndex((id, index) => id >= 0 && unit.skillPp[index] > 0);
    return { kind: "skill", slot: Math.max(0, slot) };
  }

  /** The production command as the decision the planner and the canary expect. */
  private decisionOf(
    command: BattleCommand,
    view: EnemyView,
    self: BattleAiUnit,
    foe: BattleAiUnit,
  ): BattleAiDecision {
    const unit = view.party[view.active];
    if (command.kind === "skill") {
      const id = unit.skillIds[command.slot],
        row = this.rules.damage.skillRow(id);
      return BattleAiDecision.skill(id, row?.targetSide === 1 ? self : foe, 0, "basic-ai");
    }
    if (command.kind === "switch") return BattleAiDecision.switchTo(command.member, 0, "basic-ai");
    return BattleAiDecision.none("basic-ai");
  }

  /** `ProbeWebBattleMath.aiProductionActionKey`: the string the planner matches candidates against. */
  private actionKeyOf(decision: BattleAiDecision, own: OwnedUnit[], foe: BattleAiUnit): string {
    if (decision.type === "SKILL") {
      const key = this.rulebook.unifiedSkill(decision.skillId)?.stableKey ?? "";
      const target =
        decision.target === foe
          ? this.playerKey
          : own.find((member) => member.unit === decision.target)?.actorKey;
      return key && target ? `SKILL:${key}:${target.toString()}` : "";
    }
    if (decision.type === "SWITCH")
      return `SWITCH:${BattleAiActorKey.npcMember(decision.switchIndex + 1).toString()}`;
    return "";
  }

  /** The committed decision back as a core command; anything it cannot express keeps production. */
  private commandOf(
    decision: BattleAiDecision,
    view: EnemyView,
    production: BattleCommand,
  ): BattleCommand {
    const unit = view.party[view.active];
    switch (decision.type) {
      case "SKILL": {
        const slot = unit.skillIds.findIndex(
          (id, index) => id === decision.skillId && unit.skillPp[index] > 0,
        );
        return slot >= 0 ? { kind: "skill", slot } : production;
      }
      case "SWITCH":
        return view.maySwitch ? { kind: "switch", member: decision.switchIndex } : production;
      case "ITEM": {
        const member = view.party.findIndex((pet) => this.live.get(pet) === decision.target);
        return {
          kind: "item",
          itemId: decision.itemId,
          member: member >= 0 ? member : view.active,
        };
      }
      default:
        return production;
    }
  }
}

function describe(command: BattleCommand): string {
  switch (command.kind) {
    case "skill":
      return `skill#${command.slot}`;
    case "switch":
      return `switch→${command.member}`;
    case "item":
      return `item ${command.itemId}`;
    default:
      return command.kind;
  }
}
