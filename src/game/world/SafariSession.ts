import type { InputCommand } from "../../core/input/GameCommand";
import type { SavedPet } from "../../persistence/save/GameSave";
import { DEFAULT_CAPTURE_ANIMATION, type CaptureAnimation } from "../battle/BattleDefinition";
import { captureDuration, captureVisualAt, type CaptureSpec } from "../battle/CaptureAnimation";
import {
  pickSafariPet,
  resolveSafariTurn,
  safariPassable,
  safariRandom,
  SAFARI_BALLS,
  SAFARI_FEE,
  SAFARI_SPECIES,
  type SafariAction,
  type SafariEncounter,
  type SafariMap,
  type SafariRun,
} from "../meta/Safari";

export type SafariPort = {
  map: () => SafariMap | undefined;
  run: () => SafariRun | undefined;
  setRun: (run: SafariRun | undefined) => void;
  canEnter: () => boolean;
  wallet: () => { badges: number } | undefined;
  hasSpace: () => boolean;
  createPet: (id: number, level: number, random: (bound: number) => number) => SavedPet | undefined;
  speed: (id: number) => number;
  receive: (pet: SavedPet) => void;
  save: () => void;
  blocked: () => boolean;
  captureAnimation?: () => CaptureAnimation;
  /** The species name for messages ("Đã bắt được Uy Qua!"); "pet" without it. */
  speciesName?: (id: number) => string | undefined;
};

/** Tap targets in the 240x320 UI space, shared by the renderer and `click`: [x, y, width, height]. */
export const SAFARI_BUTTONS = {
  /** "Rời" in the top-right corner, on the map and in an encounter (a finger-sized target). */
  exit: [186, 0, 54, 30],
  enter: [20, 214, 96, 28],
  close: [124, 214, 96, 28],
  leave: [24, 178, 92, 26],
  stay: [124, 178, 92, 26],
} as const;
/** The encounter's four command tiles (Bóng, Mồi, Đá, Chạy): a 40x38 tile and its label under it. */
export const SAFARI_COMMANDS: readonly (readonly [number, number, number, number])[] = [
  [10, 264, 40, 56],
  [70, 264, 40, 56],
  [130, 264, 40, 56],
  [190, 264, 40, 56],
];

function inside(rect: readonly number[], x: number, y: number): boolean {
  return x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3];
}

/** One Safari run suspends the original room; its only persistent state lives in the save. */
export class SafariSession {
  visible = false;
  selection = 0;
  tickCount = 0;
  /** The tick the current message appeared on: the map shows it for a while, then hides it. */
  messageTick = 0;
  /** Pets caught since entering, for the run's closing line (not saved). */
  caughtThisVisit = 0;
  private text = "";
  moving = false;
  confirmExit = false;
  throwAnimation: {
    action: "ball" | "bait" | "rock";
    encounter: SafariEncounter;
    tick: number;
    outcome: "caught" | "fled" | "stay" | "run";
    balls: number;
    position: { x: number; y: number; direction: number };
  } | null = null;

  constructor(private readonly port: SafariPort) {}

  get message(): string {
    return this.text;
  }
  set message(value: string) {
    this.text = value;
    this.messageTick = this.tickCount;
  }
  get run(): SafariRun | undefined {
    return this.port.run();
  }
  /**
   * The encounter's odds as `resolveSafariTurn` rolls them, in whole percent: a ball's catch chance
   * and the chance the pet flees after any action that is not "Chạy".
   */
  get odds(): { catch: number; flee: number } | null {
    const encounter = this.run?.encounter;
    if (!encounter) return null;
    const factor = encounter.effect === "bait" ? 0.5 : encounter.effect === "rock" ? 2 : 1;
    const species = SAFARI_SPECIES.find((row) => row.id === encounter.pet.speciesId);
    const speed = this.port.speed(encounter.pet.speciesId);
    return {
      catch: Math.round(Math.min(3380, (species?.catchRate ?? 0) * factor) / 100),
      flee: Math.round((100 * Math.min(256, Math.max(0, Math.floor(speed * 3 * factor)))) / 256),
    };
  }
  get map(): SafariMap | undefined {
    return this.port.map();
  }
  get captureSpec(): CaptureSpec {
    const spec = this.port.captureAnimation?.() ?? DEFAULT_CAPTURE_ANIMATION;
    return {
      captureSpriteId: spec.spriteId,
      captureDurations: spec.durations,
      captureEffectDurations: spec.effectDurations,
      captureShrinkSteps: spec.shrinkSteps,
      captureRestoreSteps: spec.restoreSteps,
    };
  }
  get captureVisual() {
    const animation = this.throwAnimation;
    if (!animation || animation.action !== "ball" || animation.tick >= this.captureTicks)
      return null;
    return captureVisualAt(this.captureSpec, animation.tick, animation.outcome === "caught");
  }
  get captureTicks(): number {
    return captureDuration(this.captureSpec, this.throwAnimation?.outcome === "caught");
  }

