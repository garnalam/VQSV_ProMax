import type { BattleContext } from "../story/SourceOpcodeInterpreter";
import type { SavedPet } from "../../persistence/SaveRepository";
import type { PetCoreStats } from "./PetStatCalculator";
import { BATTLE_SEATS } from "./BattleSeats";

export type BattleSide = "player" | "enemy";
export type BattleCombatantDefinition = {
  side: BattleSide;
  speciesId: number;
  name: string;
  level: number;
  spriteId: number;
  element: number;
  maxHp: number;
  attack?: number;
  defense?: number;
  speed?: number;
  origin: { x: number; y: number };
};
export type BattlePhaseDefinition = { key: string; start: number };
export type BattleWindow = { from: number; to: number };
export type BattleOffsetKeyframe = { from: number; to: number; x: number; y: number };
export type BattleHpKeyframe = { from: number; value: number };
export type BattleEffectWindow = BattleWindow & {
  spriteId: number;
  state: number;
  cursorDivisor: number;
};
export type BattleDamageWindow = BattleWindow & { value: number; label: string };
export type BattleAnimationTrack = {
  stateWindows: Array<BattleWindow & { state: number }>;
  cursor: (tick: number, state: number) => number;
};
/** The capture ball's sprite, phase lengths and the enemy's shrink/restore steps. */
export type CaptureAnimation = {
  spriteId: number;
  /** Throw, (unused), shake, success hold — in ticks. */
  durations: [number, number, number, number];
  /** Shrink into the ball, spring back out on a miss — in ticks. */
  effectDurations: [number, number];
  /** `[scale10, dx, dy]` per step. */
  shrinkSteps: Array<[number, number, number]>;
  restoreSteps: Array<[number, number, number]>;
};
/** `VqsvBattleRuntime.initCatchResult/advanceCatchPhase` (the pack's world contract carries the same). */
export const DEFAULT_CAPTURE_ANIMATION: CaptureAnimation = {
  spriteId: 269,
  durations: [8, 1, 25, 15],
  effectDurations: [9, 8],
  shrinkSteps: [
    [10, 0, 0],
    [7, 0, -10],
    [4, 0, -20],
  ],
  restoreSteps: [
    [4, 0, -20],
    [6, 0, -12],
    [8, 0, -4],
    [10, 0, 0],
  ],
};
export type BattleTutorialDefinition = {
  kind: "capture-tutorial";
  weakHp: number;
  sealBallId: number;
  guaranteedBallId: number;
  weakText: string;
  retryText: string;
  captureSpriteId: number;
  captureDurations: [number, number, number, number];
  captureEffectDurations: [number, number];
  captureShrinkSteps: Array<[number, number, number]>;
  captureRestoreSteps: Array<[number, number, number]>;
};
export type BattleDefinition = {
  id: string;
  combatants: Record<BattleSide, BattleCombatantDefinition>;
  phases: BattlePhaseDefinition[];
  duration: number;
  resultAt: number;
  resultIndex: number;
  offsets: Record<BattleSide, BattleOffsetKeyframe[]>;
  hp: Record<BattleSide, BattleHpKeyframe[]>;
  animations: Record<BattleSide, BattleAnimationTrack>;
  activeWindows: BattleWindow[];
  hiddenWindows: Partial<Record<BattleSide, BattleWindow[]>>;
  deathWindow?: BattleWindow;
  effects: BattleEffectWindow[];
  damage: BattleDamageWindow[];
  entry: {
    leftActorSpriteId: number;
    rightActorSpriteId: number;
    playerCount?: number;
    enemyCount?: number;
  };
  experience: { value: number; max: number };
  tutorial?: BattleTutorialDefinition;
  /** A fight against a trainer's pet: nothing can be captured, so Cảm Lãm Chi Diệp's floor is off. */
  trainer?: boolean;
  /**
   * The descriptor's `captureSuccessResultIndex`: a catch reports this op47 result instead of the
   * win's 0 (`BattleOutcomeEngine.winResultIndex(..., catchSucceeded, captureSuccessResultIndex)`).
   */
  captureSuccessResultIndex?: number;
};

