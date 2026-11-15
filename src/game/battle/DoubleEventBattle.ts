import type { PackBattleAiEncounterRow } from "../../data/GameData";
import type { SavedPet } from "../../persistence/save/GameSave";
import type { SourceItemData } from "../story/GameAssets";
import { DoubleBattleRuntime } from "./DoubleBattleRuntime";
import { enumName } from "./ai/BattleAiEncounterCatalog";
import { BattleRandom } from "./BattleRandom";
import { DoubleBattleCore } from "./engine/DoubleBattleCore";
import type { BattleServices } from "./engine/BattleServices";
import type { BattleCharms, CombatantSetup } from "./engine/BattleTypes";
import type { DoubleBattleSetup } from "./engine/DoubleBattleTypes";
import type { LevelUpResult, PetProgression } from "./engine/PetProgression";
import {
  TAN_NGUYET_BOSS,
  TAN_NGUYET_LONG_MA,
  maMocBattleDeck,
  maMocBattleStats,
} from "./engine/TanNguyetLongMa";

/** `VqsvBattleEventDescriptor.runtimeEncounterQuality`: the phẩm chất an on-map challenge NPC is built at. */
const NPC_ENCOUNTER_QUALITY = 5;
const QUALITY_CLASSES = ["NPC", "ELITE_NPC", "GYM_TRAINER", "GYM_LEADER"];
/** `VqsvDoubleBattleRuntime`: at most three lent pets ride in slot 3. */
const COMPANION_LIMIT = 3;
/** `playerBattleOwners`: the first six roster pets are the ones a 2v2 can send out. */
const PLAYER_OWNER_LIMIT = 6;

/** `encounter().quality`, then `VqsvBattleRuntime.enemyQuality` over the scene and ownership. */
function enemyQuality(
  services: BattleServices,
  sceneId: number,
  trainerOwned: boolean,
  row: PackBattleAiEncounterRow | undefined,
): number {
  if (sceneId === services.enemyLevel.cauVongSceneId && trainerOwned) return NPC_ENCOUNTER_QUALITY;
  if (!row || !QUALITY_CLASSES.includes(enumName(row.encounter.encounterClass))) return -1;
  return (row.sourceLock?.sourceActorId ?? -1) >= 0 ? NPC_ENCOUNTER_QUALITY : -1;
}

/**
 * The fight a SIMULTANEOUS_2V2 encounter declares, laid out the way `VqsvDoubleBattleEventDescriptor
 * .request` and `VqsvDoubleBattleRuntime.enter` build it: the roster is the AI catalog's members
 * (`runtimeEncounterRoster`, not the decoded op37 record), each becomes an NPC pet
 * (`enemyFromEncounter` at the scene's level rule, then `applyAuthoredEnemyDeck` and the PRESET
 * thiên phú), the first six roster pets are the player's owners, and a non-gym fight lends
 * `companionRoster` (at most three, no deck) to slot 3.
 *
 * Talents that are not preset are rolled in `newDoubleBattleCore`, the way `newCore` rolls them.
 */
