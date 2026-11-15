import { WHARF_BOAT_SPRITE, WHARF_OCEAN_MAP, type WharfTravel } from "../game/world/WharfTravel";
import type { BootAssets } from "../pack/boot";
import { roomBackdropColor, roomBackPic } from "../game/world/RoomBackdrop";
import { gameplayCommands, gameplayShortcuts, type InputCommand } from "../core/input/GameCommand";
import type { InputSnapshot } from "../core/input/InputSnapshot";
import { SWIPE_START, TouchSwipe } from "../core/input/TouchSwipe";
import type { AreaMapView } from "../game/world/AreaMap";
import { KEY } from "../core/input/KeyCode";
import { JavaRandom } from "../core/JavaRandom";
import type { Screen } from "../core/ScreenManager";
import { drawCanvasCopy, fillCanvas, type CanvasRenderer } from "../rendering/CanvasRenderer";
import { battleFrameX, cornerShift, viewport, type Corner } from "../core/Viewport";
import {
  LAND_WORLD_PET,
  landWorldFit,
  landWorldPanel,
  landWorldPet,
  LEFT_KEY,
  LEFT_KEY_SOURCE,
  RIGHT_KEY,
  RIGHT_KEY_SOURCE,
  SOFTKEY_TOP,
  TOP_END,
  type LandWorldFit,
  type LandWorldPanel,
} from "../game/world/WorldLandscape";
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "../core/constants";
import { inLandSpace, LAND_BOTTOM, LAND_CENTER } from "../core/LandCenter";
import { fitCamera } from "../game/world/Camera";
import type { GameAssets, SpriteFrame } from "../game/story/GameAssets";
import type { StorySceneRuntime } from "../game/story/StorySceneRuntime";
import type { StoryActor as IntroActor } from "../game/story/StoryActor";
import type { WorldRuntime } from "../game/world/WorldRuntime";
import {
  drawWorldPanel,
  drawWorldPlates,
  type WorldPanelArt,
} from "../rendering/WorldPanelRenderer";
import { drawAreaMap } from "../rendering/AreaMapRenderer";
import { drawBag } from "../rendering/BagRenderer";
import { BattleUiRenderer } from "../rendering/BattleUiRenderer";
import { drawPetSetting, drawReleaseConfirm } from "../rendering/WorldPetOverlays";
import { drawSourceChoice } from "../rendering/SourceChoiceRenderer";
import { drawSkillScreen } from "../rendering/SkillScreenRenderer";
import { drawQualityUpgrade } from "../rendering/QualityUpgradeRenderer";
import { drawRecordPanel } from "../rendering/RecordRenderer";
import { drawEvolution } from "../rendering/EvolutionRenderer";
import { drawPortableShop } from "../rendering/PortableShopRenderer";
import { drawRidePanel } from "../rendering/RideRenderer";
import {
  drawConvenienceShop,
  drawWharfPanel,
  drawPetBankMenu,
  drawWorldShop,
} from "../rendering/WorldShopRenderer";
import { drawRainbowCharmPanel } from "../rendering/RainbowCharmRenderer";
import { drawCauVongShop } from "../rendering/CauVongShopRenderer";
import { drawCauVongIncubator } from "../rendering/CauVongIncubatorRenderer";
import { drawWardrobe } from "../rendering/WardrobeRenderer";
import { drawFashionShop } from "../rendering/FashionShopRenderer";
import { drawBattlePass, drawChallenge } from "../rendering/MetaSystemsRenderer";
import { drawBondingTower } from "../rendering/BondingTowerRenderer";
import { battleUiState } from "../game/battle/BattleUiState";
import type { GameSave } from "../persistence/SaveRepository";
import type { SaveRepository } from "../persistence/SaveRepository";
import { SaveService } from "../persistence/SaveService";
import { BattleRenderer } from "../rendering/BattleRenderer";
import type { DoubleBattleRuntime } from "../game/battle/DoubleBattleRuntime";
import { doubleBattleFallTicks } from "../game/battle/DoubleEventBattle";
import {
  TAN_NGUYET_ACTOR_ID,
  TAN_NGUYET_NAMEPLATE_LIFT,
  TAN_NGUYET_WORLD_TEXT,
} from "../game/world/TanNguyetBossWorld";
import { MotionInterpolator } from "../rendering/MotionInterpolator";
import {
  CHOICE_BOX,
  ROOM_TITLE,
  SHORTCUT_TOGGLE,
  SHORTCUTS,
  SPEED_CHECKBOX,
  TALK_PROMPT,
} from "../game/world/WorldHud";
import { GameplayHost, gameplaySources, type SessionStart } from "../game/session/GameplayHost";
import { cauVongDrawOrder } from "../game/world/CauVongDrawOrder";
import { CAU_VONG_EXPRESSION_SPRITE } from "../game/world/CauVongCutscene";
import { renderCauVongMinigame } from "../game/world/CauVongMinigameView";

/** Landscape: the plain colour of the bands beside a narrow room or a portrait-box screen. */
const SIDE_BAND_COLOR = "#142d60";

/**
 * The gameplay screen: turns the tick's input into commands for `GameplayHost` and draws what the
 * host holds. All simulation (layer order, story, world, panel, saving) lives in the host; this
 * class only adds presentation state such as the opening's particles and the battle backdrop.
 */
/** `Actor.setSourceObstacleMarker`: sprite 259's generic action marker (`game.h.f`, state 7). */
const OBSTACLE_MARKER_SPRITE = 259,
  OBSTACLE_MARKER_STATE = 7;
/**
 * The speaker tab cell's width, and the widest a long name may stretch it: the "Bỏ qua" plate
 * (68 px, 23 px right of the tab) still ends inside the 240 px screen.
 */
const SPEAKER_TAB_WIDTH = 62,
  SPEAKER_TAB_MAX_WIDTH = 148;

export class NewGameScreen implements Screen {
  readonly host: GameplayHost;
  readonly saveService: SaveService;
  private readonly battleRenderer: BattleRenderer;
  /** The JavaSE pet dashboard and msgWarm box, shared with the fight. */
  private readonly petUi: BattleUiRenderer;
  private readonly actorFrameCache = new Map<string, { frame: SpriteFrame; mirror: boolean }>();
  private readonly particles: { x: number; y: number; speed: number; image: HTMLImageElement }[] =
    [];
  private readonly random = new JavaRandom(7n);
  private particleMode = "";
  /** Parity harness: stop simulating so a checkpoint frame stays on screen. */
  frozen = false;
  private battleBackground: HTMLCanvasElement | null = null;
  /** Landscape: the sheet a source-laid-out world panel is painted on (`drawLandWorldPanel`). */
  private panelSheet: HTMLCanvasElement | null = null;
  /**
   * A simultaneous 2v2 (`VqsvDoubleBattleRuntime`) the screen is playing over the world. While it is
   * set it owns the input and the frame; the world under it stays where the fight opened.
   */
  doubleBattle: DoubleBattleRuntime | null = null;
  private readonly swipe = new TouchSwipe();
  /** Smooths walking and camera pans between the 15 Hz ticks (presentation only). */
  private readonly motion = new MotionInterpolator();
  /** The x2 speed the HUD checkbox shows and toggles; the app wires it to its gameplay clock. */
  speed: { enabled: () => boolean; toggle: () => void } | null = null;
  /** Set by the app for an admin account: opens the Admin Tool over this session. */
  admin: { open: (host: GameplayHost) => void } | null = null;
  /** The three-step JavaSE settings meter, wired to the app's persisted audio mixer. */
  volume: { level: () => number; setLevel: (level: number) => void } | null = null;
  /** Told after every tick what the screen is showing, so the app can pick the music for it. */
  onPresentation: ((screen: NewGameScreen) => void) | null = null;
  /** Receives the menu and fight cues of each tick (the app plays them). */
  onSound: ((cue: string) => void) | null = null;
  constructor(
    skipIntro: boolean,
    readonly assets: GameAssets,
    private readonly boot: BootAssets,
    saves: SaveRepository,
    back: () => void,
    resumeSave?: GameSave,
  ) {
    const start: SessionStart = resumeSave
      ? { kind: "resume", save: resumeSave }
      : skipIntro
        ? { kind: "skipIntro" }
        : { kind: "opening" };
    this.saveService = new SaveService(saves);
    this.host = new GameplayHost(
      gameplaySources(assets, boot),
      this.saveService,
      {
        onExit: back,
        onOpeningTick: () => this.tickParticles(),
        speedX2: {
          enabled: () => this.speed?.enabled() ?? false,
          toggle: () => this.speed?.toggle(),
        },
        volume: {
          level: () => this.volume?.level() ?? 0,
          setLevel: (level) => this.volume?.setLevel(level),
        },
        admin: {
          enabled: () => this.admin !== null,
          open: () => this.admin?.open(this.host),
        },
      },
      start,
    );
    this.battleRenderer = new BattleRenderer(assets, boot);
    this.petUi = new BattleUiRenderer(assets, boot);
  }
  /** The scene on screen when no world is: a director cutscene, else the opening. */
  private get runtime(): StorySceneRuntime {
    return this.host.cutscene ?? this.host.runtime;
  }
  private get prelude(): StorySceneRuntime | null {
    return this.host.prelude;
  }
  private get world(): WorldRuntime | null {
    return this.host.world;
  }
  get particleCount(): number {
    return this.particles.length;
  }
  /**
   * One simulation tick (`GameplayState.tick`): the pointer press, if any, is applied first and may
   * add commands for this same tick; then the keyboard-derived commands run.
   */
  tick(input: InputSnapshot, sameFrame = false): void {
    if (this.frozen) return;
    const pointer = input.pointer;
    // A press on a scrollbar is the bar's; any other press is a click. A finger on a list waits:
    // dragged, it scrolls (TouchSwipe); lifted in place, it is the click.
    const fromPointer: InputCommand[] = [];
    const areaMap =
      this.host.panel.visible && this.host.panel.mode === "areaMap"
        ? this.host.panel.areaMap
        : null;
    if (areaMap || this.mapDrag) this.dragAreaMap(input, areaMap, fromPointer);
    else {
      if (pointer.pressed && !this.host.pointerPress(pointer.pressX, pointer.pressY)) {
        if (pointer.touch && this.host.swipeScrollable)
          this.swipe.press(pointer.pressX, pointer.pressY);
        else fromPointer.push(...this.host.pointer(pointer.pressX, pointer.pressY));
      }
      if (pointer.moved && pointer.x >= 0) {
        if (this.swipe.active) {
          const result = this.swipe.move(pointer.y);
          if (result.kind === "wheel") this.host.wheel(result.steps);
        }
        // Moving the mouse drags a held thumb, or moves the cursor onto the row under it (PC QoL).
        else this.host.pointerMove(pointer.x, pointer.y);
      }
      if (pointer.released) {
        const tap = this.swipe.release();
        if (tap) fromPointer.push(...this.host.pointer(tap.x, tap.y));
        this.host.pointerRelease();
      }
    }
    if (input.wheelRotation !== 0) this.host.wheel(input.wheelRotation);
    // JavaSE's settings/help screens still own the two phone softkeys. GameplayCommand intentionally
    // has no generic softkey commands, so route F1/F2 only while these panels are active.
    if (this.host.panel.mode === "settings" && input.wasPressed(KEY.F1))
      this.host.panel.systemSource.toggleSpeedX2();
    const panelSoftkeys: InputCommand[] =
      (this.host.panel.mode === "help" || this.host.panel.mode === "settings") &&
      input.wasPressed(KEY.F2)
        ? ["back"]
        : [];
    // Key 1 lists the main task, key 9 asks for the ride (GameplayState's shortcuts). The loading
    // screen samples no input, so neither of them opens behind it.
    const shortcuts = gameplayShortcuts(input),
      world = this.host.story.worldActive && !this.host.mapLoadingActive ? this.world : null;
    if (world && shortcuts.task) this.host.openTask(world);
    if (world && shortcuts.ride) this.host.pressRide(world);
    if (input.typedText) this.host.panel.typeText(input.typedText);
    this.step(
      [
        ...gameplayCommands(input, { textEntryActive: this.textEntryActive() }),
        ...panelSoftkeys,
        ...fromPointer,
      ],
      sameFrame,
    );
  }

  /** A finger (or held mouse) on the open area map: where it went down and how far it has panned. */
  private mapDrag: { startX: number; startY: number; x: number; y: number; moved: boolean } | null =
    null;
  /**
   * Web only: the area map pans under a dragged finger or mouse, as the held arrows do. A press
   * that never moves is the source's click on release (the legend band closes the map).
   */
  private dragAreaMap(
    input: InputSnapshot,
    view: AreaMapView | null,
    fromPointer: InputCommand[],
  ): void {
    const pointer = input.pointer;
    if (pointer.pressed && view)
      this.mapDrag = {
        startX: pointer.pressX,
        startY: pointer.pressY,
        x: pointer.pressX,
        y: pointer.pressY,
        moved: false,
      };
    const drag = this.mapDrag;
    if (!drag) return;
    if (pointer.moved && pointer.x >= 0 && view) {
      // The pointer comes in UI-box px; the map is drawn in canvas px (landscape: box × scale).
      const scale = viewport.landscape ? viewport.ui.scale : 1;
      if (
        !drag.moved &&
        Math.hypot(pointer.x - drag.startX, pointer.y - drag.startY) * scale >= SWIPE_START
      )
        drag.moved = true;
      if (drag.moved) {
        const dx = Math.trunc((pointer.x - drag.x) * scale),
          dy = Math.trunc((pointer.y - drag.y) * scale);
        if (dx !== 0 || dy !== 0) {
          view.drag(dx, dy);
          drag.x += dx / scale;
          drag.y += dy / scale;
        }
      }
    }
    if (pointer.released) {
      if (!drag.moved && view) fromPointer.push(...this.host.pointer(drag.startX, drag.startY));
      this.mapDrag = null;
      this.host.pointerRelease();
    }
  }
  /** The page is being hidden: a 2v2 fight is mid-way, so only the world may save. */
  suspend(): void {
    if (!this.frozen && !this.doubleBattle) this.host.saveBeforeSuspend();
  }

