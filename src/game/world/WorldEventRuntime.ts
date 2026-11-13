import type { InputCommand } from "../../core/input/GameCommand";
import type { StoryActor } from "../story/StoryActor";
import type { StoryDataRegistry } from "../story/StoryDataRegistry";
import { SourceOpcodeInterpreter } from "../story/SourceOpcodeInterpreter";
import type { StorySceneServices } from "../story/StorySceneRuntime";
import { StorySceneRuntime } from "../story/StorySceneRuntime";
import type { GroupRef } from "./WorldEventCatalog";
import { EVENT_STATE_FRESH, EventStateLedger, giftReceiptKey } from "./EventStateLedger";
import type {
  ItemTable,
  RuntimeStoryEvent,
  SourceRoutePatch,
} from "../story/SourceOpcodeInterpreter";

const CAU_VONG_SCENE = 98;

export type WorldEventEffects = {
  /** `table`: the db.mid group, 4 consumables (op17), 3 equipment/materials (op18), 5 specials (op19). */
  grantItem(itemId: number, quantity: number, table?: ItemTable): void;
  consumeItem(itemId: number, quantity: number, table?: ItemTable): void;
  /** op31 `CurrencyEngine.adjustRaw`: kind 0 money, 1 badges; `amount` is signed. */
  adjustCurrency(kind: number, amount: number): void;
  requestSave(): void;
};

/**
 * Runs one decoded (scene, room, group) program against the live world. The group's
 * records are the whole program, so the ledger is written by the group's own
 * op14/op23/op42 records rather than by the caller.
 */
export class WorldEventRuntime {
  readonly scene: StorySceneRuntime;
  private settled = 0;
  /**
   * The group had not completed when it started (`EventStateLedger.giftReceived`): its op17/op18
   * gifts are handed over once, so a replay after a lost or fled fight does not pay them again.
   * A retired (op42) group is a repeatable one and pays every time, as a chest's script does.
   */
  private readonly giftsOnce: boolean;
  /** Gifts this run has already paid: a group that names the same item twice pays both. */
  private readonly paidThisRun = new Set<string>();
  constructor(
    readonly ref: GroupRef,
    registry: StoryDataRegistry,
    services: StorySceneServices,
    private readonly ledger: EventStateLedger,
    private readonly effects: WorldEventEffects,
    player: StoryActor,
    patches?: (id: string) => SourceRoutePatch[] | undefined,
    /**
     * A runtime's own short script instead of the group's records (a chest's reward): the events
     * run exactly as compiled ones do, and `ref` only names the room.
     */
    script?: { id: string; events: RuntimeStoryEvent[] },
  ) {
    const id = `world:${ref.scene}:${ref.room}:${ref.group}`;
    const initialRoom = { scene: ref.scene, room: ref.room, x: player.x, y: player.y };
    const program = script
      ? {
          id: script.id,
          groups: [{ sceneId: ref.scene, roomIndex: ref.room, groupIndex: ref.group }],
          events: script.events,
          startEvent: 0,
          initialRoom,
          startupDelay: 0,
          stopAtTenYears: false,
        }
      : new SourceOpcodeInterpreter(registry).compile({
          id,
          patches: patches?.(id),
          groups: [{ sceneId: ref.scene, roomIndex: ref.room, groupIndex: ref.group }],
          startEvent: 0,
          initialRoom,
        });
    this.scene = new StorySceneRuntime(program, services);
    this.scene.adoptWorldPlayer(player);
    // Cầu Vồng (scene 98) follows JavaSE as it is and keeps its own receipts (`questOnce`).
    this.giftsOnce =
      !script &&
      ref.scene !== CAU_VONG_SCENE &&
      ledger.sourceEventState(ref.scene, ref.room, ref.group) === EVENT_STATE_FRESH;
  }
  get done(): boolean {
    return this.scene.exhausted;
  }
  /** The actors op38 wants the player to walk up to and activate, empty while nothing waits. */
  get activationIds(): readonly number[] {
    return this.scene.activationIds;
  }
  /** op35: the option box the group is showing, or null. */
  get choice(): { options: readonly string[]; index: number } | null {
    return this.scene.choice;
  }
  activateActor(id: number): boolean {
    return this.scene.activateActor(id);
  }
  moveChoice(delta: number): void {
    this.scene.moveChoice(delta);
  }
  tick(commands: InputCommand[]): void {
    if (this.done) return;
    if (commands.includes("confirm")) this.scene.confirm();
    this.scene.tick();
    this.settle();
  }
  /** Applies ledger and inventory side effects for every event that just finished. */
  private settle(): void {
    // Execution order, not program order: a branch record can visit the same command twice or skip one.
    const completed = this.scene.completedEvents;
    while (this.settled < completed.length) {
      const event = completed[this.settled++];
      if (event.type === "retire")
        this.ledger.op42RepeatEvent(this.ref.scene, this.ref.room, this.ref.group);
      else if (event.type === "markComplete")
        this.ledger.op23MarkEventComplete(event.ref.scene, event.ref.room, event.ref.group);
      else if (event.type === "markRetired")
        this.ledger.op77RetireEvent(event.ref.scene, event.ref.room, event.ref.group);
      else if (event.type === "groupEnd")
        this.ledger.op14CompleteEvent(this.ref.scene, this.ref.room, this.ref.group);
      else if (event.type === "savePrompt") this.effects.requestSave();
      else if (event.type === "currency") {
        if ((event.mode === 0 || event.mode === 1) && (event.kind === 0 || event.kind === 1))
          this.effects.adjustCurrency(event.kind, event.mode === 0 ? event.amount : -event.amount);
      } else if (event.type === "item") {
        if (event.mode === 0) {
          if (!this.giftAlreadyReceived(event.itemId, event.table ?? 4))
            this.effects.grantItem(event.itemId, event.quantity, event.table);
        } else this.effects.consumeItem(event.itemId, event.quantity, event.table);
      }
    }
  }
  /** Whether a replay must skip this gift; otherwise its receipt is written as it is paid. */
  private giftAlreadyReceived(itemId: number, table: number): boolean {
    // op19 specials keep their own rules (held once, eggs stack on purpose).
    if (!this.giftsOnce || table === 5) return false;
    const key = giftReceiptKey(this.ref.scene, this.ref.room, this.ref.group, table, itemId);
    if (this.paidThisRun.has(key)) return false;
    if (this.ledger.giftReceived(key)) return true;
    this.ledger.markGiftReceived(key);
    this.paidThisRun.add(key);
    return false;
  }
}