  open(): void {
    if (!this.run && !this.port.canEnter()) return;
    this.visible = true;
    this.selection = 0;
    this.confirmExit = false;
    this.message = "";
  }

  enter(seed = Date.now() >>> 0): void {
    if (this.run || this.port.blocked()) return;
    const map = this.map,
      wallet = this.port.wallet();
    if (!map || !wallet || !this.port.canEnter()) return;
    if (wallet.badges < SAFARI_FEE) {
      this.message = `Cần ${SAFARI_FEE} huy hiệu để vào Safari.`;
      return;
    }
    const run: SafariRun = {
      balls: SAFARI_BALLS,
      x: map.spawn[0],
      y: map.spawn[1],
      direction: 0,
      seed,
      steps: 0,
      encounter: null,
    };
    if (!safariPassable(map, run.x, run.y)) throw new Error("Safari spawn is blocked");
    run.steps = 12 + safariRandom(run, 11);
    wallet.badges -= SAFARI_FEE;
    this.caughtThisVisit = 0;
    this.port.setRun(run);
    this.message = "Đã vào Safari. Đi lại để gặp pet.";
    this.port.save();
  }

  leave(): void {
    if (this.port.blocked() || this.throwAnimation) return;
    this.port.setRun(undefined);
    this.confirmExit = false;
    this.visible = false;
    this.message = "Đã rời khu Safari.";
    this.port.save();
  }

  act(action: SafariAction): void {
    const run = this.run,
      encounter = run?.encounter;
    if (!run || !encounter || this.port.blocked() || this.throwAnimation) return;
    if (action === "ball" && !this.port.hasSpace()) {
      this.message = "Đội và ngân hàng pet đã đầy. Bóng được giữ lại.";
      return;
    }
    const before = structuredClone(encounter),
      name = this.port.speciesName?.(encounter.pet.speciesId) ?? "pet";
    if (action === "ball") run.balls--;
    const result = resolveSafariTurn(
      encounter,
      action,
      this.port.speed(encounter.pet.speciesId),
      (bound) => safariRandom(run, bound),
    );
    if (result === "caught") {
      this.port.receive(encounter.pet);
      this.caughtThisVisit++;
    }
    if (action !== "run") {
      this.throwAnimation = {
        action,
        encounter: before,
        tick: 0,
        outcome: result,
        balls: run.balls,
        position: { x: run.x, y: run.y, direction: run.direction },
      };
    }
    this.message =
      result === "caught"
        ? `Đã bắt được ${name}!`
        : result === "fled"
          ? `${name} đã bỏ chạy.`
          : result === "run"
            ? "Đã rời cuộc gặp."
            : action === "ball"
              ? "Pet thoát khỏi bóng."
              : encounter.effect === "bait"
                ? "Pet đang ăn mồi: khó bắt hơn nhưng ít bỏ chạy."
                : encounter.effect === "rock"
                  ? "Pet nổi giận: dễ bắt hơn nhưng dễ bỏ chạy."
                  : action === "rock"
                    ? "Hòn đá làm pet bỏ dở mồi, pet bình thường lại."
                    : "Miếng mồi làm pet nguôi giận, pet bình thường lại.";
    if (result !== "stay") {
      run.encounter = null;
      this.selection = 0;
    }
    if (run.balls === 0) {
      this.port.setRun(undefined);
      this.message += ` Hết bóng, lượt Safari kết thúc (bắt được ${this.caughtThisVisit} pet).`;
    }
    this.port.save();
  }

