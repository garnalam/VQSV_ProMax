import type { InputCommand } from "../../core/input/GameCommand";
import type { BattleRules } from "./BattleRules";
import { battleUiState, type BattleUiPet, type BattleUiState } from "./BattleUiState";
import { CPOS_GROUPS } from "./BattleRuntime";
import type { StatusPresentationSlot } from "./StatusPresentation";
import {
  BattleCommandError,
  SKILL_NOT_READY_WARNING,
  TIER_LOCK_WARNING,
} from "./engine/BattleTypes";
import type { DoubleBattleCore } from "./engine/DoubleBattleCore";
import type { DoubleEvent, DoubleSlot, PlayerSlot } from "./engine/DoubleBattleTypes";
import { MAX_PET_LEVEL, requiredExp } from "./engine/PetProgression";
import type { BattleItems } from "./engine/BattleItems";
import { DoubleActionFx, type DoubleFxRole } from "./DoubleSkillFx";
import type { SkillFxDraw } from "./SkillFx";
import { StateOneLEffectTracker, type StateOneLEntry } from "./StateOneLEffect";

/** What the 2v2 screen reads beyond the battle rules: names, elements, items, a fall's length. */
export type DoubleBattleView = {
  items: BattleItems;
  /** A bag item's list row: name, description, sprite-258 icon cell. */
  itemInfo: (itemId: number) => { name: string; description: string; iconCell: number } | undefined;
  speciesName: (speciesId: number) => string | undefined;
  speciesElement: (speciesId: number) => number;
  /** `actionDeathDuration` for a sprite. */
  fallTicks: (spriteId: number) => number;
};

/** `CPOS_GROUP` 1: the four formation rows (`VqsvBattleAnimationTables.cposRow(1, slot)`). */
const FORMATION_ROWS = CPOS_GROUPS[1];
const SLOTS: readonly DoubleSlot[] = [0, 1, 2, 3];
const ELEMENT_NAMES = ["Hỏa", "Mộc", "Thổ", "Thủy", "Điện", "Quỷ", "Phong"];
/** `VqsvDoubleBattleRuntime`'s holds, in ticks. */
const ROUND_START_HOLD = 8;
const ITEM_HOLD = 12;
const BLOCKED_HOLD = 10;
const RESULT_HOLD = 24;
/** `tickAction`'s phase-2 and phase-3 waits (6 ticks each) after the hit has settled. */
const SETTLE_TICKS = 6;
/** `actionDamageTextActive`: `bloodRow(0)` (11 frames) after a hit, `bloodRow(1)` (6) after a miss. */
const HIT_TEXT_TICKS = 11;
const MISS_TEXT_TICKS = 6;

type Stage = "entry" | "command" | "skill" | "target" | "pet" | "item" | "playing" | "done";
type PetPurpose = "switch" | "replacement" | "item";

/** One formation slot as the renderer reads it (`VqsvDoubleBattlePresentationState.SlotState`). */
export type DoubleSlotView = {
  actorX: number;
  actorY: number;
  markerX: number;
  markerY: number;
  visible: boolean;
  spriteId: number;
  /** The pet's nature: 7..9 draws the shiny palette (`PetShinyPalette`). */
  nature: number;
  spriteState: number;
  stateTick: number;
  name: string;
  level: number;
  element: number;
  hp: number;
  maxHp: number;
  shield: number;
};

type Beat = { event: DoubleEvent; phase: number; ticks: number };

/** `actionDeath*`: the fallen pet fades out band by band over `duration` ticks. */
export type DoubleDeathView = {
  slot: DoubleSlot;
  spriteId: number;
  tick: number;
  duration: number;
};

/** What the action's skill effect draws this tick, already placed on formation slots. */
export type DoubleFxView = {
  actorEffect: {
    slot: DoubleSlot;
    sprite: number;
    state: number;
    cursor: number;
    sourceId: number;
  } | null;
  special: {
    slot: DoubleSlot;
    type: number;
    values: readonly number[];
    ticks: number;
    duration: number;
  } | null;
  /** A Cầu Vồng effect's pieces, placed over the caster's and the target's slots. */
  skillFxDraws: SkillFxDraw[];
  /** A signature effect's world sprites, each over its slot and mirrored on the player's side. */
  signatureSprites: {
    sprite: number;
    state: number;
    elapsed: number;
    x: number;
    y: number;
    mirror: boolean;
  }[];
};

