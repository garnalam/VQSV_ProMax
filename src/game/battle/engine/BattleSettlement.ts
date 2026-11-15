import type { SavedPet } from "../../../persistence/save/GameSave";
import { decideCatchStorage } from "../BattleOutcomeEngine";
import { NO_HELD_ITEM } from "../HeldItems";
import { shinyApplies } from "../../../rendering/PetShinyPalette";
import { defaultShinyColor } from "../../../rendering/ShinyDesigns";
import type { BattleCore } from "./BattleCore";
import type { BattleOutcome } from "./BattleTypes";
import type { LevelUpResult, PetProgression } from "./PetProgression";

/** What a finished fight changed in the save, for the report screen. */
export type BattleSettlementReport = {
  outcome: BattleOutcome;
  /** Per player party member, in party order. */
  members: { experience: number; level: number; levelUp: LevelUpResult }[];
  /** The pet that joined the party, or `null`. `storage` says where it went. */
  caught: { pet: SavedPet; storage: "ROSTER" | "BANK" | "RELEASE" } | null;
  /** The whole party was restored after a loss (and the player goes back to the last save point). */
  restoredAfterLoss: boolean;
};

/**
 * Write a finished fight back into the save. `party` is the save's own list of pets, in the order the
 * fight was built from, and is changed in place; so is `inventory`.
 *
 * - HP and PP: what each pet walked out with.
 * - EXP: every pet's share, with its level-ups (stats, refills, new skills).
 * - A caught pet joins the roster while it has fewer than six, else the bank while it has room, else
 *   it is let go (`decideCatchStorage`); without a bank a seventh pet is let go.
 * - The bag: every count the fight spent.
 * - A loss (decided 2026-11-05): the whole party is restored to full, as the player is sent back to
 *   the last save point.
 */
export function settleBattle(
  core: BattleCore,
  party: SavedPet[],
  inventory: Record<string, number>,
  progression: PetProgression,
  bank?: { pets: SavedPet[]; capacity: number },
): BattleSettlementReport {
  const request = core.request;
  if (request.kind !== "ended") throw new Error("settle a fight only after it has ended");
  const outcome = request.outcome;
  party.forEach((pet, member) => {
    const unit = core.unit("player", member);
    pet.currentHp = unit.hp();
    pet.skillPp = (pet.skillIds ?? []).map((_, slot) => Math.max(0, unit.skillPp[slot] ?? 0));
  });
  const members = party.map((pet, member) => ({
    experience: outcome.experience[member] ?? 0,
    levelUp: progression.addExperience(pet, outcome.experience[member] ?? 0),
    level: 0,
  }));
  members.forEach((entry, member) => (entry.level = party[member].level));
  for (const [id, count] of Object.entries(core.bag())) inventory[String(id)] = count;

  let caught: BattleSettlementReport["caught"] = null;
  if (outcome.reason === "catch" && outcome.caught !== undefined) {
    const setup = core.enemySetup(outcome.caught),
      unit = core.unit("enemy", outcome.caught),
      pet: SavedPet = {
        slot: party.length,
        speciesId: setup.speciesId,
        level: setup.level,
        quality: setup.quality,
        nature: setup.nature,
        // A caught shiny keeps the colour it fought in.
        ...(shinyApplies(setup.nature)
          ? {
              shinyColor:
                setup.shinyColor ??
                defaultShinyColor(setup.spriteId ?? setup.speciesId, setup.nature),
            }
          : {}),
        currentHp: unit.hp(),
        maxHp: unit.maxHp(),
        experience: 0,
        visualSpriteId: setup.spriteId,
        skillIds: unit.skillIds.filter((id) => id >= 0),
        skillPp: unit.skillIds.flatMap((id, slot) => (id >= 0 ? [unit.skillPp[slot]] : [])),
        physicalTraitId: setup.physicalTraitId ?? -1,
        heldEquipmentId: NO_HELD_ITEM,
      },
      storage = decideCatchStorage({
        rosterSize: party.length,
        bankSize: bank?.pets.length ?? 0,
        bankCapacity: bank ? bank.capacity : 0,
      }).outcome;
    if (storage === "ROSTER") party.push(pet);
    else if (storage === "BANK" && bank) bank.pets.push({ ...pet, slot: bank.pets.length });
    caught = { pet, storage: storage as "ROSTER" | "BANK" | "RELEASE" };
  }

  const restoredAfterLoss = outcome.winner === "enemy";
  if (restoredAfterLoss) for (const pet of party) progression.restore(pet);
  return { outcome, members, caught, restoredAfterLoss };
}
