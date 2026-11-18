import type {
  PackBattleAiEncounterRow,
  PackBattleAiProfile,
  PackBattleEvent,
} from "../../data/GameData";
import { RUNTIME_MODES } from "./ai/BattleAiV2RuntimeSelector";
import { BattleRandom } from "./BattleRandom";
import { AiV2EnemyController } from "./engine/AiV2EnemyController";
import { BattleCore } from "./engine/BattleCore";
import { BasicEnemyAi } from "./engine/EnemyController";
import type { SavedPet } from "../../persistence/save/GameSave";
import { DivinePetSeal } from "../pet/DivinePetSeal";
import { rollShinyColor } from "../../rendering/ShinyDesigns";
import type { BattleContext } from "../story/SourceOpcodeInterpreter";
import type { SourceItemData } from "../story/GameAssets";
import type { GroupRef } from "../world/WorldEventCatalog";
import { enumName } from "./ai/BattleAiEncounterCatalog";
import { BattleDefinitionRegistry, type BattleDefinition } from "./BattleDefinition";
import { BattleRuntime } from "./BattleRuntime";
import { BATTLE_SEATS } from "./BattleSeats";
import { KIM_DIEM_INTRO_TICKS } from "./KimDiemPresentation";
import type { BattleCharms, BattleKind, BattleSetup, CombatantSetup } from "./engine/BattleTypes";
import { ENCOUNTER_NATURE_FALLBACK } from "./engine/BattleTypes";
import { settleBattle } from "./engine/BattleSettlement";
import type { BattleServices } from "./engine/BattleServices";

/**
 * One op32 battle, as the Java engine declared it, with the constant name its dump row is keyed by.
 */
export type EventBattleDescriptor = PackBattleEvent & { symbol: string };

/** `VqsvBattleEventDescriptor.runtimeEncounterQuality`: the phẩm chất an on-map challenge NPC is built at. */
const NPC_ENCOUNTER_QUALITY = 5;
/** The encounter classes that answer to a trainer on the map rather than to a script. */
const QUALITY_CLASSES = ["NPC", "ELITE_NPC", "GYM_TRAINER", "GYM_LEADER"];

type ResolvedEventBattle =
  | { ok: true; event: EventBattleDescriptor; row: PackBattleAiEncounterRow }
  | { ok: false; why: string };

/**
 * The two rows a source fight needs: the op32 descriptor the group declares and the A2 encounter the
 * AI catalog locks to that same (scene, room, group, actor, roster). Java reads the pair in
 * `VqsvBattleEventDescriptor.request()` and refuses a fight with no A2 row, because everything that
 * makes the enemy side — its roster, its thiên phú, its brain — comes from that row.
 */
function resolve(services: BattleServices, group: GroupRef, actorId: number): ResolvedEventBattle {
  const event = services.eventBattleAt(group.scene, group.room, group.group, actorId);
  if (!event)
    return {
      ok: false,
      why: `${group.scene}:${group.room}:${group.group} has no battle record for actor ${actorId}`,
    };
  const row = services.catalog.encounterForDescriptor(
    group.scene,
    group.room,
    group.group,
    event.op67ActorId,
    event.op37Encounter,
  );
  if (!row)
    return {
      ok: false,
      why: `Source battle descriptor lacks an A2 encounter identity: ${event.label}`,
    };
  return { ok: true, event, row };
}

/** The A2 encounter row an event group's fight is built from (`aiV2Encounter`), if it has one. */
export function eventBattleEncounter(
  services: BattleServices,
  group: GroupRef,
  actorId: number,
): PackBattleAiEncounterRow | undefined {
  const resolved = resolve(services, group, actorId);
  return resolved.ok ? resolved.row : undefined;
}

/** `enemyPartyFromEncounter`: three ints per pet, and a ragged or short record still seats one. */
function memberCount(encounter: readonly number[]): number {
  return encounter.length > 3 && encounter.length % 3 === 0 ? encounter.length / 3 : 1;
}

/** `VqsvBattleEventDescriptor.runtimeEncounterQuality`, over the authored encounter class and its lock. */
function encounterQuality(row: PackBattleAiEncounterRow): number {
  if (!QUALITY_CLASSES.includes(enumName(row.encounter.encounterClass))) return -1;
  return (row.sourceLock?.sourceActorId ?? -1) >= 0 ? NPC_ENCOUNTER_QUALITY : -1;
}