/**
 * The 2v2 screen over `DoubleBattleCore`: `VqsvDoubleBattleRuntime`'s presentation half.
 *
 * Entry slides the four pets in along `cpos` group 1 (two ticks a frame, slot by slot, each odd slot
 * starting before its partner lands); a commanded slot gets the command bar, the skill list, the
 * target cursor over a formation slot, or the pet screen; then the core's events play one by one —
 * the actor's action pose, the receiver's hit pose with the damage text and the HP bar walking
 * Java's tween, a fall, a slide for a replacement — and the result holds before the screen closes.
 */
export class DoubleBattleRuntime {
  tickCount = 0;
  ui: BattleUiState = battleUiState("BATTLE");
  readonly catchListOpen = false;
  stage: Stage = "entry";
  /** The slot whose command or target is being chosen, or whose pose is active. */
  activeActorSlot: DoubleSlot | -1 = -1;
  activeTargetSlot: DoubleSlot | -1 = -1;
  /** `battleLog`, which Java only draws with the debug flag. */
  log = "";
  damage: {
    slot: DoubleSlot;
    text: string;
    critical: boolean;
    miss: boolean;
    tick: number;
  } | null = null;
  /** The pet fading out (`battleP7DeathEffect*`). */
  death: DoubleDeathView | null = null;

  /** The cpos frame each slot is drawn at (`applyCposFrame`). */
  private readonly frame = [0, 0, 0, 0];
  /** `entryFrames`: the slide-in counters, applied before they advance, so the drawn frame lags. */
  private readonly entryFrames = [0, 0, 0, 0];
  private readonly visible = [false, false, false, false];
  /** `actionHidden`: a speffect transform or a fall is drawn in the pet's place. */
  private readonly hidden = [false, false, false, false];
  private fx: DoubleActionFx | null = null;
  private deathTicks = 0;
  private readonly spriteState = [0, 0, 0, 0];
  private readonly stateStart = [0, 0, 0, 0];
  /** `actionLEffect*`: the state-1 L of the pet that lunges (`tickActionLEffect`). */
  private readonly lEffect = new StateOneLEffectTracker<DoubleSlot>();
  private readonly displayHp = [0, 0, 0, 0];
  private entrySlot = 0;
  private entryCadence = 0;
  private readonly beats: Beat[] = [];
  private beat: Beat | null = null;
  private hold = 0;
  private commandIndex = 0;
  private commandSlot: PlayerSlot = 2;
  private skillSlots: number[] = [];
  private targets: DoubleSlot[] = [];
  private pendingSkill = -1;
  private petPurpose: PetPurpose = "switch";
  private pendingItem = -1;
  private itemIds: number[] = [];
  private tween = { slot: -1, step: 0, accum: 0, delay: 0, target: 0 };
  /** `actionDeathSlot`: the pet this action has already felled. */
  private deathSlot: DoubleSlot | -1 = -1;
  private slide: { slot: DoubleSlot; frame: number; cadence: number } | null = null;

  constructor(
    readonly core: DoubleBattleCore,
    private readonly rules: BattleRules,
    private readonly view: DoubleBattleView,
  ) {
    this.queue(core.start());
    for (const slot of SLOTS) {
      this.displayHp[slot] = core.unit(slot).hp();
      this.visible[slot] = true;
      this.frame[slot] = 0;
    }
  }

  // ------------------------------------------------------------------ what the renderer reads

  get finished(): boolean {
    return this.stage === "done";
  }
  /** "player" or "enemy" once the fight is over. */
  get winner(): "player" | "enemy" | null {
    const request = this.core.request;
    return request.kind === "ended" ? request.outcome.winner : null;
  }

  slot(slot: DoubleSlot): DoubleSlotView {
    const row = FORMATION_ROWS[slot],
      frames = row.length / 4,
      at = Math.max(0, Math.min(frames - 1, this.frame[slot])) * 4,
      unit = this.core.unit(slot),
      setup = this.core.setupOf(slot);
    return {
      actorX: row[at],
      actorY: row[at + 1],
      markerX: row[at + 2],
      markerY: row[at + 3],
      visible: this.visible[slot] && !this.hidden[slot] && !this.fxHides(slot),
      spriteId: setup.spriteId ?? -1,
      nature: setup.nature,
      spriteState: this.spriteState[slot],
      stateTick: this.tickCount - this.stateStart[slot],
      name: setup.name ?? this.speciesName(setup.speciesId),
      level: setup.level,
      element: setup.element ?? this.view.speciesElement(setup.speciesId),
      hp: this.displayHp[slot],
      maxHp: unit.maxHp(),
      shield: unit.shieldHp(),
    };
  }

