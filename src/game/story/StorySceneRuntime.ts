import { BattleRuntime } from "../battle/BattleRuntime";
import type { RoomAsset } from "./GameAssets";
import type { StoryActor } from "./StoryActor";
import { StoryEventInterpreter, type StoryEventStepResult } from "./StoryEventInterpreter";
import {
  SourceOpcodeInterpreter,
  type BattleContext,
  type GrantedPet,
  type RuntimeStoryEvent,
  type SourceProgram,
  type SourceRouteOptions,
  TextKind,
} from "./SourceOpcodeInterpreter";
import { ROUTE_ID } from "./SourceRoutes";
import type { StoryDataRegistry } from "./StoryDataRegistry";
import { sourceItem } from "./SourceItemCatalog";
import type { ItemTable } from "./SourceOpcodeInterpreter";

type StoryEvent = RuntimeStoryEvent;
type ActiveState = {
  tx?: number[];
  ty?: number[];
  remaining?: number[];
  waited?: number[];
  done?: boolean[];
  pathStep?: number;
  confirmed?: boolean;
  /** op49 went to the host's `taskOption.ui`; the answer comes from there, not the choice box. */
  panelChoice?: boolean;
  /** op83: the menu was answered with a notice; the record goes on here once it is read. */
  exchangeNext?: number;
};
export type StoryStarter = {
  speciesId: 68;
  level: 7;
  quality: 2;
  nature: 2;
  visualSpriteId: 154;
  skillIds?: [40, 41];
  currentHp?: number;
};
export type StoryTempEffect = { actor: number; state: number; tick: number };
export type StorySourceGroupLocator = { sceneId: number; roomIndex: number; groupIndex: number };
export type HostedBattleResolution = { result: number; branch: number; reason: string };
export type StorySceneServices = {
  room: (scene: number, room: number) => RoomAsset | undefined;
  animationTicks: (sprite: number, state: number) => number;
  /**
   * `TextBox.dialog` pagination (`paginateTagged` with the JavaSE text metrics). Without it a
   * dialog is one page, as before.
   */
  dialogPages?: (tagged: string) => string[];
  /** Start fetching a room's map when a scene loads it (rooms past the opening load on demand). */
  prepareRoom?: (scene: number, room: number) => void;
  /**
   * `VqsvGameRuntime.Scene.sourceSetMainTaskProgress`, called by op45 in the tick its tip opens.
   * Without it the announced task index is dropped and nothing else writes the scalar.
   */
  taskProgress?: (flag: number) => void;
  /** Resolve an op item id through the same pack catalog used by the bag and battle UI. */
  /** An item's name; `table` is its db.mid group (4 consumables when absent, 3 gear, 5 specials). */
  itemName?: (itemId: number, table?: ItemTable) => string | undefined;
  /**
   * Java runs a world group's op32 through the game's own battle screen, not inside the scene: the
   * world starts the fight, plays it, and hands the finished battle back here. Returning true says
   * the world took it, so this record waits; the scene then finishes it when the runtime arrives.
   * Without this service the scene builds the fight itself, the way the scripted intro does.
   */
  battleHost?: (context: BattleContext) => boolean | HostedBattleResolution;
  /** Branch quest mutations owned by StoryDirector/QuestLog, not by the presentation runtime. */
  setBranchTask?: (task: number, status: 1 | 3) => void;
  /** Source progression effects whose state belongs to the live world/save. */
  grantBadge?: (badgeId: number) => void;
  /**
   * True while op53's `badge.ui` award is up (`openSourceBadgeAward` + `WaitForPanelClosed`); the
   * record holds the group until it closes. Without it the grant is silent and the group goes on.
   */
  badgeAwardOpen?: () => boolean;
  /**
   * op49 (`openBranchTaskAcceptOption`): ask the host to show `taskOption.ui` for this branch task.
   * True when it will; the record then waits for `taskOptionAnswer` (0 accepts, 1 declines). Without
   * it the offer falls back to the in-scene choice box.
   */
  openTaskOption?: (task: number, options: readonly string[]) => boolean;
  taskOptionAnswer?: () => number | null;
  refreshPets?: () => void;
  /** op66's `a.a.r[feature][0] = 3`; persisted by WorldFlags. */
  unlockSourceFeature?: (feature: number) => void;
  /** op20's invisible quest-item row, persisted with the campaign flags. */
  mutateSourceFlag?: (mode: number, flag: number) => void;
  /**
   * op87 mode 0, `game.j.a(slot, species, level, quality, nature, skillA, skillB)`: the roster is the
   * world's, so the world builds and keeps the pet and returns the name the reward box announces.
   * The record then waits for the key the way the source's does.
   */
  grantPet?: (pet: GrantedPet) => string;
  /** op84's two live numbers: counter 0 is the collection (found, missing), 1 the race. */
  sourceCounts?: (counter: number) => readonly [number | string, number | string];
  /** `sourceCanPay(s, 0, amount)`: the hero holds this much money. */
  canPay?: (amount: number) => boolean;
  /** The V4 eggs Jones sells (`V4EggCatalog`), in menu order. */
  exchangeEggs?: () => readonly { itemId: number; name: string; price: number }[];
  /** `V4EggShopService.purchase`: pay the price and add the egg; false when the money is short. */
  buyEgg?: (itemId: number, price: number) => boolean;
  /** `roster.size() >= 6 && PetBankExpansionService.full(...)`: no room for another pet. */
  petStorageFull?: () => boolean;
  /** A room runtime's script step: still running, done, or the branch to take. */
  worldHook?: (hook: string, elapsed: number) => "continue" | "complete" | { branch: number };
};

/**
 * `VqsvSceneActors.makeActors`: the actor set of the blank 0:0 tableau (`loadBlankWorldRoom`), all
 * hidden — [id, sprite, state, x, y]. `Sc8C2Runtime.Scene0G2` stages the four forces with it.
 */
