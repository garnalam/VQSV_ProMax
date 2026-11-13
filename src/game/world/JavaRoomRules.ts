/**
 * What JavaSE's chapter runtimes add on top of a room's source event data, room by room. The
 * runtimes (`PhoenixC3Runtime`, `BlcC1Runtime`, ...) own their rooms: they choose which source
 * groups run, when, and what a reload restores. Where that differs from the decoded records the
 * difference is written here, each rule naming the runtime it comes from.
 */
import type { GroupRef } from "../quest/QuestCatalog";

const ref = (scene: number, room: number, group: number): GroupRef => ({ scene, room, group });

/** Extra conditions a runtime puts on one source group's trigger. */
export type TriggerRule = {
  group: number;
  /** No runtime dispatches this group: it never runs in JavaSE. */
  never?: true;
  /** Same-room groups that must be complete first. */
  after?: number[];
  /** Groups elsewhere that must be complete first. */
  afterRefs?: GroupRef[];
  /** The main task the runtime requires (`mainTaskProgress == n`). */
  mainTask?: number;
  /** The runtime starts the group by itself once its conditions hold (no rect, actor or torch). */
  auto?: true;
  /** The main task must have reached this (`>=`), and `badge` must be won. */
  minTask?: number;
  badge?: number;
  /** An op59 row whose actors break when the hero steps on them instead of on 5. */
  touch?: true;
  /** The runtime starts the group on this actor's activation (its op16 follows other records). */
  actor?: number;
};

export const TRIGGER_RULES: Readonly<Record<string, readonly TriggerRule[]>> = {
  // `PhoenixC3Runtime.tickGym`: g1 once g0 is won, the leader (g2) once both are, on task 31.
  "9:6": [
    { group: 1, after: [0] },
    { group: 2, after: [0, 1], mainTask: 31 },
  ],
  // `BlcC1Runtime.tickCity` (and later owners of 7:2) never dispatch g0: its op6 into scene 0
  // is not wired, although its only gate (0:0:0) is always met.
  "7:2": [{ group: 0, never: true }],
  // `BlcC2Runtime.tickLaserRoute`: the route's introduction needs task 35 and the barrier lifted
  // (7:3:g3); Lôi Kỳ Lân's first challenge (10:4:g3) needs task 35.
  "10:1": [{ group: 0, mainTask: 35, afterRefs: [ref(7, 3, 3)] }],
  "10:4": [{ group: 3, mainTask: 35 }],
  // `BlcC3Runtime.tickMinhVuongSanctum`: Minh Vương Long rises as soon as the save prompt (10:8:g2)
  // is answered on task 37 — the room's torches are never lit in JavaSE, so op59 is not the cue.
  "10:8": [{ group: 0, auto: true, after: [2], mainTask: 37 }],
  // `tickTinhVanGuardian`: Tinh Vân Hạc's first challenge needs task 38.
  "10:7": [{ group: 0, mainTask: 38 }],
  // `BlcC3Runtime.tickTemple`: Tomas's handoff (11:3:g5) waits for task 39 as well.
  "11:3": [{ group: 5, mainTask: 39 }],
  // `BlcC4Runtime.tryStartGymBattle`: on task 40 only, each trainer once every one before it is
  // beaten (Phi, Joey, Yuri, Burch, then the leader).
  "9:7": [0, 1, 2, 3, 4].map((group) => ({
    group,
    mainTask: 40,
    after: Array.from({ length: group }, (_, i) => i),
  })),
  // `BlcC4Runtime.tryStartReturnRitual`: 7:0:g0 (op86 [9,7,4], op56, then op16 [19]) starts on
  // Tomas's activation once the U Linh badge is won, not as soon as its gate holds.
  "7:0": [{ group: 0, actor: 19 }],
  // `XhtC1Runtime.routeAuthorized`: the Nguyên Mộc mine's switches (2:7:g3, op61 47–50) only
  // answer once the U Linh badge (5) is won and the main line has reached task 42.
  "2:7": [{ group: 3, minTask: 42, badge: 5 }],
  // `XhtC2Runtime.tryStartShapeBreak`: 10:12:g0 waits on op59 while the hero walks over its 28
  // floor shapes (`playerIntersectsActorSourceMask`), each cycling 1 → 2 as it is stepped on.
  "10:12": [{ group: 0, touch: true }],
  // `NguyenMocC4RaceRuntime` owns 3:7 outright: Jill's race is its own flow (`LucHanhDieuRace`),
  // so none of the room's three source groups is dispatched.
  "3:7": [0, 1, 2].map((group) => ({ group, never: true as const })),
};

