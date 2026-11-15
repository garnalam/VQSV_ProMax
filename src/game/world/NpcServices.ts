/**
 * JavaSE `VqsvSourceNpcDispatchFlow` (source `game.l` state 23): talking to a town's merchant,
 * pet-bank clerk or convenience envoy shows its line (`VqsvSourceNpcDialogueFlow`, `TextBox.dialog`
 * with the speaker's name) and then opens the service. A direct service (the convenience envoys)
 * skips the line; an ordinary NPC (`Continuation.NONE`) has only the line.
 *
 * The table is baked by `ExportWebNpcServices.java` (`story/npc-services.json`) from the chapter
 * runtimes' own `Entry[]` tables.
 */

export type NpcContinuation =
  /** `VqsvSourceNpcDispatchFlow.ordinary`: the line is all there is. */
  | "NONE"
  | "MATERIAL_SHOP"
  | "ITEM_SHOP"
  | "WORLD_MATERIAL_SHOP"
  | "WORLD_ITEM_SHOP"
  | "PET_BANK"
  | "CONVENIENCE_SHOP"
  /** A wharf captain: `openSourceWharfFromWorld` on the dock `wharf` names (Q0–Q4). */
  | "WHARF"
  /** `openCauVongShopFromWorld(s, actor, shopCategory)`. */
  | "CAU_VONG_SHOP"
  /** `openSourceConveniencePetstate(1)`: the evolve list straight away (Bắc Hải 56's counter). */
  | "CONVENIENCE_EVOLVE"
  /** `openCauVongIncubatorFromWorld`: the shared five-slot Cầu Vồng incubator. */
  | "CAU_VONG_INCUBATOR";

export type NpcService = {
  scene: number;
  room: number;
  actorId: number;
  dialogRow: number;
  speaker: string | null;
  text: string | null;
  continuation: NpcContinuation;
  /** `dialogueBeforeContinuation`. */
  dialogue: boolean;
  /** `BichThuyHubRuntime.isPetBankExpansionEnvoy`: the envoy whose menu adds the charm and bank rows. */
  bankExpansion: boolean;
  /** The dock (`sourceWharfIndex`, Q0–Q4) a WHARF captain opens. */
  wharf?: number;
  /** The category a CAU_VONG_SHOP opens: 0 items, 1 materials, 2 badges, 3 the mutation document. */
  shopCategory?: number;
  /** The chapter runtime whose table the row is: only the room's current owner's rows answer. */
  runtime?: string;
  /** `LeitaTempleEscort`: after the line, the hero is taken to `[scene, room, x, y, direction]`. */
  transport?: number[];
  /**
   * Web-only (owner 2026-11-15): in a cloud room an NPC with nothing else to say takes the hero back
   * to the room's entrance and lays the clouds out as they started.
   */
  cloudReturn?: boolean;
};

/**
 * One dock of `VqsvPanelRuntime` (`SOURCE_WHARF_TITLES` / `_LABELS` / `_ROUTES`): its title, the
 * destination rows (the last one, "Không ra hàng", closes the menu) and, per destination, the
 * nine-value route `{gateScene, gateRoom, gateGroup, targetScene, targetRoom, x, y, direction,
 * boatMode}` that `VqsvWharfTravelRuntime` sails.
 */
export type WharfDock = {
  index: number;
  title: string;
  labels: string[];
  routes: number[][];
};

export type NpcServicesDocument = {
  profileVersion: string;
  services: NpcService[];
  wharfs?: WharfDock[];
};

/** The service an actor of this room runs, if any (`firstRequested` over the room's table). */
export function npcServiceAt(
  doc: NpcServicesDocument | undefined,
  scene: number,
  room: number,
  actorId: number,
  /** The room's JavaSE owner (`JavaRoomRules.roomOwner`), when it has an owner table. */
  owner?: string,
): NpcService | undefined {
  return doc?.services.find(
    (service) =>
      service.scene === scene &&
      service.room === room &&
      service.actorId === actorId &&
      (owner === undefined || service.runtime === owner),
  );
}

/**
 * One service conversation: the typewriter line (2 characters a tick; 5 completes it, then 5
 * closes it, as `TextBox.dialog` + `waitForText`), then the continuation is handed to the host.
 */
export class NpcServiceFlow {
  visibleChars = 0;
  private doneTicks = 0;
  private ready = false;
  done = false;

  constructor(readonly service: NpcService) {
    if (!service.dialogue || !service.text) this.done = true;
  }

  get speaker(): string {
    return this.service.speaker ?? "";
  }
  get text(): string {
    return this.service.text ?? "";
  }

  tick(confirm: boolean): void {
    if (this.done) return;
    const length = this.text.length;
    if (confirm) {
      if (this.visibleChars < length) {
        this.visibleChars = length;
        this.ready = true;
      } else if (this.ready) this.done = true;
      return;
    }
    if (this.visibleChars < length) {
      this.visibleChars = Math.min(length, this.visibleChars + 2);
      this.doneTicks = 0;
      this.ready = false;
    } else if (++this.doneTicks > 38) this.ready = true;
  }
}