  /** `doubleBattleSideHasLivingUnit`: the HUD band of a side shows while one of its pets stands. */
  /** The action's skill effect this tick (`syncActionSceneState`). */
  /** The skill action playing (`actionActorSlot`, `actionTargetSlot`, `actionPhase`, `actionTicks`). */
  get action(): {
    actor: DoubleSlot;
    target: DoubleSlot;
    skillId: number;
    phase: number;
    ticks: number;
  } | null {
    const beat = this.beat;
    if (beat?.event.type !== "strike") return null;
    return {
      actor: beat.event.slot,
      target: beat.event.target,
      skillId: beat.event.skillId,
      phase: beat.phase,
      ticks: beat.ticks,
    };
  }

  get fxView(): DoubleFxView {
    const fx = this.fx,
      beat = this.beat;
    if (!fx || !beat || beat.event.type !== "strike" || beat.phase !== 0)
      return { actorEffect: null, special: null, skillFxDraws: [], signatureSprites: [] };
    const event = beat.event,
      slotOf = (role: DoubleFxRole | null): DoubleSlot | -1 =>
        role === "actor" ? event.slot : role === "target" ? event.target : -1,
      effectSlot = slotOf(fx.effectRole),
      actor = fx.actorEffect,
      special = fx.specialEffect,
      rainbow = fx.rainbowEffect;
    const view: DoubleFxView = {
      actorEffect: actor && effectSlot >= 0 ? { slot: effectSlot as DoubleSlot, ...actor } : null,
      special: special && effectSlot >= 0 ? { slot: effectSlot as DoubleSlot, ...special } : null,
      skillFxDraws: [],
      signatureSprites: [],
    };
    if (!rainbow) return view;
    const caster = this.slot(event.slot),
      target = this.slot(event.target),
      casterPlayerSide = event.slot >= 2,
      targetPlayerSide = event.target >= 2;
    if (rainbow.kind === "skillFx") {
      const frame = this.rules.fx.frameAt(rainbow.key, rainbow.tick);
      view.skillFxDraws = this.rules.fx.draws(rainbow.key, frame, {
        player: { x: caster.actorX, y: caster.actorY },
        enemy: { x: target.actorX, y: target.actorY },
        caster: { x: caster.actorX, y: caster.actorY },
        target: { x: target.actorX, y: target.actorY },
        casterPlayerSide,
        targetPlayerSide,
      });
    } else
      view.signatureSprites = this.rules.signatureFx
        .active(rainbow.key, rainbow.tick)
        .map((placed) => {
          const at = placed.onCaster ? caster : target;
          return {
            sprite: placed.sprite,
            state: placed.state,
            elapsed: placed.elapsed,
            x: at.actorX,
            y: at.actorY,
            mirror: placed.onCaster ? casterPlayerSide : targetPlayerSide,
          };
        });
    return view;
  }

  private fxHides(slot: DoubleSlot): boolean {
    const event = this.beat?.event,
      role = this.fx?.hiddenRole;
    if (!role || event?.type !== "strike" || this.beat!.phase !== 0) return false;
    return (role === "actor" ? event.slot : event.target) === slot;
  }

  /** `bloodRow`: the per-tick `[dx, dy]` float of the damage (0) or miss (1) text. */
  bloodRow(row: 0 | 1): readonly number[] {
    return this.rules.sourceFx.bloodRow(row);
  }

  sideAlive(playerSide: boolean): boolean {
    return (playerSide ? [2, 3] : [0, 1]).some((slot) => this.displayHp[slot] > 0);
  }

  statusStrip(slot: DoubleSlot): (StatusPresentationSlot & { badgeCell: number })[] {
    const presentation = this.rules.presentation;
    return presentation.project(this.core.unit(slot)).map((entry) => ({
      ...entry,
      badgeCell: presentation.durationBadgeCell(entry.remainingDuration),
    }));
  }

  /** The EXP bar under slot 2. */
  get experienceBar(): { value: number; max: number } {
    const level = this.core.setupOf(2).level;
    return { value: 0, max: level >= MAX_PET_LEVEL ? 0 : requiredExp(level + 1) };
  }

  // ------------------------------------------------------------------ input

