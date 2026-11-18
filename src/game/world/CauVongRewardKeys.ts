// Web only: which ledger keys a story rewind (StoryJournal) keeps.
//
// The owner's rule (2026-11-18): a rewound stretch of story is as if it had never been played (its
// fights, scenes and item rewards all come back), but the player's pets stay as they are. So only
// the receipts that stand for a pet the player already owns survive, so that a replay does not hand
// the same pet over twice:
// - every Cầu Vồng step that grants a pet (`{k:"pet", receipt, species}`, the cafe and Đông pets),
// - the ride ownership marks (98:0:700100+ride),
// - the summon boss rewards and pets (653000+event, 653000+n in room 51).
// Item, money and quest-item receipts are cleared and paid again, so the story never waits on a
// quest item the player has already spent.

import { RAINBOW_RIDE_OWNED_EVENT } from "../ride/RideSystem";
import { CAFE_ROOM } from "./CauVongPrep";

/** `CauVongSummoning` REWARD: a boss's reward receipt is 653000 + its event. */
const SUMMON_REWARD = 653000;
/** The prep document's pet grants without a room of their own are paid in the cafe. */
const ROOMLESS_RECEIPT_ROOM = CAFE_ROOM;

/** Every pet-granting `receipt` in the Cầu Vồng documents, keyed by the room it is written in. */
export function cauVongPetReceiptKeys(documents: readonly unknown[]): Set<string> {
  const keys = new Set<string>();
  const walk = (value: unknown, room: number | undefined): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, room);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    const here = typeof node.room === "number" ? node.room : room;
    if (typeof node.receipt === "number" && typeof node.species === "number")
      keys.add(`98:${here ?? ROOMLESS_RECEIPT_ROOM}:${node.receipt}`);
    for (const child of Object.values(node)) walk(child, here);
  };
  for (const document of documents) walk(document, undefined);
  return keys;
}

/** The predicate the rewind uses: true for a key that must survive (a pet the player owns). */
export function rewardKeyPredicate(documents: readonly unknown[]): (key: string) => boolean {
  const pets = cauVongPetReceiptKeys(documents);
  return (key) => {
    if (!key.startsWith("98:")) return false;
    if (pets.has(key)) return true;
    const event = Number(key.slice(key.lastIndexOf(":") + 1));
    if (key.startsWith("98:0:") && event >= RAINBOW_RIDE_OWNED_EVENT && event < RAINBOW_RIDE_OWNED_EVENT + 100)
      return true;
    return event >= SUMMON_REWARD && event < SUMMON_REWARD + 1000;
  };
}