/**
 * `VqsvBattleRuntime.effectiveEnemyLevel`: the Cầu Vồng chapter authored its levels already boosted,
 * any other region takes the AI bundle's projection for that member when the species and level still
 * match, and everything else is held to the ordinary cap.
 */
function enemyLevel(
  services: BattleServices,
  sceneId: number,
  member: PackBattleAiEncounterRow["members"][number] | undefined,
  speciesId: number,
  sourceLevel: number,
): number {
  if (sceneId === services.enemyLevel.cauVongSceneId)
    return services.enemyLevel.clampEnemy(sourceLevel);
  if (member && member.sourceSpeciesId === speciesId && member.sourceLevel === sourceLevel)
    return member.effectiveLevel;
  return services.enemyLevel.forScene(sceneId, sourceLevel);
}

/** Why this build cannot run the fight the group declares (no descriptor / no A2 row), or null. */
export function unsupportedEventBattle(
  services: BattleServices,
  group: GroupRef,
  actorId: number,
): string | null {
  const resolved = resolve(services, group, actorId);
  return resolved.ok ? null : resolved.why;
}

/**
 * Web rule (owner, 2026-11-16): a gym's 2v2 (`GYM_TRAINER` / `GYM_LEADER`, scene 9) has the player
 * command both slots, so it needs two living pets. Java falls back to a 1v1 on the decoded roster
 * with fewer; the web refuses the fight instead (`WorldRuntime.startEvent` says why).
 */
export function gymDoubleNeedsPair(
  services: BattleServices,
  group: GroupRef,
  actorId: number,
  party: readonly SavedPet[],
): boolean {
  const resolved = resolve(services, group, actorId);
  if (!resolved.ok || enumName(resolved.row.encounter.battleFormat) !== "SIMULTANEOUS_2V2")
    return false;
  const kind = enumName(resolved.row.encounter.encounterClass);
  return (
    (kind === "GYM_TRAINER" || kind === "GYM_LEADER") &&
    party.filter((pet) => (pet.currentHp ?? 1) > 0).length < 2
  );
}

/**
 * The 2v2 descriptor to seat for this fight, or null for an ordinary 1v1.
 *
 * `VqsvBattleEventDescriptor.request`: every SIMULTANEOUS_2V2 encounter is fought 2v2. A gym needs
 * two living pets (`gymDoubleNeedsPair`: the world does not start it with fewer). The one non-gym 2v2 (Bích Thủy WS-2's soldiers, `SCENE2_ROOM0_GROUP1_SOLDIERS`) needs only one:
 * the player commands slot 2 and Harry's lent pets hold slot 3 under the COMPANION AI.
 */
export function doubleEventBattleSymbol(
  services: BattleServices,
  group: GroupRef,
  actorId: number,
  party: readonly SavedPet[],
): string | null {
  const resolved = resolve(services, group, actorId);
  if (!resolved.ok || enumName(resolved.row.encounter.battleFormat) !== "SIMULTANEOUS_2V2")
    return null;
  const kind = enumName(resolved.row.encounter.encounterClass),
    gym = kind === "GYM_TRAINER" || kind === "GYM_LEADER",
    living = party.filter((pet) => (pet.currentHp ?? 1) > 0).length;
  return living >= (gym ? 2 : 1) ? resolved.event.symbol : null;
}

/**
 * The fight one event group's op32 declares, on the battle core and driven entirely by pack data: the
 * descriptor for its roster and gates, the AI catalog for the enemy's levels, thiên phú and brain.
 *
 * The authored timeline a source fight needs is the same one any core fight uses — the core reports
 * every event, so nothing here knows the elder, the gym or any other battle by name.
 */