/**
 * The runtimes that can own a room, in `Scene2Room1Group6ElizaScript`'s dispatch order: the first
 * whose `owns` holds runs the room. An owner that lists `groups` dispatches only those source
 * groups; its NPC tables (`npc-services.json` rows carry their runtime) are the only ones talked to.
 */
export type RoomOwner = {
  runtime: string;
  /** `owns(s)`: these groups complete and those not. */
  done?: GroupRef[];
  notDone?: GroupRef[];
  groups?: number[];
};

export const ROOM_OWNERS: Readonly<Record<string, readonly RoomOwner[]>> = {
  // `BlcC1Runtime.owns`: 7:6 once the landing (7:6:g4) is over; `PhoenixC4Runtime` before it.
  "7:6": [{ runtime: "BlcC1Runtime", done: [ref(7, 6, 4)] }, { runtime: "PhoenixC4Runtime" }],
  // The temple: `BlcC3Runtime` between 10:7:g0 and 11:3:g5 (Tomas's handoff only), `BlcC2Runtime`
  // between 10:4:g3 and 11:3:g4 (the wings), `BlcC1Runtime` otherwise.
  "11:3": [
    { runtime: "BlcC3Runtime", done: [ref(10, 7, 0)], notDone: [ref(11, 3, 5)], groups: [5] },
    { runtime: "BlcC2Runtime", done: [ref(10, 4, 3)], notDone: [ref(11, 3, 4)], groups: [4] },
    { runtime: "BlcC1Runtime", groups: [0, 1, 2, 3, 6] },
  ],
};

/** The runtime running this room now, or undefined when the room has no owner table. */
export function roomOwner(
  scene: number,
  room: number,
  complete: (ref: GroupRef) => boolean,
): RoomOwner | undefined {
  return ROOM_OWNERS[`${scene}:${room}`]?.find(
    (owner) => (owner.done ?? []).every(complete) && !(owner.notDone ?? []).some(complete),
  );
}

/** What a room's load restores once a group is complete (`reconcileRoomEntry`). */
export type EntryRule = {
  /** The group (same room unless `ref`) whose completion applies the rule. */
  after: number;
  ref?: GroupRef;
  /** ... unless this same-room group is complete too. */
  unless?: number;
  hide?: number[];
  /** Actors shown standing in `state` facing `direction`. */
  show?: { id: number; state: number; direction: number }[];
};

/**
 * Groups whose op56 records are not replayed on load: they hide or show an actor on one battle
 * branch only (a guardian caught rather than knocked out), so the runtime's own rule decides.
 */
export const NO_REPLAY: Readonly<Record<string, readonly number[]>> = {
  "10:4": [3, 5],
  "10:7": [0, 1],
  "10:8": [0, 3],
  "10:11": [0, 1],
  "10:12": [1, 4],
  "10:0": [1, 3],
};