  handleInput(commands: readonly InputCommand[]): void {
    const pressed = (command: InputCommand) => commands.includes(command),
      delta = pressed("left") || pressed("up") ? -1 : pressed("right") || pressed("down") ? 1 : 0;
    if (this.ui.mode === "WARNING") {
      if (pressed("confirm") || pressed("back")) this.closeWarning();
      return;
    }
    switch (this.stage) {
      case "command":
        if (delta) this.commandIndex = (this.commandIndex + 6 + delta) % 6;
        this.ui.selectedIndex = this.commandIndex;
        if (pressed("confirm")) this.openCommand(this.commandIndex);
        return;
      case "skill": {
        const count = this.ui.rows.length;
        if (pressed("back")) return this.openCommandBar(this.commandSlot);
        if (delta && count > 0) this.selectRow((this.ui.selectedIndex + count + delta) % count);
        if (pressed("confirm")) this.confirmSkill();
        return;
      }
      case "target":
        if (pressed("back")) return this.openSkills();
        if (delta && this.targets.length > 0) {
          const index = this.targets.indexOf(this.activeTargetSlot as DoubleSlot);
          this.showTarget(
            this.targets[(index + this.targets.length + delta) % this.targets.length],
          );
        }
        if (pressed("confirm"))
          this.submit({
            kind: "skill",
            skillIndex: this.pendingSkill,
            target: this.activeTargetSlot as DoubleSlot,
          });
        return;
      case "item": {
        const count = this.ui.rows.length;
        if (pressed("back")) return this.openCommandBar(this.commandSlot);
        if (delta && count > 0) this.selectRow((this.ui.selectedIndex + count + delta) % count);
        if (pressed("confirm") && count > 0) {
          this.pendingItem = this.itemIds[this.ui.selectedIndex];
          this.openPets("item");
        }
        return;
      }
      case "pet": {
        const count = this.ui.rows.length;
        if (pressed("back") && this.petPurpose !== "replacement")
          return this.petPurpose === "item"
            ? this.openItems()
            : this.openCommandBar(this.commandSlot);
        const vertical = pressed("up") ? -1 : pressed("down") ? 1 : 0;
        if (vertical && count > 0)
          this.ui.selectedIndex = (this.ui.selectedIndex + count + vertical) % count;
        if (pressed("left")) this.ui.tab = ((this.ui.tab ?? 0) + 3) % 4;
        if (pressed("right")) this.ui.tab = ((this.ui.tab ?? 0) + 1) % 4;
        if (pressed("confirm")) this.confirmPet();
        return;
      }
      default:
        return;
    }
  }

  // ------------------------------------------------------------------ tick

  tick(): void {
    this.tickCount++;
    if (this.stage === "entry") return this.tickEntry();
    if (this.stage !== "playing") return;
    if (this.slide) return this.tickSlide();
    if (this.beat) return this.tickBeat();
    if (this.hold > 0) {
      this.hold--;
      return;
    }
    const next = this.beats.shift();
    if (next) {
      this.beat = next;
      this.startBeat(next);
      return;
    }
    this.afterQueue();
  }

  /** `tickEntry`: slot by slot, two ticks a frame; an even slot near its last frames pulls the next. */
  private tickEntry(): void {
    if (this.entrySlot < SLOTS.length) {
      const slot = this.entrySlot,
        frames = FORMATION_ROWS[slot].length / 4,
        frame = Math.max(0, Math.min(frames - 1, this.entryFrames[slot]));
      this.frame[slot] = frame;
      if ((slot & 1) === 0 && slot + 1 < SLOTS.length && frame > frames - 3) {
        const next = slot + 1;
        this.entryFrames[next] = Math.min(
          FORMATION_ROWS[next].length / 4 - 1,
          this.entryFrames[next] + 1,
        );
        this.frame[next] = this.entryFrames[next];
      }
      if (++this.entryCadence >= 2) {
        this.entryCadence = 0;
        this.entryFrames[slot]++;
        if (this.entryFrames[slot] >= frames) {
          this.entryFrames[slot] = frames - 1;
          this.frame[slot] = frames - 1;
          this.entrySlot++;
        }
      }
      return;
    }
    for (const slot of SLOTS) this.frame[slot] = FORMATION_ROWS[slot].length / 4 - 1;
    this.stage = "playing";
  }

