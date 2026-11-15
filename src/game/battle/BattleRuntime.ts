import { winResultIndexWithCapture } from "./BattleOutcomeEngine";
import type { SkillFxDraw } from "./SkillFx";
import type { SourceActorPlacement, SourceSpecialPlacement } from "./SourceSkillAnimation";
import { StateOneLEffectTracker, type StateOneLEntry } from "./StateOneLEffect";
import type { InputCommand } from "../../core/input/GameCommand";
import type { SavedPet } from "../../persistence/SaveRepository";
import type { SourceItemData, SourceSkillData } from "../story/GameAssets";
import type { BattleContext } from "../story/SourceOpcodeInterpreter";
import {
  BattleDefinitionRegistry,
  battleWindowContains,
  type BattleDefinition,
  type BattlePhaseDefinition,
  type BattleSide,
} from "./BattleDefinition";
import { battleUiState, type BattleUiPet, type BattleUiState } from "./BattleUiState";
import {
  CATCH_LIST,
  commandIndexAt,
  contains,
  ITEM_LIST,
  listIndexAt,
  PET_STATE,
  petIndexAt,
  scrollbarOf,
  SHOP_LIST,
  SKILL_LIST,
  type BattleListLayout,
} from "./BattleListLayout";
import {
  clampIndexIntoVisible,
  dragScroll,
  pressScrollbar,
  scrollToShow,
} from "../../ui/UiScrollbarMath";
import type { BattleRules } from "./BattleRules";
import { BattleRandom } from "./BattleRandom";
import type { DesignTraitProjection } from "./DesignTraitProjection";
import type { DesignTraitUnit } from "./DesignTraits";
import { NO_HELD_ITEM } from "./HeldItems";
import { p7PostEffectText, resolveP7PostSkill, type P7PostSkillOutcome } from "./P7PostSkill";
import { resolveP7Strike } from "./P7Strike";
import type { StatusPresentationSlot } from "./StatusPresentation";
import { type StatusInstance, type StatusUnit, type StatusUnitBase } from "./StatusState";
import type { BattleCore } from "./engine/BattleCore";
import type { BattleServices } from "./engine/BattleServices";
import type { BattleSettlementReport } from "./engine/BattleSettlement";
import { MAX_PET_LEVEL, requiredExp, type LevelUpResult } from "./engine/PetProgression";
import {
  BattleCommandError,
  NO_LEGAL_SKILL_MESSAGE,
  SKILL_NOT_READY_WARNING,
  TIER_LOCK_WARNING,
  type BattleCommand,
  type BattleEvent,
  type BattleOutcome,
  CATCH_NOT_ALLOWED_TEXT,
  ITEMS_NOT_ALLOWED_TEXT,
  type Seat,
} from "./engine/BattleTypes";

/**
 * A fight on the battle core (`engine/BattleCore`): the core owns every rule and both teams; this
 * runtime only turns its events into what the screen plays. `party` is the save's own list of pets,
 * in the order the core's player side was built from.
 */
export type CoreBattleBinding = {
  core: BattleCore;
  party: SavedPet[];
  /** Names and profiles for the pet screen. */
  services?: BattleServices;
  /**
   * Writes the finished fight into the save. The runtime calls it once the end is played, so the
   * level-ups it reports are shown before the battle screen closes.
   */
  settle?: () => BattleSettlementReport;
  /** Play the shared source entry deployment before opening the command bar. */
  entryPresentation?: boolean;
  shopCurrency?: { money: number; badges: number };
};

/** One thing the screen plays, in the order the core reported it. */
type Beat =
  | { kind: "skill"; event: BattleEvent & { type: "skill" } }
  | { kind: "message"; text: string }
  /** A silent change to a bar: a status tick, an item, a knockout. */
  | { kind: "hp"; seat: Seat; hp?: number; delta?: number }
  /** A pet is recalled and another sent out on `side`. */
  | { kind: "switch"; side: BattleSide; from: number; to: number; text: string }
  | { kind: "catch"; caught: boolean }
  /** JavaSE P10/EXIT_FADE: the successful escape line remains visible for 12 ticks. */
  | { kind: "runExit" }
  | { kind: "end"; outcome: BattleOutcome }
  /** JavaSE P8: one visible run of the EXP bar, ending at either a level threshold or the award. */
  | { kind: "experience"; member: number; level: number; from: number; to: number; award: number }
  /** A party pet levelled up: the Thăng cấp card. */
  | { kind: "levelUp"; member: number; level: number; result: LevelUpResult }
  /** Everything is played: the battle screen may close. */
  | { kind: "finish" };

/** `BattleRuntime.result` for a fight the player lost (the world sends it back to its save point). */
export const BATTLE_RESULT_LOST = -3;

/**
 * `cpos.mid` (`VqsvBattleAnimationTables.cposRow`): the slide a pet makes into its seat, one row per
 * seat, as `x, y, x2, y2` per frame; the last frame is where the pet stands. A group is picked by the
 * fight's mode (`sourceCposGroup`), the enemy seat is row 0 and the player's row 1 (row 2 in group 1).
 */
export const CPOS_GROUPS: readonly (readonly (readonly number[])[])[] = [
  [
    [400, 33, 240, 81, 239, 33, 199, 81, 197, 80, 151, 84, 173, 106, 140, 87, 177, 103, 144, 85],
    [-400, 175, -80, 200, 0, 175, -32, 200, 53, 207, 24, 207, 72, 225, 40, 209, 70, 223, 36, 206],
  ],
  [
    [400, 17, 240, 48, 173, 17, 133, 48, 131, 54, 98, 46, 118, 67, 85, 50, 121, 63, 88, 46],
    [400, 77, 240, 76, 240, 77, 208, 76, 201, 93, 163, 83, 191, 103, 159, 86, 195, 100, 163, 83],
    [-80, 123, -70, 196, 47, 141, 17, 188, 102, 191, 75, 196, 122, 216, 89, 189, 118, 213, 85, 196],
    [-80, 103, -70, 182, 0, 104, -40, 153, 36, 155, 2, 161, 49, 182, 15, 164, 46, 179, 12, 161],
  ],
  [
    [118, 160, 800, 0, 152, 138, 800, 81, 161, 129, 800, 84, 177, 103, 144, 85],
    [-400, 175, -80, 200, 0, 175, -32, 200, 53, 207, 24, 207, 72, 225, 40, 209, 70, 223, 36, 206],
  ],
];
/** `SHORT_WAIT`: the incoming pet holds its first (off-screen) frame this long before it slides. */
const SWITCH_IN_HOLD = 6;

/** A sound the fight asks for; the screen drains them after each tick (`cues`). */
export type BattleCue =
  "hit" | "crit" | "miss" | "heal" | "faint" | "throw" | "catch" | "escape" | "switch" | "levelUp";

/** One drawn strip slot: the identity the projector picked plus the numeral badge over its corner. */
export type StatusStripSlot = StatusPresentationSlot & { badgeCell: number };

/** `VqsvBattleRuntime.TRAIT_ENEMY_SLOT` and `TRAIT_PLAYER_SLOT`, the projection's two seats in a 1v1. */
const TRAIT_ENEMY_SLOT = 0;
const TRAIT_PLAYER_SLOT = 1;
/** `golden-trait-battle.json`'s `slots.roundIndexAtEnter`: the round a 1v1 fight opens on. */
const TRAIT_ENTRY_ROUND = 1;

export type InteractiveBattleStage =
  | "fight"
  | "skillList"
  | "skillAction"
  | "itemList"
  | "petList"
  | "shop"
  | "warning"
  | "weak"
  | "sealList"
  | "captureFail"
  | "sealFail"
  | "retry"
  | "guaranteedList"
  | "captureSuccess"
  | "caught"
  | "runExit"
  /** The post-battle EXP bar is advancing with JavaSE's game.h.am cadence. */
  | "experience"
  /** The Thăng cấp card of a pet that levelled up; waits for confirm. */
  | "levelUp"
  /** A pet is recalled and another slides into the seat. */
  | "switching";

/** One signature-effect sprite placed on a seat: `elapsed` ticks into its animation. */
export interface SignatureFxPlacement {
  sprite: number;
  state: number;
  elapsed: number;
  x: number;
  y: number;
  mirror: boolean;
}

