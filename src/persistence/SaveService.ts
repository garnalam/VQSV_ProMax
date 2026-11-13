import type { GameSave } from "./save/GameSave";
import type { SaveRepository } from "./SaveRepository";

export type SaveOutcome = {
  onSuccess?: () => void;
  onFailure?: (error: unknown) => void;
};

/**
 * The one writer of the save slot during play. Writes run strictly one after another in request
 * order, so a later snapshot can never land before an earlier one, and a failed write does not
 * stop the ones queued behind it.
 *
 * The snapshot is taken by the caller at request time (the tick that asked to save); only the
 * storage work is deferred. Java's `VqsvSaveRuntime` writes synchronously inside the tick; the web
 * cannot block a tick on IndexedDB, so the world shows its "saving" phase until the outcome
 * callback reports back.
 */
export class SaveService {
  private queue: Promise<void> = Promise.resolve();
  private pendingCount = 0;

  constructor(private readonly repository: SaveRepository) {}

  /** Writes still queued or running. */
  get pending(): number {
    return this.pendingCount;
  }

  save(snapshot: GameSave, outcome: SaveOutcome = {}): void {
    this.pendingCount++;
    this.queue = this.queue
      .then(() => this.repository.save(snapshot))
      .then(
        () => outcome.onSuccess?.(),
        (error: unknown) => outcome.onFailure?.(error),
      )
      // A throwing callback must not reject the chain: every later write would be skipped.
      .catch((error: unknown) => console.error("VQSV save callback failed", error))
      .finally(() => {
        this.pendingCount--;
      });
  }

  /** Resolves once every write requested so far has finished (tests, and leaving a session). */
  flush(): Promise<void> {
    return this.queue;
  }
}