export const ENTRY_RULES: Readonly<Record<string, readonly EntryRule[]>> = {
  // `BlcC2Runtime.reconcileRoomEntry`: Lôi Kỳ Lân (10) is gone once it was caught (10:4:g5).
  "10:4": [{ after: 5, hide: [10] }],
  // `BlcC3Runtime.reconcileRoomEntry`: in 10:8 the sleeping statue (5) gives way to Minh Vương
  // Long (6) once it has risen (g0), until it is caught (g3); in 10:7 Tinh Vân Hạc (6) is gone
  // once caught (g1).
  "10:8": [
    { after: 0, hide: [5], show: [{ id: 6, state: 0, direction: 0 }], unless: 3 },
    { after: 3, hide: [5, 6] },
  ],
  "10:7": [{ after: 1, hide: [6] }],
  // `XhtC1Runtime.reconcilePersistentActors`: Linh Quang Lộc (0) is gone once caught — g1, which
  // g0's capture branch also marks (op23); knocked out instead, he waits for the retry.
  "10:11": [{ after: 1, hide: [0] }],
  // `XhtC2Runtime.reconcilePersistentActors`: Chiến Thần Đà (29) shows once the shapes' tableau
  // (g0) has played and leaves once caught (g4, which g1's capture branch marks).
  "10:12": [{ after: 4, hide: [29] }],
  // `XhtC3Runtime.reconcilePersistentActors`: Tương Quân Giải (1) leaves once caught (g3).
  "10:0": [{ after: 3, hide: [1] }],
  // `BlcC1Runtime.reconcileRoomEntry`: after Sophie's reveal (7:3:g2) the two guards are gone and
  // Sophie (25) stands facing left; after the city arrival (7:2:g1) Bạch Bảo Châu (60) glows in
  // state 2 and Sophie (61) has left; after the temple reveal (11:3:g2) its four extras are gone.
  "7:3": [{ after: 2, hide: [23, 24], show: [{ id: 25, state: 0, direction: 3 }] }],
  "7:2": [{ after: 1, hide: [61], show: [{ id: 60, state: 2, direction: 0 }] }],
  "11:3": [{ after: 2, hide: [18, 20, 21, 22] }],
  // `PhoenixC4Runtime.reconcileRoomEntry`: once 11:2:g0 has played, Silia (10) and the guards its
  // op3 sent off stay gone; once g1 has, Sophie (11) and the flash (26). Elsewhere op3 is a
  // scene's own exit — 11:14's Yafei walks back in on the next load — so it is not replayed.
  "11:2": [
    { after: 0, hide: [10, 6, 7, 13, 20, 21, 22, 27, 28] },
    { after: 1, hide: [11, 26] },
  ],
};

/**
 * Groups a runtime's `reconcileRoomEntry` closes the moment the room loads, before any trigger is
 * read, once `when` is complete: the route barriers a chapter has outgrown. Without it a hero who
 * arrives inside the barrier's rect (through the door it guards) is pushed back once more.
 */
export type EntryCompletion = { when: GroupRef; complete: GroupRef[] };

export const ENTRY_COMPLETES: Readonly<Record<string, readonly EntryCompletion[]>> = {
  // `BlcC3Runtime.reconcileRoomEntry`: Minh Vương Long risen (10:8:g0) retires 7:8's barrier
  // (op23 7:8:g1, op14 7:8:g2); the wings (11:3:g4) retire 7:11's (7:11:g1, g2).
  "7:8": [{ when: ref(10, 8, 0), complete: [ref(7, 8, 1), ref(7, 8, 2)] }],
  "7:11": [{ when: ref(11, 3, 4), complete: [ref(7, 11, 1), ref(7, 11, 2)] }],
  // `BlcC4Runtime.reconcileReturnPrerequisite`: the U Linh badge (9:7:g4) lifts 7:1's barrier
  // (7:1:g1) and closes its op15 link (7:1:g0).
  "7:1": [{ when: ref(9, 7, 4), complete: [ref(7, 1, 1), ref(7, 1, 0)] }],
};

/** Doors a runtime keeps shut until a group is complete (`complete(...) && tryTransition(...)`). */
export const DOOR_RULES: Readonly<Record<string, Readonly<Record<number, GroupRef>>>> = {
  // `BlcC1Runtime.tryLeftTransitions`: 7:3's door 1 to 7:4 opens with 7:3:g3 (marked by 11:3:g3).
  "7:3": { 1: ref(7, 3, 3) },
  // `BlcC1Runtime.tryCityTransitions`: 7:2's door 5 to the gym opens with 7:2:g7 (11:3:g5).
  "7:2": { 5: ref(7, 2, 7) },
  // `BlcC4Runtime.tryReturnTransition`: 7:1's door 4 into the temple opens with 7:1:g1 (marked by
  // 7:1:g0 once the U Linh badge is won); `tryTempleTransition`: 7:0's door 17 down to Địa Giới
  // (6:1) opens with the return ritual (7:0:g0).
  "7:1": { 4: ref(7, 1, 1) },
  "7:0": { 17: ref(7, 0, 0) },
  // `XhtC3Runtime.tryHandleRoom4Boundary`: 4:4's mine door (31) needs its switches (g0, op60)
  // and Chiến Thần Đà's word (4:4:g1, marked by 10:12:g1).
  "4:4": { 31: ref(4, 4, 1) },
  // `XhtC2Runtime.tickNiemThoBoundary`: 4:10's door 1 to the ruins needs 4:10:g0 (marked by g1
  // once Linh Quang Lộc is met, 10:11:g0).
  "4:10": { 1: ref(4, 10, 0) },
};

