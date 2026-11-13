/**
 * Mounts, ported from JavaSE `RideProgression`, `VqsvRideRuntime` and the ride half of
 * `PanelDecisionService`. Ride ids are the stable menu ids: 0..3 the Liệt Hỏa rides, 4..8 the
 * Cầu Vồng rides (`CV_PLANT`..`CV_WATER`).
 *
 * The per-room restrictions are baked by `ExportWebRideRooms.java` (`story/ride-rooms.json`): the
 * `petRide.mid` rows plus the scene-98 rules `applyRoomPolicy` layers on top. A room the table does
 * not list blocks every ride (the `policy == null` branch).
 */

export const CV_PLANT = 4,
  CV_BEAST = 5,
  CV_METAL = 6,
  CV_SKY = 7,
  CV_WATER = 8,
  RIDE_COUNT = 9,
  /** Liệt Hỏa's Hải âu: flies over everything outside Cầu Vồng. */
  HAI_AU = 2,
  /** `RideProgression.speedFor(-1)`, the walking speed. */
  WALK_SPEED = 4,
  /** `ExportWebRideSprites`: Cầu Vồng riders are filed as sprite 9000 + ride id. */
  RAINBOW_RIDER_SPRITE_BASE = 9000;

/** `VqsvPanelRuntime.RIDE_LABELS`. */
export const RIDE_LABELS = [
  "Lục đi điểu",
  "Hư không hành giả",
  "Hải âu",
  "Nham sơn long",
  "Quả Tử Tiểu Tả",
  "Dị Thú",
  "Đồng Cầu huynh đệ",
  "Mao Cầu Điểu",
  "Cá heo",
] as const;

export type RideRoomsDocument = { profileVersion: string; rooms: Record<string, number[]> };

/** The saved half of `RideProgression` (`campaign.ride`); the speed is derived from the ride. */
export type RideState = { activeIndex: number; blocked: number[] };

export type RideSelection = "locked" | "blocked" | "ready";

/** `RideProgression.speedFor`: the plant mount is six, the fast mounts eight, the rest four. */
export function rideSpeed(rideIndex: number): number {
  return rideIndex === CV_PLANT
    ? 6
    : rideIndex === 0 || rideIndex === 1 || rideIndex === CV_BEAST || rideIndex === CV_SKY
      ? 8
      : WALK_SPEED;
}

/** `RideProgression.suppressesEncounters`: Hư không hành giả, Nham sơn long and Dị Thú. */
export function rideSuppressesEncounters(activeIndex: number): boolean {
  return activeIndex === 1 || activeIndex === 3 || activeIndex === CV_BEAST;
}

/** `RideProgression.terrainIndex`: the Liệt Hỏa slot whose terrain a Cầu Vồng ride shares. */
export function rideTerrainIndex(rideIndex: number): number {
  switch (rideIndex) {
    case CV_PLANT:
    case CV_METAL:
      return 0;
    case CV_BEAST:
      return 1;
    case CV_SKY:
      return 2;
    case CV_WATER:
      return 3;
    default:
      return rideIndex;
  }
}

/** `RideProgression.rainbowSpeciesId`: the pet a Cầu Vồng ride is. */
export function rainbowRideSpecies(rideIndex: number): number {
  switch (rideIndex) {
    case CV_PLANT:
      return 113;
    case CV_METAL:
      return 134;
    case CV_SKY:
      return 149;
    case CV_BEAST:
      return 166;
    default:
      return 182;
  }
}

export const isRainbowRide = (rideIndex: number): boolean =>
  rideIndex >= CV_PLANT && rideIndex < RIDE_COUNT;

/**
 * `VqsvPlayerAppearanceRuntime.applyEffectiveAppearance`: a Liệt Hỏa ride swaps the hero for
 * sprite ride + 1; a Cầu Vồng ride for its rider projection; on foot the wardrobe decides.
 */
export function riderSprite(activeIndex: number, onFoot: number): number {
  if (isRainbowRide(activeIndex)) return RAINBOW_RIDER_SPRITE_BASE + activeIndex;
  return activeIndex >= 0 ? activeIndex + 1 : onFoot;
}

/** `RideProgression.selectionOutcome`. */
export function rideSelection(
  state: RideState,
  rideIndex: number,
  unlocked: boolean,
): RideSelection {
  if (!unlocked) return "locked";
  if (rideIndex < 0 || rideIndex >= RIDE_COUNT || state.blocked[rideIndex] === 1) return "blocked";
  return "ready";
}