  /** `GameFacade.textEntryActive()`: only the gift-code box takes typed text. */
  textEntryActive(): boolean {
    return this.host.panel.visible && this.host.panel.mode === "giftCode";
  }

  /** Advance one tick with already-derived commands (also used by scripted traces). */
  step(commands: InputCommand[], sameFrame = false): void {
    if (this.frozen) return;
    if (this.doubleBattle) {
      this.doubleBattle.handleInput(commands);
      this.doubleBattle.tick();
      return;
    }
    const before = this.motionTarget();
    // ProMax: both x2 ticks share one render interval, so keep the start of the first step.
    if (!sameFrame)
      this.motion.capture(before?.actors ?? null, before?.camera ?? null, before?.actors.values());
    const menu = this.menuOwnsInput();
    this.host.step(commands);
    this.emitSounds(commands, menu);
    const after = this.motionTarget();
    this.motion.settle(after?.actors ?? null, after?.camera ?? null, after?.actors.values());
    this.onPresentation?.(this);
  }

  /** A menu (panel, card, save prompt, the fight's lists) takes the arrows, not the hero. */
  private menuOwnsInput(): boolean {
    const world = this.host.story.worldActive ? this.world : null;
    if (!world) return false;
    if (this.host.panel.visible || world.savePromptVisible) return true;
    if (world.battleVisible && world.doubleBattle) return true;
    return world.battleVisible && !!world.battle && !world.battle.complete;
  }
  /** The tick's cues: menu navigation, then whatever the fight asked for. */
  private emitSounds(commands: readonly InputCommand[], menu: boolean): void {
    const sink = this.onSound;
    const battle = this.host.story.worldActive ? this.world?.battle : null;
    if (!sink) {
      if (battle) battle.cues.length = 0;
      return;
    }
    if (menu) {
      if (commands.includes("back")) sink("back");
      else if (commands.includes("confirm")) sink("confirm");
      else if (["up", "down", "left", "right"].some((c) => commands.includes(c as InputCommand)))
        sink("cursor");
    }
    if (battle) for (const cue of battle.cues.splice(0)) sink(cue);
  }

  /** The actor set and camera the screen is drawing now (what the interpolator tracks). */
  private motionTarget(): {
    actors: Map<number, IntroActor>;
    camera: { x: number; y: number };
  } | null {
    const world = this.host.story.worldActive ? this.world : null;
    if (world) return { actors: world.actors, camera: { x: world.cameraX, y: world.cameraY } };
    const scene = this.prelude ?? this.runtime;
    return scene.actors
      ? { actors: scene.actors, camera: { x: scene.cameraX, y: scene.cameraY } }
      : null;
  }

  /**
   * What the music follows (`game.l`'s `W.a(track)` calls): the room on screen, the event group that
   * is running there, and whether a fight is up (and which group it belongs to).
   */
  musicContext(): {
    scene: number;
    room: number;
    battle: boolean;
    group: { scene: number; room: number; group: number } | null;
  } {
    const world = this.host.story.worldActive ? this.world : null;
    if (world) {
      const battle = world.battleEntryVisible || world.battleVisible;
      return {
        scene: world.sceneId,
        room: world.roomIndex,
        battle,
        group: battle ? world.battleGroup : world.activeEventGroup,
      };
    }
    const scene = this.prelude ?? (this.host.story.scene as StorySceneRuntime);
    return {
      scene: scene.renderScene,
      room: scene.renderRoom,
      battle: !!scene.battle,
      group: null,
    };
  }