  private startBeat(beat: Beat): void {
    const event = beat.event;
    switch (event.type) {
      case "roundStart":
        this.log = `Lượt ${event.round} bắt đầu.`;
        this.hold = ROUND_START_HOLD;
        this.beat = null;
        return;
      case "strike": {
        // `prepareAction`: every pet back to idle and shown, then the skill's effect starts.
        this.activeActorSlot = event.slot;
        this.activeTargetSlot = event.target;
        const row = this.rules.damage.skillRow(event.skillId);
        this.log = `${this.slot(event.slot).name} dùng ${row?.name ?? ""}`;
        for (const slot of SLOTS) {
          this.hidden[slot] = false;
          this.pose(slot, 0);
        }
        this.deathSlot = -1;
        this.lEffect.reset();
        this.fx = new DoubleActionFx(
          this.rules,
          event.skillId,
          row?.stableKey,
          event.secondary,
          (role, state) => this.pose(role === "actor" ? event.slot : event.target, state),
        );
        beat.phase = 0;
        beat.ticks = 0;
        return;
      }
      case "replacement":
        this.visible[event.slot] = true;
        this.displayHp[event.slot] = this.core.unit(event.slot).hp();
        this.spriteState[event.slot] = 0;
        this.slide = { slot: event.slot, frame: 0, cadence: 0 };
        this.frame[event.slot] = 0;
        this.log = `Đã thay đổi sủng vật: ${this.slot(event.slot).name}`;
        this.beat = null;
        return;
      case "faint":
        // A strike already played this fall; a status or recoil death plays it here.
        if (!this.visible[event.slot]) {
          this.beat = null;
          return;
        }
        this.startDeath(event.slot);
        beat.ticks = 0;
        return;
      case "item": {
        if (event.target !== -1) this.displayHp[event.target] = this.core.unit(event.target).hp();
        const recovery = [event.hpGained > 0 ? `${event.hpGained} HP` : "", event.ppGained > 0 ? `${event.ppGained} PP` : ""].filter(Boolean).join(" và ");
        this.log = event.cauVongRecovery
          ? `Đối phương hồi ${recovery} cho ${this.speciesName(event.cauVongRecovery.speciesId)}.`
          : event.refused ?? `${this.slot(event.slot).name} dùng đạo cụ.`;
        this.hold = ITEM_HOLD;
        this.beat = null;
        return;
      }
      case "statusTick":
      case "charmHeal":
      case "charmRevive":
        this.displayHp[event.slot] = this.core.unit(event.slot).hp();
        if (event.type === "charmRevive") this.visible[event.slot] = true;
        this.hold = BLOCKED_HOLD;
        this.beat = null;
        return;
      case "blocked":
      case "controlled":
      case "noPp":
        this.log =
          event.type === "blocked"
            ? `${event.status} có hiệu lực: ${this.slot(event.slot).name} mất hành động kế tiếp.`
            : event.type === "noPp"
              ? "Kỹ năng đã hết PP."
              : `${event.status}`;
        this.hold = BLOCKED_HOLD;
        this.beat = null;
        return;
      case "end":
        this.log = event.outcome.winner === "player" ? "Chiến thắng!" : "Thất bại!";
        this.activeActorSlot = -1;
        this.activeTargetSlot = -1;
        this.hold = RESULT_HOLD;
        this.beat = null;
        return;
      default:
        this.beat = null;
    }
  }

  private tickBeat(): void {
    const beat = this.beat!,
      event = beat.event;
    beat.ticks++;
    if (event.type === "faint") {
      if (!this.tickDeath()) {
        this.hidden[event.slot] = false;
        this.displayHp[event.slot] = 0;
        this.beat = null;
      }
      return;
    }
    if (event.type !== "strike") return;
    switch (beat.phase) {
      case 0: {
        // `tickActionLEffect`, `tickActionEffectSequence`, then a Power-0 skill skips straight to
        // its post effects.
        this.tickLEffect(event.slot);
        if (this.fx!.tick()) return;
        if (this.rules.damage.skillRow(event.skillId)?.powerPercent === 0) {
          this.displayHp[event.receiver] = event.receiverHp;
          this.displayHp[event.slot] = event.actorHp;
          beat.phase = 2;
        } else {
          this.landStrike(event);
          beat.phase = 1;
        }
        beat.ticks = 0;
        return;
      }
      case 1: {
        this.tickTween();
        if (beat.ticks === 6 && event.receiverHp > 0) this.pose(event.receiver, 0);
        const textTicks = event.hit ? HIT_TEXT_TICKS : MISS_TEXT_TICKS;
        if (beat.ticks >= textTicks) this.damage = null;
        if (beat.ticks < textTicks || this.tween.slot >= 0) return;
        if (event.receiverHp <= 0 && !this.death && this.deathSlot < 0) {
          this.startDeath(event.receiver);
          return;
        }
        if (this.death && this.tickDeath()) return;
        beat.phase = 2;
        beat.ticks = 0;
        return;
      }
      case 2:
        if (beat.ticks < SETTLE_TICKS) return;
        // The actor's own recoil or reflect felled it: it falls after the hit settles.
        if (event.slot !== event.target && event.actorHp <= 0 && this.visible[event.slot]) {
          this.startDeath(event.slot);
          beat.phase = 4;
        } else beat.phase = 3;
        beat.ticks = 0;
        return;
      case 4:
        if (this.tickDeath()) return;
        beat.phase = 3;
        beat.ticks = 0;
        return;
      default:
        if (beat.ticks < SETTLE_TICKS) return;
        // `finishAction`.
        for (const slot of SLOTS) {
          this.hidden[slot] = false;
          this.spriteState[slot] = 0;
        }
        this.fx = null;
        this.activeActorSlot = -1;
        this.activeTargetSlot = -1;
        this.beat = null;
    }
  }