export function createEventBattle(
  services: BattleServices,
  group: GroupRef,
  context: BattleContext,
  party: SavedPet[],
  inventory: Record<string, number>,
  items: readonly SourceItemData[] = [],
  presentation?: { playerActorSpriteId: number; enemyActorSpriteId: number },
  /** The team charms for a fight of this kind (`trainerOwned`: `TRAINER_OWNED_FORBIDDEN`). */
  charms?: (trainerOwned: boolean) => BattleCharms | undefined,
  shopCurrency?: { money: number; badges: number },
): BattleRuntime {
  const resolved = resolve(services, group, context.actorId);
  if (!resolved.ok)
    throw new Error(
      `cannot run the battle of ${group.scene}:${group.room}:${group.group}: ${resolved.why}`,
    );
  const { event, row } = resolved,
    quality = encounterQuality(row),
    enemy = buildEnemy(services, event, row, quality),
    // The core seats the first living pet, so the authored combatant has to describe that one.
    player = party.find((pet) => (pet.currentHp ?? 1) > 0) ?? party[0],
    playerSetup = services.partyMember(player),
    bag: Record<number, number> = {};
  for (const [id, count] of Object.entries(inventory)) bag[Number(id)] = count;
  const captureAllowed = !event.npcEnemyEntry && event.op32Mode[0] !== 2,
    kind: BattleKind = event.npcEnemyEntry ? "trainer" : "wild",
    setup: BattleSetup = {
      format: "1v1",
      kind,
      captureAllowed,
      runAllowed: event.op32Mode[1] === 0,
      player: party.map((pet) => services.partyMember(pet)),
      enemy,
      inventory: bag,
      charms: charms?.(!!event.npcEnemyEntry),
      sceneId: event.sceneId,
      capturePolicy: event.npcEnemyEntry ? "TRAINER_OWNED_FORBIDDEN" : "WILD_ALLOWED",
    },
    core = services.newCore(setup, event.symbol),
    definition = coreDefinition({
      id: `source-encounter-${context.encounter.join("-")}`,
      player,
      playerSetup,
      enemy,
      npcEntry: event.npcEnemyEntry,
      presentation,
      partySize: party.length,
      captureAllowed,
      captureSuccessResultIndex: event.captureSuccessResultIndex,
    });
  return new BattleRuntime(
    {
      actorId: context.actorId,
      encounter: context.encounter,
      flags: context.flags,
      mode: context.mode,
      branchTargets: context.branchTargets,
    },
    new BattleDefinitionRegistry([definition]),
    services.rules,
    undefined,
    [],
    items,
    {
      core,
      party,
      services,
      settle: () =>
        settleBattle(core, party, inventory, services.progression, services.petBank?.()),
      entryPresentation: true,
      shopCurrency,
    },
  );
}

/** JavaSE `repeatableRequest`: reuse an authored descriptor without running its room event group. */
export function createRepeatableBattle(
  services: BattleServices,
  descriptorSymbol: string,
  party: SavedPet[],
  inventory: Record<string, number>,
  items: readonly SourceItemData[] = [],
  presentation?: { playerActorSpriteId: number; enemyActorSpriteId: number },
  charms?: (trainerOwned: boolean) => BattleCharms | undefined,
  shopCurrency?: { money: number; badges: number },
): { battle: BattleRuntime; encounter: PackBattleAiEncounterRow } {
  const event = services.eventBattle(descriptorSymbol);
  if (!event) throw new Error(`Missing repeatable descriptor ${descriptorSymbol}`);
  const group = { scene: event.sceneId, room: event.roomIndex, group: event.groupIndex },
    context: BattleContext = {
      actorId: event.op67ActorId,
      encounter: [
        event.op37Encounter[0] ?? 0,
        event.op37Encounter[1] ?? 0,
        event.op37Encounter[2] ?? 0,
      ],
      flags: [event.battleFlags[0] ?? 0, event.battleFlags[1] ?? 0],
      mode: [event.op32Mode[0] ?? 0, event.op32Mode[1] ?? 0],
      branchTargets: [...event.op47BranchTargets],
    },
    encounter = eventBattleEncounter(services, group, context.actorId);
  if (!encounter) throw new Error(`Repeatable descriptor has no encounter ${descriptorSymbol}`);
  return {
    battle: createEventBattle(
      services,
      group,
      context,
      party,
      inventory,
      items,
      presentation,
      charms,
      shopCurrency,
    ),
    encounter,
  };
}

/**
 * A free-world random encounter (`VqsvFreeWorldEncounterProducer`): one wild pet, catchable, with the
 * default enemy brain and no descriptor; running away is allowed except in room 3:7.
 */