const inWindow = (tick: number, window: BattleWindow) => tick >= window.from && tick <= window.to;
export const sourceIntroBattle: BattleDefinition = {
  id: "source-encounter-5-20-4",
  combatants: {
    player: {
      side: "player",
      speciesId: 68,
      name: "Điện Miêu",
      level: 7,
      spriteId: 154,
      element: 4,
      maxHp: 179,
      origin: { ...BATTLE_SEATS.player },
    },
    enemy: {
      side: "enemy",
      speciesId: 5,
      name: "Viêm Ma",
      level: 20,
      spriteId: 91,
      element: 0,
      maxHp: 601,
      origin: { ...BATTLE_SEATS.enemy },
    },
  },
  phases: [
    { start: 0, key: "NPC_VS_ENTRY" },
    { start: 24, key: "P0_ENTRY" },
    { start: 65, key: "P1_DISPATCH" },
    { start: 72, key: "P2_SELECT_EXECUTE" },
    { start: 79, key: "P7_RESOLVE_0" },
    { start: 80, key: "P7_RESOLVE_1" },
    { start: 103, key: "P7_RESOLVE_2A" },
    { start: 114, key: "P7_RESOLVE_3A" },
    { start: 120, key: "P1_DISPATCH_2" },
    { start: 127, key: "P2_SELECT_EXECUTE_2" },
    { start: 134, key: "P7_RESOLVE_0B" },
    { start: 135, key: "P7_RESOLVE_1B" },
    { start: 146, key: "P7_RESOLVE_2B" },
    { start: 157, key: "P7_KO" },
    { start: 168, key: "P7_RESOLVE_3B" },
    { start: 174, key: "P9_LOSE" },
    { start: 181, key: "EXIT_FADE" },
  ],
  duration: 210,
  resultAt: 181,
  resultIndex: 1,
  offsets: {
    player: [
      { from: 24, to: 56, x: -470, y: -48 },
      { from: 57, to: 58, x: -70, y: -48 },
      { from: 59, to: 60, x: -17, y: -16 },
      { from: 61, to: 62, x: 2, y: 2 },
    ],
    enemy: [
      { from: 24, to: 46, x: 223, y: -70 },
      { from: 47, to: 48, x: 62, y: -70 },
      { from: 49, to: 50, x: 20, y: -23 },
      { from: 51, to: 52, x: -4, y: 3 },
    ],
  },
  hp: {
    player: [
      { from: 0, value: 179 },
      { from: 106, value: 170 },
      { from: 107, value: 152 },
      { from: 108, value: 125 },
      { from: 109, value: 89 },
      { from: 110, value: 71 },
      { from: 149, value: 65 },
      { from: 150, value: 53 },
      { from: 151, value: 35 },
      { from: 152, value: 11 },
      { from: 153, value: 0 },
    ],
    enemy: [{ from: 0, value: 601 }],
  },
  animations: {
    enemy: {
      stateWindows: [
        { from: 79, to: 118, state: 1 },
        { from: 134, to: 172, state: 1 },
      ],
      cursor: (t, state) => {
        if (state !== 1) return -1;
        if (t >= 102 && t <= 118) return Math.floor((t - 102) / 2);
        if (t >= 157) return Math.floor((t - 157) / 2);
        const local = t - (t < 134 ? 79 : 134);
        return local === 0 ? 0 : local <= 19 ? Math.ceil(local / 2) : local - 9;
      },
    },
    player: {
      stateWindows: [
        { from: 102, to: 107, state: 2 },
        { from: 145, to: 155, state: 2 },
        { from: 156, to: 172, state: 3 },
      ],
      cursor: (t) => {
        if (t >= 79 && t <= 101) return t === 79 ? 3 : Math.floor((t - 80) / 2) % 4;
        if (t >= 102 && t <= 107) return t === 107 ? 1 : 0;
        if (t >= 108 && t <= 112) return Math.floor((t - 108) / 2);
        if (t >= 113 && t <= 118) return Math.floor((t - 108) / 2) % 4;
        if (t >= 134 && t <= 144) return Math.floor((t - 132) / 2) % 4;
        if (t >= 145 && t <= 149) return 0;
        if (t >= 150 && t <= 152) return 1;
        if (t >= 153 && t <= 155) return 0;
        if (t >= 156 && t <= 166) return Math.floor((t - 156) / 2) % 4;
        if (t >= 167 && t <= 172) return Math.floor((t - 164) / 2) % 4;
        return -1;
      },
    },
  },
  activeWindows: [
    { from: 71, to: 118 },
    { from: 126, to: 172 },
  ],
  hiddenWindows: { player: [{ from: 156, to: Number.MAX_SAFE_INTEGER }] },
  deathWindow: { from: 156, to: 166 },
  effects: [
    { from: 81, to: 101, spriteId: 262, state: 1, cursorDivisor: 2 },
    { from: 136, to: 144, spriteId: 262, state: 5, cursorDivisor: 2 },
  ],
  damage: [
    { from: 102, to: 112, value: 108, label: "Gieo Hạt" },
    { from: 145, to: 155, value: 223, label: "Gieo Hạt" },
  ],
  entry: { leftActorSpriteId: 5, rightActorSpriteId: 30 },
  experience: { value: 0, max: 760 },
};
export const DEFAULT_BATTLE_DEFINITIONS: readonly BattleDefinition[] = [sourceIntroBattle];
export const createCaptureTutorialBattleDefinition = (
  data: {
    encounter: { request: [number, number, number] };
    player: { id: number; name: string; level: number; spriteId: number; element: number };
    opponent: { id: number; name: string; level: number; spriteId: number; element: number };
    items: { sealBall: number; guaranteedBall: number };
    capture: {
      spriteId: number;
      durations: [number, number, number, number];
      effectDurations: [number, number];
      shrinkSteps: Array<[number, number, number]>;
      restoreSteps: Array<[number, number, number]>;
    };
    text: { weak: string; retry: string };
  },
  pet: SavedPet,
  // Authored combatants carry no stats of their own: the engine builds each one from its species'
  // growth data at its level and quality, so the numbers below are computed, never copied.
  stats: { player: PetCoreStats; opponent: PetCoreStats },
): BattleDefinition => ({
  id: `source-encounter-${data.encounter.request.join("-")}`,
  combatants: {
    player: {
      side: "player",
      speciesId: pet.speciesId,
      name: data.player.name,
      level: pet.level,
      spriteId: pet.visualSpriteId ?? data.player.spriteId,
      element: data.player.element,
      maxHp: pet.maxHp ?? stats.player.hp,
      attack: stats.player.attack,
      defense: stats.player.defense,
      speed: stats.player.speed,
      origin: { ...BATTLE_SEATS.player },
    },
    enemy: {
      side: "enemy",
      speciesId: data.opponent.id,
      name: data.opponent.name,
      level: data.opponent.level,
      spriteId: data.opponent.spriteId,
      element: data.opponent.element,
      maxHp: stats.opponent.hp,
      attack: stats.opponent.attack,
      defense: stats.opponent.defense,
      speed: stats.opponent.speed,
      origin: { ...BATTLE_SEATS.enemy },
    },
  },
  phases: [
    { start: 0, key: "P0_ENTRY" },
    { start: 26, key: "P1_DISPATCH" },
  ],
  duration: Number.MAX_SAFE_INTEGER,
  resultAt: Number.MAX_SAFE_INTEGER,
  resultIndex: 0,
  offsets: { player: [], enemy: [] },
  hp: {
    player: [{ from: 0, value: pet.currentHp ?? pet.maxHp ?? stats.player.hp }],
    enemy: [{ from: 0, value: stats.opponent.hp }],
  },
  animations: {
    player: { stateWindows: [], cursor: () => -1 },
    enemy: { stateWindows: [], cursor: () => -1 },
  },
  activeWindows: [],
  hiddenWindows: {},
  effects: [],
  damage: [],
  entry: { leftActorSpriteId: 0, rightActorSpriteId: 0 },
  experience: { value: 0, max: 760 },
  tutorial: {
    kind: "capture-tutorial",
    weakHp: Math.floor(stats.opponent.hp / 2),
    sealBallId: data.items.sealBall,
    guaranteedBallId: data.items.guaranteedBall,
    weakText: data.text.weak,
    retryText: data.text.retry,
    captureSpriteId: data.capture.spriteId,
    captureDurations: data.capture.durations,
    captureEffectDurations: data.capture.effectDurations,
    captureShrinkSteps: data.capture.shrinkSteps,
    captureRestoreSteps: data.capture.restoreSteps,
  },
});

export class BattleDefinitionRegistry {
  private readonly definitions = new Map<string, BattleDefinition>();
  constructor(definitions: readonly BattleDefinition[] = DEFAULT_BATTLE_DEFINITIONS) {
    for (const definition of definitions) this.definitions.set(definition.id, definition);
  }
  resolve(context: BattleContext): BattleDefinition {
    const id = `source-encounter-${context.encounter.join("-")}`,
      definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unsupported battle definition ${id}`);
    return definition;
  }
}

export const battleWindowContains = inWindow;