const BLANK_ROOM_ACTORS: readonly (readonly number[])[] = [
  [0, 84, 0, 384, 168],
  [1, 85, 0, 9, 274],
  [2, 161, 0, 53, 192],
  [3, 173, 0, 187, 419],
  [4, 185, 0, 383, 191],
  [5, 101, 0, 15, 246],
  [6, 117, 0, 354, 110],
  [7, 133, 0, 26, 91],
  [8, 149, 0, 378, 238],
  [9, 327, 2, 124, 357],
  [10, 266, 0, 618, 130],
  [11, 266, 0, 617, 144],
  [12, 266, 0, 617, 145],
  [13, 266, 0, 617, 145],
  [14, 267, 2, 255, 223],
  [15, 267, 2, 196, 239],
  [16, 267, 2, 156, 211],
  [17, 262, 0, 602, 199],
  [18, 262, 0, 132, 227],
  [19, 262, 0, 201, 222],
  [20, 262, 0, 264, 219],
  [21, 262, 0, 601, 199],
  [22, 264, 0, 148, 201],
  [23, 264, 0, 204, 221],
  [24, 264, 0, 262, 205],
  [25, 266, 0, 615, 149],
  [26, 267, 0, 153, 199],
  [27, 267, 0, 188, 249],
  [28, 267, 0, 260, 233],
  [29, 266, 0, 615, 149],
  [30, 266, 0, 616, 149],
  [31, 266, 0, 617, 149],
  [32, 266, 0, 158, 210],
  [33, 266, 0, 211, 257],
  [34, 266, 0, 617, 148],
  [35, 266, 0, 251, 203],
  [36, 262, 0, 603, 196],
  [37, 262, 0, 601, 197],
  [38, 262, 0, 602, 197],
  [39, 85, 0, 46, 166],
];
const INITIAL_SCENE0_ACTORS: number[][] = [
  [0, 84, 384, 168],
  [1, 85, 9, 274],
  [2, 161, 53, 192],
  [3, 173, 187, 419],
  [4, 185, 383, 191],
  [5, 101, 15, 246],
  [6, 117, 354, 110],
  [7, 133, 26, 91],
  [8, 149, 378, 238],
  [9, 327, 124, 357],
  [14, 267, 255, 223],
  [15, 267, 196, 239],
  [16, 267, 156, 211],
  [18, 262, 132, 227],
  [19, 262, 201, 222],
  [20, 262, 264, 219],
  [22, 264, 148, 201],
  [23, 264, 204, 221],
  [24, 264, 262, 205],
  [26, 267, 153, 199],
  [27, 267, 188, 249],
  [28, 267, 260, 233],
  [29, 266, 615, 149],
  [30, 266, 616, 149],
  [32, 266, 158, 210],
  [33, 266, 211, 257],
  [35, 266, 251, 203],
];

/** `ScreenEffect.SOURCE_SHAKE_PATTERN_2`. */
const SHAKE_PATTERN = [-5, 10, -5];