  /** `tickActionLEffect`: the actor's current pose and how long it has held it. */
  private tickLEffect(slot: DoubleSlot): void {
    const catalog = this.rules.lEffect;
    if (!catalog) return;
    const setup = this.core.setupOf(slot);
    this.lEffect.tick(
      (setup.spriteId ?? -1) >= 0 ? catalog.entry(setup.speciesId) : undefined,
      slot,
      this.spriteState[slot],
      this.tickCount - this.stateStart[slot],
    );
  }

  /** The L shown this tick (`battleLVisible`: only while action phase 0 plays), or undefined. */
  get stateOneLEffect(): { entry: StateOneLEntry; slot: DoubleSlot; frame: number } | undefined {
    const beat = this.beat,
      view = this.lEffect.view;
    if (beat?.event.type !== "strike" || beat.phase !== 0 || !view) return undefined;
    return { entry: view.entry, slot: view.owner, frame: view.frame };
  }

  /** `startActionDeath`: the pet's fall pose under the band-by-band fade, its own draw hidden. */
  private startDeath(slot: DoubleSlot): void {
    this.deathSlot = slot;
    this.deathTicks = 0;
    this.pose(slot, 3);
    this.hidden[slot] = true;
    this.death = {
      slot,
      spriteId: this.slot(slot).spriteId,
      tick: 0,
      duration: Math.max(1, this.fallTicks(slot)),
    };
  }

  /** One tick of the fade; false (and the pet gone) once it has run its length. */
  private tickDeath(): boolean {
    const death = this.death;
    if (!death) return false;
    if (++this.deathTicks < death.duration) {
      death.tick = this.deathTicks;
      return true;
    }
    this.visible[death.slot] = false;
    this.death = null;
    return false;
  }

  /** The hit lands: the receiver's pose, the damage text and Java's HP tween. */
  private landStrike(event: DoubleEvent & { type: "strike" }): void {
    if (event.hit && event.damage > 0) this.pose(event.receiver, 2);
    this.damage = {
      slot: event.receiver,
      text: event.hit ? `-${event.damage}` : "Né tránh",
      critical: event.crit,
      miss: !event.hit,
      tick: this.tickCount,
    };
    const from = this.displayHp[event.receiver];
    this.tween = {
      slot: from !== event.receiverHp ? event.receiver : -1,
      step: Math.max(1, Math.trunc(Math.abs(from - event.receiverHp) / 11)),
      accum: 0,
      delay: 0,
      target: event.receiverHp,
    };
    this.displayHp[event.slot] = event.actorHp;
  }

  /** `tickActionHpTween`: after four ticks the bar moves by a growing step toward the HP the hit left. */
  private tickTween(): void {
    const tween = this.tween;
    if (tween.slot < 0) return;
    const current = this.displayHp[tween.slot];
    if (current === tween.target) {
      tween.slot = -1;
      return;
    }
    if (++tween.delay < 4) return;
    tween.accum += tween.step;
    this.displayHp[tween.slot] =
      current < tween.target
        ? Math.min(tween.target, current + tween.accum)
        : Math.max(tween.target, current - tween.accum);
    if (this.displayHp[tween.slot] === tween.target) tween.slot = -1;
  }

  private tickSlide(): void {
    const slide = this.slide!,
      frames = FORMATION_ROWS[slide.slot].length / 4;
    this.frame[slide.slot] = slide.frame;
    if (++slide.cadence >= 2) {
      slide.cadence = 0;
      slide.frame++;
      if (slide.frame >= frames) {
        this.frame[slide.slot] = frames - 1;
        this.slide = null;
      }
    }
  }

  /** The events have played: open what the core asks for next. */
  private afterQueue(): void {
    const request = this.core.request;
    if (request.kind === "ended") {
      this.stage = "done";
      return;
    }
    if (request.kind === "command") return this.openCommandBar(request.slot);
    this.commandSlot = request.slot;
    this.openPets("replacement");
  }

  // ------------------------------------------------------------------ menus