/** `RideProgression.roomAllows`. */
export function roomAllowsRide(state: RideState, rideIndex: number): boolean {
  return rideIndex >= 0 && rideIndex < RIDE_COUNT && state.blocked[rideIndex] !== 1;
}

/** The baked `applyRoomPolicy` restrictions for a room. */
export function roomRestrictions(
  doc: RideRoomsDocument | undefined,
  scene: number,
  room: number,
): number[] {
  const row = doc?.rooms[`${scene}:${room}`];
  return Array.from({ length: RIDE_COUNT }, (_, i) => (row ? (row[i] === 1 ? 1 : 0) : 1));
}

/** What `VqsvRideRuntime.rideUnlocked` reads from the session. */
export type RideOwnership = {
  /** Special rewards held (`inventory.specialRewards`, unlocked ones). */
  specials: readonly number[];
  /** `CauVongChapterRuntime.eventDone(room, event)`: scene 98's op14 ledger. */
  rainbowEventDone: (room: number, event: number) => boolean;
  collected: (speciesId: number) => boolean;
};

/** Cầu Vồng ride ownership is written to scene 98 room 0 group 700100 + ride. */
export const RAINBOW_RIDE_OWNED_EVENT = 700100;
/** `applySelectedRide` marks the save as using the separated ride ids. */
export const RIDE_IDS_SEPARATED_EVENT = 700099;
/** `CauVongNorthSeaHiddenClassroomRuntime.CAPTIVES_RELEASED_EVENT`. */
const CAPTIVES_RELEASED_EVENT = 104;

/** `VqsvRideRuntime.rideUnlocked`. */
export function rideUnlocked(rideIndex: number, own: RideOwnership): boolean {
  if (isRainbowRide(rideIndex)) {
    if (own.rainbowEventDone(0, RAINBOW_RIDE_OWNED_EVENT + rideIndex)) return true;
    if (own.collected(rainbowRideSpecies(rideIndex))) return true;
    // `CauVongLunchQuestRuntime.accepted`.
    if (rideIndex === CV_PLANT) return own.rainbowEventDone(1, 101);
    if (rideIndex === CV_METAL) return own.rainbowEventDone(9, 41734);
    if (rideIndex === CV_SKY) return own.rainbowEventDone(9, 41849) || own.rainbowEventDone(9, 104);
    if (rideIndex === CV_WATER)
      return (
        own.collected(183) ||
        own.rainbowEventDone(48, 52082) ||
        own.rainbowEventDone(31, 52183) ||
        own.rainbowEventDone(61, CAPTIVES_RELEASED_EVENT)
      );
    return false;
  }
  if (rideIndex < 0 || rideIndex > 3) return false;
  return own.specials.includes(rideIndex + 1);
}

/**
 * `VqsvRideRuntime.applyRoomPolicy` on the state: take the room's restrictions, then keep the
 * mount only while the room allows it (and, on a save resume, while it is still owned).
 * Returns true when the hero had to get off.
 */
export function applyRideRoomPolicy(
  state: RideState,
  restrictions: readonly number[],
  owned: ((rideIndex: number) => boolean) | null,
): boolean {
  state.blocked = Array.from({ length: RIDE_COUNT }, (_, i) => (restrictions[i] === 1 ? 1 : 0));
  const active = state.activeIndex;
  if (active < 0) return false;
  if (!roomAllowsRide(state, active) || (owned !== null && !owned(active))) {
    state.activeIndex = -1;
    return true;
  }
  return false;
}

/** `WorldEngine.HAI_AU_AIRBORNE_ANCHOR_Y`: the bounds test uses the bird, 25 px above the feet. */
export const HAI_AU_AIRBORNE_ANCHOR_Y = 25;

/** `WorldEngine.canLandFromHaiAu` (`game.j.s`): both footprint corners on plain ground. */
export function canLandFromHaiAu(
  x: number,
  y: number,
  terrainAt: (x: number, y: number) => number,
): boolean {
  return terrainAt(x + 7, y + 7) === 0 && terrainAt(x - 8, y - 8) === 0;
}

/**
 * `CauVongTerrainMechanisms.canDismount`: the four corners of the walking footprint are floor
 * (Cầu Vồng's floor 0 reads as -1 through `GameMap`).
 */
export function canDismountRainbow(
  x: number,
  y: number,
  terrainAt: (x: number, y: number) => number,
): boolean {
  for (const dx of [-8, 7])
    for (const dy of [-8, 7]) {
      const terrain = terrainAt(x + dx, y + dy);
      if (terrain !== -1 && terrain !== 0) return false;
    }
  return true;
}