export function createWildBattle(
  services: BattleServices,
  request: { speciesId: number; level: number; nature: number; quality: number },
  party: SavedPet[],
  inventory: Record<string, number>,
  runAllowed: boolean,
  items: readonly SourceItemData[] = [],
  presentation?: { playerActorSpriteId: number; enemyActorSpriteId: number },
  charms?: BattleCharms,
  shopCurrency?: { money: number; badges: number },
): BattleRuntime {
  const wild = services.encounterPet(
    request.speciesId,
    request.level,
    Math.max(1, request.quality),
    request.nature >= 0 ? request.nature : ENCOUNTER_NATURE_FALLBACK,
  );
  // A wild shiny comes in any of the 13 colours (the Đồ giám has a page for each); the colour is
  // kept on the setup, so a catch keeps the colour the fight showed.
  if (wild.nature >= 7 && wild.nature <= 9 && wild.shinyColor === undefined)
    wild.shinyColor = rollShinyColor();
  const enemy = [wild],
    player = party.find((pet) => (pet.currentHp ?? 1) > 0) ?? party[0],
    playerSetup = services.partyMember(player),
    bag: Record<number, number> = {};
  for (const [id, count] of Object.entries(inventory)) bag[Number(id)] = count;
  const core = services.newCore({
      format: "1v1",
      kind: "wild",
      captureAllowed: true,
      runAllowed,
      player: party.map((pet) => services.partyMember(pet)),
      enemy,
      inventory: bag,
      charms,
    }),
    // `BattleDefinitionRegistry.resolve` keys a fight by its context triple.
    encounter: [number, number, number] = [request.speciesId, request.level, request.nature],
    definition = coreDefinition({
      id: `source-encounter-${encounter.join("-")}`,
      player,
      playerSetup,
      enemy,
      npcEntry: false,
      presentation,
      partySize: party.length,
      captureAllowed: true,
    });
  return new BattleRuntime(
    {
      actorId: request.speciesId,
      // The context records the source triple; the stars ride on the core's enemy seat.
      encounter,
      flags: [0, 1],
      mode: [0, 0],
      branchTargets: [],
    },
    new BattleDefinitionRegistry([definition]),
    services.rules,
    undefined,
    [],
    items,
    {
      core,
      party,
      services,
      settle: () =>
        settleBattle(core, party, inventory, services.progression, services.petBank?.()),
      entryPresentation: true,
      shopCurrency,
    },
  );
}

/**
 * A Cầu Vồng trainer the chapter runtime asks for directly (`new BattleRequest(2,
 * CauVongSourceBattleCatalog.encounter(rows), Flags(1,1), Mode(0,2), ..., npcEnemyEntry=true)`): the
 * roster is boss.d's, its levels already boosted (only clamped here), no A2 row; a trainer's pets
 * cannot be caught and `Mode(0,2)` forbids running.
 *
 * Every Cầu Vồng request is baked with what `VqsvBattleRuntime.enterBattle` makes of the roster:
 * `quality` (`enemyQuality`: 5 for a trainer in scene 98), each member's deck
 * (`CauVongEnemySkillDecks` and `EarthPetrificationPriority.ensureDeck`) and the request's AI
 * profile (`profile`, resolved from its baked `tier`), which the enemy's brain then runs on.
 */
export function createSourceTrainerBattle(
  services: BattleServices,
  request: {
    label: string;
    members: readonly (readonly [number, number, number])[];
    quality?: number;
    skills?: readonly (readonly number[])[];
    profile?: PackBattleAiProfile;
    /** The scene the fight happens in (Cầu Vồng item recovery reads it). */
    sceneId?: number;
    /** Authored boss stats (Kim Diễm Long Vương) instead of the species' own. */
    encounterStats?: CombatantSetup["stats"];
    kimDiemIntro?: boolean;
    boss?: BattleSetup["boss"];
    /** A share of the stats by species (Đại Điện's hidden Divine pets keep their seal). */
    enemyStatPercent?: (speciesId: number) => number;
  },
  party: SavedPet[],
  inventory: Record<string, number>,
  items: readonly SourceItemData[] = [],
  presentation?: { playerActorSpriteId: number; enemyActorSpriteId: number },
  charms?: BattleCharms,
  shopCurrency?: { money: number; badges: number },
): BattleRuntime {
  if (request.members.length === 0) throw new Error(`Empty trainer roster ${request.label}`);
  const enemy = request.members.map(([speciesId, level, nature], member) => {
      const pet = services.encounterPet(
        speciesId,
        services.enemyLevel.clampEnemy(level),
        request.quality ?? -1,
        nature,
      );
      if (request.encounterStats) pet.stats = { ...request.encounterStats };
      if (request.enemyStatPercent)
        pet.stats = DivinePetSeal.scaleStats(pet.stats, request.enemyStatPercent(speciesId));
      const deck = request.skills?.[member];
      return deck && deck.length > 0 ? { ...pet, skillIds: [...deck] } : pet;
    }),
    player = party.find((pet) => (pet.currentHp ?? 1) > 0) ?? party[0],
    playerSetup = services.partyMember(player),
    bag: Record<number, number> = {};
  for (const [id, count] of Object.entries(inventory)) bag[Number(id)] = count;
  const setup: BattleSetup = {
    format: "1v1",
    kind: "trainer",
    captureAllowed: false,
    runAllowed: false,
    player: party.map((pet) => services.partyMember(pet)),
    enemy,
    inventory: bag,
    charms,
    sceneId: request.sceneId,
    boss: request.boss,
    capturePolicy: "TRAINER_OWNED_FORBIDDEN",
  };
  const core = request.profile
      ? profiledCore(services, setup, request.profile)
      : services.newCore(setup),
    [first] = request.members,
    encounter: [number, number, number] = [first[0], first[1], first[2]],
    definition = coreDefinition({
      id: `source-encounter-${encounter.join("-")}`,
      player,
      playerSetup,
      enemy,
      npcEntry: true,
      kimDiemIntro: request.kimDiemIntro,
      // `RuntimeProfile(-1, ...)`: no source actor, so `enterNpcVsEntry` shows the first enemy
      // pet's visual on the card (`enemyRender.visualId`).
      presentation: {
        playerActorSpriteId: presentation?.playerActorSpriteId ?? 0,
        enemyActorSpriteId: enemy[0].spriteId ?? 0,
      },
      partySize: party.length,
      captureAllowed: false,
    });
  return new BattleRuntime(
    { actorId: first[0], encounter, flags: [1, 1], mode: [0, 2], branchTargets: [] },
    new BattleDefinitionRegistry([definition]),
    services.rules,
    undefined,
    [],
    items,
    {
      core,
      party,
      services,
      settle: () =>
        settleBattle(core, party, inventory, services.progression, services.petBank?.()),
      entryPresentation: true,
      shopCurrency,
      kimDiemIntro: request.kimDiemIntro,
    },
  );
}

