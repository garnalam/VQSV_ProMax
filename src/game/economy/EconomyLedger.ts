import type { SavedPet } from "../../persistence/save/GameSave";

/**
 * Web only (owner, 2026-11-16): where each player's money and pets came from. The session watches
 * the money and every pet (party and bank) after each tick and before each save; a change becomes a
 * line with the source the game was in at that moment (a fight, an event, a shop, a panel, a
 * letter). The save carries the lines, and the server (`server/ledger.mjs`) checks the next save
 * against the one before it and warns the admin about money or pets nothing explains.
 *
 * A pet is followed by its `uid`, given the first time the ledger sees it. A pet already owned
 * when the ledger first watches (an older save, one the admin added) is logged as "baseline".
 */
export type LedgerEntry = {
  seq: number;
  /** Epoch milliseconds. */
  t: number;
  kind: "money" | "pet+" | "pet-";
  amount?: number;
  balance?: number;
  pet?: { uid: string; speciesId: number; level: number; quality: number; nature?: number };
  source: string;
};
export type LedgerSnapshot = { seq: number; entries: LedgerEntry[] };

/** Lines kept in the save; the server reads only the ones newer than the save it already has. */
export const LEDGER_KEEP = 400;

const newUid = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
};

const card = (pet: SavedPet & { uid: string }) => ({
  uid: pet.uid,
  speciesId: pet.speciesId,
  level: pet.level,
  quality: pet.quality,
  ...(pet.nature === undefined ? {} : { nature: pet.nature }),
});

export class EconomyLedger {
  private seq = 0;
  private entries: LedgerEntry[] = [];
  private money: number | null = null;
  private owned = new Map<string, SavedPet & { uid: string }>();
  /** A source a panel or a server reply named for the next change (a letter, a gift code). */
  private hint: { source: string; until: number } | null = null;

  constructor(
    snapshot?: LedgerSnapshot,
    private readonly clock: () => number = Date.now,
  ) {
    if (snapshot && Number.isSafeInteger(snapshot.seq)) {
      this.seq = snapshot.seq;
      this.entries = Array.isArray(snapshot.entries) ? snapshot.entries.slice(-LEDGER_KEEP) : [];
    }
  }

  /** Names the source of the changes the next few observations find (`mail:12`, `gift:CODE`). */
  expect(source: string, ticks = 30): void {
    this.hint = { source, until: ticks };
  }

  /**
   * Compares the money and pets with the last look and writes a line for each change. The first
   * look only learns the state; pets without a uid get one there and are logged as "baseline".
   */
  observe(money: number, pets: readonly SavedPet[], context: string): void {
    const source = this.hint?.source ?? context,
      first = this.money === null;
    if (this.hint && --this.hint.until <= 0) this.hint = null;
    if (!first && money !== this.money) this.push({ kind: "money", amount: money - this.money!, balance: money, source });
    this.money = money;
    const seen = new Map<string, SavedPet & { uid: string }>();
    for (const pet of pets) {
      const owned = pet as SavedPet & { uid?: string };
      if (!owned.uid || seen.has(owned.uid)) {
        owned.uid = newUid();
        this.push({ kind: "pet+", pet: card(owned as SavedPet & { uid: string }), source: first ? "baseline" : source });
      } else if (!first && !this.owned.has(owned.uid))
        // A uid the ledger did not know: a pet that came back from elsewhere (a letter's pet,
        // another tab). Logged as gained here; the server checks it against the last save.
        this.push({ kind: "pet+", pet: card(owned as SavedPet & { uid: string }), source });
      seen.set(owned.uid!, owned as SavedPet & { uid: string });
    }
    if (!first)
      for (const [uid, pet] of this.owned)
        if (!seen.has(uid)) this.push({ kind: "pet-", pet: card(pet), source });
    this.owned = seen;
  }

  snapshot(): LedgerSnapshot {
    return { seq: this.seq, entries: this.entries.map((entry) => ({ ...entry })) };
  }

  private push(line: Omit<LedgerEntry, "seq" | "t">): void {
    this.entries.push({ seq: ++this.seq, t: this.clock(), ...line });
    if (this.entries.length > LEDGER_KEEP) this.entries.splice(0, this.entries.length - LEDGER_KEEP);
  }
}
