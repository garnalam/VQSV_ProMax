import type { StoryDataRegistry } from "./StoryDataRegistry";
import type { InputCommand } from "../../core/input/GameCommand";
import type { WorldAction, WorldRuntime } from "../world/WorldRuntime";
export type StorySceneId = string;
export interface StorySceneAdapter {
  readonly id: StorySceneId;
  readonly sourceSceneId?: number;
  readonly sourceRoomIndex?: number;
  readonly sourceGroups?: ReadonlyArray<{ sceneId: number; roomIndex: number; groupIndex: number }>;
  readonly complete: boolean;
  tick(): void;
  confirm(): void;
  requestDialogueSkip?(): void;
}

export class StoryRuntime {
  private readonly scenes = new Map<StorySceneId, StorySceneAdapter>();
  private active: StorySceneAdapter;
  private worldSession: WorldRuntime | null = null;
  private worldEnabled = false;
  constructor(
    initial: StorySceneAdapter,
    readonly sourceData?: StoryDataRegistry,
  ) {
    this.active = initial;
    this.validateSource(initial);
    this.scenes.set(initial.id, initial);
  }
  get scene(): StorySceneAdapter {
    return this.active;
  }
  get sourceRoom() {
    return this.sourceData &&
      this.active.sourceSceneId !== undefined &&
      this.active.sourceRoomIndex !== undefined
      ? this.sourceData.room(this.active.sourceSceneId, this.active.sourceRoomIndex)
      : undefined;
  }
  register(scene: StorySceneAdapter): this {
    this.validateSource(scene);
    this.scenes.set(scene.id, scene);
    return this;
  }
  switchTo(id: StorySceneId): StorySceneAdapter {
    const next = this.scenes.get(id);
    if (!next) throw new Error(`Unknown story scene ${id}`);
    this.active = next;
    return next;
  }
  get world(): WorldRuntime | null {
    return this.worldSession;
  }
  get worldActive(): boolean {
    return this.worldEnabled && this.worldSession !== null;
  }
  enterWorld(world: WorldRuntime): WorldRuntime {
    this.worldSession = world;
    this.worldEnabled = true;
    return world;
  }
  suspendWorld(): void {
    this.worldEnabled = false;
  }
  resumeWorld(): void {
    if (this.worldSession) this.worldEnabled = true;
  }
  tick(commands: InputCommand[] = []): WorldAction {
    if (this.worldActive) return this.worldSession!.tick(commands);
    this.active.tick();
    return null;
  }
  pointer(x: number, y: number): void {
    if (this.worldActive) this.worldSession!.pointer(x, y);
    else this.active.confirm();
  }
  confirm(): void {
    this.active.confirm();
  }
  requestDialogueSkip(): void {
    this.active.requestDialogueSkip?.();
  }
  get complete(): boolean {
    return this.worldActive ? this.worldSession!.phase === "complete" : this.active.complete;
  }
  private validateSource(scene: StorySceneAdapter): void {
    if (!this.sourceData) return;
    for (const locator of scene.sourceGroups ?? []) {
      if (!this.sourceData.group(locator.sceneId, locator.roomIndex, locator.groupIndex))
        throw new Error(
          `Missing source event group ${locator.sceneId}:${locator.roomIndex}:${locator.groupIndex} for ${scene.id}`,
        );
    }
  }
}
