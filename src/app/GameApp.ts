import { AudioManager, type SoundCue } from "../audio/AudioManager";
import { GameLoop } from "../core/GameLoop";
import { GameplayClock } from "../core/GameplayClock";
import { InputState, bindDomInput } from "../core/input/InputState";
import { toUi, viewport } from "../core/Viewport";
import { ScreenManager } from "../core/ScreenManager";
import { SIMULATION_STEP_MS } from "../core/constants";
import { GameAssets } from "../game/story/GameAssets";
import { Pack } from "../pack/Pack";
import { loadBootAssets, type BootAssets } from "../pack/boot";
import {
  applyApkActors,
  applyApkEvents,
  type ApkActorsDocument,
  type ApkEventsDocument,
} from "../game/world/ApkActors";
import { applyApkBattleSeats, BATTLE_SEATS } from "../game/battle/BattleSeats";
import { DEFAULT_BATTLE_DEFINITIONS } from "../game/battle/BattleDefinition";
import { SaveRepository } from "../persistence/SaveRepository";
import type { SaveService } from "../persistence/SaveService";
import { CanvasRenderer } from "../rendering/CanvasRenderer";
import { BootLoaderRenderer } from "../rendering/BootLoaderRenderer";
import { BootProgress } from "../pack/BootProgress";
import { NewGameScreen } from "../screens/NewGameScreen";
import { TitleScreen } from "../screens/TitleScreen";
import { TitleFlowModel, type StartRequest } from "../screens/title/TitleFlowModel";
import type { Screen } from "../core/ScreenManager";
import {
  AccountError,
  LocalAccountService,
  type Account,
  type AccountService,
} from "../account/AccountService";
import { LoginOverlay } from "./LoginOverlay";
import { AdminToolOverlay } from "./AdminToolOverlay";
import { AdminApi } from "../account/AdminApi";
import { ADMIN_RELOAD_EVENT, RemoteAccountService } from "../account/RemoteAccountService";
import { RewardsApi } from "../account/RewardsApi";
import { GiftMailbox } from "./GiftMailbox";
import { LiveChannel } from "./LiveChannel";
import { importJavaSave, parseJavaProperties } from "../persistence/save/JavaSaveImport";
import { importCatalogFor } from "../persistence/save/JavaSaveCatalog";

const SPEED_KEY = "vqsv.speedX2";

/** What the canvas shows under the login panel. */
const BLANK: Screen = { tick() {}, render: (r) => r.clear() };

