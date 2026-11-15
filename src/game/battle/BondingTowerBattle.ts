import type { SavedPet } from "../../persistence/save/GameSave";
import type { TowerFloor, TowerPetSpec } from "../meta/BondingTower";
import { doubleBattleOnScreen } from "./DoubleEventBattle";
import { createSinglePracticeBattle } from "./EventBattle";
import type { BattleServices } from "./engine/BattleServices";
import type { BattleCharms } from "./engine/BattleTypes";

export function createBondingTowerBattle(
  services: BattleServices,
  floor: TowerFloor,
  pets: Readonly<Record<string, TowerPetSpec>>,
  roster: readonly SavedPet[],
  playerActorSpriteId: number,
  fallTicks: (spriteId: number) => number,
  charms: BattleCharms | undefined,
) {
  const party: SavedPet[] = [];
  const player = roster.map((pet) => {
    const member = services.partyMember(pet);
    const skillIds = [...member.skillIds];
    const skillPp = services.progression.fullPp(skillIds);
    party.push({
      ...pet,
      currentHp: member.stats.hp,
      maxHp: member.stats.hp,
      experience: 0,
      skillIds,
      skillPp,
    });
    return { ...member, hp: undefined, skillPp };
  });
  const enemy = floor.team.map((id) => {
    const spec = pets[id];
    if (!spec) throw new Error(`Tower floor ${floor.floor} references unknown pet ${id}`);
    const member = services.encounterPet(id, floor.level, floor.quality, 1, { name: spec.name });
    const deck = towerDeck(services, floor, spec);
    const skillIds = deck.length ? deck : member.skillIds;
    if (!skillIds.some((skill) => (services.rules.damage.skillRow(skill)?.powerPercent ?? 0) > 0))
      throw new Error(`Tower floor ${floor.floor} pet ${id} has no damaging skill`);
    return {
      ...member,
      skillIds,
      physicalTraitId:
        floor.floor < 50 ? 0 : spec.role === "tank" ? 2 : spec.role === "fast" ? 8 : 4,
      statFactors: floor.factors,
      wideStats: true,
    };
  });
  const enemyProfile = { ...services.trainerProfile, itemBudget: 0 };
  const common = {
    player,
    enemy,
    charms,
    capturePolicy: "TRAINER_OWNED_FORBIDDEN",
    runAllowed: true,
    itemsAllowed: false,
    experienceAllowed: false,
  };
  if (floor.double)
    return {
      double: doubleBattleOnScreen(
        services,
        {
          ...common,
          controlsBoth: true,
          companion: [],
          enemyProfile,
          companionProfile: services.companionProfile,
        },
        `tower-${floor.floor}`,
        [],
        fallTicks,
      ),
    };
  return {
    single: createSinglePracticeBattle(
      services,
      { ...common, format: "1v1", kind: "trainer", captureAllowed: false },
      party,
      enemyProfile,
      -900 - floor.floor,
      playerActorSpriteId,
    ),
  };
}

function towerDeck(services: BattleServices, floor: TowerFloor, pet: TowerPetSpec): number[] {
  const { damage, web } = services.rules;
  const choices = pet.grants.flatMap((grant) => {
    if (grant.level > floor.level) return [];
    const skill = damage.skillRow(grant.id);
    if (!skill) return [];
    return [
      {
        ...grant,
        power: skill.powerPercent,
        description:
          damage.lietHoaRecord(grant.id)?.description ?? web?.skillDescription(grant.id) ?? "",
      },
    ];
  });
  const score = (grant: (typeof choices)[number]) => grant.level + (grant.signature ? 100 : 0);
  const utilityScore = (grant: (typeof choices)[number]) => {
    const healing = pet.role === "support" && /hồi.*(HP|máu)/i.test(grant.description);
    const control =
      pet.role === "control" && /giảm|độc|ngủ|giam|hóa đá|tê/i.test(grant.description);
    return score(grant) + (healing ? 500 : 0) + (control ? 200 : 0);
  };
  const attacks = choices.filter((grant) => grant.power > 0).sort((a, b) => score(b) - score(a));
  const utility =
    floor.floor >= 20
      ? choices
          .filter((grant) => grant.power <= 0)
          .sort((a, b) => utilityScore(b) - utilityScore(a))
      : [];
  const utilitySlots = ["support", "control", "tank"].includes(pet.role) ? 2 : 1;
  return [
    ...new Set(
      [
        ...attacks.slice(0, 1),
        ...utility.slice(0, utilitySlots),
        ...attacks,
        ...choices.sort((a, b) => b.level - a.level),
      ].map((grant) => grant.id),
    ),
  ].slice(0, 5);
}
