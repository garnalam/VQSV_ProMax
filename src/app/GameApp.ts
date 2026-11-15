import { AudioManager, type SoundCue } from "../audio/AudioManager";
import { GameLoop } from "../core/GameLoop";
import { GameplayClock } from "../core/GameplayClock";
import { InputState, bindDomInput } from "../core/input/InputState";
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from "../core/constants";
import { ScreenManager } from "../core/ScreenManager";
import { SIMULATION_STEP_MS } from "../core/constants";
import { GameAssets } from "../game/story/GameAssets";
import { Pack } from "../pack/Pack";
import { loadBootAssets, type BootAssets } from "../pack/boot";
import { SaveRepository } from "../persistence/SaveRepository";
import { CanvasRenderer } from "../rendering/CanvasRenderer";
import { BootLoaderRenderer } from "../rendering/BootLoaderRenderer";
import { BootProgress } from "../pack/BootProgress";
import { BootScreen } from "../screens/BootScreen";
import { NewGameScreen } from "../screens/NewGameScreen";
import { TitleScreen } from "../screens/TitleScreen";
import { TitleFlowModel, type StartRequest } from "../screens/title/TitleFlowModel";
import { LocalAccountService, type AccountService } from "../account/AccountService";
import { RemoteAccountService } from "../account/RemoteAccountService";
import type { SaveService } from "../persistence/SaveService";
import { LoginOverlay } from "./LoginOverlay";
import { TouchGamepad } from "../core/input/TouchGamepad";
import { fitStage } from "./StageLayout";
import { mountFullscreenButton } from "./FullscreenButton";
import "./login.css";
import "./touch-controls.css";