export function doubleBattleSetup(
  services: BattleServices,
  symbol: string,
  party: readonly SavedPet[],
  inventory: Record<string, number> = {},
  charms?: (trainerOwned: boolean) => BattleCharms | undefined,
): DoubleBattleSetup {
  const event = services.eventBattle(symbol);
  if (!event) throw new Error(`Missing 2v2 descriptor ${symbol}`);
  const row = services.catalog.encounterForDescriptor(
    event.sceneId,
    event.roomIndex,
    event.groupIndex,
    event.op67ActorId,
    event.op37Encounter,
  );
  if (!row)
    throw new Error(`Source battle descriptor lacks an A2 encounter identity: ${event.label}`);
  if (enumName(row.encounter.battleFormat) !== "SIMULTANEOUS_2V2")
    throw new Error(`${event.label} is not a simultaneous 2v2`);
  const key = row.encounter.encounterKey,
    kind = enumName(row.encounter.encounterClass),
    controlsBoth = kind === "GYM_TRAINER" || kind === "GYM_LEADER",
    trainerOwned = !!event.npcEnemyEntry,
    quality = enemyQuality(services, event.sceneId, trainerOwned, row);
  if (row.members.length < 2) throw new Error(`2v2 encounter ${key} needs at least two members`);
  const enemy: CombatantSetup[] = [];
  for (const [member, authored] of row.members.entries()) {
    const level = services.enemyLevel.forScene(event.sceneId, authored.sourceLevel);
    let pet = services.encounterPet(
      authored.sourceSpeciesId,
      level,
      quality,
      authored.sourceNature,
    );
    if (enumName(authored.physicalTraitMode) === "PRESET") {
      const runtimeId = services.talentRuntimeId(authored.physicalTraitKey);
      if (runtimeId === undefined)
        throw new Error(
          `Authored 2v2 member references inactive physical trait ${authored.physicalTraitKey}`,
        );
      pet = { ...pet, physicalTraitId: runtimeId };
    }
    const deck = services.catalog.deck(key, member + 1);
    if (deck.length > 0)
      pet = { ...pet, skillIds: [...deck], skillPp: services.progression.fullPp(deck) };
    enemy.push(pet);
  }
  const companion: CombatantSetup[] = [];
  if (!controlsBoth) {
    const lent = event.companionRoster;
    if (lent.length === 0 || lent.length % 3 !== 0)
      throw new Error(`2v2 companion roster is missing source triples for ${event.label}`);
    for (let index = 0; index < Math.min(COMPANION_LIMIT, lent.length / 3); index++)
      companion.push(
        services.encounterPet(lent[index * 3], lent[index * 3 + 1], -1, lent[index * 3 + 2]),
      );
  }
  const bag: Record<number, number> = {};
  for (const [id, count] of Object.entries(inventory)) bag[Number(id)] = count;
  return {
    controlsBoth,
    sceneId: event.sceneId,
    capturePolicy: trainerOwned ? "TRAINER_OWNED_FORBIDDEN" : "WILD_ALLOWED",
    player: party.slice(0, PLAYER_OWNER_LIMIT).map((pet) => services.partyMember(pet)),
    companion,
    enemy,
    enemyProfile: event.aiProfile,
    companionProfile: services.companionProfile,
    encounterKey: key,
    inventory: bag,
    charms: charms?.(trainerOwned),
  };
}

/** The symbol the boss fight rolls its enemy talents under (it has no descriptor). */
export const TAN_NGUYET_SYMBOL = "TAN_NGUYET_LONG_MA";

/**
 * `TanNguyetLongMaBossRuntime.battleRequest()` as `VqsvDoubleBattleRuntime.enter` builds it: Hoa Tiên
 * Tử (CV-089) and Tàn Nguyệt Long Ma, both level 50 (the scene's level rule) and nature 5, at the
 * species' own quality, the player commanding both slots, `BattleAiProfile.defaultFor(true)` and no
 * AI-v2 encounter. The boss stats and decks (`configureEncounterUnit`) are laid on by the core, after
 * the talent's permanent share, so they are written here only to show the fight as it will stand.
 */
export function tanNguyetBattleSetup(
  services: BattleServices,
  party: readonly SavedPet[],
  inventory: Record<string, number> = {},
  charms?: (trainerOwned: boolean) => BattleCharms | undefined,
): DoubleBattleSetup {
  const enemy = [TAN_NGUYET_BOSS.allySpeciesId, TAN_NGUYET_LONG_MA.speciesId].map((speciesId) => {
    const level = services.enemyLevel.forScene(TAN_NGUYET_BOSS.sceneId, TAN_NGUYET_BOSS.bossLevel),
      pet = services.encounterPet(speciesId, level, -1, TAN_NGUYET_BOSS.nature),
      deck = maMocBattleDeck(speciesId) ?? pet.skillIds;
    return {
      ...pet,
      stats: maMocBattleStats(speciesId, pet.stats),
      skillIds: [...deck],
      skillPp: services.progression.fullPp(deck),
    };
  });
  const bag: Record<number, number> = {};
  for (const [id, count] of Object.entries(inventory)) bag[Number(id)] = count;
  return {
    controlsBoth: true,
    sceneId: TAN_NGUYET_BOSS.sceneId,
    capturePolicy: "TRAINER_OWNED_FORBIDDEN",
    player: party.slice(0, PLAYER_OWNER_LIMIT).map((pet) => services.partyMember(pet)),
    companion: [],
    enemy,
    enemyProfile: services.trainerProfile,
    companionProfile: services.companionProfile,
    inventory: bag,
    charms: charms?.(true),
    boss: "tan-nguyet-long-ma",
  };
}