  private openCommandBar(slot: PlayerSlot): void {
    this.stage = "command";
    this.commandSlot = slot;
    this.activeActorSlot = slot;
    this.activeTargetSlot = -1;
    this.commandIndex = 0;
    this.log = `Chọn hành động cho ${this.slot(slot).name}`;
    this.ui = { ...battleUiState("COMMAND"), title: "Chiến đấu", selectedIndex: 0 };
  }

  /** `tickCommand`: 0 fight, 2 items, 3 pets; catching and the rest are refused in a 2v2. */
  private openCommand(index: number): void {
    const actor = this.core.unit(this.commandSlot),
      locked = !!this.rules.web?.switchAndItemsLocked(actor);
    if (index === 0) this.openSkills();
    else if (index === 1) this.warn("Trận chiến này không cho bắt sủng vật");
    else if (index === 2)
      locked ? this.warn("Trạng thái bị quấn, không thể sử dụng đạo cụ") : this.openItems();
    else if (index === 3)
      locked ? this.warn("Trạng thái bị quấn, không thể đổi sủng vật") : this.openPets("switch");
    else this.warn("Trận phối hợp 2v2 chỉ nhận lệnh chiến đấu.");
  }

  private openSkills(): void {
    const unit = this.core.unit(this.commandSlot);
    this.stage = "skill";
    this.skillSlots = unit.skillIds.flatMap((id, slot) => (id >= 0 ? [slot] : []));
    const first = this.skillSlots.findIndex((slot) => unit.skillPp[slot] > 0);
    this.ui = {
      ...battleUiState("CHOICE_SKILL"),
      title: "Chiến đấu",
      prompt: "Sử dụng",
      selectedIndex: Math.max(0, first),
      rows: this.skillSlots.map((slot) => {
        const id = unit.skillIds[slot],
          row = this.rules.damage.skillRow(id);
        return {
          name: row?.name ?? `Kỹ năng ${id}`,
          value: `${unit.skillPp[slot]}/${row?.ppMax ?? 0}`,
          description:
            this.rules.damage.lietHoaRecord(id)?.description ??
            this.rules.web?.skillDescription(id) ??
            "",
          enabled: unit.skillPp[slot] > 0,
          element: row?.elementFamily,
          power: row?.powerPercent,
          tier: row?.learnTier,
          targetSide: row?.targetSide,
          chance: row?.chanceOrParam,
        };
      }),
    };
    this.selectRow(this.ui.selectedIndex);
  }

  private selectRow(index: number): void {
    this.ui.selectedIndex = index;
    this.ui.description = this.ui.rows[index]?.description ?? "";
    if (this.ui.scroll > index) this.ui.scroll = index;
    if (index >= this.ui.scroll + 5) this.ui.scroll = index - 4;
  }

  /** `tickSkill`'s confirm: PP, Phong Bế, then the target cursor on the first legal slot. */
  private confirmSkill(): void {
    const unit = this.core.unit(this.commandSlot),
      slot = this.skillSlots[this.ui.selectedIndex];
    if (slot === undefined) return;
    if (unit.skillPp[slot] <= 0) return this.warn("Kỹ năng đã hết PP.");
    const id = unit.skillIds[slot];
    const row = this.rules.damage.skillRow(id);
    if (row && !unit.canUseSkillTier(row.learnTier)) return this.warn(TIER_LOCK_WARNING);
    if (!this.rules.web?.skillUsable(row, unit)) return this.warn(SKILL_NOT_READY_WARNING);
    this.targets = this.core.legalTargets(this.commandSlot, id);
    if (this.targets.length === 0) return this.warn("Không còn mục tiêu hợp lệ.");
    this.pendingSkill = slot;
    this.stage = "target";
    this.showTarget(this.targets[0]);
  }

  private showTarget(slot: DoubleSlot): void {
    this.activeTargetSlot = slot;
    const view = this.slot(slot);
    this.ui = {
      ...battleUiState("TARGET"),
      targetName: view.name,
      targetPlayerSide: slot >= 2,
      targetSlotPosition: { x: view.actorX, y: view.actorY },
    };
  }

  private openItems(): void {
    const bag = this.core.bag();
    this.stage = "item";
    this.itemIds = Object.keys(bag)
      .map(Number)
      .filter(
        (id) => this.core.freeItemCount(id) > 0 && this.view.items.get(id)?.kind === "recovery",
      );
    this.ui = {
      ...battleUiState("CHOICE"),
      title: "Đạo cụ",
      prompt: "Sử dụng",
      rows: this.itemIds.map((id) => {
        const item = this.view.itemInfo(id);
        return {
          name: item?.name ?? `Đạo cụ ${id}`,
          value: String(this.core.freeItemCount(id)),
          description: item?.description ?? "",
          iconCell: item?.iconCell ?? id,
        };
      }),
    };
    this.selectRow(0);
  }

