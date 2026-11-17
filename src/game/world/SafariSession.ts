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
};

/** One Safari run suspends the original room; its only persistent state lives in the save. */
export class SafariSession {
  visible = false;
  selection = 0;
  message = "";
  tickCount = 0;
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

  get run(): SafariRun | undefined {
    return this.port.run();
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
    const before = structuredClone(encounter);
    if (action === "ball") run.balls--;
    const result = resolveSafariTurn(
      encounter,
      action,
      this.port.speed(encounter.pet.speciesId),
      (bound) => safariRandom(run, bound),
    );
    if (result === "caught") this.port.receive(encounter.pet);
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
        ? "Đã bắt được pet!"
        : result === "fled"
          ? "Pet đã bỏ chạy."
          : result === "run"
            ? "Đã rời cuộc gặp."
            : action === "ball"
              ? "Pet thoát khỏi bóng."
              : encounter.effect === "neutral"
                ? "Pet đã bình tĩnh trở lại."
                : encounter.effect === "bait"
                  ? "Pet đang ăn mồi."
                  : "Pet đang nổi giận.";
    if (result !== "stay") {
      run.encounter = null;
      this.selection = 0;
    }
    if (run.balls === 0) {
      this.port.setRun(undefined);
      this.message += " Đã dùng hết bóng, lượt Safari kết thúc.";
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
      this.leave();
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
    }
    this.port.save();
  }

  click(x: number, y: number): void {
    if (x >= 189 && y < 35) {
      this.tick(["back"]);
      return;
    }
    if (!this.run || this.confirmExit) {
      if (y >= 190) this.tick(["confirm"]);
      return;
    }
    if (this.run.encounter && y >= 236 && y < 292) {
      this.selection = Math.min(3, Math.max(0, Math.floor(x / 120) + (y >= 264 ? 2 : 0)));
      this.tick(["confirm"]);
    }
  }
}
