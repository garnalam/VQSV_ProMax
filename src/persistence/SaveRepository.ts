import { isGameSave, type GameSave } from "./save/GameSave";
import { upgradeSave } from "./save/migrations";
import { IndexedDbSaveStore, type SaveStore } from "./save/SaveStore";

export {
  CURRENT_SAVE_VERSION,
  isGameSave,
  type GameSave,
  type SavedPet,
  type StoryRecord,
} from "./save/GameSave";

const ACTIVE = "active";
const BACKUP = "backup";

/** Stable JSON for comparisons: object keys sorted, so key order never fakes a mismatch. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );
}

/**
 * Local save slot with the guarantees the Java `VqsvSaveRuntime` gives on desktop:
 * - the snapshot is validated before it is written;
 * - the previous valid save is rotated into a backup in the same atomic write;
 * - the written value is read back and compared in full before the save counts as successful;
 * - loading upgrades older schemas, and falls back to the backup when the primary is unusable.
 */
export class SaveRepository {
  constructor(private readonly store: SaveStore = new IndexedDbSaveStore()) {}

  async hasAnySave(): Promise<boolean> {
    return (
      (await this.store.get(ACTIVE)) !== undefined || (await this.store.get(BACKUP)) !== undefined
    );
  }

  async hasValidSave(): Promise<boolean> {
    return (await this.load()) !== undefined;
  }

  async deleteAll(): Promise<void> {
    await this.store.clear();
  }

  async save(value: GameSave): Promise<void> {
    if (!isGameSave(value)) throw new Error("Invalid VQSV save snapshot");
    const previous = upgradeSave(await this.store.get(ACTIVE)),
      entries: [string, unknown][] = [[ACTIVE, value]];
    if (previous) entries.unshift([BACKUP, previous]);
    await this.store.putAll(entries);
    const persisted = await this.store.get(ACTIVE);
    if (canonical(persisted) !== canonical(value))
      throw new Error("Save read-back validation failed");
  }

  /** The current save, upgraded to the latest schema; the backup when the primary is unusable. */
  async load(): Promise<GameSave | undefined> {
    return upgradeSave(await this.store.get(ACTIVE)) ?? upgradeSave(await this.store.get(BACKUP));
  }
}

/** @deprecated Former names, kept so older imports keep compiling. Use `SavedPet` / `GameSave`. */
export type { SavedPet as VqsvWebPet, GameSave as VqsvWebSave } from "./save/GameSave";