/**
 * `TanNguyetLongMaBossRuntime.challengeBlockReason`: six pets in the roster, every one of them level
 * 50 or higher; `null` when the challenge may start.
 */
export function tanNguyetChallengeBlock(party: readonly SavedPet[]): string | null {
  if (party.length < TAN_NGUYET_BOSS.requiredPartySize)
    return `Cần đủ 6 sủng vật trong đội hình để khiêu chiến Tàn Nguyệt Long Ma. Hiện có: ${party.length}/6.`;
  const below = party
    .slice(0, TAN_NGUYET_BOSS.requiredPartySize)
    .filter((pet) => !pet || pet.level < TAN_NGUYET_BOSS.requiredPetLevel).length;
  return below === 0
    ? null
    : `Cả 6 sủng vật phải đạt cấp 50 mới có thể khiêu chiến Tàn Nguyệt Long Ma. Chưa đạt: ${below} pet.`;
}

/** A 2v2 on the web rules: enemy and companion talents rolled from the fight's identity, as `newCore` does. */
export function newDoubleBattleCore(
  services: BattleServices,
  setup: DoubleBattleSetup,
  symbol: string,
  seed = services.seedSource(),
): DoubleBattleCore {
  return new DoubleBattleCore(
    services.rules,
    {
      items: services.items,
      skillRules: services.doubleSkillRules,
      rulebook: services.rulebook,
      catalog: services.catalog,
    },
    {
      ...setup,
      badgeProfile: setup.badgeProfile ?? services.badgeProfile(),
      goldenPartyExperiencePercent: setup.goldenPartyExperiencePercent ?? services.goldenPartyExperiencePercent(),
      enemy: setup.enemy.map((pet, member) => services.enemyTalentPet(pet, member, symbol, seed)),
      companion: setup.companion.map((pet, index) =>
        services.enemyTalentPet(pet, setup.enemy.length + index, symbol, seed),
      ),
    },
    new BattleRandom(seed),
  );
}

/**
 * `VqsvDoubleBattleRuntime.actionDeathDuration`: a Cầu Vồng visual falls for its whole state-2
 * animation, any other sprite for a quarter of its idle height (at least 4 ticks, 8 without one).
 */
export function doubleBattleFallTicks(
  sprites: {
    animationTicks(sprite: number, state: number): number;
    animationBounds(sprite: number, state: number): { height: number } | undefined | null;
  },
  spriteId: number,
): number {
  if (spriteId >= 1000 && spriteId < 1102) return Math.max(1, sprites.animationTicks(spriteId, 2));
  const bounds = sprites.animationBounds(spriteId, 0);
  return bounds && bounds.height > 0 ? Math.max(4, Math.floor(bounds.height / 4)) : 8;
}

/** What a finished 2v2 changed in the save, per player battle owner. */
export type DoubleSettlement = {
  winner: "player" | "enemy";
  members: { experience: number; levelUp: LevelUpResult }[];
  /** The direct EXP the owners earned (`var2`, which `cauVongIncubation.advanceExperience` reads). */
  direct: number;
};