export class BattleRuntime {
  readonly definition: BattleDefinition;
  tickCount = 0;
  result = -2;
  branch = -1;
  complete = false;
  interactiveStage: InteractiveBattleStage = "fight";
  ui: BattleUiState = battleUiState("BATTLE");
  private readonly hpOverride: Partial<Record<BattleSide, number>> = {};
  private captureTick = 0;
  private tutorialInventory: Record<string, number> = {};
  private actionTick = 0;
  /** `p7LEffect*`: the state-1 L of the pet that lunges (`tickP7LEffect`). */
  private readonly lEffect = new StateOneLEffectTracker<BattleSide>();
  private selectedSkill: SourceSkillData | null = null;
  private actionDamage = 0;
  private actionCrit = false;
  /**
   * `p7Target`: the side the current skill was aimed at, which is the bar the HP tween owns. A buff
   * aimed at the player would otherwise write the player's HP into the enemy's bar.
   */
  private actionTargetSide: BattleSide = "enemy";
  private actionTargetHpStart = 0;
  private actionTargetHpEnd = 0;
  private actionAttackerHpEnd = 0;
  /** What the skill's own post-skill route spent, or null for a skill that has no route. */
  private actionPostSkill: P7PostSkillOutcome | null = null;
  private actionHit = true;
  /**
   * The two live combatants, built exactly when the fight is scored by the engines. HP, statuses and
   * the held item belong to them; `hpOverride` is only the bar the tween is drawing.
   */
  private sides: { player: DesignTraitUnit; enemy: DesignTraitUnit } | undefined;
  /**
   * `VqsvBattleRuntime.traitProjection`: this fight's characteristic and talent projection, bound to
   * this fight's own draw stream because the chance seams consume draws the battle is graded on.
   */
  readonly traitProjection: DesignTraitProjection | undefined;
  /** `VqsvBattleRuntime.turn`: the round the projection stamps on every seam it is asked about. */
  private roundIndex = TRAIT_ENTRY_ROUND;
  /** One draw stream per battle, the way Java's P7 walk asks for its rolls. */
  private readonly random = new BattleRandom();
  private readonly skills = new Map<number, SourceSkillData>();
  /** Set when the fight runs on the battle core. */
  readonly core: BattleCore | undefined;
  /** The save's party the core's player side was built from (settled when the fight ends). */
  readonly party: SavedPet[] | undefined;
  private readonly services: BattleServices | undefined;
  private readonly settle: (() => BattleSettlementReport) | undefined;
  private readonly entryPresentation: boolean;
  private readonly shopCurrency: { money: number; badges: number } | undefined;
  /** Presentation gate only; the battle/core remains on its ordinary fight request. */
  private entryDeploying = false;
  /** What the finished fight wrote into the save (core fights with a `settle`). */
  settlement: BattleSettlementReport | null = null;
  /** What is still to be played from the core's last answer. */
  private beats: Beat[] = [];
  /** Where the screen goes once the beats are played: back to the menu, or the tutorial's retry. */
  private afterBeats: InteractiveBattleStage = "fight";
  /** A message beat is up and waits for the confirm button. */
  private messageBeat = false;
  /** Presentation-only EXP cursor; settlement has already committed the authoritative save. */
  private expDisplay: {
    member: number;
    level: number;
    value: number;
    target: number;
    max: number;
    hold: number;
    initial: boolean;
  } | null = null;
  /** JavaSE holds a level card for 40 ticks, unless the player confirms sooner. */
  private levelUpHold = 0;
  private runExitHold = 0;
  /** The side whose skill is playing; the enemy has turns of its own on the core. */
  private actionCasterSide: BattleSide = "player";
  /** How the fight ended, once it has. */
  outcome: BattleOutcome | null = null;
  /**
   * The party member each seat shows and the HP each pet is drawn with. The core has already applied
   * the whole round when the beats start, so the screen walks its own copy forward beat by beat.
   */
  private displayMember: Record<BattleSide, number> = { player: 0, enemy: 0 };
  private shownHp: Record<BattleSide, number[]> = { player: [], enemy: [] };
  /** The item id behind each row of the bag list, and which kind of list it is. */
  private itemRowIds: number[] = [];
  private itemListKind: "capture" | "recovery" | undefined;
  /** The skill slot behind each row of the skill list. */
  private skillRowSlots: number[] = [];
  /**
   * The switch being played: the outgoing pet slides back out along its seat's `cpos` row (the web's
   * recall), then the incoming one holds off-screen and slides in the way Java's P15 does.
   */
  /** Sounds asked for since the screen last drained them (presentation only). */
  readonly cues: BattleCue[] = [];
  /** Where the held scrollbar thumb was grabbed, or null while none is held. */
  private scrollGrab: number | null = null;
  /** The tick each seat's shown pet was knocked out on (its fall plays from there). */
  private faintAt: Partial<Record<BattleSide, number>> = {};
  private switchAnim: {
    side: BattleSide;
    to: number;
    tick: number;
    outTicks: number;
    text: string;
  } | null = null;
  /** A recovery item waiting for its pet and/or skill to be picked. */
  private pendingItem: { itemId: number; member?: number } | null = null;
  private shopRowIds: number[] = [];
  private shopQuantity = 1;
  constructor(
    readonly context: BattleContext,
    definitions = new BattleDefinitionRegistry(),
    /**
     * The formula and status rules this fight is scored by. Only the keyframed intro timeline is
     * built without them: it replays authored HP and effect windows and never asks for a hit, while
     * an interactive fight resolves every one of its numbers through the engines, so the constructor
     * refuses one that arrives rule-free. The dev parity rig reads the status catalog off here to
     * plant a strip, which is the same catalog a commit plants from.
     */
    readonly rules?: BattleRules,
    private readonly ownedPet?: SavedPet,
    skills: readonly SourceSkillData[] = [],
    private readonly items: readonly SourceItemData[] = [],
    binding?: CoreBattleBinding,
  ) {
    this.definition = definitions.resolve(context);
    this.core = binding?.core;
    this.party = binding?.party;
    this.services = binding?.services;
    this.settle = binding?.settle;
    this.entryPresentation = binding?.entryPresentation === true;
    this.shopCurrency = binding?.shopCurrency;
    for (const skill of skills) this.skills.set(skill.id, skill);
    if (ownedPet) {
      this.hpOverride.player =
        ownedPet.currentHp ?? ownedPet.maxHp ?? this.definition.combatants.player.maxHp;
      ownedPet.skillIds ??= skills.map((skill) => skill.id);
      ownedPet.skillPp ??= skills.map((skill) => skill.pp);
    }
    if (this.core) {
      // The core seats both teams (entry pass, characteristics, talents); the bars start on them.
      this.core.start();
      this.resyncFromCore();
      if (this.entryPresentation) {
        this.entryDeploying = true;
        this.ui = battleUiState("BATTLE");
      }
      this.syncTutorialUi();
    } else if (this.definition.tutorial) {
      if (!rules) {
        throw new Error("an interactive battle is scored by the engine, so it needs its rules");
      }
      this.traitProjection = rules.newTraitProjection((label) => this.random.percent(label));
      this.sides = {
        player: this.createUnit(rules, "player"),
        enemy: this.createUnit(rules, "enemy"),
      };
      // `BattleUnit`'s opening move: the party pet stands on the HP the save left it on, which is
      // what `sourceCurrentHp >= 0 ? sourceCurrentHp : maxHp()` answers, while the encounter pet that
      // `enemyFromEncounter` builds has never been away from full.
      this.sides.player.setHp(ownedPet?.currentHp ?? this.sides.player.maxHp());
      this.enterTraits();
      // `playerDisplayHp` and `enemyDisplayHp` are read after the entry pass, because that pass is the
      // first thing that can move a unit's HP under it.
      this.hpOverride.player = this.sides.player.hp();
      this.hpOverride.enemy = this.sides.enemy.hp();
      this.syncTutorialUi();
    }
  }
  get sequenceTick(): number {
    return Math.max(0, this.tickCount - 1);
  }
  get phase(): BattlePhaseDefinition {
    if (this.interactiveStage === "skillAction")
      return { key: "P7_RESOLVE", start: this.tickCount - this.actionTick };
    let phase = this.definition.phases[0];
    for (const candidate of this.definition.phases) {
      if (candidate.start > this.tickCount) break;
      phase = candidate;
    }
    return phase;
  }
  /**
   * Who stands in a seat. On the core it is whichever pet the seat shows right now: the authored
   * combatant keeps its origin and element, the pet brings its own name, level, sprite and maximum HP.
   */
  combatant(side: BattleSide) {
    const authored = this.definition.combatants[side];
    if (!this.core) return authored;
    const member = this.displayMember[side],
      setup = this.core.setupOf(side, member),
      unit = this.core.unit(side, member);
    return {
      ...authored,
      speciesId: setup.speciesId,
      name: setup.name ?? authored.name,
      level:
        side === "player" && this.expDisplay?.member === member
          ? this.expDisplay.level
          : setup.level,
      spriteId: setup.spriteId ?? authored.spriteId,
      maxHp: unit.maxHp(),
      // `drawBattleSpriteAtSource(..., unit.nature)`: 7..9 draws the shiny palette.
      nature: setup.nature,
    };
  }
  /**
   * A skill the pet carries: the authored contract's own record first (the tutorial skills keep their
   * sprite effects), else one built from the battle catalogs — name, Power, PP and target from the skill
   * row, the description from its balance record, and a Cầu Vồng skill's `skill-fx` effect, whose length
   * is when its damage lands.
   */
  private skill(id: number): SourceSkillData | undefined {
    const authored = this.skills.get(id);
    if (authored) {
      const sourceTicks = this.rules?.sourceFx.totalTicks(id) ?? 0;
      if (sourceTicks > 0 && authored.animationTicks !== sourceTicks) {
        const sourceAuthored = {
          ...authored,
          animationSpriteId: -1,
          animationTicks: sourceTicks,
        };
        this.skills.set(id, sourceAuthored);
        return sourceAuthored;
      }
      return authored;
    }
    const row = this.rules?.damage.skillRow(id);
    if (!row || !this.rules) return undefined;
    const sourceTicks = this.rules.sourceFx.totalTicks(id),
      fxTicks = this.rules.fx.has(row.stableKey)
        ? this.rules.fx.totalTicks(row.stableKey)
        : this.rules.signatureFx.totalTicks(row.stableKey),
      fxKey = fxTicks > 0 ? row.stableKey : undefined,
      record: SourceSkillData = {
        id,
        name: row.name,
        description:
          this.rules.damage.lietHoaRecord(id)?.description ??
          this.rules.web?.skillDescription(id) ??
          "",
        element: row.elementFamily,
        power: row.powerPercent,
        learnTier: row.learnTier,
        pp: row.ppMax,
        effectMode: row.effectMode,
        effectId: row.effectId,
        chanceOrParam: row.chanceOrParam,
        targetSide: row.targetSide,
        effectRow: [],
        animationSpriteId: -1,
        animationState: 0,
        animationTicks: sourceTicks > 0 ? sourceTicks : fxKey ? Math.max(1, fxTicks) : 8,
        ...(fxKey ? { fxKey } : {}),
      };
    this.skills.set(id, record);
    return record;
  }
  /**
   * The pieces of the Cầu Vồng effect the selected skill is playing this tick, placed over the two seats
   * (`VqsvBattleRenderer.drawRainbowSkillAnimation`): the caster is the player, the target its skill's side.
   */
  get skillFxDraws(): SkillFxDraw[] {
    const skill = this.selectedSkill;
    if (this.interactiveStage !== "skillAction" || !skill?.fxKey || !this.rules) return [];
    if (!this.rules.fx.has(skill.fxKey)) return [];
    const frame = this.rules.fx.frameAt(skill.fxKey, this.actionTick);
    return this.rules.fx.draws(skill.fxKey, frame, {
      player: this.combatant("player").origin,
      enemy: this.combatant("enemy").origin,
      casterPlayerSide: this.actionCasterSide === "player",
      targetPlayerSide: this.core ? this.actionTargetSide === "player" : skill.targetSide === 1,
    });
  }
  /**
   * The world sprite animations a pet-design signature skill is playing this tick
   * (`SignatureSkillAnimationCatalog`): each over the caster (the player) or the skill's target, played
   * once from its start and held on its last frame, mirrored on the player's side.
   */
  get signatureFxSprites(): SignatureFxPlacement[] {
    const skill = this.selectedSkill;
    if (this.interactiveStage !== "skillAction" || !skill?.fxKey || !this.rules) return [];
    const targetSide: BattleSide = this.core
      ? this.actionTargetSide
      : skill.targetSide === 1
        ? "player"
        : "enemy";
    return this.rules.signatureFx.active(skill.fxKey, this.actionTick).map((event) => {
      const side: BattleSide = event.onCaster ? this.actionCasterSide : targetSide,
        origin = this.combatant(side).origin;
      return {
        sprite: event.sprite,
        state: event.state,
        elapsed: event.elapsed,
        x: origin.x,
        y: origin.y,
        mirror: side === "player",
      };
    });
  }

  private get sourceSkillFrame() {
    const skill = this.selectedSkill;
    if (this.interactiveStage !== "skillAction" || !skill || !this.rules?.sourceFx.has(skill.id))
      return undefined;
    return this.rules.sourceFx.frame(
      skill.id,
      this.actionTick,
      this.actionCasterSide,
      this.actionTargetSide,
    );
  }

  /** Actor-effect sprites produced by the current effect.mid chunk. */
  get sourceActorEffects(): SourceActorPlacement[] {
    return this.sourceSkillFrame?.actors ?? [];
  }

  /** The speffect.mid transform replacing its owner's ordinary pet draw this tick. */
  get sourceSpecialEffect(): SourceSpecialPlacement | undefined {
    return this.sourceSkillFrame?.special;
  }

  /** Ticks since effect.mid last changed this pet's base state (Java's base-state start tick). */
  sourceBaseElapsed(side: BattleSide): number | undefined {
    return this.sourceSkillFrame?.stateElapsed[side];
  }
  /**
   * `BattleStatusPresentationProjector.project` for the unit this side fights with, with the numeral
   * badge the renderer puts over each slot's corner.
   *
   * An authored timeline that never scores a hit has no unit behind it, so it answers with the empty
   * strip — the same thing the projector returns for a unit that owns no status, and the renderer
   * draws nothing for it because the source's own blank slot is fully transparent.
   */
  statusStrip(side: BattleSide): StatusStripSlot[] {
    const unit = this.sides?.[side];
    if (!unit || !this.rules) return [];
    const presentation = this.rules.presentation;
    return presentation.project(unit).map((slot) => ({
      ...slot,
      badgeCell: presentation.durationBadgeCell(slot.remainingDuration),
    }));
  }
  /**
   * The unit this side fights with, or undefined while the fight is only a keyframed timeline. The
   * renderer never asks for it — it reads `statusStrip` — but the dev parity rig plants the statuses
   * a real tutorial fight never accumulates here, through the same owner a commit uses.
   */
  statusUnit(side: BattleSide): StatusUnit | undefined {
    return this.sides?.[side];
  }
  /**
   * `VqsvBattleRuntime.battleRenderState`'s shieldHp slot: the live unit's pool, or 0 for a fight
   * that has no unit behind it. The bar tweens its hp, never its shield, which is why this reads the
   * unit directly instead of the same keyframed path `hp` walks.
   */
  shield(side: BattleSide): number {
    const unit = this.sides?.[side];
    return unit ? unit.shieldHp() : 0;
  }
  hp(side: BattleSide): number {
    const override = this.hpOverride[side];
    if (override !== undefined) return override;
    let value = this.combatant(side).maxHp;
    for (const keyframe of this.definition.hp[side]) {
      if (keyframe.from > this.sequenceTick) break;
      value = keyframe.value;
    }
    return value;
  }
  offset(side: BattleSide): { x: number; y: number } {
    const entry = this.deploymentOffset(side);
    if (entry) return entry;
    const slide = this.switchOffset(side);
    if (slide) return slide;
    const frame = this.definition.offsets[side].find((item) =>
      battleWindowContains(this.sequenceTick, item),
    );
    return frame ? { x: frame.x, y: frame.y } : { x: 0, y: 0 };
  }
  state(side: BattleSide): number {
    const source = this.sourceSkillFrame;
    if (source) return source.states[side] ?? 0;
    if (this.interactiveStage === "skillAction" && side === this.actionCasterSide) return 1;
    return (
      this.definition.animations[side].stateWindows.find((item) =>
        battleWindowContains(this.sequenceTick, item),
      )?.state ?? 0
    );
  }
  cursor(side: BattleSide): number {
    if (this.sourceSkillFrame) return this.actionTick;
    if (this.interactiveStage === "skillAction" && side === this.actionCasterSide)
      return Math.floor(this.actionTick / 2);
    return this.definition.animations[side].cursor(this.sequenceTick, this.state(side));
  }
  hidden(side: BattleSide): boolean {
    if (this.entryDeploying && !this.deploymentPetVisible(side)) return true;
    if (this.sourceSkillFrame?.hidden.includes(side)) return true;
    // On the core a knocked-out pet leaves its seat once its fall has been told.
    if (this.core && this.interactiveStage !== "switching")
      return (this.shownHp[side][this.displayMember[side]] ?? 1) <= 0;
    return (
      this.definition.hiddenWindows[side]?.some((window) =>
        battleWindowContains(this.sequenceTick, window),
      ) ?? false
    );
  }

  /** The shared ball/recall overlay used by initial deployment and tactical switches. */
  get summonVisual(): { x: number; y: number; tick: number; recall: boolean } | null {
    // Java P0/P15 moves the pet actor itself along `cpos.mid`; sprite 294 is only the ground
    // marker. The capture ball (269) must not be reused here — that invented arc was the visibly
    // misplaced "throw" seen on the web build.
    return null;
  }

