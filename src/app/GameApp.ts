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

export class GameApp {
  private readonly renderer: CanvasRenderer;
  private readonly input = new InputState();
  private readonly screens = new ScreenManager();
  private readonly gameplayClock = new GameplayClock();
  private readonly saves = new SaveRepository();
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
    if (!(await this.enterParityCheckpoint()))
      this.screens.replace(new BootScreen(this.assets!, (enabled) => this.enterTitle(enabled)));
    // M mutes and unmutes the game (remembered for the next visit).
    window.addEventListener("keydown", (event) => {
      if (event.code === "KeyM" && !event.repeat) this.audio?.toggleMute();
    });
    new GameLoop(
      SIMULATION_STEP_MS,
      () =>
        this.gameplayClock.tick(
          (input) => this.screens.tick(input),
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
  private async showTitle(): Promise<void> {
    this.gameplayClock.setSpeedX2(false);
    this.audio?.playMenu();
    if (!this.assets) return;
    const model = new TitleFlowModel(
      await this.saves.hasValidSave(),
      await this.saves.hasAnySave(),
    );
    this.screens.replace(
      new TitleScreen(
        this.assets,
        model,
        (request) => this.startBoundary(request),
        () => this.saves.deleteAll(),
      ),
    );
  }
  private async startBoundary(request: StartRequest): Promise<void> {
    if (!this.gameAssets || !this.assets) return;
    this.gameplayClock.setSpeedX2(request.speedX2);
    const save = request.loadSave ? await this.saves.load() : undefined;
    if (request.loadSave && !save) {
      await this.showTitle();
      return;
    }
    this.screens.replace(
      this.wireGameplay(
        new NewGameScreen(
          request.skipIntro,
          this.gameAssets,
          this.assets,
          this.saves,
          () => void this.showTitle(),
          save,
        ),
      ),
    );
  }
}