/** Seat a practice opponent with the standard trainer entry and no persistent settlement. */
export function createSinglePracticeBattle(
  services: BattleServices,
  setup: BattleSetup,
  party: SavedPet[],
  profile: PackBattleAiProfile,
  actorId: number,
  playerActorSpriteId: number,
): BattleRuntime {
  const first = setup.enemy[0];
  const encounter: BattleContext["encounter"] = [first.speciesId, first.level, first.nature];
  const definition = coreDefinition({
    id: `source-encounter-${encounter.join("-")}`,
    player: party[0],
    playerSetup: setup.player[0],
    enemy: [...setup.enemy],
    npcEntry: true,
    presentation: { playerActorSpriteId, enemyActorSpriteId: first.spriteId ?? 0 },
    partySize: party.length,
    captureAllowed: false,
  });
  return new BattleRuntime(
    {
      actorId,
      encounter,
      flags: [0, 1],
      mode: [0, 2],
      branchTargets: [],
    },
    new BattleDefinitionRegistry([definition]),
    services.rules,
    undefined,
    [],
    [],
    { core: profiledCore(services, setup, profile), party, services, entryPresentation: true },
  );
}

/**
 * `services.newCore` with the request's own AI profile: the same seat setup (badges, the post-EXP
 * heal, the enemy's thiên phú), the enemy's brain the AI-v2 controller over the basic AI, running on
 * `profile` without an encounter key (`BattleRequest.RuntimeProfile.withAiProfile`).
 */
function profiledCore(
  services: BattleServices,
  setup: BattleSetup,
  profile: PackBattleAiProfile,
): BattleCore {
  const seed = services.seedSource();
  return new BattleCore(
    services.rules,
    services.deps,
    {
      ...setup,
      badgeProfile: setup.badgeProfile ?? services.badgeProfile(),
      goldenPartyExperiencePercent:
        setup.goldenPartyExperiencePercent ?? services.goldenPartyExperiencePercent(),
      postExpBadgeHeal:
        setup.postExpBadgeHeal ?? ((speciesId) => services.postExpBadgeHeal(speciesId)),
      enemy: setup.enemy.map((pet, member) =>
        services.enemyTalentPet(pet, member, undefined, seed),
      ),
    },
    new BattleRandom(seed),
    new AiV2EnemyController(
      services.rules,
      services.rulebook,
      services.catalog,
      undefined,
      new BasicEnemyAi(services.rules),
      RUNTIME_MODES.ALL_ENCOUNTERS_V2,
      profile,
    ),
  );
}