  /** Whether a frame between two ticks would differ (something is walking or the camera pans). */
  animating(): boolean {
    return !this.frozen && this.motion.moving;
  }
  /**
   * `GameFacade:51`: the room-swap screen runs at normal speed whatever the x2 checkbox says, so its
   * 16 ticks stay 16 ticks.
   */
  speedX2Suppressed(): boolean {
    return this.host.mapLoadingActive;
  }
  private get worldPanelArt(): WorldPanelArt {
    return {
      cell: (index) => this.boot.cell(257, index),
      cellFor: (sprite, index) => this.boot.cell(sprite, index),
      font: this.boot.panelFont,
    };
  }
  /**
   * `docs/kim-diem-long-vuong-20261018.md`: scene98/room49 (Kim Diễm Long Vương) is presented at
   * 720x960 so his frames show their HD atlas; simulation and input stay 240x320.
   */
  presentationScale(): number {
    const world = this.world;
    return world && world.sceneId === 98 && world.roomIndex === 49
      ? (this.assets.cauVongHd?.scale ?? 1)
      : 1;
  }
  render(r: CanvasRenderer, alpha = 1): void {
    this.motion.alpha = this.frozen ? 1 : alpha;
    // `VqsvSceneView.render`: the loading screen replaces the frame, the world is not drawn under it.
    if (this.host.mapLoadingActive) {
      r.uiSpace();
      this.drawMapLoading(r.context);
      return;
    }
    if (this.doubleBattle) {
      const world = this.world;
      if (world) this.drawWorldBattleBackground(r, world);
      else r.clear();
      this.battleRenderer.renderDouble(r.context, this.doubleBattle, (g) => {
        if (world) this.drawWorldBattleBackground(r, world);
        else {
          g.fillStyle = "#000";
          fillCanvas(g);
        }
      });
      return;
    }
    const travel = this.host.wharfTravel;
    if (travel && this.world && travel.phase < 4) {
      this.renderWharfTravel(r, travel, this.world);
      return;
    }
    if (this.host.story.worldActive && this.world) {
      this.renderWorldSession(r);
      // `startBars(12, …)` opens over the room the boat landed in.
      if (travel) this.drawWharfBars(r, travel);
      return;
    }
    if (this.prelude) {
      this.renderPrelude(r);
      return;
    }
    const g = r.context;
    r.clear();
    this.drawWorld(
      r,
      this.runtime.renderScene,
      this.runtime.renderRoom,
      this.runtime.cameraX,
      this.runtime.cameraY,
      this.runtime.actors,
    );
    r.uiSpace();
    this.drawParticles(g);
    this.drawEffect(g);
    if (this.runtime.currentText) this.text(r);
  }
  /** `VqsvMapLoadingRuntime.render`: black, the source progress bar, and one elemental tip. */
  private drawMapLoading(g: CanvasRenderingContext2D): void {
    const loading = this.world?.mapLoading;
    if (!loading) return;
    // Landscape: black over the whole canvas, the bar against the 320x240 screen's bottom edge.
    if (viewport.landscape) {
      g.fillStyle = "#000000";
      fillCanvas(g);
    }
    inLandSpace(g, LAND_BOTTOM, () => loading.render(g, this.boot.panelFont));
  }
  private drawWorld(
    r: CanvasRenderer,
    scene: number,
    roomIndex: number,
    cameraX: number,
    cameraY: number,
    actors: Map<number, IntroActor>,
    shake: { x: number; y: number } = { x: 0, y: 0 },
    /** The free world's own room (see `roomAsset`), not the cutscene's staging of it. */
    worldRoom = false,
  ): void {
    const g = r.context;
    r.clear();
    // `rainbowPresentation.shakeOffset`: Cầu Vồng's source shake moves the world by 0 or 1 px.
    const cauVongView = scene === 98 ? this.world?.cauVongPresentation : undefined;
    // The world fills the whole canvas (landscape); the caller goes back to `uiSpace` for the UI.
    r.worldSpace();
    const room = this.roomAsset(scene, roomIndex, worldRoom),
      layers = room ? this.assets.maps.get(room.mapId) : undefined,
      view = this.viewCamera(scene, roomIndex, actors, cameraX, cameraY, worldRoom),
      // The shakes move the fitted view, so a centred room still trembles.
      jolt = cauVongView?.shakeOffset ?? 0,
      camera = { x: view.x - shake.x - jolt, y: view.y - shake.y - jolt },
      // An APK map's picture starts at the room's origin (game x = -originX).
      mapCamera = { x: camera.x + (room?.originX ?? 0), y: camera.y + (room?.originY ?? 0) };
    if (!layers) {
      g.fillStyle = "#081050";
      fillCanvas(g);
      this.drawActorSet(g, actors, 1, camera);
      return;
    }
    this.drawRoomBackdrop(g, scene, roomIndex);
    for (const i of [1, 2]) if (layers[i]) this.drawMapLayer(g, layers[i], mapCamera);
    this.drawMapGutters(g, [layers[1], layers[2]], mapCamera);
    // Landscape shows the bands beside a narrow room; the source's screen ended at the room's edge,
    // so scripts park actors just outside it. Nothing of the room's cast is drawn past the map.
    g.save();
    this.clipToMap(g, [layers[1], layers[2]], mapCamera);
    // Cầu Vồng rooms keep JavaSE's source-row order (`cauVongDrawOrder`).
    const cauVong = scene === 98;
    this.drawActorSet(g, actors, 2, camera, undefined, true, cauVong);
    // `PLAYER_SHADOW` under the free-world hero, before the actors that may stand in front of it.
    if (actors === this.world?.actors) this.drawPlayerShadow(g, actors, camera);
    this.drawActorSet(g, actors, 1, camera, undefined, true, cauVong);
    if (layers[3]) this.drawMapLayer(g, layers[3], mapCamera);
    this.drawActorSet(g, actors, 0, camera, undefined, true, cauVong);
    if (cauVongView && this.world) this.drawCauVongOverlay(g, this.world, actors, camera);
    g.restore();
    if (cauVongView) this.drawCauVongCurtain(g, cauVongView);
  }
  /** The camera a room is drawn with this frame: interpolated, then fitted to the canvas. */
  private viewCamera(
    scene: number,
    roomIndex: number,
    actors: Map<number, IntroActor>,
    x: number,
    y: number,
    worldRoom = false,
  ): { x: number; y: number } {
    return fitCamera(
      this.roomAsset(scene, roomIndex, worldRoom),
      this.motion.camera(actors, { x, y }),
    );
  }
  /**
   * The room a frame is drawn on. A cutscene stages `getRoom`, where the opening's 5:1 is the
   * cinematic `introRoom1`; the free world, its source events and its battles stand in the world's
   * own room (`getWorldRoom`, which the collision uses too), so Cửa Hắc Thạch Thành is drawn as itself.
   */
  private roomAsset(scene: number, roomIndex: number, worldRoom: boolean) {
    return worldRoom
      ? this.assets.getWorldRoom(scene, roomIndex)
      : this.assets.getRoom(scene, roomIndex);
  }
  /** Landscape only: clips to the part of the canvas the map picture covers. */
  private clipToMap(
    g: CanvasRenderingContext2D,
    layers: readonly (HTMLImageElement | undefined)[],
    camera: { x: number; y: number },
  ): void {
    const base = layers.find((layer) => layer?.complete && layer.naturalWidth > 0);
    if (!viewport.landscape || !base) return;
    g.beginPath();
    g.rect(-camera.x, -camera.y, base.naturalWidth, base.naturalHeight);
    g.clip();
  }
  /**
   * `VqsvSceneView` in scene 98 after the actor layers: op49's effects, each actor's expression
   * (`renderRainbowExpression`, 4 px right of and 44 px above the foot), then
   * `rainbowPresentation.render` (the white flash and the curtain bars).
   */
  private drawCauVongOverlay(
    g: CanvasRenderingContext2D,
    world: WorldRuntime,
    actors: Map<number, IntroActor>,
    camera: { x: number; y: number },
  ): void {
    // `CauVongBranchTreasures.render`: each shown chest on the floor, shut (ui 54) or open (55),
    // centred on its foot and standing on it, inside the source viewport's margin.
    const regions = this.assets.cauVongUiRegions;
    if (regions)
      for (const chest of world.cauVongTreasures) {
        const x = chest.x - camera.x,
          y = chest.y - camera.y;
        if (x < -30 || x > viewport.width + 30 || y < -30 || y > viewport.height + 30) continue;
        const [sx, sy, w, h] = regions[chest.open ? 55 : 54];
        g.drawImage(this.assets.cauVongUi(), sx, sy, w, h, x - Math.floor(w / 2), y - h, w, h);
      }
    for (const effect of world.cauVongEffects)
      this.drawSprite(
        g,
        effect.sprite,
        effect.state,
        effect.tick,
        effect.x - camera.x,
        effect.y - camera.y,
      );
    for (const [id, expression] of world.cauVongExpressions) {
      const actor = actors.get(id);
      if (!actor?.visible) continue;
      this.drawSprite(
        g,
        CAU_VONG_EXPRESSION_SPRITE,
        expression.state,
        expression.tick,
        actor.x + actor.renderOffsetX + 4 - camera.x,
        actor.y + actor.renderOffsetY - 44 - camera.y,
      );
    }
  }
  /**
   * `rainbowPresentation.render`: the white flash and the curtain bars, over the whole canvas (the
   * bars close from its top and bottom edges whatever its shape).
   */
  private drawCauVongCurtain(
    g: CanvasRenderingContext2D,
    view: NonNullable<WorldRuntime["cauVongPresentation"]>,
  ): void {
    if (view.flashing) {
      g.fillStyle = "#ffffff";
      fillCanvas(g);
    }
    const height = view.curtainHeight;
    if (height > 0) {
      g.fillStyle = "#000000";
      g.fillRect(0, 0, viewport.width, height);
      g.fillRect(0, viewport.height - height, viewport.width, height);
    }
  }
  /** `VqsvSceneView.renderWorld`: the room's fill colour, then its back-pic strip tiled across. */
  private drawRoomBackdrop(g: CanvasRenderingContext2D, scene: number, room: number): void {
    g.fillStyle = roomBackdropColor(scene, room);
    fillCanvas(g);
    const name = roomBackPic(scene, room),
      strip = name ? this.boot.backPics.get(name) : undefined;
    if (!strip?.complete || strip.naturalWidth <= 0) return;
    // `renderSourceBackPic`: 240 / width copies from the left edge, screen-fixed.
    const copies = Math.ceil(viewport.width / strip.naturalWidth);
    for (let i = 0; i < copies; i++) g.drawImage(strip, i * strip.naturalWidth, 0);
  }
  /**
   * Landscape: a room narrower than the canvas is centred, with a band either side the map does not
   * reach. Both bands are one plain dark blue (`SIDE_BAND_COLOR`), the same in every room.
   */
  private drawMapGutters(
    g: CanvasRenderingContext2D,
    layers: readonly (HTMLImageElement | undefined)[],
    camera: { x: number; y: number },
  ): void {
    const base = layers.find((layer) => layer?.complete && layer.naturalWidth > 0);
    if (!viewport.landscape || !base) return;
    const left = Math.max(0, -camera.x),
      rightEdge = base.naturalWidth - camera.x,
      right = Math.max(0, viewport.width - rightEdge);
    if (left <= 0 && right <= 0) return;
    g.fillStyle = SIDE_BAND_COLOR;
    if (left > 0) g.fillRect(0, 0, left, viewport.height);
    if (right > 0) g.fillRect(rightEdge, 0, right, viewport.height);
  }
  /**
   * One map layer, cut to the 240x320 viewport. A whole-map `drawImage` with a negative offset asks
   * the browser to clip a large image every frame; the source rect copies only what shows.
   */
  private drawMapLayer(
    g: CanvasRenderingContext2D,
    layer: HTMLImageElement,
    camera: { x: number; y: number },
  ): void {
    if (!layer.complete || layer.naturalWidth === 0) return;
    const sx = Math.max(0, camera.x),
      sy = Math.max(0, camera.y),
      w = Math.min(viewport.width - (sx - camera.x), layer.naturalWidth - sx),
      h = Math.min(viewport.height - (sy - camera.y), layer.naturalHeight - sy);
    if (w <= 0 || h <= 0) return;
    g.drawImage(layer, sx, sy, w, h, sx - camera.x, sy - camera.y, w, h);
  }
  /**
   * `VqsvSceneView`'s `PLAYER_SHADOW` (sprite 337) under the hero. That sprite is not in the pack
   * bake, so the web draws the same soft oval in code.
   */
  private drawPlayerShadow(
    g: CanvasRenderingContext2D,
    actors: Map<number, IntroActor>,
    camera: { x: number; y: number },
  ): void {
    const player = actors.get(-1);
    if (!player?.visible) return;
    const at = this.motion.actor(actors, -1, player);
    g.save();
    g.fillStyle = "rgba(0, 0, 0, 0.28)";
    g.beginPath();
    g.ellipse(at.x - camera.x, at.y - camera.y - 1, 9, 3.5, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  private drawActorSet(
    g: CanvasRenderingContext2D,
    actors: Map<number, IntroActor>,
    layer: number,
    camera: { x: number; y: number },
    include: (actor: IntroActor) => boolean = () => true,
    sortY = true,
    cauVong = false,
  ): void {
    let visible: IntroActor[] = [];
    for (const a of actors.values())
      if (a.visible && a.layer === layer && include(a)) visible.push(a);
    if (cauVong) visible = cauVongDrawOrder(visible, layer);
    else if (sortY) visible.sort((a, b) => a.y - b.y || a.id - b.id);
    for (const actor of visible) {
      // `renderActorAndPlayerLayer`: the custom boss gets its shadow under and nameplate over it,
      // in the world's map or in the event group's that it is lent to.
      const boss = actor.id === TAN_NGUYET_ACTOR_ID;
      if (boss) this.drawTanNguyetShadow(g, actor, camera);
      this.drawActorFrame(g, actors, actor, camera);
      if (boss) this.drawTanNguyetNameplate(g, actor, camera);
      // `renderSourceActor`: an emitter's beam is drawn right after it (`VqsvSourceLaserRuntime.render`).
      if (actors === this.world?.actors) this.drawLaserBeam(g, actor.id, camera);
    }
  }
  /**
   * `TanNguyetLongMaWorldDecorationRenderer.renderShadow`: two black ovals under the boss's foot,
   * 80×20 at 34% and 56×14 at 24%.
   */
  private drawTanNguyetShadow(
    g: CanvasRenderingContext2D,
    boss: IntroActor,
    camera: { x: number; y: number },
  ): void {
    const x = boss.x - camera.x,
      y = boss.y - camera.y;
    g.save();
    g.fillStyle = "#000";
    for (const [alpha, rx, ry] of [
      [0.34, 40, 10],
      [0.24, 28, 7],
    ] as const) {
      g.globalAlpha = alpha;
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  /** `renderNameplate`: the 120×50 plate centred on the boss, 158 px above its foot. */
  private drawTanNguyetNameplate(
    g: CanvasRenderingContext2D,
    boss: IntroActor,
    camera: { x: number; y: number },
  ): void {
    const plate = this.assets.pack.imageElement("custom-boss.tan-nguyet-nameplate");
    // Java holds the defeat card from class load: start its fetch while the boss is in view, so a
    // lost fight's first frame already has it.
    this.assets.pack.imageElement("custom-boss.tan-nguyet-defeat");
    if (!plate.complete || plate.naturalWidth === 0) return;
    g.drawImage(
      plate,
      boss.x - camera.x - Math.trunc(plate.naturalWidth / 2),
      boss.y - camera.y - TAN_NGUYET_NAMEPLATE_LIFT,
    );
  }
  /**
   * `TanNguyetLongMaDefeatCutscene.renderExclusive`: black, then the card stretched over the whole
   * 240×320 frame with bicubic filtering.
   */
  private drawTanNguyetDefeatCard(g: CanvasRenderingContext2D): void {
    g.fillStyle = "#000";
    fillCanvas(g);
    const card = this.assets.pack.imageElement("custom-boss.tan-nguyet-defeat");
    if (!card.complete || card.naturalWidth === 0) return;
    g.save();
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(card, 0, 0, 240, 320);
    g.restore();
  }
  /**
   * `VqsvDarkRoomPresentation.render`: four opaque black rectangles leave only the 2r × 2r window
   * around the light (centre given in world coordinates) unpainted.
   */
  private drawDarkRoom(
    g: CanvasRenderingContext2D,
    view: { x: number; y: number; radius: number } | null,
    camera: { x: number; y: number },
  ): void {
    if (!view) return;
    const cx = view.x - camera.x,
      cy = view.y - camera.y,
      r = view.radius;
    g.fillStyle = "#000000";
    // Java's fillRect paints nothing for a negative size; the canvas would flip it instead.
    const fill = (x: number, y: number, w: number, h: number) => {
      if (w > 0 && h > 0) g.fillRect(x, y, w, h);
    };
    const width = viewport.width,
      height = viewport.height;
    fill(0, 0, width, cy - r);
    fill(0, cy - r, cx - r, r * 2);
    fill(0, cy + r, width, height - (cy + r));
    fill(cx + r, cy - r, width - (cx + r), r * 2);
  }
  /** `VqsvSourceLaserRuntime.fillBeam`: a green (0x00ff00) band with a white core. */
  private drawLaserBeam(
    g: CanvasRenderingContext2D,
    actorId: number,
    camera: { x: number; y: number },
  ): void {
    const beam = this.world?.laserBeamFor(actorId);
    if (!beam || beam.length <= 0) return;
    const x = beam.x - camera.x,
      y = beam.y - camera.y;
    for (const [color, thickness] of [
      ["#00ff00", beam.outer],
      ["#ffffff", beam.inner],
    ] as const) {
      g.fillStyle = color;
      const half = Math.trunc(thickness / 2);
      if (beam.vertical) g.fillRect(x - half, y, thickness, beam.length);
      else g.fillRect(x, y - half, beam.length, thickness);
    }
  }
  private drawActorFrame(
    g: CanvasRenderingContext2D,
    actors: Map<number, IntroActor>,
    actor: IntroActor,
    camera: { x: number; y: number },
  ): void {
    const at = this.motion.actor(actors, actor.id, actor);
    // A blank frame is part of the animation (blinking): draw nothing, not the last cached frame.
    if (this.assets.blankAt(actor.sprite, actor.state, actor.animationTick)) return;
    const orientation =
        actor.renderOrientation !== undefined && actor.renderOrientation >= 0
          ? actor.renderOrientation
          : actor.direction,
      mirror = orientation === 3,
      // `anim.setPaletteNature(paletteNature)`: the pet companion in its shiny palette.
      sprite = this.assets.shinySprite(actor.sprite, actor.paletteNature, actor.paletteColor),
      key = `${actor.id}:${sprite}`,
      next = this.assets.frame(sprite, actor.state, actor.animationTick),
      nextImage = next ? this.assets.imageFor(next, mirror) : undefined;
    let frame = next,
      drawMirror = mirror;
    if (next && nextImage?.complete && nextImage.naturalWidth > 0)
      this.actorFrameCache.set(key, { frame: next, mirror });
    else {
      const cached = this.actorFrameCache.get(key);
      if (cached) {
        frame = cached.frame;
        drawMirror = cached.mirror;
      }
    }
    if (!frame) return;
    const image = this.assets.imageFor(frame, drawMirror);
    if (image.complete && image.naturalWidth > 0)
      g.drawImage(
        this.assets.shinyImage(image, actor.paletteNature, sprite, actor.paletteColor),
        Math.floor(at.x + actor.renderOffsetX - camera.x + (drawMirror ? frame.mox : frame.ox)),
        Math.floor(at.y + actor.renderOffsetY - camera.y + (drawMirror ? frame.moy : frame.oy)),
      );
  }
  /** `CauVongMinigameView.render` over `RainbowMinigameArt` and the baked banks. */
  private drawCauVongMinigame(
    g: CanvasRenderingContext2D,
    view: NonNullable<WorldRuntime["cauVongMinigameView"]>,
  ): void {
    const assets = this.assets,
      part = (
        bank: number,
        kind: "cells" | "regions",
        index: number,
        x: number,
        y: number,
        mirrored: boolean,
      ) => {
        const p = assets.cauVongBanks?.[String(bank)]?.[kind][index];
        if (!p) return;
        const image = assets.cauVongBankImage(mirrored ? p.mirrorFile : p.file);
        if (image.complete)
          g.drawImage(image, x + (mirrored ? p.mox : p.ox), y + (mirrored ? p.moy : p.oy));
      };
    renderCauVongMinigame(g, view.m, view.tables, {
      font: this.boot.panelFont,
      image: (name) => assets.cauVongArt(name),
      icon: (ctx, item, id, x, y, centered) => {
        const table = item ? assets.cauVongItemRegions : assets.cauVongUiRegions;
        const key = item ? (assets.cauVongItemAlias?.[String(id)] ?? id) : id,
          r = table?.[key];
        if (!r) return;
        const atlas = assets.cauVongArt(item ? "item" : "ui");
        if (!atlas.complete) return;
        const [sx, sy, w, h] = r,
          dx = centered ? x - Math.trunc(w / 2) : x,
          dy = centered ? y - Math.trunc(h / 2) : y;
        ctx.drawImage(atlas, sx, sy, w, h, dx, dy, w, h);
      },
      bankCell: (_ctx, bank, cell, x, y) => part(bank, "cells", cell, x, y, false),
      bankRegion: (_ctx, bank, region, x, y, mirrored) =>
        part(bank, "regions", region, x, y, mirrored),
      sprite: (ctx, sprite, state, tick, x, y) => this.drawSprite(ctx, sprite, state, tick, x, y),
      held: (ctx, sprite, state, elapsed, x, y) => {
        const frame = assets.heldFrame(sprite, state, elapsed);
        if (!frame) return;
        const image = assets.imageFor(frame);
        if (image.complete)
          ctx.drawImage(image, Math.floor(x + frame.ox), Math.floor(y + frame.oy));
      },
      money: view.money,
      streakPaid: view.streakPaid,
    });
  }
  private drawSprite(
    g: CanvasRenderingContext2D,
    sprite: number,
    state: number,
    tick: number,
    x: number,
    y: number,
    mirror = false,
  ): void {
    const frame = this.assets.frame(sprite, state, tick);
    if (!frame) return;
    const image = this.assets.imageFor(frame, mirror);
    if (image.complete)
      g.drawImage(
        image,
        Math.floor(x + (mirror ? frame.mox : frame.ox)),
        Math.floor(y + (mirror ? frame.moy : frame.oy)),
      );
  }
  private tickParticles(): void {
    const particleEffect = this.runtime.particleEffect,
      star = particleEffect.startsWith("star-particles"),
      fire = particleEffect.startsWith("fire-particles");
    if (!star && !fire) {
      this.particles.length = 0;
      this.particleMode = "";
      return;
    }
    const mode = star ? "star" : "fire",
      count = Math.min(180, Number(particleEffect.split("-").at(-1)) || 0);
    if (this.particleMode !== mode) {
      this.particles.length = 0;
      this.particleMode = mode;
    }
    while (this.particles.length < count) this.particles.push(this.newParticle(mode));
    for (const p of this.particles) {
      p.x -= p.speed;
      p.y -= p.speed;
      if (p.x < -p.image.width || p.y < -p.image.height) {
        const next = this.newParticle(mode);
        p.image = next.image;
        p.speed = next.speed;
        p.x = 240 + this.random.nextInt(80);
        p.y = this.random.nextInt(320);
      }
    }
  }
  private newParticle(mode: string): {
    x: number;
    y: number;
    speed: number;
    image: HTMLImageElement;
  } {
    const roll = this.random.nextInt(100),
      index =
        mode === "fire"
          ? roll < 20
            ? 2
            : roll < 55
              ? 1
              : 0
          : roll < 3
            ? 3
            : roll < 15
              ? 2
              : roll < 50
                ? 1
                : 0,
      image = this.boot.effect(`${mode}-${index}`)!,
      speedMin = [1, 1, 2, 2][index],
      speedMax = [3, 4, 5, 6][index];
    return {
      x: this.random.nextInt(240),
      y: this.random.nextInt(320),
      speed: this.random.nextInt(speedMax - speedMin) + speedMin,
      image,
    };
  }
  private drawParticles(g: CanvasRenderingContext2D): void {
    for (const p of this.particles) if (p.image.complete) g.drawImage(p.image, p.x, p.y);
  }
  private drawEffect(g: CanvasRenderingContext2D): void {
    const effect = this.runtime.effect,
      t = this.runtime.effectTick;
    if (effect === "solid-black") {
      g.fillStyle = "#000";
      fillCanvas(g);
    } else if (effect === "fade-out") {
      g.fillStyle = `rgba(0,0,0,${Math.min(255, t * 17) / 255})`;
      fillCanvas(g);
    } else if (effect === "fade-in") {
      g.fillStyle = `rgba(0,0,0,${Math.max(0, 255 - t * 17) / 255})`;
      fillCanvas(g);
    } else if (effect === "flash" && t <= 1) {
      g.fillStyle = t % 3 === 0 ? "#fff" : "#000";
      fillCanvas(g);
    } else if (effect.startsWith("circle")) {
      const open = effect === "circle-open",
        radius = open ? 25 + t * 10 : Math.max(0, 160 - t * 10);
      g.fillStyle = open ? "#fff" : "#8b17c4";
      g.beginPath();
      g.arc(120, 160, radius, 0, Math.PI * 2);
      g.fill();
    } else if (effect === "bars-13" || effect === "bars-12") {
      const progress = Math.min(1, t / 2);
      g.fillStyle = "#000";
      const top = effect === "bars-13" ? 10 * progress : 10 * (1 - progress),
        bottom = effect === "bars-13" ? 50 * progress : 50 * (1 - progress);
      g.fillRect(0, 0, 240, top);
      g.fillRect(0, 320 - bottom, 240, bottom);
    }
  }
  private renderPrelude(r: CanvasRenderer, prelude = this.prelude!): void {
    const g = r.context;
    if (prelude.battle) {
      if (!this.battleBackground) {
        this.drawBattleBackgroundWorld(r, prelude);
        // The capture keeps the surface's own resolution (720x960 in Long Vương's room).
        this.battleBackground = document.createElement("canvas");
        this.battleBackground.width = g.canvas.width;
        this.battleBackground.height = g.canvas.height;
        this.battleBackground.getContext("2d")!.drawImage(g.canvas, 0, 0);
      } else {
        drawCanvasCopy(g, this.battleBackground);
      }
      r.uiSpace();
      this.battleRenderer.render(g, prelude.battle, this.motion.alpha);
      return;
    }
    this.battleBackground = null;
    this.drawWorld(
      r,
      prelude.renderScene,
      prelude.renderRoom,
      prelude.cameraX,
      prelude.cameraY,
      prelude.actors,
    );
    const preludeCamera = this.viewCamera(
      prelude.renderScene,
      prelude.renderRoom,
      prelude.actors,
      prelude.cameraX,
      prelude.cameraY,
    );
    for (const effect of prelude.actorEffects) {
      const actor = prelude.actors.get(effect.actor);
      if (actor?.visible)
        this.drawSprite(
          g,
          259,
          effect.state,
          effect.tick,
          actor.x - preludeCamera.x,
          actor.y - preludeCamera.y - 40,
          false,
        );
    }
    r.uiSpace();
    this.drawPreludeEffect(g, prelude);
    if (prelude.currentText) this.drawPreludeText(g, prelude);
  }
  private renderWorldSession(r: CanvasRenderer): void {
    const world = this.world!,
      g = r.context,
      eventScene = world.eventScene;
    // `VqsvSceneView.render`: `CauVongSummoningMinigame.render` draws the open board instead.
    const minigame = world.cauVongMinigameView;
    if (minigame) {
      this.battleBackground = null;
      r.clear();
      this.drawCauVongMinigame(g, minigame);
      this.fillUiBands(r);
      return;
    }
    if (world.tanNguyetDefeatCardVisible) {
      this.battleBackground = null;
      this.drawTanNguyetDefeatCard(g);
      return;
    }
    if (world.battleVisible) {
      if (!this.battleBackground) {
        this.drawWorldBattleBackground(r, world);
        // The capture keeps the surface's own resolution (720x960 in Long Vương's room).
        this.battleBackground = document.createElement("canvas");
        this.battleBackground.width = g.canvas.width;
        this.battleBackground.height = g.canvas.height;
        this.battleBackground.getContext("2d")!.drawImage(g.canvas, 0, 0);
      } else {
        drawCanvasCopy(g, this.battleBackground);
      }
    } else if (eventScene) {
      // A free-world source event owns its own actor visibility, camera and op9 overlay. Rendering
      // the underlying WorldRuntime here used to discard all three: starter group 3 jumped straight
      // into the Elder fight, and room 3's Neil/Sophie memory left the present-day cast on screen.
      this.battleBackground = null;
      this.drawWorld(
        r,
        eventScene.renderScene,
        eventScene.renderRoom,
        eventScene.cameraX,
        eventScene.cameraY,
        eventScene.actors,
        // op24: `VqsvSceneView` translates the view by the shake offset.
        eventScene.shakeOffset,
        true,
      );
      const eventCamera = this.viewCamera(
        eventScene.renderScene,
        eventScene.renderRoom,
        eventScene.actors,
        eventScene.cameraX,
        eventScene.cameraY,
        true,
      );
      if (eventScene.renderScene === world.sceneId && eventScene.renderRoom === world.roomIndex)
        this.drawDarkRoom(g, world.darkRoomView, eventCamera);
      for (const effect of eventScene.actorEffects) {
        const actor = eventScene.actors.get(effect.actor);
        if (actor?.visible)
          this.drawSprite(
            g,
            259,
            effect.state,
            effect.tick,
            actor.x - eventCamera.x,
            actor.y - eventCamera.y - 40,
            false,
          );
      }
      r.uiSpace();
      this.drawPreludeEffect(g, eventScene);
    } else {
      this.battleBackground = null;
      this.drawWorld(
        r,
        world.sceneId,
        world.roomIndex,
        world.cameraX,
        world.cameraY,
        world.actors,
        undefined,
        true,
      );
      // `renderSourceActorMarkers`: while no panel owns the frame, the action marker (sprite 259,
      // state 7) floats over each tree or rock the hero can clear.
      const markerCamera = this.viewCamera(
        world.sceneId,
        world.roomIndex,
        world.actors,
        world.cameraX,
        world.cameraY,
        true,
      );
      // `VqsvQuestMarkerRuntime.render`: side-quest markers over their NPCs.
      for (const marker of world.questMarkers)
        this.drawSprite(
          g,
          OBSTACLE_MARKER_SPRITE,
          marker.state,
          world.presentationTick,
          marker.x - markerCamera.x,
          marker.y - markerCamera.y,
        );
      if (!this.host.panel.visible) {
        const camera = markerCamera;
        for (const prompt of world.obstaclePrompts)
          this.drawSprite(
            g,
            OBSTACLE_MARKER_SPRITE,
            OBSTACLE_MARKER_STATE,
            world.presentationTick,
            prompt.x - camera.x,
            prompt.y - camera.y,
          );
      }
      // `VqsvDarkRoomPresentation.render` comes after the whole world pass, markers included.
      this.drawDarkRoom(g, world.darkRoomView, markerCamera);
    }
    r.uiSpace();
    // `NguyenMocC4RaceRuntime.renderOverlay`: the countdown picture centred, else the run's time.
    const race = world.raceOverlay;
    if (race && "countdown" in race) {
      const image = this.boot.effect(`down-${race.countdown - 1}`);
      if (image)
        g.drawImage(image, 120 - Math.floor(image.width / 2), 160 - Math.floor(image.height / 2));
    } else if (race) this.boot.panelFont.draw(g, race.elapsed, 10, 40, "#000380");
    // An op53 award opens badge.ui while its group still holds the scene: the panel owns the frame.
    if (eventScene && !this.host.panel.visible) {
      if (eventScene.currentText) this.drawPreludeText(g, eventScene);
      const choice = eventScene.choice;
      if (choice) inLandSpace(g, LAND_CENTER, () => this.drawChoiceBox(g, choice));
      return;
    }
    // Tàn Nguyệt Long Ma's `TextBox.msgWarm` notice over the room.
    const bossNotice = world.tanNguyetNotice;
    if (bossNotice !== null) {
      inLandSpace(g, LAND_CENTER, () =>
        this.petUi.drawWarningBox(
          g,
          bossNotice,
          TAN_NGUYET_WORLD_TEXT.prompt,
          world.presentationTick,
        ),
      );
      return;
    }
    if (world.repelPromptVisible) {
      // Landscape: the line and the box at full size in the middle of the 320x240 screen.
      inLandSpace(g, LAND_CENTER, () => {
        if (world.repelPromptText)
          this.drawTaskTipRaw(g, world.repelPromptText, world.presentationTick);
        const choice = world.repelPromptChoice;
        if (choice) this.drawChoiceBox(g, choice);
      });
      return;
    }
    // `VqsvSourceNpcDialogueFlow`: a service NPC's line (`TextBox.dialog`) before its panel opens.
    const npcDialog = world.npcDialog;
    if (npcDialog) {
      this.drawDialogBox(g, npcDialog.speaker, npcDialog.text);
      return;
    }
    if (world.savePromptVisible) {
      this.drawSavePrompt(g, world.currentText, world.saveSelected);
      return;
    }
    if (world.battleEntryVisible) {
      this.drawBattleEntryTransition(g, world.presentationTick, world.battleEntryMode);
      return;
    }
    if (world.battleVisible && world.doubleBattle) {
      // A gym's 2v2 over the room the fight began in (the cached battle background).
      const background = this.battleBackground;
      this.battleRenderer.renderDouble(g, world.doubleBattle, (ctx) => {
        if (background) ctx.drawImage(background, 0, 0);
        else this.drawWorldBattleBackground(r, world);
      });
      return;
    }
    if (world.battleVisible) {
      this.drawWorldBattle(g);
      return;
    }
    if (world.phase === "battleReport") {
      this.drawWorldDialog(g, "Neil", world.currentText);
      return;
    }
    if (world.phase === "returnTask")
      inLandSpace(g, LAND_CENTER, () =>
        this.drawTaskTipRaw(g, world.currentText, world.presentationTick),
      );
    // `VqsvSceneView` draws `worldUi` only while no panel owns the frame, then the panel above the map.
    const land = landWorldPanel(this.host.panel),
      fit = land ? null : landWorldFit(this.host.panel);
    if (land) this.drawLandWorldPanel(r, world, land);
    else if (fit) this.drawFitWorldPanel(r, world, fit);
    else if (landWorldPet(this.host.panel)) {
      // The short dashboard at full size, where the fight's goes (`LAND_PET_STATE`).
      const k = r.backingScale,
        e = k * (battleFrameX() + LAND_WORLD_PET.x),
        f = k * LAND_WORLD_PET.y;
      this.drawWorldPanelsWith(r, world, k, e, f, true);
    } else this.drawWorldPanels(r, g, world);
  }
  /** `drawWorldPanels` under one transform (`a = d = scale`, then `e, f`) in both spaces. */
  private drawWorldPanelsWith(
    r: CanvasRenderer,
    world: WorldRuntime,
    scale: number,
    e: number,
    f: number,
    land = false,
  ): void {
    const g = r.context,
      place = () => g.setTransform(scale, 0, 0, scale, e, f),
      shim = {
        context: g,
        backingScale: r.backingScale,
        worldSpace: place,
        uiSpace: place,
      } as unknown as CanvasRenderer;
    place();
    g.imageSmoothingEnabled = false;
    this.drawWorldPanels(shim, g, world, land);
    r.uiSpace();
  }
  /**
   * Landscape: a JavaSE card (`landWorldFit`) scaled to fit the 320x240 screen, its dim spread over
   * the rest of the screen. The edges are kept on whole device pixels so the two dims meet cleanly.
   */
  private drawFitWorldPanel(r: CanvasRenderer, world: WorldRuntime, fit: LandWorldFit): void {
    const g = r.context,
      k = r.backingScale,
      ox = k * (battleFrameX() + fit.x),
      oy = k * fit.y,
      s = k * fit.scale,
      x0 = Math.round(ox + fit.region.x * s),
      y0 = Math.round(oy + fit.region.y * s),
      x1 = Math.round(ox + (fit.region.x + fit.region.w) * s),
      y1 = Math.round(oy + (fit.region.y + fit.region.h) * s);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = fit.dim;
    g.beginPath();
    g.rect(0, 0, g.canvas.width, g.canvas.height);
    g.rect(x0, y0, x1 - x0, y1 - y0);
    g.fill("evenodd");
    g.beginPath();
    g.rect(x0, y0, x1 - x0, y1 - y0);
    g.clip();
    this.drawWorldPanelsWith(r, world, s, ox, oy);
    g.restore();
    r.uiSpace();
  }
  /**
   * Landscape: a panel laid out on a source `.ui` is drawn at full size where the APK puts it
   * (`landWorldPanel`). It is painted on its own 240x320 sheet, then the body, the game menu's
   * banner and the two softkeys are laid on the 320x240 screen, each moved by its own shift.
   */
  private drawLandWorldPanel(r: CanvasRenderer, world: WorldRuntime, land: LandWorldPanel): void {
    const k = r.backingScale,
      sheet = (this.panelSheet ??= document.createElement("canvas"));
    if (sheet.width !== LOGICAL_WIDTH * k || sheet.height !== LOGICAL_HEIGHT * k) {
      sheet.width = LOGICAL_WIDTH * k;
      sheet.height = LOGICAL_HEIGHT * k;
    }
    const s = sheet.getContext("2d")!;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, sheet.width, sheet.height);
    s.setTransform(k, 0, 0, k, 0, 0);
    s.imageSmoothingEnabled = false;
    const onSheet = {
      context: s,
      backingScale: k,
      worldSpace: () => s.setTransform(k, 0, 0, k, 0, 0),
      uiSpace: () => s.setTransform(k, 0, 0, k, 0, 0),
    } as unknown as CanvasRenderer;
    this.drawWorldPanels(onSheet, s, world);
    const g = r.context,
      lay = (
        part: { x: number; y: number; w: number; h: number },
        shift: { x: number; y: number },
      ) =>
        g.drawImage(
          sheet,
          part.x * k,
          part.y * k,
          part.w * k,
          part.h * k,
          part.x + shift.x,
          part.y + shift.y,
          part.w,
          part.h,
        );
    g.setTransform(k, 0, 0, k, k * battleFrameX(), 0);
    g.imageSmoothingEnabled = false;
    const bodyTop = land.top ? TOP_END : 0;
    lay({ x: 0, y: bodyTop, w: LOGICAL_WIDTH, h: SOFTKEY_TOP - bodyTop }, land);
    if (land.top) lay({ x: 0, y: 0, w: LOGICAL_WIDTH, h: TOP_END }, land.top);
    lay(LEFT_KEY_SOURCE, LEFT_KEY);
    lay(RIGHT_KEY_SOURCE, RIGHT_KEY);
    r.uiSpace();
  }
  /** The open world panel (or, with none, the talk prompt and the world HUD). */
  private drawWorldPanels(
    r: CanvasRenderer,
    g: CanvasRenderingContext2D,
    world: WorldRuntime,
    /** Landscape's full-size pet dashboard: short, without the world HUD under it. */
    land = false,
  ): void {
    const art = this.worldPanelArt;
    if (this.host.panel.visible && this.host.panel.isCard)
      inLandSpace(g, LAND_CENTER, () => this.drawPanelCard(g));
    else if (this.host.panel.visible && this.host.panel.mode === "pet") {
      // JavaSE `renderPetStateOverlay` (world: "Xác định"), then `renderSourcePetSetting`,
      // `renderSourceReleaseConfirm` and `TextBox.msgWarm` over it.
      const panel = this.host.panel,
        tick = panel.openedTicks;
      // JavaSE closes the game menu before it opens the pet state, so `worldUi` (the room banner,
      // the shortcut toggle and the softkey plates) stays under the dashboard, except while the
      // release confirmation is up.
      if (panel.petStage !== "confirmRelease" && !land) {
        r.worldSpace();
        this.drawWorldHud(g, world);
        r.uiSpace();
      }
      // `choice.ui` ("Đạo cụ", "Vật phẩm trang sức") closes the dashboard while it is up.
      const choice = panel.petChoiceView,
        choiceLayout = this.boot.layouts.get("choice"),
        skills = panel.petSkillView,
        quality = panel.petQuality,
        evolution = panel.petEvolution;
      if (evolution)
        drawEvolution(
          g,
          {
            font: this.boot.panelFont,
            icon: (id, x, y) => {
              // `sourceMaterialItem`: the unified record's PNG, else its sprite-258 cell.
              const source = this.assets.bagItems?.material(id);
              if (!source) return;
              const icon = source.iconKey
                ? this.assets.pack.imageElement(source.iconKey)
                : this.boot.cell(258, source.icon);
              if (!icon || !icon.complete || icon.naturalWidth === 0) return;
              g.imageSmoothingEnabled = false;
              const scale = Math.min(13 / icon.naturalWidth, 13 / icon.naturalHeight),
                width = Math.max(1, Math.round(icon.naturalWidth * scale)),
                height = Math.max(1, Math.round(icon.naturalHeight * scale));
              g.drawImage(
                icon,
                x + Math.floor((13 - width) / 2),
                y + Math.floor((13 - height) / 2),
                width,
                height,
              );
            },
            sprite: (spriteId, x, y, w, h, at) => {
              const frame = this.assets.frame(spriteId, 0, at),
                bounds = this.assets.animationBounds(spriteId, 0);
              if (!frame || !bounds) return;
              const image = this.assets.imageFor(frame);
              if (!image.complete || image.naturalWidth === 0) return;
              g.drawImage(
                image,
                x + (w - bounds.width) / 2 - bounds.x + frame.ox,
                y + h - bounds.height - bounds.y + frame.oy,
              );
            },
          },
          evolution,
          tick,
        );
      else if (quality)
        drawQualityUpgrade(
          g,
          {
            font: this.boot.panelFont,
            fx: (name) => this.assets.pack.imageElement(`quality-fx.${name}`),
            pet: (pet) => this.host.petLook(pet),
            sprite: (spriteId, x, y, w, h, at, nature, shinyColor) => {
              const visual = this.assets.shinySprite(spriteId, nature, shinyColor),
                frame = this.assets.frame(visual, 0, at),
                bounds = this.assets.animationBounds(visual, 0);
              if (!frame || !bounds) return;
              const image = this.assets.petImage(frame, visual, nature, false, shinyColor);
              if (!image) return;
              g.drawImage(
                image,
                x + Math.trunc((w - bounds.width) / 2) - bounds.x + frame.ox,
                y + (h - bounds.height) - bounds.y + frame.oy,
              );
            },
          },
          quality,
          tick,
        );
      else if (skills)
        drawSkillScreen(
          g,
          {
            font: this.boot.panelFont,
            sprite: (spriteId, nature, shinyColor) => {
              const visual = this.assets.shinySprite(spriteId, nature, shinyColor),
                frame = this.assets.frameAtCursor(visual, 0, 0),
                bounds = this.assets.animationBounds(visual, 0),
                image = frame
                  ? this.assets.petImage(frame, visual, nature, false, shinyColor)
                  : undefined;
              return frame && bounds && image ? { frame, bounds, image } : undefined;
            },
          },
          skills,
        );
      else if (choice && choiceLayout)
        drawSourceChoice(
          g,
          choiceLayout,
          {
            font: this.boot.panelFont,
            cell: (i) => this.boot.cell(257, i),
            icon: (i) => this.boot.cell(258, i),
            image: (key) => this.assets.pack.imageElement(key),
          },
          choice,
        );
      else
        this.petUi.drawPetDashboard(
          g,
          {
            ...battleUiState("PET_STATE"),
            rows: panel.petCards,
            // `battleMenuAction`: the service's verb on the softkey ("Gởi lại", "Tiến hóa"...).
            prompt: panel.petActionLabel,
            selectedIndex: panel.selected,
            scroll: panel.listScroll,
            tab: panel.petTab,
          },
          tick,
          land,
        );
      const petsetting = this.boot.layouts.get("petsetting"),
        msgconfirm = this.boot.layouts.get("msgconfirm"),
        overlayArt = { font: this.boot.panelFont, cell: (i: number) => this.boot.cell(257, i) };
      if (panel.petStage === "setting" && petsetting)
        drawPetSetting(
          g,
          petsetting,
          overlayArt,
          panel.petSettingRows,
          panel.petSettingCursor,
          panel.petSettingScroll,
        );
      if (panel.petStage === "confirmRelease" && msgconfirm)
        drawReleaseConfirm(
          g,
          msgconfirm,
          overlayArt,
          "Bạn muốn phóng sinh sủng vật này?",
          "Xác nhận",
        );
      if (panel.petMessage)
        this.petUi.drawWarningBox(g, panel.petMessage.text, panel.petMessage.prompt, tick);
      else if (panel.petEvolution?.message)
        this.petUi.drawWarningBox(g, panel.petEvolution.message, "Nhấn nút 5 để tiếp tục", tick);
    } else if (this.host.panel.visible && this.host.panel.mode === "bag") {
      // JavaSE `renderBag`, then its `TextBox.msgWarm` line.
      const panel = this.host.panel;
      drawBag(g, panel, {
        font: this.boot.panelFont,
        icon: (index) => this.boot.cell(258, index),
        image: (key) => this.assets.pack.imageElement(key),
        petSprite: (visualId, x, y, w, h) => {
          const frame = this.assets.frame(visualId, 0, 0),
            bounds = this.assets.animationBounds(visualId, 0);
          if (!frame || !bounds) return;
          const image = this.assets.imageFor(frame);
          if (!image.complete || image.naturalWidth === 0) return;
          g.drawImage(
            image,
            x + Math.trunc((w - bounds.width) / 2) - bounds.x + frame.ox,
            y + Math.trunc((h - bounds.height) / 2) - bounds.y + frame.oy,
          );
        },
      });
      // `tickEggPicker`'s `ChoiceBox.optionUi`, then the `msgWarm` / `openbox.ui` line.
      if (panel.eggPicker)
        this.drawChoiceBox(g, {
          options: panel.eggPicker.labels.slice(panel.eggPicker.start),
          index: panel.eggPicker.index - panel.eggPicker.start,
        });
      if (panel.bagMessage?.kind === "openbox")
        this.drawOpenBox(g, panel.openedTicks, panel.bagMessage.text);
      else if (panel.bagMessage)
        this.petUi.drawWarningBox(
          g,
          panel.bagMessage.text,
          panel.bagMessage.prompt,
          panel.openedTicks,
        );
    } else if (
      this.host.panel.visible &&
      (this.host.panel.mode === "portableShop" ||
        this.host.panel.mode === "portableShopBuy" ||
        this.host.panel.mode === "portableShopConfirm")
    ) {
      const panel = this.host.panel;
      drawPortableShop(g, panel, {
        font: this.boot.panelFont,
        icon: (index) => this.boot.cell(258, index),
        cell: (index) => this.boot.cell(257, index),
        unifiedIcon: (index) => this.assets.pack.imageElement(`shop-icons.${index}`),
      });
      if (panel.portableShopMessage)
        this.petUi.drawWarningBox(
          g,
          panel.portableShopMessage.text,
          panel.portableShopMessage.prompt,
          panel.openedTicks,
        );
    } else if (this.host.panel.visible && this.host.panel.mode.startsWith("fashion")) {
      const panel = this.host.panel;
      drawFashionShop(g, panel, {
        font: this.boot.panelFont,
        bagIcon: this.assets.pack.imageElement("fashion-ui.blind-bag"),
        fashionIcon: this.assets.pack.imageElement("fashion-ui.fashion"),
        openSheet: this.assets.pack.imageElement("fashion-ui.blind-bag-open"),
        rainbowPreview: (key) => this.assets.pack.imageElement(`fashion-preview.${key}.png`),
        preview: (sprite, state, tick) => {
          const frame = this.assets.frame(sprite, state, tick);
          return frame
            ? { image: this.assets.imageFor(frame), ox: frame.ox, oy: frame.oy }
            : undefined;
        },
      });
      if (panel.wardrobeMessage)
        this.petUi.drawWarningBox(
          g,
          panel.wardrobeMessage.text,
          panel.wardrobeMessage.prompt,
          panel.openedTicks,
        );
    } else if (this.host.panel.visible && this.host.panel.mode === "wardrobe") {
      const panel = this.host.panel;
      drawWardrobe(g, panel, {
        font: this.boot.panelFont,
        rainbowPreview: (key) => this.assets.pack.imageElement(`fashion-preview.${key}.png`),
        preview: (sprite, state, tick) => {
          const frame = this.assets.frame(sprite, state, tick);
          return frame
            ? { image: this.assets.imageFor(frame), ox: frame.ox, oy: frame.oy }
            : undefined;
        },
      });
      if (panel.wardrobeMessage)
        this.petUi.drawWarningBox(
          g,
          panel.wardrobeMessage.text,
          panel.wardrobeMessage.prompt,
          panel.openedTicks,
        );
    } else if (
      this.host.panel.visible &&
      (this.host.panel.mode === "challenge" || this.host.panel.mode === "giftCode")
    ) {
      drawChallenge(g, this.host.panel, this.boot.panelFont);
    } else if (
      this.host.panel.visible &&
      (this.host.panel.mode === "battlePass" || this.host.panel.mode === "battlePassHelp")
    ) {
      drawBattlePass(g, this.host.panel, this.boot.panelFont);
    } else if (this.host.panel.visible && this.host.panel.mode === "bondingTower") {
      const panel = this.host.panel;
      drawBondingTower(g, this.boot.panelFont, panel.bondingTower, panel.towerSource.view(), {
        icon: this.assets.pack.imageElement("bonding-tower-art.tower.png"),
        portrait: (id) => this.assets.pack.imageElement(`bonding-tower-art.${id}.png`),
      });
    } else if (
      this.host.panel.visible &&
      (
        ["worldShop", "worldShopSell", "worldShopSellConfirm", "worldShopRecover"] as const
      ).includes(this.host.panel.mode as never)
    ) {
      // JavaSE "Thương điếm": shop.ui, the shopbuy.ui sell list, msgRecover.ui, then its msgWarm line.
      const panel = this.host.panel,
        shop = this.boot.layouts.get("shop"),
        shopbuy = this.boot.layouts.get("shopbuy"),
        msgRecover = this.boot.layouts.get("msgRecover");
      if (shop && shopbuy && msgRecover)
        drawWorldShop(
          g,
          panel,
          { shop, shopbuy, msgRecover },
          {
            ...art,
            icon: (index) => this.boot.cell(258, index),
          },
        );
      if (panel.worldShopMessage)
        this.petUi.drawWarningBox(
          g,
          panel.worldShopMessage.text,
          panel.worldShopMessage.prompt,
          panel.openedTicks,
        );
    } else if (
      this.host.panel.visible &&
      (this.host.panel.mode === "convenience" || this.host.panel.mode === "petBank")
    ) {
      // JavaSE `renderSourceConvenienceShop` (wharf2.ui) / `renderSourcePetBank` (shop.ui).
      const panel = this.host.panel,
        layout = this.boot.layouts.get(panel.mode === "convenience" ? "wharf2" : "shop");
      if (layout) {
        if (panel.mode === "convenience") drawConvenienceShop(g, panel, art, layout);
        else drawPetBankMenu(g, panel, art, layout);
      }
      const message =
        panel.serviceMessage ??
        (panel.campaignMessage
          ? { text: panel.campaignMessage, prompt: "Nhấn nút 5 để tiếp tục" }
          : null);
      if (message) this.petUi.drawWarningBox(g, message.text, message.prompt, panel.openedTicks);
    } else if (this.host.panel.visible && this.host.panel.mode === "wharf") {
      // JavaSE `renderSourceEastWharf`, then `showClosedWaterRoute`'s msgWarm line.
      const panel = this.host.panel,
        layout = this.boot.layouts.get(panel.wharfLayoutName);
      if (layout) drawWharfPanel(g, panel, art, layout);
      // The ocean and the boat are fetched while the menu is up, so the crossing opens drawn.
      for (const index of [1, 2, 3])
        this.assets.pack.imageElement(`wharf.maps/${WHARF_OCEAN_MAP}/layer-${index}.png`);
      for (const state of [0, 2]) {
        const frame = this.assets.frame(WHARF_BOAT_SPRITE, state, 0);
        if (frame) this.assets.imageFor(frame);
      }
      if (panel.wharfMessage)
        this.petUi.drawWarningBox(
          g,
          panel.wharfMessage.text,
          panel.wharfMessage.prompt,
          panel.openedTicks,
        );
    } else if (this.host.panel.visible && this.host.panel.mode === "ride") {
      // JavaSE `renderRide`, then its `msgwarm.ui` line.
      const panel = this.host.panel,
        layout = this.boot.layouts.get("ride");
      if (layout)
        drawRidePanel(g, panel, layout, {
          font: this.boot.panelFont,
          cell: (sprite, index) => this.boot.cell(sprite, index),
          rainbowIcon: (index) => this.assets.pack.imageElement(`ride-sprites.icons/r${index}.png`),
        });
      if (panel.rideMessage)
        this.petUi.drawWarningBox(
          g,
          panel.rideMessage.text,
          panel.rideMessage.prompt,
          panel.openedTicks,
        );
    } else if (
      this.host.panel.visible &&
      (this.host.panel.mode === "rainbowCharm" || this.host.panel.mode === "rainbowCharmConfirm")
    ) {
      // JavaSE `renderRainbowCharm`, with `drawSmsInfoOverlay` over it while confirming.
      const catalog = this.assets.rainbowCharms,
        smsInfo = this.boot.layouts.get("smsInfo");
      if (catalog && smsInfo)
        drawRainbowCharmPanel(g, this.host.panel, {
          font: this.boot.panelFont,
          catalog,
          icon: (id) => this.assets.pack.imageElement(`charm-icons.${id}`),
          cell: (index) => this.boot.cell(257, index),
          smsInfo,
        });
    } else if (this.host.panel.visible && this.host.panel.mode === "cauVongShop") {
      // JavaSE `CauVongShopPanel.render`.
      const panel = this.host.panel;
      drawCauVongShop(g, panel.cauVongShop, panel.cauVongShopSource.purse(), this.boot.panelFont);
    } else if (this.host.panel.visible && this.host.panel.mode === "cauVongIncubator") {
      // JavaSE `CauVongIncubatorPanel.render`.
      const panel = this.host.panel;
      drawCauVongIncubator(
        g,
        panel.cauVongIncubator,
        panel.cauVongIncubatorSource,
        this.boot.panelFont,
      );
    } else if (this.host.panel.visible && this.host.panel.mode === "areaMap") {
      // Landscape: the map spreads over the whole canvas (`areaMapScreen`), not the UI box.
      const view = this.host.panel.areaMap;
      if (view) {
        if (viewport.landscape) r.worldSpace();
        drawAreaMap(g, view, {
          font: this.boot.sourceFont,
          sprite: (sprite, state, tick, x, y) => this.drawSprite(g, sprite, state, tick, x, y),
        });
        if (viewport.landscape) r.uiSpace();
      }
    } else if (
      this.host.panel.visible &&
      (this.host.panel.mode === "record" ||
        this.host.panel.mode === "petmap" ||
        this.host.panel.mode === "badge")
    ) {
      // JavaSE Đồ giám: `renderRecord`, `renderPetmap`, `renderBadge`, then its `msgWarm` line.
      const record = this.boot.layouts.get("record"),
        petmap = this.boot.layouts.get("petmap"),
        badge = this.boot.layouts.get("badge");
      if (record && petmap && badge)
        drawRecordPanel(
          g,
          this.host.panel,
          { record, petmap, badge },
          {
            font: this.boot.panelFont,
            cell: (i) => this.boot.cell(257, i),
            // A colour page draws every picture in its shiny colour (nature 7 only marks it shiny).
            idle: (spriteId, shinyColor) => {
              const visual = this.assets.shinySprite(spriteId),
                frame = this.assets.frameAtCursor(visual, 0, 0);
              if (!frame) return undefined;
              const image =
                shinyColor === undefined
                  ? this.assets.imageFor(frame)
                  : this.assets.petImage(frame, visual, 7, false, shinyColor);
              return image ? { image, ox: 0, oy: 0 } : undefined;
            },
            badgeIcon: (key) => this.assets.pack.imageElement(`badge-icons.${key}`),
          },
        );
      const message = this.host.panel.recordMessage;
      if (message)
        this.petUi.drawWarningBox(g, message.text, message.prompt, this.host.panel.openedTicks);
    } else if (this.host.panel.visible) {
      const gamemenu = this.boot.layouts.get("gamemenu"),
        gamesystem = this.boot.layouts.get("gamesystem"),
        help = this.boot.layouts.get("help1"),
        settings = this.boot.layouts.get("help"),
        optionConfirm = this.boot.layouts.get("option"),
        msgtip = this.boot.layouts.get("msgtip"),
        task = this.boot.layouts.get("task");
      if (gamemenu && gamesystem && help && settings && optionConfirm && msgtip && task)
        drawWorldPanel(
          g,
          this.host.panel,
          {
            gamemenu,
            gamesystem,
            help,
            settings,
            optionConfirm,
            msgtip,
            task,
            taskOption: this.boot.layouts.get("taskOption"),
          },
          art,
          world.currency,
          { taskProgress: this.host.taskProgress() },
        );
    } else {
      // The talk bubble stands over an actor and the HUD pins to the screen corners: both are
      // drawn on the whole canvas.
      r.worldSpace();
      this.drawTalkPrompt(g, world);
      this.drawWorldHud(g, world);
      r.uiSpace();
    }
  }
  /** `VqsvTalkPromptRuntime.render`: the speech bubble over the NPC the player faces. */
  private drawTalkPrompt(g: CanvasRenderingContext2D, world: WorldRuntime): void {
    const prompt = world.talkPrompt;
    if (!prompt) return;
    const actor = world.actors.get(prompt.actorId),
      at = actor ? this.motion.actor(world.actors, actor.id, actor) : { x: prompt.x, y: prompt.y },
      camera = this.viewCamera(
        world.sceneId,
        world.roomIndex,
        world.actors,
        world.cameraX,
        world.cameraY,
        true,
      );
    this.drawSprite(
      g,
      TALK_PROMPT.sprite,
      TALK_PROMPT.animation,
      world.hud.promptTick,
      at.x - camera.x,
      at.y - TALK_PROMPT.yOffset - camera.y,
      false,
    );
  }
  /**
   * `WorldUi.render`: the room banner, the shortcut toggle and its three buttons, the two softkey
   * plates and the x2 checkbox.
   */
  private drawWorldHud(g: CanvasRenderingContext2D, world: WorldRuntime): void {
    const layout = this.boot.layouts.get("world"),
      hud = world.hud,
      font = this.boot.panelFont;
    if (!layout) return;
    // Drawn on the whole canvas (\`worldSpace\`), full size: in landscape each control keeps its
    // place against its own corner of the screen (\`cornerShift\`), as the APK's world.ui does.
    const pin = (corner: Corner) => {
      const d = cornerShift(corner);
      g.setTransform(base.a, base.b, base.c, base.d, base.e + d.x * base.a, base.f + d.y * base.d);
    };
    const base = g.getTransform();
    pin("tl");
    // The banner drops in at widget 1 (aligned to its top-left), the name scrolls in widget 6.
    if (hud.titleAnimationTick >= 0) {
      const banner = layout.widget(ROOM_TITLE.bannerWidget),
        bounds = this.assets.animationBounds(257, ROOM_TITLE.animation),
        frame = this.assets.heldFrame(257, ROOM_TITLE.animation, hud.titleAnimationTick);
      if (banner && bounds && frame) this.blit(g, frame, banner.x - bounds.x, banner.y - bounds.y);
      const text = layout.widget(ROOM_TITLE.textWidget);
      if (hud.titleTextVisible && text) {
        const w = Math.max(1, text.w),
          width = font.width(hud.roomTitle),
          color = `#${((Number(text.lColor ?? 0xffcc99) >>> 0) & 0xffffff).toString(16).padStart(6, "0")}`,
          scroll =
            width > w ? ((hud.titleAnimationTick - ROOM_TITLE.textFrame) * 2) % (width + w) : 0,
          x = width > w ? text.x + w - scroll : text.x + Math.floor((w - width) / 2);
        g.save();
        g.beginPath();
        g.rect(text.x, text.y, w, Math.max(1, text.h));
        g.clip();
        font.draw(g, hud.roomTitle, x, text.y, color);
        g.restore();
      }
    }
    // The shortcut toggle: a rounded plate with an arrow that points the way the strip will move.
    pin("bl");
    const t = SHORTCUT_TOGGLE;
    g.fillStyle = "#0b3d50";
    g.beginPath();
    g.roundRect(t.x, t.y, t.w, t.h, 4);
    g.fill();
    g.strokeStyle = "#f8dc55";
    g.stroke();
    const cx = t.x + t.w / 2,
      cy = t.y + t.h / 2,
      open = hud.shortcutsOpen;
    g.fillStyle = "#f8dc55";
    g.beginPath();
    g.moveTo(cx - 7, open ? cy - 4 : cy + 4);
    g.lineTo(cx, open ? cy + 4 : cy - 4);
    g.lineTo(cx + 7, open ? cy - 4 : cy + 4);
    g.fill();
    if (hud.shortcutsExpanded)
      for (const shortcut of SHORTCUTS) {
        const widget = layout.widget(shortcut.widget),
          frame = this.assets.heldFrame(257, shortcut.animation, hud.shortcutAnimationTick);
        if (frame) this.blit(g, frame, widget?.x ?? shortcut.x, widget?.y ?? shortcut.y);
      }
    pin("tl");
    const bottomLeft = cornerShift("bl"),
      bottomRight = cornerShift("br");
    drawWorldPlates(g, this.worldPanelArt, layout, bottomLeft, bottomRight);
    // `drawSpeedCheckbox`.
    pin("tr");
    const speed = this.speed?.enabled() ?? false,
      { boxX, boxY } = SPEED_CHECKBOX,
      ink = speed ? "#fff16a" : "#ffffff";
    g.fillStyle = "#0b3d50";
    g.fillRect(boxX - 1, boxY - 1, 12, 12);
    g.strokeStyle = ink;
    g.strokeRect(boxX + 0.5, boxY + 0.5, 9, 9);
    if (speed) {
      g.beginPath();
      g.moveTo(boxX + 2.5, boxY + 5.5);
      g.lineTo(boxX + 4.5, boxY + 7.5);
      g.lineTo(boxX + 8.5, boxY + 2.5);
      g.stroke();
    }
    font.draw(g, "x2", boxX + 14, boxY, ink);
    g.setTransform(base);
  }
  /** The one-line notice card (a shortcut whose panel is not ported yet). */
  private drawPanelCard(g: CanvasRenderingContext2D): void {
    const panel = this.host.panel,
      font = this.boot.panelFont,
      x = 18,
      w = 204,
      h = 62,
      y = Math.floor((320 - h) / 2) - 10;
    g.fillStyle = "rgba(0, 18, 28, 0.55)";
    fillCanvas(g);
    g.fillStyle = "#0b3d50";
    g.beginPath();
    g.roundRect(x + 2, y + 3, w, h, 8);
    g.fill();
    g.fillStyle = "#e9f6f8";
    g.beginPath();
    g.roundRect(x, y, w, h, 8);
    g.fill();
    g.fillStyle = "#245f76";
    g.beginPath();
    g.roundRect(x, y, w, 22, [8, 8, 0, 0]);
    g.fill();
    g.fillStyle = "#f0a43c";
    g.fillRect(x, y + 21, w, 2);
    font.centered(g, "Thông báo", x, w, y + 6, "#ffffff");
    font.centered(g, panel.notice, x, w, y + 32, "#14384a");
    font.centered(g, "Nhấn 5 để đóng", x, w, y + h - 14, "#6e93a5");
  }
  /** A world sprite frame with its anchor at x,y. */
  private blit(g: CanvasRenderingContext2D, frame: SpriteFrame, x: number, y: number): void {
    const image = this.assets.imageFor(frame);
    if (image.complete && image.naturalWidth > 0)
      g.drawImage(image, Math.floor(x + frame.ox), Math.floor(y + frame.oy));
  }
  /**
   * `ScreenEffect.renderBattleEntryTransition`: three white flashes, then the wipe of `mode` — 0 two
   * half-height bars with a tapering fringe, 1 ten-pixel rows from alternate sides, 2 ten-pixel
   * columns from alternate ends (each grows 15 px a tick, to the screen width).
   */
  private drawBattleEntryTransition(g: CanvasRenderingContext2D, tick: number, mode = 0): void {
    if (tick < 10) {
      if (tick % 3 === 1) {
        g.fillStyle = "#fff";
        fillCanvas(g);
      }
      return;
    }
    const progress = Math.max(0, Math.min(240, (tick - 9) * 15)),
      half = 160;
    g.fillStyle = "#000";
    if (mode === 1) {
      let left = false;
      for (let y = 0; y < 320; y += 10) {
        g.fillRect(left ? 0 : 240 - progress, y, progress, 10);
        left = !left;
      }
    } else if (mode === 2) {
      let top = false;
      for (let x = 0; x < 240; x += 10) {
        g.fillRect(x, top ? 0 : 320 - progress, 10, progress);
        top = !top;
      }
    } else {
      g.fillRect(0, 0, progress, half);
      for (let i = 1; i < 6; i++) g.fillRect(progress + i * 15, 0, Math.max(0, 15 - i * 3), half);
      g.fillRect(240 - progress, half, progress, 160);
      for (let i = 1; i < 6; i++)
        g.fillRect(240 - progress - i * 15, half, Math.max(0, 15 - i * 3), 160);
    }
    if (progress >= 240) fillCanvas(g);
  }
  /**
   * Seat a simultaneous 2v2 over the world and fetch every pet sheet it can show — both rosters and
   * the lent companions, so a replacement slides in drawn. The effect sprites and the Cầu Vồng
   * effect sheets are already loaded with the battle frames.
   */
  openDoubleBattle(battle: DoubleBattleRuntime): Promise<void> {
    this.doubleBattle = battle;
    return Promise.all(
      battle.core.spriteIds().map((sprite) => this.assets.prepareSprite(sprite)),
    ).then(() => undefined);
  }
  /**
   * `VqsvDoubleBattleRuntime.actionDeathDuration`: a Cầu Vồng visual falls for its whole state-2
   * animation, any other sprite for a quarter of its idle height (at least 4 ticks, 8 without one).
   */
  doubleBattleFallTicks(spriteId: number): number {
    return doubleBattleFallTicks(this.assets, spriteId);
  }
  /**
   * `VqsvWharfTravelRuntime.renderExclusive`: until the fade is done, the departure frame (the
   * world as `captureBattleBackground` takes it) under the black fade; then black, ocean layers 1
   * and 2, the boat centred at its y, ocean layer 3 over it, and the bars.
   */
  private renderWharfTravel(r: CanvasRenderer, travel: WharfTravel, world: WorldRuntime): void {
    const g = r.context;
    if (!travel.oceanVisible) {
      this.drawWorldBattleBackground(r, world);
      g.fillStyle = `rgba(0,0,0,${travel.fadeAlpha / 255})`;
      fillCanvas(g);
      return;
    }
    g.fillStyle = "#000";
    fillCanvas(g);
    const layer = (index: number) => {
      const image = this.assets.pack.imageElement(
        `wharf.maps/${WHARF_OCEAN_MAP}/layer-${index}.png`,
      );
      if (image.complete && image.naturalWidth > 0) g.drawImage(image, 0, 0);
    };
    layer(1);
    layer(2);
    this.drawSprite(
      g,
      WHARF_BOAT_SPRITE,
      travel.route.boatMode,
      travel.boatTicks,
      120,
      travel.boatY,
    );
    layer(3);
    this.fillUiBands(r);
    this.drawWharfBars(r, travel);
  }
  /**
   * Landscape: a whole screen drawn in the 240x320 UI box (the ocean crossing, a Cầu Vồng
   * minigame) leaves bands either side of it, painted the same plain colour as a narrow room's
   * (`drawMapGutters`).
   */
  private fillUiBands(r: CanvasRenderer): void {
    if (!viewport.landscape) return;
    const g = r.context,
      k = r.backingScale,
      { scale, x } = viewport.ui,
      left = Math.round(k * x),
      right = Math.round(k * (x + 240 * scale)),
      width = g.canvas.width,
      height = g.canvas.height;
    if (left <= 0 && right >= width) return;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = SIDE_BAND_COLOR;
    if (left > 0) g.fillRect(0, 0, left, height);
    if (right < width) g.fillRect(right, 0, width - right, height);
    g.restore();
  }
  /** `startBars`: black bars closing from the canvas's top and bottom edges, across its width. */
  private drawWharfBars(r: CanvasRenderer, travel: WharfTravel): void {
    const bars = travel.bars;
    if (!bars) return;
    const g = r.context;
    r.worldSpace();
    g.fillStyle = "#000";
    g.fillRect(0, 0, viewport.width, bars.top);
    g.fillRect(0, viewport.height - bars.bottom, viewport.width, bars.bottom);
    r.uiSpace();
  }
  private drawWorldBattleBackground(r: CanvasRenderer, world: WorldRuntime): void {
    const g = r.context;
    r.clear();
    r.worldSpace();
    const room = this.assets.getWorldRoom(world.sceneId, world.roomIndex),
      layers = room ? this.assets.maps.get(room.mapId) : undefined,
      camera = fitCamera(room, { x: world.cameraX, y: world.cameraY }),
      mapX = -camera.x - (room?.originX ?? 0),
      mapY = -camera.y - (room?.originY ?? 0);
    if (!layers) return r.uiSpace();
    this.drawRoomBackdrop(g, world.sceneId, world.roomIndex);
    for (const i of [1, 2]) if (layers[i]) g.drawImage(layers[i], mapX, mapY);
    this.drawMapGutters(g, [layers[1], layers[2]], { x: -mapX, y: -mapY });
    this.drawActorSet(g, world.actors, 1, camera, (actor) => actor.variant === 0, true);
    this.drawActorSet(g, world.actors, 2, camera, (actor) => actor.variant === 0, false);
    if (layers[3]) g.drawImage(layers[3], mapX, mapY);
    this.drawActorSet(g, world.actors, 0, camera, (actor) => actor.variant === 0, false);
    r.uiSpace();
  }
  private drawSavePrompt(g: CanvasRenderingContext2D, message: string, selected: number): void {
    const frame = this.boot.cell(257, 124),
      cancel = this.boot.cell(257, 75),
      save = this.boot.cell(257, 133);
    if (frame) g.drawImage(frame, 51, 134);
    if (cancel) g.drawImage(cancel, 1, 298);
    if (save) g.drawImage(save, 218, 298);
    this.boot.panelFont.centered(g, message, 56, 138, 142, "#1c6c91");
    g.strokeStyle = "#fff16a";
    g.strokeRect(selected === 1 ? 0 : 217, 297, 24, 22);
  }
  /**
   * `ChoiceBox.render`: one frame cell per row, the option centred inside it, and the marker cell on
   * the cursor's row. Nothing else is drawn over it, so the box floats on the map exactly as Java's
   * does.
   */
  private drawChoiceBox(
    g: CanvasRenderingContext2D,
    choice: { options: readonly string[]; index: number },
  ): void {
    for (let row = 0; row < CHOICE_BOX.rows && row < choice.options.length; row++) {
      const frame = this.boot.cell(CHOICE_BOX.sheet, CHOICE_BOX.frameCell);
      if (frame) g.drawImage(frame, CHOICE_BOX.x, CHOICE_BOX.rowY[row]);
      this.boot.panelFont.centered(
        g,
        choice.options[row],
        CHOICE_BOX.textX,
        CHOICE_BOX.textWidth,
        CHOICE_BOX.textY[row],
        CHOICE_BOX.color,
      );
      if (row !== choice.index) continue;
      const marker = this.boot.cell(CHOICE_BOX.sheet, CHOICE_BOX.markerCell);
      if (marker) g.drawImage(marker, CHOICE_BOX.markerX, CHOICE_BOX.markerY[row]);
    }
  }
  private drawWorldBattle(g: CanvasRenderingContext2D): void {
    const world = this.world!,
      battle = world.battle;
    if (!battle) return;
    this.battleRenderer.render(g, battle, this.motion.alpha);
    if (world.currentText) this.drawTaskTipRaw(g, world.currentText, world.presentationTick);
  }
  private drawWorldDialog(g: CanvasRenderingContext2D, speaker: string, text: string): void {
    this.bottomBand(g, (width) => {
      const frame = this.boot.cell(257, 129),
        tab = this.boot.cell(257, 130);
      if (frame) drawBandFrame(g, frame, 256, width);
      this.drawSpeakerTab(g, tab, speaker, 62);
      this.wrap(g, text, 6, 264, width - 10, 12, "#000");
    });
  }
  /**
   * A box laid against the bottom of the 240x320 screen (`dialog.ui`): in landscape it is drawn on
   * the whole canvas at full size, against the canvas's bottom edge and as wide as the canvas, as
   * the APK's 320x240 dialog.ui does. `body` gets that width (240 in portrait).
   */
  private bottomBand(g: CanvasRenderingContext2D, body: (width: number) => void): void {
    if (!viewport.landscape) {
      body(LOGICAL_WIDTH);
      return;
    }
    const k = g.getTransform().a / viewport.ui.scale;
    g.save();
    g.setTransform(k, 0, 0, k, 0, k * (viewport.height - LOGICAL_HEIGHT));
    body(viewport.width);
    g.restore();
  }
  /**
   * The speaker tab (cell 257:130, 62 px) at (1, 231) with the name in it; returns its width. A name
   * that fits keeps the cell as drawn; a longer one stretches the cell's middle so the name has 6 px
   * on each side, up to the width that still leaves the "Bỏ qua" plate on screen.
   */
  private drawSpeakerTab(
    g: CanvasRenderingContext2D,
    tab: HTMLImageElement | undefined,
    speaker: string,
    centerWidth = 60,
  ): number {
    const font = this.boot.panelFont,
      textWidth = font.width(speaker);
    if (textWidth <= centerWidth) {
      if (tab) g.drawImage(tab, 1, 231);
      font.centered(g, speaker, 1, centerWidth, 239, "#1c6c91");
      return SPEAKER_TAB_WIDTH;
    }
    const width = Math.min(SPEAKER_TAB_MAX_WIDTH, textWidth + 12);
    if (tab) {
      const edge = 12,
        smoothing = g.imageSmoothingEnabled;
      g.imageSmoothingEnabled = false;
      g.drawImage(tab, 0, 0, edge, tab.height, 1, 231, edge, tab.height);
      g.drawImage(
        tab,
        edge,
        0,
        tab.width - edge * 2,
        tab.height,
        1 + edge,
        231,
        width - edge * 2,
        tab.height,
      );
      g.drawImage(
        tab,
        tab.width - edge,
        0,
        edge,
        tab.height,
        1 + width - edge,
        231,
        edge,
        tab.height,
      );
      g.imageSmoothingEnabled = smoothing;
    }
    font.centered(g, speaker, 1, width, 239, "#1c6c91");
    return width;
  }
  private drawBattleBackgroundWorld(r: CanvasRenderer, prelude: StorySceneRuntime): void {
    const g = r.context;
    r.clear();
    r.worldSpace();
    const room = this.assets.getRoom(prelude.renderScene, prelude.renderRoom),
      layers = room ? this.assets.maps.get(room.mapId) : undefined,
      camera = fitCamera(room, { x: prelude.cameraX, y: prelude.cameraY }),
      mapX = -camera.x - (room?.originX ?? 0),
      mapY = -camera.y - (room?.originY ?? 0);
    if (!layers) return r.uiSpace();
    this.drawRoomBackdrop(g, prelude.renderScene, prelude.renderRoom);
    for (const i of [1, 2]) if (layers[i]) g.drawImage(layers[i], mapX, mapY);
    this.drawMapGutters(g, [layers[1], layers[2]], { x: -mapX, y: -mapY });
    this.drawActorSet(g, prelude.actors, 1, camera, (actor) => actor.variant === 0, true);
    this.drawActorSet(g, prelude.actors, 2, camera, (actor) => actor.variant === 0, false);
    if (layers[3]) g.drawImage(layers[3], mapX, mapY);
    this.drawActorSet(g, prelude.actors, 0, camera, (actor) => actor.variant === 0, false);
    r.uiSpace();
  }
  private drawPreludeEffect(g: CanvasRenderingContext2D, prelude: StorySceneRuntime): void {
    const t = prelude.effectTick;
    if (prelude.effect === "fade-out") {
      g.fillStyle = `rgba(0,0,0,${Math.min(255, t * 17) / 255})`;
      fillCanvas(g);
    } else if (prelude.effect === "fade-in") {
      g.fillStyle = `rgba(0,0,0,${Math.max(0, 255 - t * 17) / 255})`;
      fillCanvas(g);
    } else if (prelude.effect === "icon") {
      const icon = this.boot.effect("ikon-1")!;
      g.fillStyle = "#000";
      fillCanvas(g);
      g.globalAlpha = Math.min(1, (t * 10) / 255);
      g.drawImage(icon, 120 - icon.width / 2, 100 - icon.height / 2);
      g.globalAlpha = 1;
    } else if (prelude.effect.startsWith("backdrop:")) {
      // op34, `startStoryBackdrop`: black, then the picture (top-left x, y) fading in 10 a tick.
      const [, name, x, y] = prelude.effect.split(":"),
        image = this.boot.effect(name);
      g.fillStyle = "#000";
      fillCanvas(g);
      if (image) {
        g.globalAlpha = Math.min(1, (t * 10) / 255);
        g.drawImage(image, Number(x), Number(y));
        g.globalAlpha = 1;
      }
    }
  }
  private drawPreludeText(g: CanvasRenderingContext2D, prelude: StorySceneRuntime): void {
    const text = prelude.currentText!.slice(0, prelude.visibleChars);
    if (prelude.textKind === "full") {
      g.fillStyle = "#000";
      fillCanvas(g);
      this.wrap(g, text, 60, 90, 120, 12, "#ffffff");
      return;
    }
    if (prelude.textKind === "box") {
      const box = prelude.textBoxRect ?? { x: 10, y: 260, width: 220, height: 50 };
      g.fillStyle = "#050505";
      g.fillRect(box.x, box.y, box.width, box.height);
      g.strokeStyle = "#8f8f8f";
      g.strokeRect(box.x, box.y, box.width - 1, box.height - 1);
      g.strokeStyle = "#d8d8d8";
      g.strokeRect(box.x + 2, box.y + 2, box.width - 5, box.height - 5);
      this.wrap(g, text, box.x + 6, box.y + 7, box.width - 12, 12, "#ffffff");
      return;
    }
    if (prelude.textKind === "openbox") {
      this.drawOpenBox(g, prelude.textTick, text);
      return;
    }
    if (prelude.textKind === "tasktip") {
      this.drawTaskTip(g, prelude, text);
      return;
    }
    this.drawDialogBox(
      g,
      prelude.currentSpeaker,
      text,
      prelude.currentBreaks,
      prelude.currentDialogMode,
      prelude.currentPortrait >= 0
        ? { index: prelude.currentPortrait, offset: prelude.portraitOffset }
        : undefined,
    );
  }
  /**
   * `TextBox.dialog`: the speaker tab, the "Bỏ qua" plate and the text. With the pager's breaks
   * the box draws exactly those lines (see `TextLayout.paginate`); otherwise it wraps.
   */
  private drawDialogBox(
    g: CanvasRenderingContext2D,
    speaker: string,
    text: string,
    breaks: readonly number[] = [],
    mode = 0,
    portrait?: { index: number; offset: number },
  ): void {
    this.bottomBand(g, (width) =>
      this.drawDialogBand(g, width, speaker, text, breaks, mode, portrait),
    );
  }
  private drawDialogBand(
    g: CanvasRenderingContext2D,
    width: number,
    speaker: string,
    text: string,
    breaks: readonly number[],
    mode: number,
    portrait?: { index: number; offset: number },
  ): void {
    const frame = this.boot.cell(257, 129),
      tab = this.boot.cell(257, 130);
    if (frame) drawBandFrame(g, frame, 256, width);
    // `renderDialogFrame`: a box of mode -1 has no speaker tab. A long name widens the tab, and the
    // "Bỏ qua" plate moves right by as much, keeping its gap to the tab.
    const grow = mode >= 0 ? this.drawSpeakerTab(g, tab, speaker) - SPEAKER_TAB_WIDTH : 0,
      plateX = 86 + grow;
    // `withRainbowPortrait`: the face stands on the box, left for Sai Kỳ (0), right for the rest,
    // sliding in from 50 px out.
    if (portrait) {
      const face = this.assets.cauVongPortrait(portrait.index);
      if (face.complete && face.naturalWidth > 0) {
        const center = portrait.index === 0 ? 30 : width - 30;
        g.drawImage(
          face,
          center + portrait.offset - Math.trunc(face.naturalWidth / 2),
          265 - face.naturalHeight,
        );
      }
    }
    // The owner's choice: the "Bỏ qua" plate is drawn over a portrait, so it is never hidden.
    g.fillStyle = "#083f59";
    g.fillRect(plateX, 235, 68, 18);
    g.strokeStyle = "#7de7f4";
    g.strokeRect(plateX, 235, 67, 17);
    g.strokeStyle = "#fff";
    g.strokeRect(plateX + 1, 236, 65, 15);
    this.boot.panelFont.centered(g, "Bỏ qua", plateX, 68, 238, "#ffffff");
    if (!breaks.length) {
      this.wrap(g, text, 6, 264, width - 10, 12, "#000000");
      return;
    }
    [0, ...breaks].forEach((start, i) => {
      const line = text.slice(start, breaks[i] ?? text.length);
      if (line) this.boot.panelFont.draw(g, line, 6, 264 + i * 12, "#000000");
    });
  }
  private drawOpenBox(g: CanvasRenderingContext2D, textTick: number, text: string): void {
    const frame = this.assets.frame(257, 9, textTick),
      image = frame ? this.assets.imageFor(frame) : undefined,
      frameX = 45,
      frameY = 147,
      frameW = 150;
    if (frame && image?.complete && image.naturalWidth > 0)
      g.drawImage(image, Math.floor(frameX + (frameW - frame.w) / 2), frameY);
    const lineX = 49,
      lineY = frameY + Math.max(0, (26 - this.boot.panelFont.height) / 2),
      lineW = 142,
      textWidth = this.boot.panelFont.taggedWidth(text),
      cycle = textWidth + lineW + 12,
      offset = textWidth > lineW && textTick > 8 ? (textTick - 8) % Math.max(1, cycle) : 0,
      drawX = textWidth > lineW ? lineX - offset : lineX + Math.max(0, (lineW - textWidth) / 2);
    g.save();
    g.beginPath();
    g.rect(lineX, frameY, lineW, 26);
    g.clip();
    this.boot.panelFont.drawTagged(g, text, drawX, lineY, "#1c6c91");
    g.restore();
  }
  private drawTaskTip(g: CanvasRenderingContext2D, prelude: StorySceneRuntime, text: string): void {
    const frame = this.assets.frame(257, 10, prelude.textTick),
      image = frame ? this.assets.imageFor(frame) : undefined,
      frameX = 14,
      frameY = 147;
    if (frame && image?.complete && image.naturalWidth > 0) g.drawImage(image, frameX, frameY);
    const lineX = 16,
      lineY = 154,
      lineW = 208,
      textWidth = this.boot.panelFont.width(text),
      cycle = textWidth + lineW + 12,
      offset = prelude.textTick % Math.max(1, cycle),
      drawX = lineX + lineW - offset;
    g.save();
    g.beginPath();
    g.rect(lineX, lineY, lineW, 13);
    g.clip();
    this.boot.panelFont.draw(g, text, drawX, lineY, "#1c6c91");
    g.restore();
  }
  private drawTaskTipRaw(g: CanvasRenderingContext2D, text: string, tick: number): void {
    const frame = this.assets.frame(257, 10, tick),
      image = frame ? this.assets.imageFor(frame) : undefined;
    if (frame && image?.complete && image.naturalWidth > 0) g.drawImage(image, 14, 147);
    const lineX = 16,
      lineY = 154,
      lineW = 208,
      textWidth = this.boot.panelFont.width(text),
      cycle = textWidth + lineW + 12,
      offset = tick % Math.max(1, cycle),
      drawX = lineX + lineW - offset;
    g.save();
    g.beginPath();
    g.rect(lineX, lineY, lineW, 13);
    g.clip();
    this.boot.panelFont.draw(g, text, drawX, lineY, "#1c6c91");
    g.restore();
  }
  private text(r: CanvasRenderer): void {
    const g = r.context,
      text = this.runtime.currentText!.slice(0, this.runtime.visibleChars),
      x = this.runtime.textFull ? 30 : 10,
      y = this.runtime.textFull ? 90 : 270,
      w = this.runtime.textFull ? 180 : 220,
      h = this.runtime.textFull ? 230 : 50;
    if (this.runtime.textFull) {
      g.fillStyle = "#000";
      fillCanvas(g);
    } else {
      g.fillStyle = "#000";
      g.fillRect(x - 4, y - 4, w + 8, h + 8);
      g.strokeStyle = "#fff";
      g.strokeRect(x - 4, y - 4, w + 7, h + 7);
    }
    this.wrap(g, text, x, y, w, 12, "#ffffff");
    if (this.runtime.textReady) {
      const prompt = "Nhấn 0 để tiếp tục";
      this.boot.panelFont.centered(g, prompt, 0, 240, 302, "#ffffff");
    }
  }
  private wrap(
    g: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    lineHeight: number,
    color: string,
  ): void {
    // Break where JavaSE breaks (`UiFont.drawTagged`, Tahoma advances); draw with the pack font.
    this.boot.textLayout
      .wrap(text, w)
      .forEach(
        (line, i) => line && this.boot.panelFont.draw(g, line, x, y + i * lineHeight, color),
      );
  }
}

/**
 * The dialog frame (cell 257:129, 240x64) at `y`, `width` wide: as drawn when it fits, else its
 * 16 px ends kept and its middle stretched, nearest-pixel.
 */
function drawBandFrame(
  g: CanvasRenderingContext2D,
  frame: HTMLImageElement,
  y: number,
  width: number,
): void {
  if (width <= frame.width) {
    g.drawImage(frame, 0, y);
    return;
  }
  const edge = 16,
    middle = frame.width - edge * 2,
    smoothing = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.drawImage(frame, 0, 0, edge, frame.height, 0, y, edge, frame.height);
  g.drawImage(frame, edge, 0, middle, frame.height, edge, y, width - edge * 2, frame.height);
  g.drawImage(
    frame,
    frame.width - edge,
    0,
    edge,
    frame.height,
    width - edge,
    y,
    edge,
    frame.height,
  );
  g.imageSmoothingEnabled = smoothing;
}