export class StorySceneRuntime {
  readonly id: string;
  readonly sourceSceneId: number;
  readonly sourceRoomIndex: number;
  get sourceGroups(): readonly StorySourceGroupLocator[] {
    return this.program.groups;
  }
  readonly starter: StoryStarter;
  readonly actors = new Map<number, StoryActor>();
  readonly actorEffects: StoryTempEffect[] = [];
  readonly eventFlags = new Set<string>();
  /** An op24 viewport shake under way (`ScreenEffect.shakeX/shakeY` read `offset`). */
  shake: { mode: number; index: number; repeats: number; offset: number } | null = null;
  /** `VqsvSceneView`'s `translate(shakeX, shakeY)`. */
  get shakeOffset(): { x: number; y: number } {
    const shake = this.shake;
    if (!shake) return { x: 0, y: 0 };
    return shake.mode === 0 ? { x: shake.offset, y: 0 } : { x: 0, y: shake.offset };
  }
  eventIndex: number;
  tickCount = 0;
  sceneId = -1;
  roomIndex = -1;
  renderScene = -1;
  renderRoom = -1;
  cameraX = 0;
  cameraY = 0;
  followActor: number | null = null;
  currentText: string | null = null;
  /**
   * Where the dialog pager broke the current page (offsets into `currentText`). `currentText`
   * stays Java's page (no dropped spaces, so typing ticks match); the box draws these lines.
   */
  currentBreaks: readonly number[] = [];
  currentSpeaker = "";
  /** The dialog box's `dialogMode` (see the text event's `mode`). */
  currentDialogMode = 0;
  /** `rainbowPortraitIndex` of the box on screen, -1 for none. */
  currentPortrait = -1;
  /** `rainbowPortraitOffset`: ±50 when the box opens, 20 px closer to 0 every tick. */
  portraitOffset = 0;
  textKind: TextKind = "full";
  textBoxRect: { x: number; y: number; width: number; height: number } | null = null;
  textRevision = 0;
  textTick = 0;
  visibleChars = 0;
  textReady = false;
  textFull = false;
  textDoneTicks = 0;
  effect = "";
  effectTick = 0;
  particleEffect = "";
  complete = false;
  tenYearsBoundary = false;
  battle: BattleRuntime | null = null;
  /** A deliberately bypassed hosted battle; op47 still consumes its authored win branch. */
  private hostedBattle: HostedBattleResolution | null = null;
  battleConsumed = false;
  dialogueSkipActive = false;
  /** op35: the option box the source is showing, with the row its cursor is on. */
  choice: { options: readonly string[]; index: number } | null = null;
  private textDisposed = false;
  /** Dialog pages (tagged) and the one showing; a single page for every other text kind. */
  private textPages: string[] = [];
  private textPage = 0;
  /** `TextBox.waitKey`: whether this box asks for a key (and so may show the ready prompt). */
  private textWaits = true;
  private readonly interpreter: StoryEventInterpreter<StoryEvent, StorySceneRuntime>;
  private activeState: ActiveState = {};
  /** The actor the player activated while op38 was waiting; resolved on the next tick. */
  private pendingActivation: number | null = null;
  private readonly actorModes = new Map<number, string>();
  private startupDelay: number;
  private awaitingTenYears = false;
  private actorsPausedThisTick = false;
  constructor(
    readonly program: SourceProgram,
    private readonly services: StorySceneServices,
    skipIntro = false,
  ) {
    this.id = program.id;
    this.sourceSceneId = program.groups[0].sceneId;
    this.sourceRoomIndex = program.groups[0].roomIndex;
    this.eventIndex = program.startEvent;
    this.startupDelay = program.startupDelay;
    this.starter = this.isOpening
      ? { speciesId: 68, level: 7, quality: 2, nature: 2, visualSpriteId: 154 }
      : {
          speciesId: 68,
          level: 7,
          quality: 2,
          nature: 2,
          visualSpriteId: 154,
          skillIds: [40, 41],
          currentHp: 179,
        };
    this.interpreter = new StoryEventInterpreter(program.events, (event, context, elapsed) =>
      context.handle(event, elapsed),
    );
    if (this.isOpening) {
      for (const [id, sprite, x, y] of INITIAL_SCENE0_ACTORS)
        this.actors.set(id, {
          id,
          sprite,
          x,
          y,
          state: 0,
          direction: 0,
          variant: 0,
          renderOffsetX: 0,
          renderOffsetY: 0,
          visible: false,
          layer: 1,
          animationTick: 0,
        });
      if (skipIntro) this.skipToTenYears();
    } else if (program.initialRoom)
      this.loadRoom(
        program.initialRoom.scene,
        program.initialRoom.room,
        program.initialRoom.x,
        program.initialRoom.y,
        true,
      );
  }
  private get isOpening(): boolean {
    return this.program.id === ROUTE_ID.openingIntro;
  }
  confirm(): void {
    if ((this.complete && this.isOpening) || this.tenYearsBoundary) return;
    const event = this.waitingEvent;
    // op38 waits for the world's activation key, which arrives through `activateActor`, not a text box.
    if (event?.type === "waitForActor") return;
    if (
      event?.type === "choice" ||
      (event?.type === "branchChoice" && !this.activeState.panelChoice) ||
      (event?.type === "eggExchange" && this.choice)
    ) {
      this.activeState.confirmed = true;
      return;
    }
    if (
      event?.type !== "text" &&
      event?.type !== "item" &&
      event?.type !== "currency" &&
      event?.type !== "grantPet" &&
      event?.type !== "countText" &&
      event?.type !== "eggExchange"
    )
      return;
    if (this.visibleChars < (this.currentText?.length ?? 0)) {
      this.visibleChars = this.currentText?.length ?? 0;
      this.textReady = true;
    } else if (this.textReady && this.textPage + 1 < this.textPages.length) {
      // `TextBox.confirm`: the next page restarts the typewriter; the box stays open.
      this.textPage++;
      this.showPage(this.textPages[this.textPage]);
      this.visibleChars = 0;
      this.textDoneTicks = 0;
      this.textReady = false;
    } else if (this.textReady) {
      this.activeState.confirmed = true;
      if (event.type === "text" && event.clearEffectOnConfirm) this.clearEffect();
    }
  }
  /**
   * The world finished a fight it hosted without a `BattleRuntime` (a simultaneous 2v2): the parked
   * op32 record completes and op47 reads this result and branch.
   */
  finishHostedBattle(resolution: HostedBattleResolution): void {
    this.hostedBattle = resolution;
  }
  /** Every event that finished, in the order it finished; the world settles side effects from this. */
  get completedEvents(): readonly StoryEvent[] {
    return this.interpreter.completed;
  }
  /** The program is over: its last record completed, or there is no record left to run. */
  get exhausted(): boolean {
    return (
      this.complete ||
      (this.interpreter.event === null && this.interpreter.index >= this.program.events.length)
    );
  }
  /** The actors op38 waits for, empty while nothing waits; the world tests activation against these. */
  get activationIds(): readonly number[] {
    const event = this.waitingEvent;
    return event?.type === "waitForActor" ? event.ids : [];
  }
  /**
   * op38: the player activated `id`. The branch is taken on the next tick, so input stays a sample and
   * the program keeps moving on the simulation clock.
   */
  activateActor(id: number): boolean {
    if (!this.activationIds.includes(id)) return false;
    this.pendingActivation = id;
    return true;
  }
  /** op35: move the option cursor (`ChoiceBox.move`), clamped at both ends like Java's. */
  moveChoice(delta: number): void {
    if (!this.choice) return;
    this.choice.index = Math.max(
      0,
      Math.min(this.choice.options.length - 1, this.choice.index + delta),
    );
  }
  requestDialogueSkip(): void {
    if (this.textKind !== "dialog" || !this.currentText) return;
    this.dialogueSkipActive = true;
    this.visibleChars = this.currentText.length;
    this.textDoneTicks = 39;
    this.textReady = true;
    this.activeState.confirmed = true;
  }
  tick(): void {
    if (this.isOpening && (this.complete || this.tenYearsBoundary)) return;
    if (this.tenYearsBoundary) {
      this.tickCount++;
      this.tickText();
      this.tickActors();
      return;
    }
    this.tickCount++;
    if (this.startupDelay > 0) {
      this.startupDelay--;
      return;
    }
    if (this.awaitingTenYears) {
      this.currentText = "Mười năm sau...";
      this.currentBreaks = [];
      this.textKind = "full";
      this.visibleChars = 0;
      this.textDoneTicks = 0;
      this.textReady = false;
      this.eventIndex = 225;
      this.tenYearsBoundary = true;
      this.tickActors();
      return;
    }
    this.actorsPausedThisTick = false;
    this.tickText();
    this.tickActorEffects();
    const before = this.interpreter.index;
    this.interpreter.tick(this);
    if (this.interpreter.index !== before) this.eventIndex++;
    if (!this.actorsPausedThisTick) this.tickActors();
    this.updateCameraFollow();
  }
  digest(): string {
    return JSON.stringify({
      scene: this.sceneId,
      room: this.roomIndex,
      event: this.eventIndex,
      tick: this.tickCount,
      text: this.currentText,
      ready: this.textReady,
      effect: this.effect,
      complete: this.complete,
      tenYears: this.tenYearsBoundary,
      starter: this.starter,
      flags: [...this.eventFlags],
      actors: [...this.actors.values()]
        .filter((a) => a.visible)
        .map((a) => [a.id, a.x, a.y, a.state]),
    });
  }
  advanceToOpeningCheckpoint(): void {
    for (let i = 0; i < 500 && !this.textReady; i++) this.tick();
    this.confirm();
    this.tick();
    for (let i = 0; i < 45; i++) this.tick();
  }
  setPlayer(x: number, y: number, direction: number): void {
    const player = this.actor(-1);
    player.x = x;
    player.y = y;
    player.direction = direction;
    player.visible = true;
    this.followActor = -1;
    this.updateCameraFollow();
  }
  /**
   * Make a running world event group walk around in the hero the world is actually moving. Java has
   * one hero object — the interpreter resolves source actor 0 to `scene.player`, the same record the
   * free-world mover writes — so a script here must edit that object instead of a copy of it.
   */
  adoptWorldPlayer(player: StoryActor): void {
    this.actors.set(-1, player);
  }
  /** The command that may still be waiting: an atomic block waits on its last child. */
  private get waitingEvent(): StoryEvent | null {
    const event = this.interpreter.event;
    return event?.type === "atomic" ? (event.events.at(-1) ?? null) : event;
  }
  private handle(e: StoryEvent, elapsed: number): StoryEventStepResult {
    if (elapsed === 1) this.activeState = {};
    if (e.type === "atomic") {
      if (elapsed === 1)
        for (const child of e.events.slice(0, -1))
          if (this.handle(child, 1) !== "complete")
            throw new Error(`atomic: ${child.type} must finish in the tick it starts`);
      const last = e.events.at(-1);
      return last ? this.handle(last, elapsed) : "complete";
    }
    if (e.type === "centerOnActor") {
      const actor = this.actor(e.actor),
        camera = this.cameraOffset(actor.x, actor.y);
      this.cameraX = camera.x;
      this.cameraY = camera.y;
      return "complete";
    }
    if (e.type === "followActor") {
      this.followActor = e.actor;
      return "complete";
    }
    if (e.type === "cameraStop") {
      this.followActor = null;
      return "complete";
    }
    if (e.type === "delay") return elapsed >= e.ticks ? "complete" : "continue";
    if (e.type === "effect") {
      if (elapsed === 1) {
        if (e.name.startsWith("star-particles") || e.name.startsWith("fire-particles")) {
          this.clearEffect();
          this.particleEffect = e.name;
        } else if (e.name === "stop-particles") this.particleEffect = "";
        else {
          this.effect = e.name;
          this.effectTick = 0;
        }
      } else if (!e.name.includes("particles")) this.effectTick++;
      return e.ticks === 0 || elapsed > e.ticks ? "complete" : "continue";
    }
    if (e.type === "text") {
      if (elapsed === 1) this.startText(e);
      if (this.activeState.confirmed) {
        this.disposeText();
        return "complete";
      }
      if (!e.wait) return "complete";
      return "continue";
    }
    if (e.type === "active") {
      e.ids.forEach((id, i) => {
        const actor = this.actors.get(id);
        if (!actor) return;
        actor.visible = true;
        this.setAction(actor, 0, e.dirs[i] ?? 0);
      });
      return "complete";
    }
    if (e.type === "hide") {
      e.ids.forEach((id) => (this.actor(id).visible = false));
      return "complete";
    }
    // op11 (`CameraMove`) takes the camera: nothing follows the hero while it pans, and once a pan
    // back to the hero arrives the camera stays on him again.
    if (e.type === "camera") {
      if (elapsed === 1) this.followActor = null;
      if (elapsed === 1 && e.speed) return "continue";
      return this.panCamera(e.x, e.y, e.speed ?? 0) ? "complete" : "continue";
    }
    if (e.type === "cameraActor") {
      if (elapsed === 1) {
        this.followActor = null;
        return "continue";
      }
      const actor = this.actor(e.actor);
      if (!this.panCamera(actor.x, actor.y, e.speed)) return "continue";
      if (e.actor === -1) this.followActor = -1;
      return "complete";
    }
    if (e.type === "load") {
      this.loadRoom(e.scene, e.room, e.x, e.y, e.updateWorld);
      if (e.direction !== undefined) this.setAction(this.actor(-1), 0, e.direction);
      return "complete";
    }
    if (e.type === "routeBoundary") {
      this.loadRoom(e.scene, e.room, e.x, e.y, true);
      this.followActor = -1;
      return "complete";
    }
    if (e.type === "placeActor") {
      const actor = this.actor(e.actor);
      actor.x = e.x;
      actor.y = e.y;
      this.setAction(actor, 0, actor.direction);
      return "complete";
    }
    if (e.type === "place") {
      const player = this.actor(-1);
      player.x = e.x;
      player.y = e.y;
      player.visible = true;
      this.followActor = -1;
      const camera = this.cameraOffset(e.x, e.y);
      this.cameraX = camera.x;
      this.cameraY = camera.y;
      return "complete";
    }
    if (e.type === "path") {
      if (this.activeState.pathStep === undefined) {
        this.activeState.pathStep = 0;
        return "continue";
      }
      const step = this.activeState.pathStep;
      if (step >= e.xs[0].length) return "complete";
      e.ids.forEach((id, i) => {
        const actor = this.actor(id);
        actor.x = e.xs[i][step];
        actor.y = e.ys[i][step];
      });
      this.activeState.pathStep++;
      return this.activeState.pathStep >= e.xs[0].length ? "complete" : "continue";
    }
    if (e.type === "move") {
      if (!this.activeState.tx) {
        this.activeState.tx = [...e.tx];
        this.activeState.ty = [...e.ty];
        return "continue";
      }
      let done = true;
      e.ids.forEach((id, i) => {
        if (this.activeState.tx![i] > 0 || this.activeState.ty![i] > 0) {
          done = false;
          this.activeState.tx![i]--;
          this.activeState.ty![i]--;
          const actor = this.actor(id);
          actor.x += e.dx[i];
          actor.y += e.dy[i];
        }
      });
      return done ? "complete" : "continue";
    }
    if (e.type === "action") return this.handleAction(e, elapsed);
    if (e.type === "shake") {
      // `ScreenEffect.startShake` / `tickShake` over `SOURCE_SHAKE_PATTERN_2`, waited on by
      // `doneShake`.
      if (elapsed === 1) {
        this.shake = { mode: e.mode, index: 0, repeats: e.repeats, offset: SHAKE_PATTERN[0] };
        return "continue";
      }
      const shake = this.shake!;
      shake.index++;
      if (shake.index >= SHAKE_PATTERN.length) {
        shake.index = 0;
        shake.repeats--;
        if (shake.repeats <= 0) {
          this.shake = null;
          return "complete";
        }
      }
      shake.offset = SHAKE_PATTERN[shake.index];
      return "continue";
    }
    if (e.type === "actorCycle") {
      if (elapsed === 1) {
        this.activeState.waited = [0];
        e.ids.forEach((id, i) => {
          const actor = this.actor(id);
          actor.visible = true;
          actor.state = e.modes[i] ?? e.modes.at(-1) ?? 0;
          actor.animationTick = 0;
        });
        return "continue";
      }
      const waited = ++this.activeState.waited![0];
      const done = e.ids.every((id) => {
        const actor = this.actor(id);
        return (
          actor.animationTick >=
          Math.max(1, this.services.animationTicks(actor.sprite, actor.state))
        );
      });
      return done || waited > 90 ? "complete" : "continue";
    }
    if (e.type === "timed") return this.handleTimed(e, elapsed);
    if (e.type === "actorEffect") {
      this.actorEffects.push({ actor: e.actor, state: e.state, tick: 0 });
      return "complete";
    }
    if (e.type === "taskProgress") {
      if (elapsed === 1) this.services.taskProgress?.(e.flag);
      return "complete";
    }
    if (e.type === "item") {
      if (elapsed === 1) {
        const itemName = this.services.itemName?.(e.itemId, e.table) ?? sourceItem(e.itemId).name,
          prefix = e.mode === 0 ? "Đạt được: " : "Mất: ";
        this.startText({
          type: "text",
          text: `${prefix}${itemName} x ${e.quantity}`,
          wait: true,
          kind: "openbox",
          box: { x: 47, y: 154, width: 146, height: 26 },
        });
      }
      if (this.activeState.confirmed) {
        this.disposeText();
        return "complete";
      }
      return "continue";
    }
    if (e.type === "currency") {
      // `op31CurrencyReward`: "Đạt được: N kim tiền", "Mất: N huy hiệu"... in `TextBox.openBox`;
      // an unknown [mode, kind] pair shows nothing, as in JavaSE.
      const text = currencyText(e.mode, e.kind, e.amount);
      if (text === null) return "complete";
      if (elapsed === 1)
        this.startText({
          type: "text",
          text,
          wait: true,
          kind: "openbox",
          box: { x: 47, y: 154, width: 146, height: 26 },
        });
      if (this.activeState.confirmed) {
        this.disposeText();
        return "complete";
      }
      return "continue";
    }
    if (e.type === "badge") {
      if (elapsed === 1) this.services.grantBadge?.(e.badgeId);
      return this.services.badgeAwardOpen?.() ? "continue" : "complete";
    }
    if (e.type === "refreshPets") {
      if (elapsed === 1) this.services.refreshPets?.();
      return "complete";
    }
    if (e.type === "featureUnlock") {
      if (elapsed === 1) this.services.unlockSourceFeature?.(e.feature);
      return "complete";
    }
    if (e.type === "sourceFlag") {
      if (elapsed === 1) this.services.mutateSourceFlag?.(e.mode, e.flag);
      return "complete";
    }
    if (e.type === "waitForActor") {
      const picked = this.pendingActivation === null ? -1 : e.ids.indexOf(this.pendingActivation);
      this.pendingActivation = null;
      if (picked < 0) return "continue";
      this.interpreter.jumpTo(e.next[picked]);
      return "complete";
    }
    if (e.type === "choice") {
      if (elapsed === 1) this.choice = { options: e.options, index: 0 };
      if (!this.activeState.confirmed) return "continue";
      const picked = this.choice?.index ?? 0;
      this.choice = null;
      this.interpreter.jumpTo(e.next[picked]);
      return "complete";
    }
    if (e.type === "branchChoice") {
      if (elapsed === 1) {
        this.activeState.panelChoice = this.services.openTaskOption?.(e.task, e.options) ?? false;
        if (!this.activeState.panelChoice) this.choice = { options: e.options, index: 0 };
      }
      let picked: number;
      if (this.activeState.panelChoice) {
        const answer = this.services.taskOptionAnswer?.() ?? null;
        if (answer === null) return "continue";
        picked = answer;
      } else {
        if (!this.activeState.confirmed) return "continue";
        picked = this.choice?.index ?? 0;
        this.choice = null;
      }
      if (picked === 0) this.services.setBranchTask?.(e.task, 1);
      this.interpreter.jumpTo(e.next[picked] ?? e.next.at(-1) ?? 0);
      return "complete";
    }
    if (e.type === "completeBranch") {
      if (elapsed === 1) this.services.setBranchTask?.(e.task, 3);
      return "complete";
    }
    if (e.type === "jump") {
      this.interpreter.jumpTo(e.next);
      return "complete";
    }
    if (e.type === "worldHook") {
      const result = this.services.worldHook?.(e.hook, elapsed) ?? "complete";
      if (typeof result === "string") return result;
      const target = e.next?.[result.branch];
      if (target !== undefined) this.interpreter.jumpTo(target);
      return "complete";
    }
    if (e.type === "petsFull") {
      if (this.services.petStorageFull?.()) this.interpreter.jumpTo(e.next);
      return "complete";
    }
    if (e.type === "countText") {
      if (elapsed === 1) {
        const values = this.services.sourceCounts?.(e.counter) ?? ["", ""];
        let at = 0;
        this.startText({
          type: "text",
          text: e.template.replace(/%s/g, () => String(values[at++] ?? "")),
          speaker: e.speaker,
          wait: true,
          kind: "dialog",
        });
      }
      if (!this.activeState.confirmed) return "continue";
      this.disposeText();
      return "complete";
    }
    if (e.type === "eggExchange") return this.handleEggExchange(e, elapsed);
    if (e.type === "grantPet") {
      if (elapsed === 1) {
        if (!this.services.grantPet)
          throw new Error(
            `${this.id}: op36/op87 needs pet storage, and the scene has no grantPet service`,
          );
        this.startText({
          type: "text",
          text: `Đạt được: ${this.services.grantPet(e)}`,
          wait: true,
          kind: "openbox",
          box: { x: 47, y: 154, width: 146, height: 26 },
        });
      }
      if (this.activeState.confirmed) {
        this.disposeText();
        return "complete";
      }
      return "continue";
    }
    if (e.type === "battle") {
      // A fight the world hosted on another engine (a gym's 2v2) answered with its result.
      if (this.hostedBattle) return "complete";
      if (!this.battle) {
        const hosted = this.services.battleHost?.(e.context);
        if (hosted === true) return "continue";
        if (hosted) {
          this.hostedBattle = hosted;
          return "complete";
        }
        this.battle = new BattleRuntime(e.context);
      }
      this.battle.tick();
      return this.battle.complete ? "complete" : "continue";
    }
    if (e.type === "consumeBattle") {
      // `consumeOp47`: the result index picks the branch, and the one result that is not an index at
      // all — running away, -1 — has to leave the branch unset too. Anything else means the fight and
      // the record disagree, which is a data bug rather than something the player can cause.
      const result = this.battle?.result ?? this.hostedBattle?.result ?? -1,
        branch = this.battle?.branch ?? this.hostedBattle?.branch ?? -1,
        expected = result === -1 ? -1 : e.branchTargets[result];
      if (branch !== expected)
        throw new Error(
          `Source op47 raw target mismatch result=${result} expected=${expected} actual=${branch}`,
        );
      this.battleConsumed = true;
      // `consumeOp47`: the result's record is where the group goes on. A catch reads on in order
      // (`CaptureBattle`'s success lines follow op47); a capture fight won by knockout takes its
      // result-0 record, the miss ("Lại bỏ lỡ cơ hội!", the step back, op42).
      const caught = this.battle?.outcome?.reason === "catch",
        next = result >= 0 && !caught ? e.next?.[result] : undefined;
      this.battle = null;
      this.hostedBattle = null;
      if (next !== undefined) this.interpreter.jumpTo(next);
      return "complete";
    }
    if (e.type === "counter") return elapsed >= 2 ? "complete" : "continue";
    if (e.type === "groupEnd") {
      if (this.program.stopAtTenYears) this.awaitingTenYears = true;
      else this.complete = true;
      return "complete";
    }
    return "complete";
  }
  private startText(e: Extract<StoryEvent, { type: "text" }>): void {
    this.textDisposed = false;
    this.textWaits = e.wait;
    if (e.effect) this.effect = e.effect;
    // `TextBox.dialog` tags the message with its ink colour, then paginates it.
    this.textPages =
      e.kind === "dialog" && this.services.dialogPages
        ? this.services.dialogPages(`#000000${e.text}`)
        : [e.text];
    this.textPage = 0;
    this.showPage(this.textPages[0]);
    this.currentSpeaker = e.speaker ?? "";
    this.currentDialogMode = e.mode ?? 0;
    this.currentPortrait = e.portrait ?? -1;
    this.portraitOffset = this.currentPortrait < 0 ? 0 : this.currentPortrait === 0 ? -50 : 50;
    this.textKind = e.kind;
    this.textBoxRect = e.box ?? null;
    this.textRevision++;
    this.textTick = 0;
    this.textFull = this.textKind === "full";
    this.visibleChars = 0;
    this.textDoneTicks = 0;
    this.textReady = false;
    if (this.dialogueSkipActive && this.textKind === "dialog") this.activeState.confirmed = true;
  }
  /**
   * Java `TextBox.disposed`: a confirmed box is still drawn for the rest of this tick and dropped
   * when the next tick's text update runs (`if (text.disposed) text = null`).
   */
  private disposeText(): void {
    this.textDisposed = true;
  }
  private clearText(): void {
    this.textDisposed = false;
    this.textPages = [];
    this.textPage = 0;
    this.currentText = null;
    this.currentBreaks = [];
    this.textBoxRect = null;
    this.textTick = 0;
    this.visibleChars = 0;
    this.textDoneTicks = 0;
    this.textReady = false;
  }
  private tickText(): void {
    if (this.textDisposed) this.clearText();
    if (!this.currentText) return;
    this.textTick++;
    if (this.currentPortrait >= 0)
      this.portraitOffset -=
        Math.sign(this.portraitOffset) * Math.min(20, Math.abs(this.portraitOffset));
    if (this.textKind === "openbox") {
      this.visibleChars = this.currentText.length;
      this.textDoneTicks++;
      this.textReady = this.textWaits && this.textDoneTicks > 10;
      return;
    }
    if (this.textKind === "tasktip") {
      this.visibleChars = this.currentText.length;
      this.textDoneTicks++;
      this.textReady = this.textWaits;
      return;
    }
    if (this.visibleChars < this.currentText.length) {
      this.visibleChars = Math.min(this.currentText.length, this.visibleChars + 2);
      this.textDoneTicks = 0;
      this.textReady = false;
    } else {
      this.textDoneTicks++;
      // Java `TextBox.tick`: only a box that waits for a key ever becomes ready for one.
      if (this.textWaits && this.textDoneTicks > 38) this.textReady = true;
    }
  }
  private handleAction(
    e: Extract<StoryEvent, { type: "action" }>,
    elapsed: number,
  ): StoryEventStepResult {
    if (elapsed === 1) {
      this.activeState.waited = e.ids.map(() => 0);
      this.activeState.done = e.ids.map(() => false);
      e.ids.forEach((id, i) => this.setAction(this.actor(id), e.modes[i], e.dirs[i]));
      return "continue";
    }
    let all = true;
    e.ids.forEach((id, i) => {
      if (this.activeState.done![i]) return;
      const actor = this.actor(id);
      this.activeState.waited![i]++;
      const cycle = Math.max(1, this.services.animationTicks(actor.sprite, actor.state));
      if (actor.animationTick >= cycle || this.activeState.waited![i] > 45) {
        this.setAction(actor, 0, actor.direction);
        this.activeState.done![i] = true;
      } else all = false;
    });
    return all ? "complete" : "continue";
  }
  private handleTimed(
    e: Extract<StoryEvent, { type: "timed" }>,
    elapsed: number,
  ): StoryEventStepResult {
    if (elapsed === 1) {
      this.activeState.remaining = [...e.durations];
      e.ids.forEach((id, i) => this.setAction(this.actor(id), 3, e.dirs[i]));
      return "continue";
    }
    let all = true;
    e.ids.forEach((id, i) => {
      if (this.activeState.remaining![i] <= 0) return;
      const actor = this.actor(id);
      this.step(actor, e.speeds[i]);
      this.activeState.remaining![i]--;
      if (this.activeState.remaining![i] > 0) all = false;
    });
    if (all) e.ids.forEach((id) => this.setAction(this.actor(id), 0, this.actor(id).direction));
    return all ? "complete" : "continue";
  }
  private setAction(actor: StoryActor, mode: number, direction: number): void {
    const key = `${mode}:${direction}`;
    if (this.actorModes.get(actor.id) === key) return;
    actor.direction = direction;
    actor.state = this.stateFor(actor, mode, direction);
    actor.animationTick = 0;
    this.actorModes.set(actor.id, key);
  }
  private stateFor(actor: StoryActor, mode: number, direction: number): number {
    if (this.isOpening)
      return actor.variant === 1 || actor.variant === 18
        ? direction === 3
          ? 1
          : Math.max(0, Math.min(2, direction))
        : 0;
    if (actor.variant !== 1 && actor.variant !== 18) return mode;
    const normalized = direction === 3 ? 1 : direction;
    if (mode === 7) return 3 + normalized;
    const family = Math.floor(mode / 3);
    return family >= 0 && family <= 3 ? family * 3 + normalized : 0;
  }
  private step(actor: StoryActor, speed: number): void {
    const amount = Math.max(1, Math.abs(speed));
    if (actor.direction === 0) actor.y += amount;
    else if (actor.direction === 1) actor.x += amount;
    else if (actor.direction === 2) actor.y -= amount;
    else if (actor.direction === 3) actor.x -= amount;
  }
  /** `moveCameraToward(x, y, speed)` then `cameraCenteredOn(x, y)`, for a room runtime's own cue. */
  panCameraTo(x: number, y: number, speed: number): boolean {
    return this.panCamera(x, y, speed);
  }
  /** `setCameraCenter(x, y)`. */
  centerCameraOn(x: number, y: number): void {
    const camera = this.cameraOffset(x, y);
    this.cameraX = camera.x;
    this.cameraY = camera.y;
  }
  /** `followActor(id)` (null: `stopCameraFollow`), applied this tick. */
  followCamera(id: number | null): void {
    this.followActor = id;
    this.updateCameraFollow();
  }
  private panCamera(x: number, y: number, speed: number): boolean {
    const target = this.cameraOffset(x, y);
    if (speed <= 0) {
      this.cameraX = target.x;
      this.cameraY = target.y;
      return true;
    }
    const dx = target.x - this.cameraX,
      dy = target.y - this.cameraY,
      distance = Math.floor(Math.sqrt(dx * dx + dy * dy));
    if (distance <= speed) {
      this.cameraX = target.x;
      this.cameraY = target.y;
      return true;
    }
    this.cameraX += Math.trunc((dx * speed) / distance);
    this.cameraY += Math.trunc((dy * speed) / distance);
    return false;
  }
  private loadRoom(scene: number, room: number, x: number, y: number, updateWorld = false): void {
    this.services.prepareRoom?.(scene, room);
    this.renderScene = scene;
    this.renderRoom = room;
    if (updateWorld || !this.isOpening) {
      this.sceneId = scene;
      this.roomIndex = room;
    }
    const asset = this.services.room(scene, room),
      player = this.actors.get(-1);
    if (asset) {
      this.actors.clear();
      this.actorModes.clear();
      for (const actor of asset.actors) this.actors.set(actor.id, { ...actor, animationTick: 0 });
      if (player) {
        // The hero keeps his identity across a room load: a world event group owns the same record
        // the world moves him with, so re-keying a copy here would drop him out of the world.
        player.x = x;
        player.y = y;
        player.animationTick = 0;
        this.actors.set(-1, player);
      }
    } else if (scene === 0 && room === 0) {
      if (this.isOpening) this.resetBlankActors();
      else {
        // `loadBlankWorldRoom`: a fresh `makeActors()` set; the hero keeps his own record.
        this.actors.clear();
        this.actorModes.clear();
        for (const [id, sprite, state, ax, ay] of BLANK_ROOM_ACTORS)
          this.actors.set(id, {
            id,
            sprite,
            x: ax,
            y: ay,
            state,
            direction: 0,
            variant: 0,
            renderOffsetX: 0,
            renderOffsetY: 0,
            visible: false,
            layer: 1,
            animationTick: 0,
          });
        if (player) this.actors.set(-1, { ...player, x, y });
      }
    }
    const camera = this.cameraOffset(x, y);
    this.cameraX = camera.x;
    this.cameraY = camera.y;
  }
  private cameraOffset(x: number, y: number): { x: number; y: number } {
    const room = this.services.room(this.renderScene, this.renderRoom),
      maxX = Math.max(0, (room?.width ?? 640) - 240),
      maxY = Math.max(0, (room?.height ?? 480) - 320);
    return { x: Math.max(0, Math.min(maxX, x - 120)), y: Math.max(0, Math.min(maxY, y - 160)) };
  }
  private tickActors(): void {
    for (const actor of this.actors.values()) if (actor.visible) actor.animationTick++;
  }
  private tickActorEffects(): void {
    for (let i = this.actorEffects.length - 1; i >= 0; i--) {
      const effect = this.actorEffects[i];
      effect.tick++;
      if (effect.tick >= 120) this.actorEffects.splice(i, 1);
    }
  }
  /** `VqsvSceneView.updateCameraFollow`; scene 98 centres an actor on its foot (x + 10, y + 19). */
  private updateCameraFollow(): void {
    if (this.followActor === null) return;
    const actor = this.actors.get(this.followActor);
    if (!actor) return;
    const foot = this.sceneId === 98 && this.followActor !== -1;
    const camera = this.cameraOffset(actor.x + (foot ? 10 : 0), actor.y + (foot ? 19 : 0));
    this.cameraX = camera.x;
    this.cameraY = camera.y;
  }
  private clearEffect(): void {
    this.effect = "";
    this.effectTick = 0;
  }
  /**
   * `NiemThoC2Runtime.JonesExchange` phases 2–6: the menu (the source egg for money, the V4 eggs,
   * leave), then either the source's own payment records or a notice read before the group goes on.
   */
  private handleEggExchange(
    e: Extract<StoryEvent, { type: "eggExchange" }>,
    elapsed: number,
  ): StoryEventStepResult {
    const eggs = this.services.exchangeEggs?.() ?? [];
    if (elapsed === 1)
      this.choice = {
        options: [
          `Trứng sủng vật - ${e.cost}`,
          ...eggs.map((egg) => `${egg.name} - ${egg.price}`),
          "Rời đi",
        ],
        index: 0,
      };
    if (!this.activeState.confirmed) return "continue";
    const pending = this.activeState.exchangeNext;
    if (pending !== undefined) {
      this.disposeText();
      this.interpreter.jumpTo(pending);
      return "complete";
    }
    const picked = this.choice?.index ?? 0;
    this.choice = null;
    this.activeState.confirmed = false;
    let next = e.leave,
      notice: string | null = null;
    if (picked === 0) {
      if (this.services.canPay?.(e.cost) ?? true) next = e.pay;
      else notice = `Không đủ ${e.cost} tiền để đổi trứng sủng vật.`;
    } else if (picked <= eggs.length) {
      const egg = eggs[picked - 1];
      if (this.services.buyEgg?.(egg.itemId, egg.price)) {
        notice = `Đã mua ${egg.name} x1.`;
        next = e.done;
      } else notice = `Không đủ kim tiền để mua ${egg.name}.`;
    }
    if (notice === null) {
      this.interpreter.jumpTo(next);
      return "complete";
    }
    this.activeState.exchangeNext = next;
    this.startText({
      type: "text",
      text: notice,
      wait: true,
      kind: "openbox",
      box: { x: 47, y: 154, width: 146, height: 26 },
    });
    return "continue";
  }
  private resetBlankActors(): void {
    const actors = [...this.actors.values()];
    this.actors.clear();
    for (const actor of actors)
      this.actors.set(actor.id, { ...actor, visible: false, animationTick: 0 });
    if (!this.actors.has(9))
      this.actors.set(9, {
        id: 9,
        sprite: 327,
        x: 124,
        y: 357,
        state: 2,
        direction: 2,
        variant: 0,
        renderOffsetX: 0,
        renderOffsetY: 0,
        visible: false,
        layer: 1,
        animationTick: 0,
      });
  }
  private actor(id: number): StoryActor {
    let actor = this.actors.get(id);
    if (!actor && (this.isOpening || id === -1)) {
      actor = {
        id,
        x: 0,
        y: 0,
        state: 0,
        direction: 0,
        variant: id === -1 ? 1 : 0,
        renderOffsetX: 0,
        renderOffsetY: 0,
        visible: id === -1,
        sprite: 0,
        layer: 1,
        animationTick: 0,
      };
      this.actors.set(id, actor);
    }
    if (!actor) throw new Error(`Missing story actor ${id}`);
    return actor;
  }
  private clean(value: string): string {
    return value.replace(/#[0-9A-Fa-f]{6}/g, "");
  }
  /** A pager page: its text without the `\n` break marks, and where those marks were. */
  private showPage(page: string): void {
    const parts = this.clean(page).split("\n"),
      breaks: number[] = [];
    let at = 0;
    for (const part of parts.slice(0, -1)) breaks.push((at += part.length));
    this.currentText = parts.join("");
    this.currentBreaks = breaks;
  }
  private skipToTenYears(): void {
    this.loadRoom(1, 0, 199, 218, true);
    this.currentText = "Mười năm sau...";
    this.currentBreaks = [];
    this.visibleChars = this.currentText.length;
    this.textReady = true;
    this.textFull = true;
    this.eventIndex = 224;
    this.tenYearsBoundary = true;
  }
}

export const createStorySceneRuntime = (
  registry: StoryDataRegistry,
  route: SourceRouteOptions,
  services: StorySceneServices,
  skipIntro = false,
) =>
  new StorySceneRuntime(new SourceOpcodeInterpreter(registry).compile(route), services, skipIntro);

/** `VqsvText.Common` money/badge reward and loss lines of op31. */
export function currencyText(mode: number, kind: number, amount: number): string | null {
  if (mode === 0 && kind === 0) return `Đạt được: ${amount} kim tiền`;
  if (mode === 0 && kind === 1) return `Đạt được: ${amount} Huy hiệu`;
  if (mode === 1 && kind === 0) return `Mất: ${amount} kim tiền`;
  if (mode === 1 && kind === 1) return `Mất: ${amount} huy hiệu`;
  return null;
}