/**
 * Kind-3 chests a JavaSE room runtime opens with `Scene1ThreeMapInteractionRuntime.tryStartChest`
 * (`ChestInteractionFlow`): 5 on one opens it (state 1, no longer an obstacle) and grants its
 * reward — the source row's quantity (column 7) of consumable item column 9 — once; afterwards it
 * says "Bảo rương này đã trống". Kind-3 actors no runtime wires (Bích Lam Cốc's) never open.
 */
export const WORLD_CHESTS: Readonly<Record<string, readonly number[]>> = {
  // Scene1ThreeMapInteractionRuntime.tryStartRoom1–6, tryStartScene11Room4/5.
  "1:1": [25, 44],
  "1:2": [4, 25],
  "1:3": [0, 47],
  "1:4": [30],
  "1:6": [23],
  "11:4": [11],
  "11:5": [9],
  // NguyenMocRoom0/1/2Runtime.tick (3:2's free chest; its keyed chest is KEYED_CHESTS).
  "3:0": [10, 11],
  "3:1": [40, 41, 42],
  "3:2": [14],
  // NguyenMocC4WestRuntime.tickWestField.
  "3:4": [13, 14],
  // NiemThoC1Runtime.tickWestRuins / tickMineTwo / tickMineThree.
  "4:1": [47],
  "4:3": [1, 2, 3],
  "4:4": [16],
  // NiemThoC3Runtime.tickSouthOne / tickGymUpper; NiemThoC4Runtime.tickNorth.
  "4:6": [8],
  "9:2": [5],
  "4:11": [8, 9],
  // HacThachC1Runtime.tickCityDock, HacThachC3Runtime.tickSecondCity, HacThachC4Runtime.tick.
  "5:2": [2],
  "5:5": [5],
  "5:6": [2, 3],
  // PhoenixC3Runtime.tickTemple.
  "6:1": [17, 18],
  // Sc8C1Runtime.tickRoom2 / tickRoom3.
  "8:2": [6],
  "8:3": [9],
  // XhtC3Runtime.tryRoomInteractions.
  "10:0": [0],
};

/**
 * `NguyenMocRoom2Runtime.KeyedChestEvent`: 3:2's chest 13 takes one Chìa khóa vàng (material 17)
 * and gives 2 of consumable 2; without a key it says where to buy one.
 */
export const KEYED_CHESTS: Readonly<
  Record<string, { actor: number; keyItem: number; itemId: number; quantity: number }>
> = {
  "3:2": { actor: 13, keyItem: 17, itemId: 2, quantity: 2 },
};

/**
 * Walk-in portals a runtime adds to a room: `CauVongChapterRuntime.tryEnterFromTribe` opens 8:1's
 * portal (actor 12, shown only then — `tickRoom1`) to Cầu Vồng's arrival map once the main line
 * reaches task 48.
 */
export const ROOM_PORTALS: Readonly<
  Record<
    string,
    {
      actor: number;
      minTask: number;
      rect: { x: number; y: number; width: number; height: number };
      to: { scene: number; room: number; x: number; y: number; direction: number };
    }
  >
> = {
  "8:1": {
    actor: 12,
    minTask: 48,
    rect: { x: 188, y: 264, width: 28, height: 32 },
    to: { scene: 98, room: 0, x: 220, y: 580, direction: 0 },
  },
};
