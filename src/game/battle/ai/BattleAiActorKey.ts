/**
 * `vqsv.battle.ai.v2.BattleAiActorKey` — the battle-local identity memory and observation use.
 *
 * A key is a side plus a stable member name (`NPC-M01`, `PLAYER-M02`); its `toString()` is the text
 * the memory canonicalises events with, so it is part of the parity and not a display convenience.
 */
export type BattleAiSide = "NPC" | "PLAYER";

/** Java's enum order: `NPC` sorts before `PLAYER`, and that order drives candidate sorting. */
const SIDE_ORDER: readonly BattleAiSide[] = ["NPC", "PLAYER"];

export class BattleAiActorKey {
  readonly side: BattleAiSide;
  readonly stableKey: string;

  private constructor(side: BattleAiSide, stableKey: string) {
    const key = stableKey.trim();
    if (key === "" || key.includes("\t") || key.includes("\n")) {
      throw new Error("Invalid battle AI actor key");
    }
    this.side = side;
    this.stableKey = key;
  }

  static of(side: BattleAiSide, stableKey: string): BattleAiActorKey {
    return new BattleAiActorKey(side, stableKey);
  }

  /** `BattleAiActorKey.npcMember`: `NPC-M%02d` over the 1-based roster slot. */
  static npcMember(memberSlot: number): BattleAiActorKey {
    if (memberSlot < 1) throw new Error("NPC member slot must be positive");
    return new BattleAiActorKey("NPC", `NPC-M${String(memberSlot).padStart(2, "0")}`);
  }

  /** `BattleAiActorKey.playerMember`: `PLAYER-M%02d` over the original roster slot. */
  static playerMember(originalRosterSlot: number): BattleAiActorKey {
    if (originalRosterSlot < 1) throw new Error("Player member slot must be positive");
    return new BattleAiActorKey("PLAYER", `PLAYER-M${String(originalRosterSlot).padStart(2, "0")}`);
  }

  toString(): string {
    return `${this.side}:${this.stableKey}`;
  }

  equals(other: BattleAiActorKey | undefined | null): boolean {
    return other !== undefined && other !== null && this.compareTo(other) === 0;
  }

  /** `compareTo`: side first, then the stable key. */
  compareTo(other: BattleAiActorKey): number {
    const sideOrder = SIDE_ORDER.indexOf(this.side) - SIDE_ORDER.indexOf(other.side);
    if (sideOrder !== 0) return sideOrder;
    return this.stableKey < other.stableKey ? -1 : this.stableKey > other.stableKey ? 1 : 0;
  }
}