export class GameApp {
  private readonly renderer: CanvasRenderer;
  private readonly input = new InputState();
  private readonly screens = new ScreenManager();
  private readonly gameplayClock = new GameplayClock();
  private readonly accounts: AccountService = import.meta.env.VITE_ACCOUNTS === "remote"
    ? new RemoteAccountService()
    : new LocalAccountService();
  private saves = new SaveRepository();
  private login: LoginOverlay | null = null;
  private activeSaveService: SaveService | null = null;
  private switching = false;
  private audio: AudioManager | null = null;
  private assets: BootAssets | null = null;
  private gameAssets: GameAssets | null = null;
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new CanvasRenderer(canvas);
    bindDomInput(this.input, canvas, (clientX, clientY) => {
      const bounds = canvas.getBoundingClientRect();
      return {
        x: Math.floor(((clientX - bounds.left) * LOGICAL_WIDTH) / bounds.width),
        y: Math.floor(((clientY - bounds.top) * LOGICAL_HEIGHT) / bounds.height),
      };
    });
  }
  async start(): Promise<void> {
    this.mountControls();
    const ready = this.loadAssets();
    await ready;
    if (import.meta.env.PROD || this.accounts instanceof RemoteAccountService) this.showLogin();
    else if (!(await this.enterParityCheckpoint()))
      this.screens.replace(new BootScreen(this.assets!, (enabled) => this.enterTitle(enabled)));
    window.addEventListener("keydown", (event) => {
      if (event.code === "KeyM" && !event.repeat) this.audio?.toggleMute();
    });
    new GameLoop(
      SIMULATION_STEP_MS,
      () => {
        const input = this.input.drainSnapshot();
        if (this.switching || this.login?.visible) return;
        this.gameplayClock.tick(
          (input, sameFrame) => this.screens.tick(input, sameFrame),
          input,
          () => this.screens.speedX2Suppressed(),
        );
      },
      (alpha) => this.screens.render(this.renderer, alpha),
      () => this.screens.animating(),
    ).start();
  }

  private mountControls(): void {
    const app = document.querySelector<HTMLElement>("#app")!;
    const stage = document.querySelector<HTMLElement>("#stage")!;
    const left = document.createElement("div");
    const right = document.createElement("div");
    left.className = "touch-pad touch-pad-left";
    right.className = "touch-pad touch-pad-right";
    app.append(left, right);
    const gamepad = new TouchGamepad(this.input, left, right);
    mountFullscreenButton(document.body);

    let touch = matchMedia("(pointer: coarse)").matches;
    const layout = () => {
      const style = getComputedStyle(app);
      const width =
        app.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const height =
        app.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const fit = fitStage(width, height, touch);
      app.dataset.layout = fit.mode;
      stage.style.width = touch ? `${fit.width}px` : "";
      stage.style.height = touch ? `${fit.height}px` : "";
    };
    layout();
    window.addEventListener("resize", layout);
    window.visualViewport?.addEventListener("resize", layout);
    window.addEventListener(
      "pointerdown",
      (event) => {
        if (!touch && event.pointerType === "touch") {
          touch = true;
          layout();
        }
      },
      { capture: true },
    );
    window.addEventListener("pagehide", () => gamepad.releaseAll());
  }

  private async loadAssets(): Promise<void> {
    // The canvas has to show something while the pack arrives, so the loader draws over the whole
    // boot and hands the frame buffer to the first screen when the files are in.
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
    } finally {
      loader.stop();
      progress.close();
      pack?.stopTracking();
    }
    // Kim Diễm Long Vương's room draws his frames from their HD cuts.
    const assets = this.gameAssets!;
    this.renderer.hdTwin = (image) => assets.hdTwin(image);
    this.renderer.hdScale = assets.cauVongHd?.scale ?? 3;
  }

  private showLogin(): void {
    const authenticate = async (mode: "login" | "register", username: string, password: string) => {
      const account = await this.accounts[mode](username, password);
      this.saves = this.accounts.saves(account);
      await this.showTitle(true);
      this.input.cancelForFocusLoss();
      this.login?.hide();
      this.audio?.chooseMusic(true);
    };
    this.login = new LoginOverlay(document.body, {
      login: (username, password) => authenticate("login", username, password),
      register: (username, password) => authenticate("register", username, password),
      identity: this.accounts instanceof RemoteAccountService ? "email" : "username",
      firstGesture: () => this.audio?.chooseMusic(true),
      volume: {
        level: () => this.audio?.volumeLevel() ?? 0,
        setLevel: (level) => this.audio?.setVolumeLevel(level),
      },
      muted: {
        get: () => this.audio?.volumeLevel() === 0,
        toggle: () => this.audio?.toggleMute(),
      },
      speedX2: {
        get: () => this.gameplayClock.isSpeedX2,
        set: (on) => this.gameplayClock.setSpeedX2(on),
      },
    });
    this.login.show();
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
        void this.showTitle();
      });
    this.wireGameplay(screen);
    await Promise.all(
      parity
        .checkpointRooms(params)
        .map(([scene, room]) => this.gameAssets!.prepareRoom(scene, room)),
    );
    if (!parity.applyUrlParityCheckpoint(screen, params)) return false;
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
    return screen;
  }
  private enterTitle(enabled: boolean): void {
    this.audio?.chooseMusic(enabled);
    void this.showTitle();
  }
  private async showTitle(fromLogin = false): Promise<void> {
    if (!this.assets) return;
    this.switching = true;
    try {
      await this.activeSaveService?.flush();
      const model = new TitleFlowModel(
        await this.saves.hasValidSave(),
        await this.saves.hasAnySave(),
      );
      this.activeSaveService = null;
      model.speedX2 = fromLogin && this.gameplayClock.isSpeedX2;
      this.gameplayClock.setSpeedX2(model.speedX2);
      this.audio?.playMenu();
      this.screens.replace(
        new TitleScreen(this.assets, model, (request) => this.startBoundary(request, model)),
      );
    } catch (error) {
      if (fromLogin) throw error;
      this.reportLoadError(error);
    } finally {
      this.switching = false;
    }
  }
  private async startBoundary(request: StartRequest, model: TitleFlowModel): Promise<void> {
    if (!this.gameAssets || !this.assets || this.switching) return;
    this.switching = true;
    try {
      const saves = this.saves;
      const save = request.loadSave ? await saves.load() : undefined;
      if (request.loadSave && !save) {
        await this.showTitle();
        return;
      }
      if (!request.loadSave && model.anySave) await saves.deleteAll();
      const game = new NewGameScreen(
        request.skipIntro,
        this.gameAssets,
        this.assets,
        saves,
        () => void this.showTitle(),
        save,
        () => this.accounts.towerLeaderboard(),
      );
      this.activeSaveService = game.saveService;
      this.gameplayClock.setSpeedX2(request.speedX2);
      this.screens.replace(this.wireGameplay(game));
    } catch (error) {
      model.mode = "menu";
      this.reportLoadError(error);
    } finally {
      this.switching = false;
    }
  }

  private reportLoadError(error: unknown): void {
    window.alert(error instanceof Error ? error.message : "Không tải được bản lưu. Hãy thử lại.");
  }
}