/**
 * `VqsvDoubleBattleRuntime.finish` → `persistRosterUnits` + `applyDeferredDoubleBattleProgression`,
 * written into the save (`party` and `inventory` change in place):
 * - HP and PP of each battle owner (the first six roster pets) as it walked out;
 * - on a win, each owner's direct + benched EXP with its level-ups (new skills, or pending when the
 *   four slots are full — the skill dashboard asks, as in 1v1);
 * - the bag as the fight left it;
 * - a loss restores the whole party, as the web does for every loss (`BattleLossWorldService`).
 */
export function settleDoubleBattle(
  core: DoubleBattleCore,
  party: SavedPet[],
  inventory: Record<string, number>,
  progression: PetProgression,
): DoubleSettlement {
  const request = core.request;
  if (request.kind !== "ended") throw new Error("settle a 2v2 only after it has ended");
  const outcome = request.outcome;
  if (outcome.winner === "none") throw new Error("a retreat has no 2v2 settlement");
  const owners = party.slice(0, core.playerCount);
  owners.forEach((pet, member) => {
    const unit = core.playerUnit(member);
    pet.currentHp = unit.hp();
    pet.skillPp = (pet.skillIds ?? []).map((_, slot) => Math.max(0, unit.skillPp[slot] ?? 0));
  });
  const members = owners.map((pet, member) => {
    const experience =
      outcome.winner === "player"
        ? (outcome.experience[member] ?? 0) + (outcome.reserveExperience[member] ?? 0)
        : 0;
    return { experience, levelUp: progression.addExperience(pet, experience) };
  });
  for (const [id, count] of Object.entries(core.bag())) inventory[String(id)] = count;
  if (outcome.winner === "enemy") for (const pet of party) progression.restore(pet);
  const direct =
    outcome.winner === "player"
      ? owners.reduce((sum, _, member) => sum + (outcome.experience[member] ?? 0), 0)
      : 0;
  return { winner: outcome.winner, members, direct };
}

/**
 * A 2v2 fight ready for the screen: the setup above on a fresh core, under the runtime that plays its
 * beats and menus. `fallTicks` is `actionDeathDuration` for a sprite, which reads the sprite sheets.
 */
export function createDoubleBattle(
  services: BattleServices,
  symbol: string,
  party: readonly SavedPet[],
  inventory: Record<string, number>,
  items: readonly SourceItemData[],
  fallTicks: (spriteId: number) => number,
  charms?: (trainerOwned: boolean) => BattleCharms | undefined,
  seed?: number,
): DoubleBattleRuntime {
  return doubleBattleOnScreen(
    services,
    doubleBattleSetup(services, symbol, party, inventory, charms),
    symbol,
    items,
    fallTicks,
    seed,
  );
}

/** The Tàn Nguyệt Long Ma fight ready for the screen (`TanNguyetLongMaBossRuntime.startBattle`). */
export function createTanNguyetBattle(
  services: BattleServices,
  party: readonly SavedPet[],
  inventory: Record<string, number>,
  items: readonly SourceItemData[],
  fallTicks: (spriteId: number) => number,
  charms?: (trainerOwned: boolean) => BattleCharms | undefined,
  seed?: number,
): DoubleBattleRuntime {
  return doubleBattleOnScreen(
    services,
    tanNguyetBattleSetup(services, party, inventory, charms),
    TAN_NGUYET_SYMBOL,
    items,
    fallTicks,
    seed,
  );
}

export function doubleBattleOnScreen(
  services: BattleServices,
  setup: DoubleBattleSetup,
  symbol: string,
  items: readonly SourceItemData[],
  fallTicks: (spriteId: number) => number,
  seed?: number,
): DoubleBattleRuntime {
  const catalog = new Map(items.map((item) => [item.id, item]));
  return new DoubleBattleRuntime(
    newDoubleBattleCore(services, setup, symbol, seed),
    services.rules,
    {
      items: services.items,
      itemInfo: (itemId) => catalog.get(itemId),
      speciesName: (speciesId) => services.speciesRow(speciesId)?.name,
      speciesElement: (speciesId) => services.speciesRow(speciesId)?.element ?? 0,
      fallTicks,
    },
  );
}