  private entryStart(): number {
    return this.definition.phases.find((phase) => phase.key === "P0_ENTRY")?.start ?? 0;
  }
  private deploymentPetVisible(side: BattleSide): boolean {
    return !!side;
  }
  private deploymentOffset(side: BattleSide): { x: number; y: number } | null {
    if (!this.entryDeploying) return null;
    const tick = this.tickCount - this.entryStart() - SWITCH_IN_HOLD,
      row = this.switchRow(side),
      frames = row.length / 4,
      actor = side === "enemy" ? 0 : 1,
      activeActor = tick < 10 ? 0 : tick < 20 ? 1 : 2,
      frame =
        actor < activeActor
          ? frames - 1
          : actor > activeActor
            ? 0
            : Math.max(0, Math.min(frames - 1, Math.floor(Math.max(0, tick % 10) / 2))),
      at = frame * 4,
      last = (frames - 1) * 4;
    return { x: row[at] - row[last], y: row[at + 1] - row[last + 1] };
  }
  get activeMarker(): boolean {
    return (
      this.interactiveStage === "skillAction" ||
      this.definition.activeWindows.some((window) =>
        battleWindowContains(this.sequenceTick, window),
      )
    );
  }
  get activeMarkerSide(): BattleSide {
    return this.interactiveStage === "skillAction" ? this.actionCasterSide : "enemy";
  }
  get attackEffect(): {
    spriteId: number;
    state: number;
    cursor: number;
    target: BattleSide;
    timed: boolean;
  } | null {
    if (
      this.interactiveStage === "skillAction" &&
      this.selectedSkill &&
      !this.rules?.sourceFx.has(this.selectedSkill.id) &&
      this.selectedSkill.animationSpriteId >= 0 &&
      this.actionTick < this.selectedSkill.animationTicks
    )
      return {
        spriteId: this.selectedSkill.animationSpriteId,
        state: this.selectedSkill.animationState,
        cursor: this.actionTick,
        target: this.core
          ? this.actionTargetSide
          : this.selectedSkill.targetSide === 1
            ? "player"
            : "enemy",
        timed: true,
      };
    const effect = this.definition.effects.find((item) =>
      battleWindowContains(this.sequenceTick, item),
    );
    return effect
      ? {
          spriteId: effect.spriteId,
          state: effect.state,
          cursor: Math.floor((this.sequenceTick - effect.from) / effect.cursorDivisor),
          target: "player",
          timed: false,
        }
      : null;
  }
  /** The number over the struck pet; `target` is the seat it floats over. */
  get damage(): { label: string; text: string; critical: boolean; target: BattleSide } | null {
    if (this.interactiveStage === "skillAction" && this.selectedSkill) {
      const start = this.selectedSkill.animationTicks;
      if (this.actionTick >= start && this.actionTick < start + 12 && this.selectedSkill.power > 0)
        return {
          label: this.selectedSkill.name,
          text: this.core && !this.actionHit ? "Trượt" : `-${this.actionDamage}`,
          critical: this.actionHit && this.actionCrit,
          target: this.core ? this.actionTargetSide : "enemy",
        };
    }
    const damage = this.definition.damage.find((item) =>
      battleWindowContains(this.sequenceTick, item),
    );
    return damage
      ? { label: damage.label, text: `-${damage.value}`, critical: false, target: "enemy" }
      : null;
  }
  /**
   * `p7PostEffectText` and `p7PostEffectPlayerSide`, read after the post-damage modifiers ran: the HP
   * the attacker lost wins, then the name the route left behind, then the heal.
   *
   * The window is the one the source gives the post-effect widget, shared with the damage number.
   */
  get postEffect(): { text: string; target: BattleSide } | null {
    if (this.interactiveStage !== "skillAction" || !this.selectedSkill || !this.actionPostSkill)
      return null;
    const start = this.selectedSkill.animationTicks;
    if (this.actionTick < start || this.actionTick >= start + 12) return null;
    const effect = p7PostEffectText(this.actionPostSkill, this.actionAttackerHpEnd);
    return effect.text === ""
      ? null
      : { text: effect.text, target: effect.playerSide ? "player" : "enemy" };
  }
  get deathVisible(): boolean {
    return (
      !!this.definition.deathWindow &&
      battleWindowContains(this.sequenceTick, this.definition.deathWindow)
    );
  }
  /**
   * How far into its fall (sprite state 3) the seat's pet is, or -1 when it is not falling. The
   * authored timeline has the player's death window; on the core either seat's pet falls when the
   * beat that knocks it out is played.
   */
  faintTick(side: BattleSide): number {
    if (!this.core) return side === "player" && this.deathVisible ? this.deathTick : -1;
    const at = this.faintAt[side];
    return at !== undefined && (this.shownHp[side][this.displayMember[side]] ?? 1) <= 0
      ? this.tickCount - at
      : -1;
  }
  get deathTick(): number {
    return this.deathVisible ? this.sequenceTick - this.definition.deathWindow!.from : 0;
  }
  get prompt(): string {
    const tutorial = this.definition.tutorial;
    if (!tutorial) return "";
    return this.interactiveStage === "weak"
      ? tutorial.weakText
      : this.interactiveStage === "sealFail" || this.interactiveStage === "retry"
        ? tutorial.retryText
        : "";
  }
  get captureVisual(): {
    spriteId: number;
    state: number;
    tick: number;
    hideEnemy: boolean;
    phase: "throw" | "capture" | "ground";
    effect?: { scale10: number; dx: number; dy: number };
  } | null {
    const tutorial = this.definition.tutorial;
    if (
      !tutorial ||
      (this.interactiveStage !== "captureFail" && this.interactiveStage !== "captureSuccess")
    )
      return null;
    const [d0, , d2] = tutorial.captureDurations,
      [shrinkDuration, restoreDuration] = tutorial.captureEffectDurations,
      t = this.captureTick;
    if (t < d0)
      return {
        spriteId: tutorial.captureSpriteId,
        state: 0,
        tick: t,
        hideEnemy: false,
        phase: "throw",
      };
    let local = t - d0;
    if (local < shrinkDuration)
      return {
        spriteId: tutorial.captureSpriteId,
        state: 1,
        tick: 0,
        hideEnemy: true,
        phase: "capture",
        effect: this.captureEffect(tutorial.captureShrinkSteps, local, shrinkDuration),
      };
    local -= shrinkDuration;
    if (local < d2)
      return {
        spriteId: tutorial.captureSpriteId,
        state: 2,
        tick: local,
        hideEnemy: true,
        phase: "capture",
      };
    local -= d2;
    if (this.interactiveStage === "captureSuccess")
      return {
        spriteId: tutorial.captureSpriteId,
        state: 3,
        tick: local,
        hideEnemy: true,
        phase: "ground",
      };
    return {
      spriteId: tutorial.captureSpriteId,
      state: 1,
      tick: 0,
      hideEnemy: true,
      phase: "capture",
      effect: this.captureEffect(
        tutorial.captureRestoreSteps,
        Math.min(local, restoreDuration - 1),
        restoreDuration,
      ),
    };
  }
  catchChoice(inventory: Record<string, number>): { label: string; quantity: number } | null {
    const tutorial = this.definition.tutorial;
    if (!tutorial) return null;
    if (this.core) inventory = this.coreBag();
    if (this.interactiveStage === "sealList")
      return { label: "Phong ấn cầu", quantity: inventory[String(tutorial.sealBallId)] ?? 0 };
    if (this.interactiveStage === "guaranteedList")
      return {
        label: "Tất Trung Cầu",
        quantity: inventory[String(tutorial.guaranteedBallId)] ?? 0,
      };
    return null;
  }
  handleInput(commands: InputCommand[], inventory: Record<string, number>): void {
    if (this.complete) return;
    if (this.core) {
      this.handleCoreInput(commands);
      return;
    }
    this.tutorialInventory = inventory;
    if (commands.includes("back")) {
      if (
        [
          "skillList",
          "itemList",
          "petList",
          "shop",
          "warning",
          "sealList",
          "guaranteedList",
        ].includes(this.interactiveStage)
      )
        this.interactiveStage = "fight";
      this.syncTutorialUi(inventory);
      return;
    }
    if (this.interactiveStage === "fight") {
      if (commands.includes("left") || commands.includes("up"))
        this.ui.selectedIndex = (this.ui.selectedIndex + 5) % 6;
      if (commands.includes("right") || commands.includes("down"))
        this.ui.selectedIndex = (this.ui.selectedIndex + 1) % 6;
      if (commands.includes("confirm")) {
        if (this.ui.selectedIndex === 0) this.interactiveStage = "skillList";
        else if (this.ui.selectedIndex === 1)
          this.interactiveStage =
            this.hp("enemy") <= this.definition.tutorial!.weakHp ? "sealList" : "weak";
        else if (
          (this.ui.selectedIndex === 2 || this.ui.selectedIndex === 3) &&
          this.sides &&
          this.rules?.web?.switchAndItemsLocked(this.sides.player)
        ) {
          this.showWarning("Đang bị Giam Cầm: không thể đổi Sủng vật hay dùng Đạo cụ.");
        } else if (this.ui.selectedIndex === 2) {
          this.interactiveStage = "itemList";
          this.openItems(inventory);
        } else if (this.ui.selectedIndex === 3) {
          this.interactiveStage = "petList";
          this.openPets();
        } else if (this.ui.selectedIndex === 4) {
          this.openBattleShop();
        } else {
          this.interactiveStage = "warning";
          this.ui = {
            ...battleUiState("WARNING"),
            message: "Không thể chạy khỏi trận hướng dẫn.",
            prompt: "Nhấn nút 5",
          };
        }
      }
    } else if (this.interactiveStage === "skillList") {
      const count = Math.max(1, this.ui.rows.length);
      if (commands.includes("up")) this.selectListRow((this.ui.selectedIndex + count - 1) % count);
      if (commands.includes("down")) this.selectListRow((this.ui.selectedIndex + 1) % count);
      if (commands.includes("confirm")) this.startSelectedSkill();
    } else if (this.interactiveStage === "warning" && commands.includes("confirm"))
      this.interactiveStage = "fight";
    else if (this.interactiveStage === "weak" && commands.includes("confirm"))
      this.interactiveStage = "sealList";
    else if (this.interactiveStage === "sealList" && commands.includes("confirm")) {
      this.consume(inventory, this.definition.tutorial!.sealBallId);
      this.captureTick = 0;
      this.interactiveStage = "captureFail";
    } else if (this.interactiveStage === "sealFail" && commands.includes("confirm"))
      this.interactiveStage = "retry";
    else if (this.interactiveStage === "retry" && commands.includes("confirm"))
      this.interactiveStage = "guaranteedList";
    else if (this.interactiveStage === "guaranteedList" && commands.includes("confirm")) {
      this.consume(inventory, this.definition.tutorial!.guaranteedBallId);
      this.captureTick = 0;
      this.interactiveStage = "captureSuccess";
    }
    this.syncTutorialUi(inventory);
  }
  /**
   * A pointer press (`VqsvBattleRuntime`'s click handling): a command button runs its command; a list
   * row selects and runs it (a pet card only selects, as Java's does); the panel's action and back
   * buttons confirm and go back; a message box takes any press as confirm. Anything else is ignored.
   */
  pointer(x: number, y: number, inventory: Record<string, number>): void {
    const run = (command: InputCommand) => this.handleInput([command], inventory),
      stage = this.interactiveStage;
    if (stage === "fight") {
      const index = commandIndexAt(x, y);
      if (index < 0) return;
      this.ui.selectedIndex = index;
      run("confirm");
      return;
    }
    if (stage === "petList") {
      const tab = PET_STATE.tabs.findIndex((rect) => contains(x, y, rect));
      if (tab >= 0) this.ui.tab = tab;
      else if (contains(x, y, PET_STATE.previous)) this.selectListRow(this.ui.selectedIndex - 1);
      else if (contains(x, y, PET_STATE.next)) this.selectListRow(this.ui.selectedIndex + 1);
      else if (contains(x, y, PET_STATE.action)) run("confirm");
      else if (contains(x, y, PET_STATE.back)) run("back");
      else {
        const index = petIndexAt(x, y, this.ui.rows.length, this.ui.scroll);
        if (index >= 0) this.selectListRow(index);
      }
      return;
    }
    if (stage === "shop" && this.ui.mode === "SHOP_CONFIRM") {
      if (contains(x, y, { x: 46, y: 136, w: 38, h: 31 })) run("left");
      else if (contains(x, y, { x: 156, y: 136, w: 38, h: 31 })) run("right");
      else if (contains(x, y, { x: 45, y: 200, w: 64, h: 20 })) run("confirm");
      else if (contains(x, y, { x: 132, y: 200, w: 64, h: 20 })) run("back");
      return;
    }
    const layout = this.listLayout;
    if (layout) {
      const index = listIndexAt(layout, x, y, this.ui.rows.length, this.ui.scroll);
      if (index >= 0) {
        this.selectListRow(index);
        run("confirm");
      } else if (contains(x, y, layout.action)) run("confirm");
      else if (contains(x, y, layout.back)) run("back");
      return;
    }
    if (["skillAction", "switching", "captureFail", "captureSuccess", "runExit"].includes(stage))
      return;
    run("confirm");
  }