export class GameApp {
  private readonly renderer: CanvasRenderer;
  /** Also fed by the on-screen gamepad (main.ts), which presses keys like a keyboard. */
  readonly input = new InputState();
  private readonly screens = new ScreenManager();
  private readonly gameplayClock = new GameplayClock();
  /** Accounts on the Cloudflare server; `VITE_ACCOUNTS=local` keeps them in this browser. */
  private readonly accounts: AccountService =
    import.meta.env.VITE_ACCOUNTS === "local"
      ? new LocalAccountService()
      : new RemoteAccountService();
  /** The signed-in account's save; the old pre-account slot only for dev checkpoints. */
  private saves = new SaveRepository();
  /** The running session's saver: its last write finishes before another save is read (ProMax). */
  private activeSaveService: SaveService | null = null;
  private login: LoginOverlay | null = null;
  /** The signed-in account; `admin` lists the Admin Tool in the game menu. */
  private account: Account | null = null;
  private adminTool: AdminToolOverlay | null = null;
  /** Server gift codes and the mailbox, for an online account only. */
  private readonly rewards =
    this.accounts instanceof RemoteAccountService ? new RewardsApi() : null;
  /** The gameplay screen on now, which the mailbox delivers gifts into. */
  private gameplay: NewGameScreen | null = null;
  private readonly mailbox = this.rewards
    ? new GiftMailbox(this.rewards, () => this.gameplay?.host ?? null)
    : null;
  /** The admin page's commands to this game and its online heartbeat (online accounts only). */
  private readonly live =
    this.accounts instanceof RemoteAccountService
      ? new LiveChannel(
          () => this.gameplay?.host ?? null,
          (reason) => this.reloadForAdmin(reason),
        )
      : null;
  private reloading = false;
  private speedX2 = readSpeedPreference();
  private audio: AudioManager | null = null;
  private assets: BootAssets | null = null;
  private gameAssets: GameAssets | null = null;
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new CanvasRenderer(canvas);
    // The server refused a save because an admin changed it since this game loaded it.
    window.addEventListener(ADMIN_RELOAD_EVENT, () => this.reloadForAdmin("save"));
    bindDomInput(this.input, canvas, (clientX, clientY) => {
      // Screens read presses in the 240x320 UI box (`viewport.ui`), wherever it sits on the canvas.
      const bounds = canvas.getBoundingClientRect();
      return toUi(
        ((clientX - bounds.left) * viewport.width) / bounds.width,
        ((clientY - bounds.top) * viewport.height) / bounds.height,
      );
    });
  }
  /** Whether the current screen has a text field open (the phone keyboard follows it). */
  textEntryActive(): boolean {
    return this.screens.textEntryActive();
  }
  async start(): Promise<void> {
    // The canvas has to show something while the pack arrives, so the loader draws over the whole
    // boot and hands the frame buffer to the first screen when the files are in.
    // Size the canvas for the viewport the page shell chose before the loader draws on it.
    this.renderer.setScale(1);
    const progress = new BootProgress(),
      loader = new BootLoaderRenderer(this.renderer.context, progress);
    loader.start();
    let pack: Pack | null = null;
    try {
      pack = await Pack.load(progress);
      this.audio = new AudioManager(pack);
      [this.assets, this.gameAssets] = await Promise.all([
        loadBootAssets(pack),
        GameAssets.fromPack(pack),
      ]);
      // Landscape: the rooms' actors, doors and event spots stand where the APK's scenes put them.
      const [apkActors, apkEvents] = await Promise.all([
        pack.json<ApkActorsDocument>("world.apk-actors"),
        pack.json<ApkEventsDocument>("world.apk-events"),
      ]);
      applyApkActors(apkActors, this.gameAssets.rooms, this.assets.sourceEvents);
      applyApkEvents(apkEvents, this.assets.sourceEvents);
      // ...and the fights seat their pets on the APK's 320x240 battle screen.
      if (viewport.landscape) {
        applyApkBattleSeats();
        for (const fight of DEFAULT_BATTLE_DEFINITIONS) {
          Object.assign(fight.combatants.player.origin, BATTLE_SEATS.player);
          Object.assign(fight.combatants.enemy.origin, BATTLE_SEATS.enemy);
        }
      }
    } finally {
      loader.stop();
      progress.close();
      pack?.stopTracking();
    }
    // Kim Diễm Long Vương's room draws his frames from their HD cuts.
    const assets = this.gameAssets!;
    this.renderer.hdTwin = (image) => assets.hdTwin(image);
    this.renderer.hdScale = assets.cauVongHd?.scale ?? 3;
    if (!(await this.enterParityCheckpoint())) this.showLogin();
    // A phone may kill a hidden tab without warning: save on the way out when that is safe.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.screens.suspend();
    });
    // M mutes and unmutes the game (remembered for the next visit).
    window.addEventListener("keydown", (event) => {
      if (event.code === "KeyM" && !event.repeat) this.audio?.toggleMute();
    });
    new GameLoop(
      SIMULATION_STEP_MS,
      () =>
        this.gameplayClock.tick(
          (input, sameFrame) => this.screens.tick(input, sameFrame),
          this.input.drainSnapshot(),
          () => this.screens.speedX2Suppressed(),
        ),
      (alpha) => this.screens.render(this.renderer, alpha),
      () => this.screens.animating(),
    ).start();
  }

  /**
   * Dev builds only: `?checkpoint=...` replays a scripted trace to a Java reference frame. The
   * harness module is not part of production bundles.
   */
  private async enterParityCheckpoint(): Promise<boolean> {
    if (!import.meta.env.DEV || !this.gameAssets || !this.assets) return false;
    const params = new URLSearchParams(location.search);
    if (params.size === 0) return false;
    // A checkpoint replays a fixed script, so the fights on the battle core draw one fixed stream.
    this.gameAssets.battleServices.seedSource = () => 0;
    const parity = await import("../dev/parityCheckpoints"),
      screen = new NewGameScreen(false, this.gameAssets, this.assets, this.saves, () => {
        this.showLogin();
      });
    this.wireGameplay(screen);
    await Promise.all(
      parity
        .checkpointRooms(params)
        .map(([scene, room]) => this.gameAssets!.prepareRoom(scene, room)),
    );
    if (!parity.applyUrlParityCheckpoint(screen, params)) return false;
    // Dev only: the checkpoint screen, for poking at it from the console.
    (window as unknown as { __vqsvScreen?: NewGameScreen }).__vqsvScreen = screen;
    this.screens.replace(screen);
    return true;
  }
  /**
   * A gameplay screen's ties to the app: the x2 checkbox drives the gameplay clock, the music follows
   * what is on screen, and the menu and fight cues are played.
   */
  private wireGameplay(screen: NewGameScreen): NewGameScreen {
    const clock = this.gameplayClock;
    screen.speed = {
      enabled: () => clock.isSpeedX2,
      toggle: () => clock.setSpeedX2(!clock.isSpeedX2),
    };
    screen.volume = {
      level: () => this.audio?.volumeLevel() ?? 0,
      setLevel: (level) => this.audio?.setVolumeLevel(level),
    };
    screen.onPresentation = (current) => this.audio?.follow(current.musicContext());
    screen.onSound = (cue) => this.audio?.play(cue as SoundCue);
    // Only an account the server signed in as `admin` sees the row; the server re-checks the role
    // on every Admin Tool call, so this only decides what the menu shows.
    screen.admin = this.account?.admin
      ? {
          open: (host) => {
            this.adminTool ??= new AdminToolOverlay(document.body, new AdminApi());
            this.adminTool.show(host);
          },
        }
      : null;
    screen.rewards = this.rewards;
    this.gameplay = screen;
    if (this.account) {
      this.mailbox?.start();
      this.live?.start();
    }
    return screen;
  }
  /**
   * An admin asked this game to reload (`LiveChannel`), or changed its save: the game reloads and
   * plays on from the cloud save. A plain reload first saves where the hero stands, when he can.
   */
  private reloadForAdmin(reason: string | undefined): void {
    if (this.reloading) return;
    this.reloading = true;
    this.live?.stop();
    this.mailbox?.stop();
    if (!reason) this.gameplay?.host?.saveIfResting();
    const note = document.createElement("div");
    note.textContent = reason
      ? "Quản trị viên vừa cập nhật tiến trình của bạn. Game đang tải lại…"
      : "Quản trị viên yêu cầu tải lại game. Đang tải lại…";
    note.setAttribute("role", "status");
    note.style.cssText =
      "position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:9999;max-width:calc(100% - 32px);" +
      "padding:10px 14px;border-radius:8px;background:#1d2b44;color:#fff;font:14px/1.4 system-ui,sans-serif;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.4)";
    document.body.append(note);
    void this.reenterForAdmin(note);
  }
  /**
   * Plays on from the cloud save without leaving the page, so the player stays signed in: a fresh
   * save repository reads the server's row again. Anything unexpected reloads the whole page.
   */
  private async reenterForAdmin(note: HTMLElement): Promise<void> {
    const written = this.activeSaveService?.flush().catch(() => undefined) ?? Promise.resolve();
    await Promise.race([written, new Promise((resolve) => window.setTimeout(resolve, 4_000))]);
    await new Promise((resolve) => window.setTimeout(resolve, 800));
    const account = this.account;
    try {
      if (!account) throw new Error("signed out");
      // The old session stops here: no more ticks, and its saver writes nothing after this point.
      this.screens.replace(BLANK);
      this.gameplay = null;
      this.activeSaveService = null;
      this.saves = this.accounts.saves(account);
      await this.startBoundary({ loadSave: true, skipIntro: false, speedX2: this.speedX2 });
      note.remove();
      this.reloading = false;
    } catch {
      window.location.reload();
    }
  }
  /**
   * The first panel (and where leaving the game returns to): sign in to play on from the
   * account's save, or register and answer the skip-prologue question.
   */
  private showLogin(): void {
    this.account = null;
    this.gameplay = null;
    this.mailbox?.stop();
    this.live?.stop();
    this.adminTool?.hide();
    this.gameplayClock.setSpeedX2(false);
    this.audio?.playMenu();
    this.screens.replace(BLANK);
    this.login ??= new LoginOverlay(document.body, {
      login: async (username, password) =>
        this.enter(await this.accounts.login(username, password)),
      register: async (username, password) =>
        this.enter(await this.accounts.register(username, password)),
      identity: this.accounts instanceof RemoteAccountService ? "email" : "username",
      firstGesture: () => {
        if (!this.audio?.isEnabled()) this.audio?.chooseMusic(true);
      },
      volume: {
        level: () => this.audio?.volumeLevel() ?? 0,
        setLevel: (level) => this.audio?.setVolumeLevel(level),
      },
      muted: {
        get: () => this.audio?.isMuted() ?? false,
        toggle: () => this.audio?.toggleMute(),
      },
      speedX2: {
        get: () => this.speedX2,
        set: (on) => {
          this.speedX2 = on;
          try {
            localStorage.setItem(SPEED_KEY, on ? "1" : "0");
          } catch {
            // Storage blocked: the choice lasts for this visit.
          }
        },
      },
    });
    this.login.show();
  }
  /** Signed in: play on from the account's save, or ask about the prologue when there is none. */
  private async enter(account: Account): Promise<void> {
    this.account = account;
    this.saves = this.accounts.saves(account);
    const hasSave = (await this.saves.hasValidSave()) || (await this.carryOverJavaSave(account));
    this.login?.hide();
    if (hasSave) {
      await this.startBoundary({ loadSave: true, skipIntro: false, speedX2: this.speedX2 });
      return;
    }
    if (!this.assets) return;
    const model = new TitleFlowModel(false, await this.saves.hasAnySave());
    model.mode = "skipIntro";
    model.speedX2 = this.speedX2;
    this.screens.replace(
      new TitleScreen(
        this.assets,
        model,
        (request) => this.startBoundary(request),
        () => this.saves.deleteAll(),
        () => this.showLogin(),
      ),
    );
  }
  /**
   * First sign-in of a Java-build player: their Java save is converted into the web game's own
   * row (the Java row is left as it is). Whatever the web game does not have is left out.
   */
  private async carryOverJavaSave(account: Account): Promise<boolean> {
    if (!this.accounts.legacyJavaSave || !this.gameAssets) return false;
    try {
      const text = await this.accounts.legacyJavaSave(account);
      if (!text) return false;
      const imported = importJavaSave(text, importCatalogFor(this.gameAssets));
      if (!imported) {
        // Still in the opening (or a newer Java format): the player starts from the prologue.
        const p = parseJavaProperties(text);
        console.info("VQSV_JAVA_IMPORT_SKIPPED", {
          version: p.get("version"),
          mode: p.get("worldResumeMode"),
          scene: p.get("scene"),
        });
        return false;
      }
      if (imported.dropped.length) console.info("VQSV_JAVA_IMPORT_DROPPED", imported.dropped);
      await this.saves.save(imported.save);
      return true;
    } catch (error) {
      // The account has progress we could not carry over: never drop the player into the
      // prologue as if it were a new account.
      console.error("VQSV_JAVA_IMPORT", error);
      throw new AccountError(
        "unknown",
        "Không đọc được save cũ của tài khoản này. Hãy báo quản trị viên, đừng chơi lại từ đầu.",
      );
    }
  }
  private async startBoundary(request: StartRequest): Promise<void> {
    if (!this.gameAssets || !this.assets) return;
    this.gameplayClock.setSpeedX2(request.speedX2);
    // A save still being written by the session just left must land before it is read back.
    await this.activeSaveService?.flush();
    this.activeSaveService = null;
    const save = request.loadSave ? await this.saves.load() : undefined;
    if (request.loadSave && !save) {
      this.showLogin();
      return;
    }
    const game = new NewGameScreen(
      request.skipIntro,
      this.gameAssets,
      this.assets,
      this.saves,
      () => this.showLogin(),
      save,
    );
    this.activeSaveService = game.saveService;
    this.screens.replace(this.wireGameplay(game));
  }
}

function readSpeedPreference(): boolean {
  try {
    return localStorage.getItem(SPEED_KEY) === "1";
  } catch {
    return false;
  }
}
