/** What the boot loader shows: how many files it asked for and how many came back. */
export type BootProgressState = { loaded: number; total: number };

/**
 * Counts the pack files the startup path asks for. The boot loads in bursts — a list of names from
 * the manifest, then whatever those files point at — so `total` grows while the load runs. Nothing
 * here pretends the count is known up front; `fraction()` only ever moves forward so a late burst
 * cannot make the bar run backwards, and `loaded()/total()` are the honest numbers beside it.
 *
 * Only the startup phase is counted: `close()` ends it, and after that a pack load is ordinary
 * gameplay traffic (walking into a room) that would otherwise keep the number moving.
 */
export class BootProgress {
  private readonly requested = new Set<string>();
  private readonly completed = new Set<string>();
  private listeners: ((state: BootProgressState) => void)[] = [];
  private widestFraction = 0;
  private closed = false;

  get loaded(): number {
    return this.completed.size;
  }
  get total(): number {
    return this.requested.size;
  }
  /** Records that `url` is about to be fetched. Re-booking a finished file is a no-op. */
  book(url: string): void {
    if (this.closed || this.completed.has(url)) return;
    if (this.requested.has(url)) return;
    this.requested.add(url);
    this.notify();
  }

  /** Records that `url` came back. A file fetched outside the boot still lands in both sets. */
  complete(url: string): void {
    if (this.closed || this.completed.has(url)) return;
    this.requested.add(url);
    this.completed.add(url);
    this.notify();
  }

  /** `loaded / total` at its highest so far: 0 while nothing is known, and never lower than before. */
  fraction(): number {
    return this.widestFraction;
  }

  /** Stops counting: the world screens own the canvas from here. */
  close(): void {
    this.closed = true;
  }

  onChange(listener: (state: BootProgressState) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((candidate) => candidate !== listener);
    };
  }

  private notify(): void {
    const share = this.requested.size === 0 ? 0 : this.completed.size / this.requested.size;
    if (share > this.widestFraction) this.widestFraction = share;
    const state = { loaded: this.completed.size, total: this.requested.size };
    for (const listener of this.listeners) listener(state);
  }
}