  /** The pointer moved (not dragging a scrollbar): the button or row under it becomes the cursor. */
  hover(x: number, y: number): void {
    if (this.complete) return;
    if (this.interactiveStage === "fight") {
      const index = commandIndexAt(x, y);
      if (index >= 0) this.ui.selectedIndex = index;
      return;
    }
    if (this.interactiveStage === "petList") {
      const index = petIndexAt(x, y, this.ui.rows.length, this.ui.scroll);
      if (index >= 0) this.selectListRow(index);
      return;
    }
    const layout = this.listLayout;
    if (!layout) return;
    const index = listIndexAt(layout, x, y, this.ui.rows.length, this.ui.scroll);
    if (index >= 0) this.selectListRow(index);
  }

  /**
   * `handleMouseWheel`: a list longer than its window scrolls (the cursor stays inside the window);
   * a short one moves the cursor instead.
   */
  wheel(steps: number): void {
    const visible = this.visibleRows;
    if (this.complete || steps === 0 || visible === 0) return;
    const size = this.ui.rows.length;
    if (size <= 0) return;
    const most = Math.max(0, size - visible);
    if (most <= 0) {
      this.selectListRow(this.ui.selectedIndex + steps);
      return;
    }
    this.ui.scroll = Math.max(0, Math.min(most, this.ui.scroll + steps));
    this.selectListRow(clampIndexIntoVisible(this.ui.selectedIndex, this.ui.scroll, size, visible));
  }

  /**
   * `pointerPressedScrollbar`: a press on the open list's bar either grabs the thumb (dragged until
   * the pointer is released) or pages the list. True when the press was the bar's.
   */
  pressScrollbar(x: number, y: number): boolean {
    const layout = this.listLayout;
    if (this.complete || !layout) return false;
    const pressed = pressScrollbar(x, y, this.ui.scroll, scrollbarOf(layout, this.ui.rows.length));
    if (!pressed) return false;
    if ("drag" in pressed) this.scrollGrab = pressed.drag;
    else this.applyScroll(pressed.scroll);
    return true;
  }
  /** Whether a scrollbar thumb is held. */
  get scrollbarDragging(): boolean {
    return this.scrollGrab !== null;
  }
  /** `dragScrollbar`: the held thumb follows the pointer. */
  dragScrollbar(y: number): void {
    const layout = this.listLayout;
    if (this.scrollGrab === null || !layout) {
      this.scrollGrab = null;
      return;
    }
    this.applyScroll(dragScroll(y, this.scrollGrab, scrollbarOf(layout, this.ui.rows.length)));
  }
  releaseScrollbar(): void {
    this.scrollGrab = null;
  }

  /** The open list's pointer layout: skills, the bag, or the ball list. */
  private get listLayout(): BattleListLayout | undefined {
    switch (this.interactiveStage) {
      case "skillList":
        return SKILL_LIST;
      case "itemList":
      case "sealList":
      case "guaranteedList":
        return this.catchListOpen ? CATCH_LIST : ITEM_LIST;
      case "shop":
        return this.ui.mode === "SHOP_BUY" ? SHOP_LIST : undefined;
      default:
        return undefined;
    }
  }
  /** How many rows the open list shows at once (0 when no list is open). */
  private get visibleRows(): number {
    if (this.interactiveStage === "petList") return PET_STATE.visiblePets;
    if (this.interactiveStage === "shop") return 5;
    return this.listLayout?.list.visibleRows ?? 0;
  }
  private applyScroll(next: number): void {
    const visible = this.visibleRows,
      size = this.ui.rows.length;
    this.ui.scroll = Math.max(0, Math.min(Math.max(0, size - visible), next));
    this.selectListRow(clampIndexIntoVisible(this.ui.selectedIndex, this.ui.scroll, size, visible));
  }
  /** Move the open list's cursor (clamped), keep it in the window and show its description. */
  private selectListRow(index: number): void {
    const size = this.ui.rows.length;
    if (size <= 0) return;
    this.ui.selectedIndex = Math.max(0, Math.min(size - 1, index));
    this.ui.scroll = scrollToShow(this.ui.selectedIndex, this.ui.scroll, size, this.visibleRows);
    if (this.interactiveStage !== "petList")
      this.ui.description = this.ui.rows[this.ui.selectedIndex]?.description ?? "";
  }
  confirm(inventory: Record<string, number>): void {
    this.handleInput(["confirm"], inventory);
  }
  tick(): void {
    if (this.complete) return;
    this.tickCount++;
    if (this.core) {
      this.tickCore();
      return;
    }
    const tutorial = this.definition.tutorial;
    if (tutorial) {
      if (this.interactiveStage === "skillAction") this.tickSkillAction();
      else if (this.interactiveStage === "captureFail") {
        this.captureTick++;
        const [a, , c] = tutorial.captureDurations,
          [shrink, restore] = tutorial.captureEffectDurations;
        if (this.captureTick >= a + shrink + c + restore) this.interactiveStage = "sealFail";
      } else if (this.interactiveStage === "captureSuccess") {
        this.captureTick++;
        const [a, , c, d] = tutorial.captureDurations,
          [shrink] = tutorial.captureEffectDurations;
        if (this.captureTick >= a + shrink + c + d) {
          this.interactiveStage = "caught";
          this.result = 0;
          this.branch = this.context.branchTargets[0] ?? -1;
          this.complete = true;
        }
      }
      this.syncTutorialUi();
      return;
    }
    if (this.tickCount >= this.definition.resultAt) {
      this.result = this.definition.resultIndex;
      this.branch = this.context.branchTargets[this.result] ?? -1;
    }
    if (this.tickCount >= this.definition.duration) this.complete = true;
  }
  setUiState(state: BattleUiState): void {
    this.ui = state;
  }
  private startSelectedSkill(): void {
    const sides = this.sides,
      web = this.rules?.web,
      roll = (label: string) => this.random.percent(label);
    let skillIndex = this.ui.selectedIndex,
      selfHit = false;
    // A skill the web rules cannot resolve yet (the Cầu Vồng ones) or a sacrifice the pet cannot pay
    // for is refused before the turn opens, so no status ticks and no PP is spent.
    const chosenId = this.ownedPet?.skillIds?.[skillIndex];
    if (
      chosenId !== undefined &&
      sides &&
      web &&
      !web.skillUsable(this.rules!.damage.skillRow(chosenId), sides.player)
    ) {
      this.showWarning(
        sides.player.canUseSkillTier(this.rules!.damage.skillRow(chosenId)?.learnTier ?? 0)
          ? SKILL_NOT_READY_WARNING
          : TIER_LOCK_WARNING,
      );
      return;
    }
    if (sides && web) {
      // The player's turn opens: the statuses its pet carries count down and bite first.
      web.ownerTurnStart(
        sides.player,
        (side) => (side === 0 ? sides.player : sides.enemy),
        this.dotSeams(sides.player, TRAIT_PLAYER_SLOT),
      );
      if (!sides.player.alive()) {
        this.finishTurn();
        return;
      }
      const block = web.beforeAction(sides.player, roll);
      if (block.blocked) {
        this.finishTurn();
        this.showWarning(`${block.status}: mất lượt hành động.`);
        return;
      }
      const control = web.controlAction(sides.player, skillIndex, this.usableSkills(), roll);
      skillIndex = control.skillIndex;
      selfHit = control.selfHit;
    }
    const id = this.ownedPet?.skillIds?.[skillIndex],
      skill = id === undefined ? undefined : this.skill(id),
      pp = this.ownedPet?.skillPp;
    if (!skill || !pp || pp[skillIndex] <= 0) {
      this.interactiveStage = "warning";
      this.ui = {
        ...battleUiState("WARNING"),
        message: "Kỹ năng không còn PP.",
        prompt: "Nhấn nút 5",
      };
      return;
    }
    // Điện áp: a skill costs 2 PP while it lasts (never more than the slot still has).
    const cost = sides && web ? web.ppCost(sides.player) : 1;
    pp[skillIndex] = Math.max(0, pp[skillIndex] - cost);
    this.selectedSkill = skill;
    this.actionTick = 0;
    this.lEffect.reset();
    this.actionPostSkill = null;
    if (sides && this.rules) {
      // `BattleUnit.selectSkill`, which the player's command commit runs before the strike: the
      // projection reads the selected skill when it is asked what the actor's own heal is worth.
      sides.player.selectedSkillId = skill.id;
      if (selfHit) this.resolveSelfHit(skill, sides, this.rules);
      else this.resolveP7Hit(skill, sides, this.rules);
    }
    this.interactiveStage = "skillAction";
    this.ui = battleUiState("BATTLE");
  }
  /**
   * `tickP7LEffect`, before this tick's effect.mid step: it reads the state the attacker was left in
   * (the frame shown last tick) and how long it has stood in it.
   */
  private tickLEffect(skill: SourceSkillData): void {
    const catalog = this.rules?.lEffect;
    if (!catalog) return;
    const side = this.actionCasterSide,
      attacker = this.combatant(side),
      t = this.actionTick - 1,
      source = this.rules!.sourceFx.has(skill.id)
        ? this.rules!.sourceFx.frame(skill.id, t, side, this.actionTargetSide)
        : undefined;
    this.lEffect.tick(
      attacker.spriteId >= 0 ? catalog.entry(attacker.speciesId) : undefined,
      side,
      source ? (source.states[side] ?? 0) : 1,
      source ? (source.stateElapsed[side] ?? 0) : t,
    );
  }
  /** The L shown this tick (`battleLVisible`: only while P7 phase 1 plays), or undefined. */
  get stateOneLEffect(): { entry: StateOneLEntry; side: BattleSide; frame: number } | undefined {
    const skill = this.selectedSkill,
      view = this.lEffect.view;
    if (this.interactiveStage !== "skillAction" || !skill || !view) return undefined;
    if (this.actionTick >= skill.animationTicks) return undefined;
    return { entry: view.entry, side: view.owner, frame: view.frame };
  }
  private tickSkillAction(): void {
    const skill = this.selectedSkill;
    if (!skill) {
      this.interactiveStage = "fight";
      return;
    }
    this.actionTick++;
    const damageStart = skill.animationTicks;
    // P7 phase 1 (the skill's animation) runs `tickP7LEffect` each tick until the damage lands.
    if (this.actionTick <= damageStart) this.tickLEffect(skill);
    if (this.core && this.actionTick === damageStart)
      this.cues.push(
        !this.actionHit ? "miss" : skill.power <= 0 ? "heal" : this.actionCrit ? "crit" : "hit",
      );
    if (
      this.actionHit &&
      skill.power > 0 &&
      this.actionTick >= damageStart &&
      this.actionTick < damageStart + 12
    ) {
      const progress = this.actionTick - damageStart + 1;
      this.hpOverride[this.actionTargetSide] = Math.max(
        this.actionTargetHpEnd,
        Math.round(
          this.actionTargetHpStart -
            ((this.actionTargetHpStart - this.actionTargetHpEnd) * progress) / 12,
        ),
      );
    }
    if (this.actionTick < damageStart + 18) return;
    if (this.core) {
      this.selectedSkill = null;
      this.actionTick = 0;
      this.landAction();
      this.nextBeat();
      return;
    }
    this.finishTurn();
    this.selectedSkill = null;
    this.actionTick = 0;
  }
  /**
   * The player's turn closes: its OWNER_TURN_END statuses heal and count down, then the round
   * boundary, then the bars fall back onto the units — the tween was the presentation of what the
   * engines already wrote into them, including the leech, the reflect on this side and whatever the
   * round passes took.
   */
  private finishTurn(): void {
    const sides = this.sides,
      web = this.rules?.web;
    if (sides && web) web.ownerTurnEnd(sides.player);
    if (sides) this.settlePivots(sides);
    this.endRound();
    if (sides) {
      this.hpOverride.player = sides.player.hp();
      this.hpOverride.enemy = sides.enemy.hp();
    }
    this.interactiveStage = this.hp("enemy") <= this.definition.tutorial!.weakHp ? "weak" : "fight";
  }
  /**
   * `VqsvBattleRuntime`'s check after an action: a PIVOT signature ("sau đòn chọn đổi sang 1 pet còn
   * sống") opens the switch when the side has a living reserve and is not under Giam Cầm, and is
   * dropped otherwise — "không có dự bị: vẫn đánh nhưng không đổi/không tạo khiên". This fight seats
   * one pet a side, so there is never a reserve, and a pivot left standing would hand its shield to
   * whichever pet a later switch brought in.
   */
  private settlePivots(sides: { player: DesignTraitUnit; enemy: DesignTraitUnit }): void {
    for (const unit of [sides.player, sides.enemy]) unit.signatureState.pendingPivot = false;
  }
  /**
   * `VqsvBattleRuntime`'s damage-over-time arm: each tick is projected as turn damage, then told to
   * the projection — the planter's `dot_tick_sustain` / `enemy_dot_heal_support` and the receiver's
   * 30% thresholds — and closed with `afterDamage`, as the Java queue does for Liệt Hỏa and Cầu Vồng
   * DOTs alike.
   */
  private dotSeams(unit: DesignTraitUnit, slot: number) {
    const projection = this.traitProjection;
    if (!projection) return undefined;
    return {
      damageProjection: (amount: number) =>
        projection.beforeDamage(
          undefined,
          TRAIT_ENEMY_SLOT,
          unit,
          slot,
          this.roundIndex,
          0,
          -1,
          amount,
          "TURN_DAMAGE",
        ),
      ticked: (status: StatusInstance, damage: number, hpBefore: number) => {
        projection.designDotTick(unit, status, damage, this.roundIndex);
        projection.afterDamage(
          undefined,
          TRAIT_ENEMY_SLOT,
          unit,
          slot,
          this.roundIndex,
          0,
          hpBefore,
          "TURN_DAMAGE",
        );
      },
    };
  }
  // ------------------------------------------------------------------ the battle core