  tick(commands: readonly InputCommand[]): void {
    this.tickCount++;
    this.moving = false;
    if (this.throwAnimation) {
      this.throwAnimation.tick++;
      const duration =
        this.throwAnimation.action === "ball"
          ? this.captureTicks + (this.throwAnimation.outcome === "caught" ? 0 : 8)
          : 26;
      if (this.throwAnimation.tick >= duration) this.throwAnimation = null;
      return;
    }
    if (this.run) this.visible = true;
    if (!this.visible || this.port.blocked()) return;
    if (commands.includes("back")) {
      if (!this.run) this.visible = false;
      else this.confirmExit = !this.confirmExit;
      return;
    }
    if (this.confirmExit) {
      if (commands.includes("confirm")) this.leave();
      return;
    }
    const run = this.run;
    if (!run) {
      if (commands.includes("confirm")) this.enter();
      return;
    }
    if (run.encounter) {
      if (commands.includes("left") || commands.includes("up"))
        this.selection = (this.selection + 3) % 4;
      if (commands.includes("right") || commands.includes("down"))
        this.selection = (this.selection + 1) % 4;
      if (commands.includes("confirm"))
        this.act((["ball", "bait", "rock", "run"] as const)[this.selection]);
      return;
    }
    const directions = [
      ["up", 0, -1, 2],
      ["down", 0, 1, 0],
      ["left", -1, 0, 3],
      ["right", 1, 0, 1],
    ] as const;
    const direction = directions.find(
      ([key]) =>
        commands.includes(key) ||
        commands.includes(`hold${key[0].toUpperCase()}${key.slice(1)}` as InputCommand),
    );
    if (direction) this.move(direction[1], direction[2], direction[3]);
  }

  private move(dx: number, dy: number, direction: number): void {
    const run = this.run,
      map = this.map;
    if (!run || !map) return;
    const before =
      Math.floor(run.y / map.tileSize) * map.columns + Math.floor(run.x / map.tileSize);
    run.direction = direction;
    const startX = run.x,
      startY = run.y;
    for (let step = 0; step < 3; step++) {
      if (!safariPassable(map, run.x + dx, run.y + dy)) break;
      run.x += dx;
      run.y += dy;
      this.moving = true;
    }
    const [x, y, w, h] = map.exitTiles;
    if (
      run.x >= x * map.tileSize &&
      run.x < (x + w) * map.tileSize &&
      run.y >= y * map.tileSize &&
      run.y < (y + h) * map.tileSize
    ) {
      // Walking into the gate asks first, like "Rời": leaving forfeits the balls left.
      run.x = startX;
      run.y = startY;
      this.moving = false;
      this.confirmExit = true;
      return;
    }
    const after = Math.floor(run.y / map.tileSize) * map.columns + Math.floor(run.x / map.tileSize);
    if (before === after) return;
    run.steps--;
    if (run.steps === 0) {
      const row = pickSafariPet(safariRandom(run, 400));
      const pet = this.port.createPet(row.id, row.level, (bound) => safariRandom(run, bound));
      if (!pet) throw new Error(`Missing Safari species ${row.id}`);
      run.encounter = { pet, effect: "neutral", turns: 0 };
      run.steps = 12 + safariRandom(run, 11);
      this.selection = 0;
      this.message = "Gặp pet hoang dã!";
      // Only checkpoints save (encounters, throws, entering, leaving, the page hiding): a save per
      // tile froze the hero on every step while it reached the server.
      this.port.save();
    }
  }

  click(x: number, y: number): void {
    if (inside(SAFARI_BUTTONS.exit, x, y)) {
      this.tick(["back"]);
      return;
    }
    if (this.confirmExit) {
      if (inside(SAFARI_BUTTONS.leave, x, y)) this.tick(["confirm"]);
      else if (inside(SAFARI_BUTTONS.stay, x, y)) this.tick(["back"]);
      return;
    }
    if (!this.run) {
      if (inside(SAFARI_BUTTONS.enter, x, y)) this.tick(["confirm"]);
      else if (inside(SAFARI_BUTTONS.close, x, y)) this.tick(["back"]);
      return;
    }
    if (!this.run.encounter) return;
    const slot = SAFARI_COMMANDS.findIndex((rect) => inside(rect, x, y));
    if (slot >= 0) {
      this.selection = slot;
      this.tick(["confirm"]);
    }
  }
}