/** The authored timeline a fight on the core uses: entry phases, the two seats, their HP. */
function coreDefinition(input: {
  id: string;
  player: SavedPet;
  playerSetup: CombatantSetup;
  enemy: CombatantSetup[];
  npcEntry: boolean;
  kimDiemIntro?: boolean;
  presentation?: { playerActorSpriteId: number; enemyActorSpriteId: number };
  partySize: number;
  captureAllowed: boolean;
  captureSuccessResultIndex?: number;
}): BattleDefinition {
  const { player, playerSetup, enemy, presentation, captureAllowed } = input;
  return {
    id: input.id,
    combatants: {
      player: combatant("player", playerSetup, { ...BATTLE_SEATS.player }),
      enemy: combatant("enemy", enemy[0], { ...BATTLE_SEATS.enemy }),
    },
    phases: input.kimDiemIntro
      ? [
          { start: 0, key: "P0_ENTRY" },
          { start: KIM_DIEM_INTRO_TICKS, key: "P1_DISPATCH" },
        ]
      : input.npcEntry
      ? [
          { start: 0, key: "NPC_VS_ENTRY" },
          { start: 23, key: "P0_ENTRY" },
          { start: 49, key: "P1_DISPATCH" },
        ]
      : [
          { start: 0, key: "P0_ENTRY" },
          { start: 26, key: "P1_DISPATCH" },
        ],
    duration: Number.MAX_SAFE_INTEGER,
    resultAt: Number.MAX_SAFE_INTEGER,
    resultIndex: 0,
    offsets: { player: [], enemy: [] },
    hp: {
      player: [{ from: 0, value: player.currentHp ?? playerSetup.stats.hp }],
      enemy: [{ from: 0, value: enemy[0].stats.hp }],
    },
    animations: {
      player: { stateWindows: [], cursor: () => -1 },
      enemy: { stateWindows: [], cursor: () => -1 },
    },
    activeWindows: [],
    hiddenWindows: {},
    effects: [],
    damage: [],
    entry: {
      leftActorSpriteId: presentation?.playerActorSpriteId ?? 0,
      rightActorSpriteId: presentation?.enemyActorSpriteId ?? 0,
      playerCount: input.partySize,
      enemyCount: enemy.length,
    },
    experience: { value: 0, max: 760 },
    // The core path asks the battle, not the definition, so this mirrors `captureAllowed` for the
    // one rule the definition still owns: Cảm Lãm Chi Diệp's 1-HP floor only holds a catchable pet.
    trainer: !captureAllowed,
    captureSuccessResultIndex: input.captureSuccessResultIndex,
  };
}

/** `enemyPartyFromEncounter` over the descriptor's roster, one pet per authored triple. */
function buildEnemy(
  services: BattleServices,
  event: EventBattleDescriptor,
  row: PackBattleAiEncounterRow,
  quality: number,
): CombatantSetup[] {
  const roster = event.op37Encounter;
  if (roster.length === 0) return [];
  const pets: CombatantSetup[] = [];
  for (let member = 0; member < memberCount(roster); member++) {
    const speciesId = roster[member * 3] ?? 0,
      sourceLevel = roster[member * 3 + 1] ?? 1,
      nature = roster[member * 3 + 2] ?? ENCOUNTER_NATURE_FALLBACK,
      authored = row.members[member],
      pet = services.encounterPet(
        speciesId,
        enemyLevel(services, event.sceneId, authored, speciesId, sourceLevel),
        quality,
        nature,
      );
    // `presetEnemyPhysicalTraitId`: only a PRESET member names a thiên phú; the rest are rolled.
    const preset = authored !== undefined && enumName(authored.physicalTraitMode) === "PRESET";
    if (!preset) pets.push(pet);
    else {
      const runtimeId = services.talentRuntimeId(authored.physicalTraitKey);
      if (runtimeId === undefined)
        throw new Error(
          `AI encounter references inactive physical trait ${authored.physicalTraitKey}`,
        );
      pets.push({ ...pet, physicalTraitId: runtimeId });
    }
  }
  return pets;
}

/**
 * The authored seat. `BattleRuntime.combatant` reads name, level, sprite and maximum HP back from the
 * core once the fight is seated, so what has to be right here is the element badge and the origin.
 */
function combatant(
  side: "player" | "enemy",
  setup: CombatantSetup,
  origin: { x: number; y: number },
): BattleDefinition["combatants"]["player"] {
  return {
    side,
    speciesId: setup.speciesId,
    name: setup.name ?? "",
    level: setup.level,
    spriteId: setup.spriteId ?? 0,
    element: setup.element ?? 0,
    maxHp: setup.stats.hp,
    attack: setup.stats.attack,
    defense: setup.stats.defense,
    speed: setup.stats.speed,
    origin,
  };
}