  /** The core's bag as the string-keyed counts the menus read. */
  private coreBag(): Record<string, number> {
    const bag: Record<string, number> = {};
    for (const [id, count] of Object.entries(this.core!.bag())) bag[id] = count;
    return bag;
  }

  /** The two units the seats show (a switch beat changes who that is). */
  private refreshSides(): void {
    if (!this.core) return;
    this.sides = {
      player: this.core.unit("player", this.displayMember.player),
      enemy: this.core.unit("enemy", this.displayMember.enemy),
    };
  }

  /** Seats, bars and the shown HP table back on the core's own state. */
  private resyncFromCore(): void {
    const core = this.core!;
    for (const side of ["player", "enemy"] as const) {
      this.displayMember[side] = core.activeMember(side);
      this.shownHp[side] = Array.from({ length: core.partySize(side) }, (_, member) =>
        core.unit(side, member).hp(),
      );
    }
    this.refreshSides();
    this.showShownHp();
  }

  /** What the playing action leaves on its two pets once its animation ends. */
  private actionLands: { seat: Seat; hp: number }[] = [];
  private landAction(): void {
    for (const land of this.actionLands) this.setShownHp(land.seat, land.hp);
    this.actionLands = [];
    this.showShownHp();
  }
  /** One pet's shown HP; a pet in a seat that drops to 0 starts its fall here. */
  private setShownHp(seat: Seat, hp: number): void {
    const table = this.shownHp[seat.side],
      before = table[seat.member] ?? 0;
    table[seat.member] = hp;
    if (hp <= 0 && before > 0 && seat.member === this.displayMember[seat.side]) {
      this.faintAt[seat.side] = this.tickCount;
      this.cues.push("faint");
    } else if (hp > before && before > 0) this.cues.push("heal");
  }

  /** Both bars on the HP the screen has walked to. */
  private showShownHp(): void {
    for (const side of ["player", "enemy"] as const)
      this.hpOverride[side] = this.shownHp[side][this.displayMember[side]] ?? 0;
  }

  /** The pet whose skills the skill list shows: the active one, or the one an item is for. */
  private skillListPet(): { ids: readonly number[]; pp: readonly number[] } {
    if (this.core) {
      const member = this.pendingItem?.member ?? this.core.activeMember("player"),
        unit = this.core.unit("player", member);
      return { ids: unit.skillIds, pp: unit.skillPp };
    }
    return { ids: this.ownedPet?.skillIds ?? [], pp: this.ownedPet?.skillPp ?? [] };
  }

  /** Hand the core a command; a refusal is the warning box, anything else is played. */
  private submitToCore(
    answer: BattleCommand | { kind: "member"; member: number | null },
    afterBeats: InteractiveBattleStage = "fight",
  ): boolean {
    let events: BattleEvent[];
    try {
      events = this.core!.submit(answer);
    } catch (error) {
      if (!(error instanceof BattleCommandError)) throw error;
      this.showWarning(error.message);
      return false;
    }
    this.pendingItem = null;
    this.afterBeats = afterBeats;
    this.beats = this.beatsOf(events);
    this.nextBeat();
    return true;
  }

  private nameOf(side: BattleSide, member: number): string {
    return this.core!.setupOf(side, member).name ?? this.definition.combatants[side].name;
  }

  /** The core's events as the beats the screen plays; bookkeeping events have no beat. */
  private beatsOf(events: readonly BattleEvent[]): Beat[] {
    const beats: Beat[] = [];
    const message = (text: string) => beats.push({ kind: "message", text });
    for (const event of events) {
      switch (event.type) {
        case "skill":
          beats.push({ kind: "skill", event });
          break;
        case "statusTick":
          if (event.damage > 0 || event.heal > 0)
            beats.push({ kind: "hp", seat: event.seat, delta: event.heal - event.damage });
          break;
        case "blocked":
          message(
            `${this.nameOf(event.seat.side, event.seat.member)} — ${event.status}: mất lượt.`,
          );
          break;
        case "controlled":
          message(`${this.nameOf(event.seat.side, event.seat.member)} đang bị ${event.status}!`);
          break;
        case "noPp":
          message(`${this.nameOf(event.seat.side, event.seat.member)} không còn PP để ra chiêu.`);
          break;
        case "noLegalSkill":
          message(NO_LEGAL_SKILL_MESSAGE);
          break;
        case "catch":
          beats.push({ kind: "catch", caught: event.caught });
          break;
        case "faint":
          beats.push({ kind: "hp", seat: event.seat, hp: 0 });
          message(`${this.nameOf(event.seat.side, event.seat.member)} đã gục.`);
          break;
        case "switch":
          beats.push({
            kind: "switch",
            side: event.side,
            from: event.from,
            to: event.to,
            text:
              event.side === "player"
                ? `Đã thay đổi sủng vật: ${this.nameOf("player", event.to)}`
                : `Đối thủ thay đổi sủng vật: ${this.nameOf("enemy", event.to)}`,
          });
          break;
        case "item": {
          const name = this.items.find((item) => item.id === event.itemId)?.name ?? "vật phẩm",
            who = this.nameOf(event.seat.side, event.seat.member);
          if (event.hpGained > 0)
            beats.push({ kind: "hp", seat: event.seat, delta: event.hpGained });
          message(
            event.revived
              ? `Dùng ${name}: ${who} hồi sinh với ${event.hpGained} HP.`
              : event.hpGained > 0 && event.ppGained > 0
                ? `Dùng ${name}: ${who} hồi ${event.hpGained} HP và ${event.ppGained} PP.`
                : event.hpGained > 0
                  ? `Dùng ${name}: ${who} hồi ${event.hpGained} HP.`
                  : event.ppGained > 0
                    ? `Dùng ${name}: ${who} hồi ${event.ppGained} PP.`
                    : `Dùng ${name} cho ${who}.`,
          );
          break;
        }
        case "charmHeal":
          // `tickDispatch`: the player's charm and an NPC's word it differently.
          beats.push({ kind: "hp", seat: event.seat, delta: event.amount });
          message(
            event.seat.side === "player"
              ? `Bùa Cao cấp trị liệu hồi ${event.amount} HP.`
              : `Bùa đối phương hồi ${event.amount} HP.`,
          );
          break;
        case "longAn":
          // `applyLongAnReflect`: "Long Ấn -n" over the attacker and the log line.
          beats.push({ kind: "hp", seat: event.seat, hp: event.attackerHp });
          message(`Long Ấn phản ${event.damage} sát thương!`);
          break;
        case "charmRevive":
          beats.push({ kind: "hp", seat: event.seat, hp: event.hp });
          message("Bùa Trọng sinh làm tâm đã hồi sinh Pet.");
          break;
        case "run":
          beats.push({ kind: "runExit" });
          break;
        case "experience":
          if (event.amount > 0)
            message(`${this.nameOf("player", event.member)} nhận ${event.amount} EXP.`);
          break;
        case "end":
          beats.push({ kind: "end", outcome: event.outcome });
          break;
      }
    }
    return beats;
  }

  /** Play the next beat, or settle the screen on what the core is waiting for. */
  private nextBeat(): void {
    this.messageBeat = false;
    for (;;) {
      const beat = this.beats.shift();
      if (!beat) {
        this.resyncFromCore();
        this.afterQueue();
        return;
      }
      switch (beat.kind) {
        case "hp": {
          const max = this.core!.unit(beat.seat.side, beat.seat.member).maxHp(),
            current = this.shownHp[beat.seat.side][beat.seat.member] ?? 0;
          this.setShownHp(
            beat.seat,
            Math.max(0, Math.min(max, beat.hp ?? current + (beat.delta ?? 0))),
          );
          this.showShownHp();
          continue;
        }
        case "skill": {
          const event = beat.event,
            skill = this.skill(event.skillId);
          // The HP the action leaves is shown when its animation ends (the target's bar tweens).
          this.actionLands = [
            { seat: event.target, hp: event.targetHp },
            { seat: event.seat, hp: event.attackerHp },
          ];
          if (!skill) {
            this.landAction();
            continue;
          }
          this.selectedSkill = skill;
          this.actionCasterSide = event.seat.side;
          this.actionTargetSide = event.target.side;
          this.actionHit = event.hit;
          this.actionDamage = event.damage;
          this.actionCrit = event.crit;
          this.actionTargetHpStart = this.hp(event.target.side);
          this.actionTargetHpEnd = event.targetHp;
          this.actionAttackerHpEnd = event.attackerHp;
          this.actionPostSkill = null;
          this.actionTick = 0;
          this.lEffect.reset();
          this.interactiveStage = "skillAction";
          this.ui = battleUiState("BATTLE");
          return;
        }
        case "switch": {
          // A fainted pet has already left its seat: only the newcomer's slide is played.
          const outgoingDown = (this.shownHp[beat.side][beat.from] ?? 0) <= 0;
          this.switchAnim = {
            side: beat.side,
            to: beat.to,
            tick: 0,
            outTicks: outgoingDown ? 0 : this.switchFrames(beat.side) - 1,
            text: beat.text,
          };
          this.interactiveStage = "switching";
          this.ui = battleUiState("BATTLE");
          this.cues.push("switch");
          if (outgoingDown) this.swapSeat();
          return;
        }
        case "message":
          this.showMessageBeat(beat.text);
          return;
        case "catch":
          this.captureTick = 0;
          this.cues.push("throw");
          this.interactiveStage = beat.caught ? "captureSuccess" : "captureFail";
          this.ui = battleUiState("CATCH_ANIM");
          return;
        case "runExit":
          this.runExitHold = 12;
          this.interactiveStage = "runExit";
          this.ui = { ...battleUiState("WARNING"), message: "Chạy trốn", prompt: "" };
          return;
        case "end":
          this.outcome = beat.outcome;
          this.result =
            beat.outcome.winner === "enemy"
              ? BATTLE_RESULT_LOST
              : beat.outcome.reason === "run"
                ? -1
                : winResultIndexWithCapture({
                    bunnyCapture: false,
                    forcedResultIndex: 0,
                    catchSucceeded: beat.outcome.reason === "catch",
                    captureSuccessResultIndex: this.definition.captureSuccessResultIndex ?? -1,
                  });
          this.branch = this.result >= 0 ? (this.context.branchTargets[this.result] ?? -1) : -1;
          if (beat.outcome.reason === "catch") this.interactiveStage = "caught";
          this.resyncFromCore();
          const before = (this.party ?? []).map((pet) => ({
            level: pet.level,
            experience: pet.experience ?? 0,
          }));
          this.settlement = this.settle?.() ?? null;
          const storage = this.settlement?.caught?.storage;
          this.beats = [
            ...(storage === "BANK"
              ? [{ kind: "message", text: "Đội đã đủ 6 pet. Pet bắt được đã chuyển vào kho." } as const]
              : storage === "RELEASE"
                ? [{ kind: "message", text: "Đội và kho đã đầy. Pet bắt được đã được phóng sinh." } as const]
                : []),
            ...(this.settlement?.members ?? []).flatMap((entry, member): Beat[] => {
              if (entry.experience <= 0 || !this.party?.[member]) return [];
              const beats: Beat[] = [],
                start = before[member] ?? { level: entry.level, experience: 0 };
              let level = start.level,
                value = start.experience;
              for (const step of entry.levelUp.steps) {
                beats.push({
                  kind: "experience",
                  member,
                  level,
                  from: value,
                  to: requiredExp(level + 1),
                  award: entry.experience,
                });
                beats.push({
                  kind: "levelUp",
                  member,
                  level: step.level,
                  result: {
                    levelsGained: 1,
                    statsBefore: step.statsBefore,
                    statsAfter: step.statsAfter,
                    learned: step.learned,
                    pending: step.pending,
                    steps: [step],
                  },
                });
                level = step.level;
                value = 0;
              }
              const finalValue = this.party[member].experience ?? 0;
              if (entry.levelUp.steps.length === 0 || finalValue > 0)
                beats.push({
                  kind: "experience",
                  member,
                  level,
                  from: value,
                  to: finalValue,
                  award: entry.experience,
                });
              return beats;
            }),
            { kind: "finish" },
          ];
          continue;
        case "experience": {
          this.displayMember.player = beat.member;
          this.expDisplay = {
            member: beat.member,
            level: beat.level,
            value: beat.from,
            target: beat.to,
            max: requiredExp(beat.level + 1),
            hold: 0,
            initial: true,
          };
          this.interactiveStage = "experience";
          this.ui = battleUiState("BATTLE");
          return;
        }
        case "levelUp": {
          this.cues.push("levelUp");
          this.expDisplay = {
            member: beat.member,
            level: beat.level,
            value: 0,
            target: 0,
            max: beat.level >= MAX_PET_LEVEL ? 0 : requiredExp(beat.level + 1),
            hold: 0,
            initial: false,
          };
          this.levelUpHold = 40;
          const name = this.nameOf("player", beat.member),
            skillName = (id: number) => this.skill(id)?.name ?? `Skill ${id}`;
          this.interactiveStage = "levelUp";
          this.ui = {
            ...battleUiState("LEVEL_UP"),
            prompt: "Nhấn nút 5",
            levelUp: {
              name,
              level: beat.level,
              spriteId: this.core!.setupOf("player", beat.member).spriteId,
              nature: this.core!.setupOf("player", beat.member).nature,
              oldStats: beat.result.statsBefore ?? [0, 0, 0, 0],
              newStats: beat.result.statsAfter ?? [0, 0, 0, 0],
              learned: beat.result.learned.map(skillName),
              pending: beat.result.pending.map(skillName),
            },
          };
          return;
        }
        case "finish":
          this.expDisplay = null;
          this.complete = true;
          return;
      }
    }
  }