  private openPets(purpose: PetPurpose): void {
    this.stage = "pet";
    this.petPurpose = purpose;
    const active = this.core.occupant(this.commandSlot);
    this.ui = {
      ...battleUiState("PET_STATE"),
      title: "Sủng vật",
      prompt: purpose === "item" ? "Sử dụng" : "Xuất chiến",
      selectedIndex: active.side === "player" ? active.index : 0,
      tab: 0,
      rows: Array.from({ length: this.core.playerCount }, (_, member) => ({
        name: this.core.playerUnit(member) ? this.memberName(member) : "",
        pet: this.petCard(member),
      })),
    };
  }

  private confirmPet(): void {
    const member = this.ui.selectedIndex;
    if (this.petPurpose === "item")
      return this.submit({ kind: "item", itemId: this.pendingItem, member });
    if (this.petPurpose === "replacement") return this.submit({ kind: "member", member });
    this.submit({ kind: "switch", member });
  }

  private submit(answer: Parameters<DoubleBattleCore["submit"]>[0]): void {
    try {
      this.queue(this.core.submit(answer));
    } catch (error) {
      if (error instanceof BattleCommandError) return this.warn(error.message);
      throw error;
    }
    const request = this.core.request;
    if (this.beats.length === 0 && request.kind === "command")
      return this.openCommandBar(request.slot);
    this.ui = battleUiState("BATTLE");
    this.stage = "playing";
  }

  private warnReturn: BattleUiState | null = null;
  private warn(message: string): void {
    this.warnReturn = this.ui;
    this.ui = { ...battleUiState("WARNING"), message, prompt: "Nhấn nút 5" };
  }
  private closeWarning(): void {
    this.ui = this.warnReturn ?? battleUiState("BATTLE");
    this.warnReturn = null;
  }

  // ------------------------------------------------------------------ helpers

  private queue(events: readonly DoubleEvent[]): void {
    for (const event of events)
      if (event.type !== "enter") this.beats.push({ event, phase: 0, ticks: 0 });
  }

  /** `setActionSpriteState`, through `normalizedPetAnimationState` for Cầu Vồng and V4 art. */
  private pose(slot: DoubleSlot, state: number): void {
    const sprite = this.core.setupOf(slot).spriteId ?? -1;
    if ((sprite >= 1000 && sprite < 1102) || (sprite >= 2000 && sprite < 2072))
      state = state >= 3 ? 2 : state === 1 ? 1 : 0;
    this.spriteState[slot] = Math.max(0, state);
    this.stateStart[slot] = this.tickCount;
  }

  /** `actionDeathDuration`: a quarter of the idle height (at least 4), or 8 without bounds. */
  private fallTicks(slot: DoubleSlot): number {
    return this.view.fallTicks(this.slot(slot).spriteId);
  }

  private memberName(member: number): string {
    const setup = this.core.playerSetup(member);
    return setup.name ?? this.speciesName(setup.speciesId);
  }

  private speciesName(speciesId: number): string {
    return this.view.speciesName(speciesId) ?? `Pet ${speciesId}`;
  }

  private petCard(member: number): BattleUiPet {
    const unit = this.core.playerUnit(member),
      setup = this.core.playerSetup(member),
      onField = SLOTS.some((slot) => {
        const at = this.core.occupant(slot);
        return at.side === "player" && at.index === member;
      });
    return {
      spriteId: setup.spriteId ?? -1,
      nature: setup.nature,
      element: setup.element ?? -1,
      elementName: ELEMENT_NAMES[setup.element ?? -1],
      level: setup.level,
      hp: unit.hp(),
      maxHp: unit.maxHp(),
      expPercent: 0,
      quality: setup.quality,
      status: !unit.alive() ? "Đã gục" : onField ? "Đang ra trận" : "Sẵn sàng",
      held: "Trống",
      stats: [
        unit.maxHp(),
        unit.currentStats.attack,
        unit.currentStats.defense,
        unit.currentStats.speed,
      ],
      buffCount: unit.activeBuffCount(),
      debuffCount: unit.activeDebuffCount(),
      skills: unit.skillIds.flatMap((id, slot) =>
        id >= 0
          ? [
              {
                name: this.rules.damage.skillRow(id)?.name ?? `Skill ${id}`,
                pp: `${unit.skillPp[slot]}/${this.rules.damage.skillRow(id)?.ppMax ?? 0}`,
                element: this.rules.damage.skillRow(id)?.elementFamily,
              },
            ]
          : [],
      ),
    };
  }
}