  private showMessageBeat(text: string): void {
    this.messageBeat = true;
    this.interactiveStage = "warning";
    this.ui = { ...battleUiState("WARNING"), message: text, prompt: "Nhấn nút 5" };
  }

  /** The beats are played: open what the core asks for next. */
  private afterQueue(): void {
    const request = this.core!.request;
    if (request.kind === "replacement" || request.kind === "pivot") {
      this.pendingItem = null;
      this.interactiveStage = "petList";
      this.openPets();
      return;
    }
    let stage = this.afterBeats;
    this.afterBeats = "fight";
    const weakHp = this.definition.tutorial?.weakHp;
    if (stage === "fight" && weakHp !== undefined && this.hp("enemy") <= weakHp) stage = "weak";
    this.interactiveStage = stage;
    this.syncTutorialUi();
  }

  /** Back to whatever the core is waiting for, dropping any half-picked item. */
  private resume(): void {
    this.pendingItem = null;
    this.afterQueue();
  }

  /** The seat's `cpos` row for this fight's mode. */
  private switchRow(side: BattleSide): readonly number[] {
    const [a = 0, b = 0] = this.context.mode,
      group = a === 0 ? (b === 1 ? 2 : 0) : 1,
      row = side === "enemy" ? 0 : group === 1 ? 2 : 1;
    return CPOS_GROUPS[group][row];
  }
  private switchFrames(side: BattleSide): number {
    return this.switchRow(side).length / 4;
  }
  /** Where the slide puts the seat's pet now, relative to where it stands; null when no slide. */
  private switchOffset(side: BattleSide): { x: number; y: number } | null {
    const anim = this.switchAnim;
    if (!anim || anim.side !== side || this.interactiveStage !== "switching") return null;
    const row = this.switchRow(side),
      frames = row.length / 4,
      last = (frames - 1) * 4,
      frame =
        anim.tick < anim.outTicks
          ? frames - 1 - (anim.tick + 1) // recall: back along the row, off the stage
          : Math.max(0, anim.tick - anim.outTicks - SWITCH_IN_HOLD),
      at = Math.max(0, Math.min(frames - 1, frame)) * 4;
    return { x: row[at] - row[last], y: row[at + 1] - row[last + 1] };
  }
  /** The incoming pet takes the seat: the sprite, the name, the bar. */
  private swapSeat(): void {
    const anim = this.switchAnim!;
    this.displayMember[anim.side] = anim.to;
    delete this.faintAt[anim.side];
    this.refreshSides();
    this.showShownHp();
  }
  private tickSwitch(): void {
    const anim = this.switchAnim;
    if (!anim) {
      this.nextBeat();
      return;
    }
    anim.tick++;
    if (anim.tick === anim.outTicks) this.swapSeat();
    if (anim.tick < anim.outTicks + SWITCH_IN_HOLD + this.switchFrames(anim.side) - 1) return;
    this.switchAnim = null;
    this.showMessageBeat(anim.text);
  }

  /** JavaSE `game.h.am`: one initial frame, then +8 EXP per 66 ms tick and a 10-tick tail. */
  private tickExperience(): void {
    const display = this.expDisplay;
    if (!display) {
      this.nextBeat();
      return;
    }
    if (display.initial) {
      display.initial = false;
      return;
    }
    if (display.value < display.target) {
      display.value = Math.min(display.target, display.value + 8);
      return;
    }
    display.hold++;
    if (display.hold >= 10) this.nextBeat();
  }

  private tickCore(): void {
    const tutorial = this.definition.tutorial;
    if (this.entryDeploying) {
      const dispatch =
        this.definition.phases.find((phase) => phase.key === "P1_DISPATCH")?.start ?? 0;
      const local = this.tickCount - this.entryStart() - SWITCH_IN_HOLD;
      if (local === 0 || local === 10) this.cues.push("switch");
      if (this.tickCount >= dispatch) {
        this.entryDeploying = false;
      }
    } else if (this.interactiveStage === "runExit") {
      this.runExitHold--;
      if (this.runExitHold <= 0) this.nextBeat();
    } else if (this.interactiveStage === "experience") this.tickExperience();
    else if (this.interactiveStage === "levelUp") {
      this.levelUpHold--;
      if (this.levelUpHold <= 0) this.nextBeat();
    } else if (this.interactiveStage === "switching") this.tickSwitch();
    else if (this.interactiveStage === "skillAction") this.tickSkillAction();
    else if (this.interactiveStage === "captureFail") {
      this.captureTick++;
      const [a, , c] = tutorial?.captureDurations ?? [0, 0, 0],
        [shrink, restore] = tutorial?.captureEffectDurations ?? [0, 0];
      if (this.captureTick >= a + shrink + c + restore) {
        this.cues.push("escape");
        this.nextBeat();
      }
    } else if (this.interactiveStage === "captureSuccess") {
      this.captureTick++;
      const [a, , c, d] = tutorial?.captureDurations ?? [0, 0, 0, 0],
        [shrink] = tutorial?.captureEffectDurations ?? [0];
      if (this.captureTick >= a + shrink + c + d) {
        this.cues.push("catch");
        this.nextBeat();
      }
    }
    if (!this.complete) this.syncTutorialUi();
  }

  private handleCoreInput(commands: InputCommand[]): void {
    if (this.entryDeploying) return;
    const core = this.core!,
      stage = this.interactiveStage,
      confirm = commands.includes("confirm");
    if (commands.includes("back")) {
      if (stage === "shop" && this.ui.mode === "SHOP_CONFIRM") {
        this.ui.mode = "SHOP_BUY";
        this.ui.message = "";
        return;
      }
      if (stage === "petList" && core.request.kind === "replacement") return;
      if (stage === "petList" && core.request.kind === "pivot") {
        this.submitToCore({ kind: "member", member: null });
        return;
      }
      if (
        ["skillList", "itemList", "petList", "shop", "sealList", "guaranteedList"].includes(
          stage,
        ) ||
        (stage === "warning" && !this.messageBeat)
      )
        this.resume();
      return;
    }
    const count = Math.max(1, this.ui.rows.length);
    switch (stage) {
      case "fight":
        if (commands.includes("left") || commands.includes("up"))
          this.ui.selectedIndex = (this.ui.selectedIndex + 5) % 6;
        if (commands.includes("right") || commands.includes("down"))
          this.ui.selectedIndex = (this.ui.selectedIndex + 1) % 6;
        if (confirm) this.openCoreMenu(this.ui.selectedIndex);
        return;
      case "skillList":
      case "itemList":
      case "petList":
        if (stage === "petList") {
          // Left and right turn the pet screen's tabs: Hồ sơ, Chỉ số, Đặc tính, Kỹ năng.
          if (commands.includes("left")) this.ui.tab = ((this.ui.tab ?? 0) + 3) % 4;
          if (commands.includes("right")) this.ui.tab = ((this.ui.tab ?? 0) + 1) % 4;
        }
        if (commands.includes("up"))
          this.selectListRow((this.ui.selectedIndex + count - 1) % count);
        if (commands.includes("down")) this.selectListRow((this.ui.selectedIndex + 1) % count);
        if (!confirm) return;
        if (stage === "skillList") this.confirmSkillRow();
        else if (stage === "itemList") this.confirmItemRow();
        else this.confirmPetRow();
        return;
      case "warning":
        if (!confirm) return;
        if (this.messageBeat) this.nextBeat();
        else this.resume();
        return;
      case "levelUp":
        if (confirm) this.nextBeat();
        return;
      case "experience":
        if (!confirm || !this.expDisplay) return;
        if (this.expDisplay.value < this.expDisplay.target)
          this.expDisplay.value = this.expDisplay.target;
        else this.nextBeat();
        return;
      case "weak":
        if (confirm) {
          this.interactiveStage = "sealList";
          this.syncTutorialUi();
        }
        return;
      case "sealList":
        if (confirm)
          this.submitToCore(
            { kind: "catch", itemId: this.definition.tutorial!.sealBallId },
            "sealFail",
          );
        return;
      case "sealFail":
        if (confirm) {
          this.interactiveStage = "retry";
          this.syncTutorialUi();
        }
        return;
      case "retry":
        if (confirm) {
          this.interactiveStage = "guaranteedList";
          this.syncTutorialUi();
        }
        return;
      case "guaranteedList":
        if (confirm)
          this.submitToCore({ kind: "catch", itemId: this.definition.tutorial!.guaranteedBallId });
        return;
      case "shop":
        if (this.ui.mode === "SHOP_CONFIRM") {
          if (commands.includes("left")) this.changeShopQuantity(-1);
          if (commands.includes("right")) this.changeShopQuantity(1);
          if (confirm) this.buyShopSelection();
          return;
        }
        if (commands.includes("up"))
          this.selectListRow((this.ui.selectedIndex + count - 1) % count);
        if (commands.includes("down")) this.selectListRow((this.ui.selectedIndex + 1) % count);
        if (confirm) this.openShopConfirm();
        return;
      default:
        return;
    }
  }

  /** The command bar: Chiêu, Bắt, Đạo cụ, Sủng vật, Thương điếm, Chạy. */
  private openCoreMenu(index: number): void {
    const tutorial = this.definition.tutorial,
      locked = !!this.sides && !!this.rules?.web?.switchAndItemsLocked(this.sides.player);
    this.pendingItem = null;
    if (index === 0) {
      this.interactiveStage = "skillList";
      this.ui.selectedIndex = 0;
      this.syncTutorialUi();
    } else if (index === 1) {
      if (tutorial) {
        // The lesson's hint already played when the bunny was worn down: the ball list opens.
        this.interactiveStage = "sealList";
        this.syncTutorialUi();
      } else if (!this.core!.captureAllowed())
        // `decideCommand` answers the softkey itself: a fight whose enemy belongs to somebody else
        // never opens the ball list, so there is no throw to waste a turn on.
        this.showWarning(CATCH_NOT_ALLOWED_TEXT);
      else if (locked) this.showWarning("Đang bị Giam Cầm: không thể dùng vật phẩm.");
      else {
        this.interactiveStage = "itemList";
        this.openItems(this.coreBag(), "capture");
      }
    } else if (index === 2 && !this.core!.itemsAllowed()) {
      this.showWarning(ITEMS_NOT_ALLOWED_TEXT);
    } else if ((index === 2 || index === 3) && locked) {
      this.showWarning("Đang bị Giam Cầm: không thể đổi Sủng vật hay dùng Đạo cụ.");
    } else if (index === 2) {
      this.interactiveStage = "itemList";
      this.openItems(this.coreBag(), "recovery");
    } else if (index === 3) {
      this.interactiveStage = "petList";
      this.openPets();
    } else if (index === 4) {
      if (this.core!.itemsAllowed()) this.openBattleShop();
      else this.showWarning("Tháp không mở thương nhân trong trận.");
    } else if (tutorial) this.showWarning("Không thể chạy khỏi trận hướng dẫn.");
    else this.submitToCore({ kind: "run" });
  }

  /** Java `prepareShopMenu`: table-4 stock except the removed SMS Tất Trung Cầu offer. */
  private openBattleShop(): void {
    const stock = this.items.filter((item) => item.id !== 0),
      rows = stock.map((item) => ({
        name: item.name,
        value: String(item.paramA * 2),
        currency: item.paramB,
        description: item.description,
        iconCell: item.iconCell,
      }));
    this.shopRowIds = stock.map((item) => item.id);
    this.shopQuantity = 1;
    this.interactiveStage = "shop";
    this.ui = {
      ...battleUiState("SHOP_BUY"),
      title: "Mua sắm",
      prompt: "Mua",
      rows,
      description: rows[0]?.description ?? "",
      shopMoney: this.shopCurrency?.money ?? 0,
      shopBadges: this.shopCurrency?.badges ?? 0,
    };
  }

  private selectedShopItem(): SourceItemData | undefined {
    const id = this.shopRowIds[this.ui.selectedIndex];
    return this.items.find((item) => item.id === id);
  }
  private shopMaximum(item: SourceItemData): number {
    const owned = this.core?.bag()[item.id] ?? 0,
      price = Math.max(0, item.paramA * 2),
      funds = item.paramB === 1 ? this.shopCurrency?.badges : this.shopCurrency?.money;
    if (item.paramB === 2 || funds === undefined) return 0;
    return Math.max(0, Math.min(99 - owned, price === 0 ? 99 : Math.floor(funds / price)));
  }
  private syncShopConfirm(): void {
    const item = this.selectedShopItem();
    this.ui.shopTotal = item ? Math.max(0, item.paramA * 2) * this.shopQuantity : 0;
    this.ui.shopCurrency = item?.paramB ?? 0;
    this.ui.message = `Số lượng ${this.shopQuantity}`;
  }
  private openShopConfirm(): void {
    const item = this.selectedShopItem();
    if (!item) return;
    if (!this.shopCurrency) {
      this.ui.description = "Thương điếm chưa được nối với túi tiền của người chơi.";
      return;
    }
    if (item.paramB === 2) {
      this.ui.description = "Vật phẩm dùng Vàng chưa khả dụng trong chế độ offline.";
      return;
    }
    const maximum = this.shopMaximum(item);
    if (maximum <= 0) {
      this.ui.description =
        (this.core?.bag()[item.id] ?? 0) >= 99 ? "Túi đã đầy." : "Không đủ tiền.";
      return;
    }
    this.shopQuantity = 1;
    this.ui.mode = "SHOP_CONFIRM";
    this.syncShopConfirm();
  }
  private changeShopQuantity(delta: number): void {
    const item = this.selectedShopItem();
    if (!item) return;
    this.shopQuantity = Math.max(1, Math.min(this.shopMaximum(item), this.shopQuantity + delta));
    this.syncShopConfirm();
  }
  private buyShopSelection(): void {
    const item = this.selectedShopItem(),
      currency = this.shopCurrency;
    if (!item || !currency) return;
    const maximum = this.shopMaximum(item);
    if (maximum <= 0) {
      this.ui.mode = "SHOP_BUY";
      this.ui.description = "Không đủ tiền hoặc túi đã đầy.";
      return;
    }
    const quantity = Math.min(maximum, this.shopQuantity),
      total = Math.max(0, item.paramA * 2) * quantity;
    if (item.paramB === 1) currency.badges -= total;
    else currency.money -= total;
    this.core?.addItem(item.id, quantity);
    this.ui.mode = "SHOP_BUY";
    this.ui.message = "";
    this.ui.description = `Đã mua ${quantity} ${item.name}.`;
    this.ui.shopMoney = currency.money;
    this.ui.shopBadges = currency.badges;
  }

  private confirmSkillRow(): void {
    const slot = this.skillRowSlots[this.ui.selectedIndex];
    if (slot === undefined) return;
    if (this.pendingItem)
      this.submitToCore({
        kind: "item",
        itemId: this.pendingItem.itemId,
        member: this.pendingItem.member,
        skillSlot: slot,
      });
    else this.submitToCore({ kind: "skill", slot });
  }

  private confirmItemRow(): void {
    const core = this.core!,
      itemId = this.itemRowIds[this.ui.selectedIndex],
      item = itemId === undefined ? undefined : core.item(itemId);
    if (itemId === undefined) return;
    if (!item) {
      this.showWarning("Vật phẩm này không dùng được trong trận.");
      return;
    }
    if (item.kind === "capture") {
      this.submitToCore({ kind: "catch", itemId });
      return;
    }
    this.pendingItem = { itemId };
    if (item.mechanic === "revive" || core.partySize("player") > 1) {
      this.interactiveStage = "petList";
      this.ui.selectedIndex = core.activeMember("player");
      this.openPets();
      return;
    }
    this.pendingItem.member = core.activeMember("player");
    this.itemNeedsSlotOrSubmit();
  }

  private confirmPetRow(): void {
    const core = this.core!,
      member = this.ui.selectedIndex,
      request = core.request.kind;
    if (request === "replacement" || request === "pivot") {
      this.submitToCore({ kind: "member", member });
      return;
    }
    if (this.pendingItem) {
      this.pendingItem.member = member;
      this.itemNeedsSlotOrSubmit();
      return;
    }
    if (member === core.activeMember("player")) {
      this.showWarning("Pet này đang ra trận.");
      return;
    }
    this.submitToCore({ kind: "switch", member });
  }

  /** Everything the pet screen shows about one party pet. */
  private petCard(member: number): BattleUiPet {
    const core = this.core!,
      unit = core.unit("player", member),
      setup = core.setupOf("player", member),
      saved = this.party?.[member],
      level = setup.level,
      need = level >= MAX_PET_LEVEL ? 0 : requiredExp(level + 1),
      profile = this.services?.profile(setup);
    return {
      spriteId: setup.spriteId ?? this.definition.combatants.player.spriteId,
      nature: setup.nature,
      element: setup.element ?? -1,
      elementName: ["Hỏa", "Mộc", "Thổ", "Thủy", "Điện", "Quỷ", "Phong"][setup.element ?? -1],
      level,
      hp: unit.hp(),
      maxHp: unit.maxHp(),
      expPercent:
        need > 0 ? Math.floor((100 * Math.min(need, saved?.experience ?? 0)) / need) : 100,
      quality: setup.quality,
      status: !unit.alive()
        ? "Đã gục"
        : member === core.activeMember("player")
          ? "Đang ra trận"
          : "Sẵn sàng",
      divineSealed: this.services?.divinePercent?.(setup.speciesId) === 30,
      held: profile?.held ?? "Trống",
      stats: [
        unit.maxHp(),
        unit.currentStats.attack,
        unit.currentStats.defense,
        unit.currentStats.speed,
      ],
      trait: profile?.trait,
      talent: profile?.talent,
      speciesName: profile?.species,
      evolution: profile?.evolution,
      buffCount: unit.activeBuffCount(),
      debuffCount: unit.activeDebuffCount(),
      skills: unit.skillIds.flatMap((id, slot) =>
        id >= 0
          ? [
              {
                name: this.skill(id)?.name ?? `Skill ${id}`,
                pp: `${unit.skillPp[slot]}/${this.rules?.damage.skillRow(id)?.ppMax ?? 0}`,
                element: this.skill(id)?.element,
              },
            ]
          : [],
      ),
    };
  }

  /**
   * The EXP bar under the player's seat: the shown pet's progress to its next level. The authored
   * timeline keeps its own numbers.
   */
  get experienceBar(): { value: number; max: number } {
    if (this.expDisplay) return { value: this.expDisplay.value, max: this.expDisplay.max };
    if (!this.core || !this.party) return this.definition.experience;
    const pet = this.party[this.displayMember.player],
      level = pet?.level ?? 1;
    return {
      value: pet?.experience ?? 0,
      max: level >= MAX_PET_LEVEL ? 0 : requiredExp(level + 1),
    };
  }

  /** The bag list is showing balls: the renderer draws the catch panel for it. */
  get catchListOpen(): boolean {
    return (
      this.interactiveStage === "sealList" ||
      this.interactiveStage === "guaranteedList" ||
      (this.interactiveStage === "itemList" && this.itemListKind === "capture")
    );
  }

  /** A PP item asks for its skill; anything else is used now. */
  private itemNeedsSlotOrSubmit(): void {
    const pending = this.pendingItem!,
      item = this.core!.item(pending.itemId);
    if (
      item?.kind === "recovery" &&
      (item.target === "one_skill" || item.target === "pet_and_one_skill")
    ) {
      this.interactiveStage = "skillList";
      this.ui.selectedIndex = 0;
      this.syncTutorialUi();
      this.ui.title = "Chọn Skill";
      return;
    }
    this.submitToCore({ kind: "item", itemId: pending.itemId, member: pending.member });
  }

  private showWarning(message: string): void {
    this.interactiveStage = "warning";
    this.ui = { ...battleUiState("WARNING"), message, prompt: "Nhấn nút 5" };
  }
  /** The skill slots the pet could use now: Hỗn Loạn draws its random skill from these. */
  private usableSkills(): { index: number; damaging: boolean }[] {
    const ids = this.ownedPet?.skillIds ?? [],
      pp = this.ownedPet?.skillPp ?? [];
    return ids.flatMap((id, index) => {
      const skill = this.skill(id),
        web = this.rules?.web,
        usable =
          !web ||
          !this.sides ||
          web.skillUsable(this.rules!.damage.skillRow(id), this.sides.player);
      return skill && usable && (pp[index] ?? 0) > 0 ? [{ index, damaging: skill.power > 0 }] : [];
    });
  }
  /**
   * Quỷ Mị / Hỗn Loạn turned the skill on its user: the skill's own damage lands on the caster and
   * none of its effects do.
   */
  private resolveSelfHit(
    skill: SourceSkillData,
    sides: { player: DesignTraitUnit; enemy: DesignTraitUnit },
    rules: BattleRules,
  ): void {
    const self = sides.player,
      before = self.hp(),
      combatant = {
        speciesId: self.speciesId,
        attack: self.currentStats.attack,
        defense: self.currentStats.defense,
        visualSpriteId: this.combatant("player").spriteId,
        unit: self,
      },
      outcome = rules.damage.damage({
        attacker: combatant,
        target: combatant,
        skillId: skill.id,
        randomPercent: (label) => this.random.percent(`battle.selfHit.${label}`),
      });
    self.damage(outcome.damage);
    this.actionHit = true;
    this.actionDamage = outcome.damage;
    this.actionCrit = outcome.critFlag === 1;
    this.actionTargetSide = "player";
    this.actionTargetHpStart = before;
    this.actionTargetHpEnd = self.hp();
    this.actionAttackerHpEnd = self.hp();
    this.actionPostSkill = null;
  }
  /**
   * `VqsvBattleRuntime`'s `RESET_ROUND` arm: the bleed is paid on both seats first, then the round-end
   * pass runs on both, and only then does the round advance. `applySourceBadgeRoundGrowth` is the one
   * step of that arm this port does not have — a battle badge is not modelled yet.
   *
   * The source reaches this arm through dispatch once each side has spent its action, and this port has
   * no enemy P7 owner: the player's strike is the whole round, so the boundary is the end of that
   * action. The two dispatch arms above `RESET_ROUND` answer a side that is down, which is why neither
   * the ticks nor the round number move once a unit has fallen.
   */
  private endRound(): void {
    const projection = this.traitProjection;
    const sides = this.sides;
    if (!projection || !sides) return;
    if (!sides.player.alive() || !sides.enemy.alive()) return;
    // The enemy has no turn of its own yet, so its statuses take theirs here: they still count down
    // and bite once per round. Moves to the enemy's turn when the runtime gives it one.
    const web = this.rules?.web;
    if (web) {
      web.ownerTurnStart(
        sides.enemy,
        (side) => (side === 0 ? sides.player : sides.enemy),
        this.dotSeams(sides.enemy, TRAIT_ENEMY_SLOT),
      );
      web.ownerTurnEnd(sides.enemy);
      if (!sides.enemy.alive()) return;
    }
    projection.tickDesignBleeding(sides.player, this.roundIndex);
    projection.tickDesignBleeding(sides.enemy, this.roundIndex);
    projection.onRoundEnd(sides.player, TRAIT_PLAYER_SLOT, this.roundIndex, 0);
    projection.onRoundEnd(sides.enemy, TRAIT_ENEMY_SLOT, this.roundIndex, 0);
    this.roundIndex++;
  }
  /**
   * `VqsvBattleRuntime`'s battle entry pass: the enemy's seat is opened first and the player's second,
   * both on the round the fight opens and with action index 0. This is where a characteristic takes its
   * opening — the stacks it enters on, the round its cooldowns are measured from, and the seat list
   * every later opponent lookup walks.
   */
  private enterTraits(): void {
    const projection = this.traitProjection;
    const sides = this.sides;
    if (!projection || !sides) return;
    projection.onBattleEnter(sides.enemy, TRAIT_ENEMY_SLOT, this.roundIndex, 0);
    projection.onBattleEnter(sides.player, TRAIT_PLAYER_SLOT, this.roundIndex, 0);
  }
  /**
   * `BattleUnit.fromSpecies` for one side of an interactive fight: the four stats the definition
   * carries are the unit's base stats, and the build ends the way Java's does — `copyBaseToCurrent()`
   * then `restoreStatsForCheck()`. The golden `p7Step` rows are measured from units built exactly this
   * way.
   *
   * The unit is a `DesignTraitUnit` rather than a plain `StatusUnit` because Java has only one unit
   * class, and the reproject is what reads the characteristic standing behind those stats. This is
   * where the scene1 fight changes: the recorded `beforeEnter` answer has Thỏ Trắng at defense 20 —
   * its `hp_band_defense` over the 60 percent band — while a plain `StatusUnit` build left it at its
   * base 12, and every damage number in the tutorial was drawn from the 12.
   */
  private createUnit(rules: BattleRules, side: BattleSide): DesignTraitUnit {
    const combatant = this.combatant(side);
    const unit = rules.traits.unit({
      speciesId: combatant.speciesId,
      ownerSide: side === "player" ? 0 : 1,
      formationSlot: 0,
      base: this.unitBase(side),
      // `PetState.physicalTraitId`: the talent the player's saved pet was rolled with, or `-1` for
      // none. The wild enemy side is not built from a save and Java's `enemyFromEncounter` rolls a
      // talent it never keeps, so only the owned pet carries one into the fight.
      physicalTraitId: side === "player" ? this.ownedPet?.physicalTraitId : undefined,
      // `enemyFromEncounter` builds the encounter pet with the sentinel form slot, so the wild side
      // never holds an item; the party pet carries whatever the save says it does.
      heldItemId:
        side === "player" ? (this.ownedPet?.heldEquipmentId ?? NO_HELD_ITEM) : NO_HELD_ITEM,
    });
    // `fromSpeciesInternal` ends with the reproject, so a pet that walks in above an HP band or
    // holding Kiếm Khí is already standing on the projected stat when the first number is drawn.
    unit.restoreStatsForCheck();
    return unit;
  }
  private unitBase(side: BattleSide): StatusUnitBase {
    const combatant = this.combatant(side);
    if (
      combatant.attack === undefined ||
      combatant.defense === undefined ||
      combatant.speed === undefined
    ) {
      throw new Error(
        `the ${side} combatant of "${this.definition.id}" has no authored attack, defense or speed:` +
          " an interactive fight is scored from a unit's four stats, so a definition without them has" +
          " no number to hit with",
      );
    }
    return {
      hp: combatant.maxHp,
      attack: combatant.attack,
      defense: combatant.defense,
      speed: combatant.speed,
    };
  }
  /**
   * `VqsvBattleRuntime.applyP7Damage` for the player's strike. The walk itself lives in
   * `resolveP7Strike`, which the golden table's `p7Step` rows grade step by step, and this spends
   * what it returns on the two HP bars the fight is tweening.
   *
   * The strike carries the skill's own post-skill route with it, because the source does: the runtime
   * hands `applyP7PostSkillEffects` the same `p7Target` the damage step aimed at, so the buff a
   * self-aimed skill promises is planted on the caster and the strip the renderer draws is that unit's.
   *
   * It carries this fight's projection too, on the two seats the 1v1 owns. Without it the walk is the
   * identity the `p7Step` rows were measured on; with it the pierce, the miss chance, the hit itself
   * and the closing `afterSkillAction` are the projection's answers, in the order the engine asks.
   */
  private resolveP7Hit(
    skill: SourceSkillData,
    sides: { player: DesignTraitUnit; enemy: DesignTraitUnit },
    rules: BattleRules,
  ): void {
    // `pvpSkillTarget`: a row that aims at its own side resolves against the caster, and everything
    // that skill still owes — its buff, its heal, the debuff a no-damage producer plants — lands on
    // the unit this picks, not on whoever happens to be standing opposite.
    const targetSide: BattleSide = skill.targetSide === 1 ? "player" : "enemy",
      target = sides[targetSide],
      targetHpBefore = target.hp(),
      trace = resolveP7Strike({
        attacker: sides.player,
        receiver: target,
        skillId: skill.id,
        rules,
        random: this.random,
        attackerSpriteId: this.combatant("player").spriteId,
        receiverSpriteId: this.combatant(targetSide).spriteId,
        // The 1v1 owner's whole context: the player is allowed to throw a ball (a wild pet, not a
        // trainer's), the player is the attacker and the enemy is the one being hit.
        allowsHpFloor: !this.definition.trainer && targetSide === "enemy",
        postSkill: resolveP7PostSkill,
        trait: this.traitProjection && {
          projection: this.traitProjection,
          attacker: sides.player,
          receiver: target,
          attackerSlot: TRAIT_PLAYER_SLOT,
          // `traitSlot(p7DamageReceiver)`: the receiver is whoever this side's unit is, and in a 1v1
          // the seat is decided by the side rather than by a formation index.
          receiverSlot: targetSide === "player" ? TRAIT_PLAYER_SLOT : TRAIT_ENEMY_SLOT,
          roundIndex: this.roundIndex,
          // `currentActorPlayer ? !enemyActionThisRound : ...`: this port has no enemy P7 owner yet,
          // so the player is always the round's first actor.
          actedFirst: true,
        },
      });
    this.actionHit = trace.hit;
    this.actionDamage = trace.damage;
    this.actionCrit = trace.critFlag === 1;
    this.actionTargetSide = targetSide;
    this.actionTargetHpStart = targetHpBefore;
    this.actionTargetHpEnd = trace.targetHpEnd;
    this.actionAttackerHpEnd = trace.attackerHpEnd;
    this.actionPostSkill = trace.postSkill ?? null;
    // Web: U Minh Triều hands back the PP it just spent; Tử Thần Xúc Ấn burns every slot to zero.
    const ppEffect = trace.zeroPower ? undefined : trace.unifiedPp,
      pp = this.ownedPet?.skillPp;
    if (ppEffect && pp) {
      if (ppEffect.exhaust) pp.fill(0);
      else if (ppEffect.refund > 0) {
        const slot = this.ownedPet?.skillIds?.indexOf(skill.id) ?? -1,
          maximum = this.rules?.damage.skillRow(skill.id)?.ppMax ?? skill.pp;
        if (slot >= 0) pp[slot] = Math.min(maximum, pp[slot] + ppEffect.refund);
      }
    }
  }
  private captureEffect(
    steps: Array<[number, number, number]>,
    tick: number,
    duration: number,
  ): { scale10: number; dx: number; dy: number } {
    const span = Math.max(1, Math.floor(duration / Math.max(1, steps.length))),
      index = Math.max(0, Math.min(steps.length - 1, Math.floor(tick / span))),
      step = steps[index] ?? [10, 0, 0];
    return { scale10: step[0], dx: step[1], dy: step[2] };
  }
  /**
   * The bag list. On the core it shows only what the fight can use — the balls for Bắt, the recovery
   * items for Đạo cụ — and remembers the item id behind each row.
   */
  private openItems(inventory: Record<string, number>, kind?: "capture" | "recovery"): void {
    const catalog = new Map(this.items.map((item) => [item.id, item])),
      entries = Object.entries(inventory).filter(
        ([id, count]) => count > 0 && (!kind || this.core?.item(Number(id))?.kind === kind),
      );
    this.itemRowIds = entries.map(([id]) => Number(id));
    this.itemListKind = kind;
    const rows = entries.map(([id, count]) => {
      const item = catalog.get(Number(id)),
        battleItem = this.core?.item(Number(id)),
        name = item?.name ?? battleItem?.name ?? `Đạo cụ ${id}`;
      if (kind === "capture")
        return {
          name,
          value: battleItem?.kind === "capture" && battleItem.guaranteed ? "100%" : "--",
          description: `Số lượng: ${count} cái`,
          iconCell: item?.iconCell ?? Number(id),
        };
      return {
        name,
        value: String(count),
        description: item?.description ?? "",
        iconCell: item?.iconCell ?? Number(id),
      };
    });
    this.ui = {
      ...battleUiState("CHOICE"),
      title: kind === "capture" ? "Bắt sủng vật" : "Đạo cụ",
      prompt: "Sử dụng",
      rows,
      description:
        rows.length === 0
          ? kind === "capture"
            ? "Không còn cầu bắt Pet."
            : "Không có vật phẩm dùng được trong trận."
          : (rows[0]?.description ?? ""),
    };
  }
  private openPets(): void {
    if (this.core) {
      const core = this.core,
        request = core.request.kind,
        rows = Array.from({ length: core.partySize("player") }, (_, member) => {
          const unit = core.unit("player", member),
            active = member === core.activeMember("player");
          return {
            name: this.nameOf("player", member),
            value: `${unit.hp()}/${unit.maxHp()}`,
            enabled: this.pendingItem ? true : unit.alive() && !active,
            pet: this.petCard(member),
          };
        });
      const keep = Math.min(this.ui.selectedIndex, rows.length - 1);
      this.ui = {
        ...battleUiState("PET_STATE"),
        tab: this.ui.mode === "PET_STATE" ? this.ui.tab : 0,
        // The cursor stays where the player left it; a replacement screen opened on a pet that is
        // already down starts on the first one that can actually be sent out, so a plain confirm on
        // the default row is never a dead end.
        selectedIndex: rows[keep]?.enabled
          ? keep
          : Math.max(
              0,
              rows.findIndex((row) => row.enabled),
            ),
        title: "Sủng vật",
        prompt: this.pendingItem ? "Chọn" : "Xuất chiến",
        rows,
        description:
          request === "replacement"
            ? "Pet đã gục: chọn Pet ra trận."
            : request === "pivot"
              ? "Chọn Pet để đổi, hoặc quay lại để ở lại."
              : "",
      };
      return;
    }
    this.ui = {
      ...battleUiState("PET_STATE"),
      title: "Sủng vật",
      prompt: "Xuất chiến",
      rows: [
        {
          name: this.combatant("player").name,
          value: `${this.hp("player")}/${this.combatant("player").maxHp}`,
        },
      ],
      description: "",
    };
  }
  private syncTutorialUi(inventory: Record<string, number> = this.tutorialInventory): void {
    const tutorial = this.definition.tutorial;
    // Every interactive screen builds its menus here, not only the lesson's: a source fight carries no
    // tutorial block and still has to show its command bar, skill list and action beat.
    if (!tutorial && !this.core) return;
    if (this.core) inventory = this.coreBag();
    if (this.interactiveStage === "fight") {
      const selected = this.ui.mode === "COMMAND" ? this.ui.selectedIndex : 0;
      this.ui = { ...battleUiState("COMMAND"), title: "Chiến đấu", selectedIndex: selected };
    } else if (this.interactiveStage === "skillList") {
      const pet = this.skillListPet(),
        slots = pet.ids.flatMap((id, slot) => (id >= 0 ? [slot] : [])),
        ids = slots.map((slot) => pet.ids[slot]),
        pp = slots.map((slot) => pet.pp[slot] ?? 0);
      this.skillRowSlots = slots;
      this.ui = {
        ...battleUiState("CHOICE_SKILL"),
        title: "Chiến đấu",
        prompt: "Sử dụng",
        // The window a wheel or a dragged bar left is kept while the list stays open.
        scroll: this.ui.mode === "CHOICE_SKILL" ? this.ui.scroll : 0,
        selectedIndex: Math.min(this.ui.selectedIndex, Math.max(0, ids.length - 1)),
        rows: ids.map((id, index) => {
          const skill = this.skill(id);
          return {
            name: skill?.name ?? `Skill ${id}`,
            value: `${pp[index] ?? 0}/${skill?.pp ?? 0}`,
            description: skill?.description ?? "",
            enabled: (pp[index] ?? 0) > 0,
            element: skill?.element,
            power: skill?.power,
            tier: skill?.learnTier,
            targetSide: skill?.targetSide,
            chance: skill?.chanceOrParam,
          };
        }),
        description: "",
      };
      this.ui.description = this.ui.rows[this.ui.selectedIndex]?.description ?? "";
    } else if (
      tutorial &&
      (this.interactiveStage === "sealList" || this.interactiveStage === "guaranteedList")
    ) {
      const guaranteed = this.interactiveStage === "guaranteedList",
        id = guaranteed ? tutorial.guaranteedBallId : tutorial.sealBallId,
        item = this.items.find((candidate) => candidate.id === id);
      this.ui = {
        ...battleUiState("CHOICE"),
        title: "Bắt sủng vật",
        prompt: "Sử dụng",
        rows: [
          {
            name: item?.name ?? (guaranteed ? "Tất Trung Cầu" : "Phong ấn cầu"),
            value: guaranteed ? "100%" : "--",
            description: `Số lượng: ${inventory[String(id)] ?? 0} cái`,
            iconCell: item?.iconCell ?? id,
          },
        ],
      };
    } else if (
      this.interactiveStage === "captureFail" ||
      this.interactiveStage === "captureSuccess"
    )
      this.ui = battleUiState("CATCH_ANIM");
    else if (
      tutorial &&
      (this.interactiveStage === "sealFail" || this.interactiveStage === "retry")
    )
      this.ui = { ...battleUiState("WARNING"), message: tutorial.retryText, prompt: "Nhấn nút 5" };
    else if (this.interactiveStage === "skillAction") this.ui = battleUiState("BATTLE");
    else if (this.interactiveStage === "weak") this.ui = battleUiState("BATTLE");
  }
  private consume(inventory: Record<string, number>, itemId: number): void {
    const key = String(itemId);
    inventory[key] = Math.max(0, (inventory[key] ?? 0) - 1);
  }
}
