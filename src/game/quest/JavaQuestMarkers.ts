/**
 * `VqsvBranchQuestRuntime.refreshBqTaskMarkers`: the quest marker (sprite 259) over each NPC of the
 * current room, rule for rule. JavaSE does not derive these from the op43/op44 rows — every room
 * that shows one has its own hand-written rule (`QuestEngine.decideMarker` for 1:0 and 2:1, then
 * one `append*Marker` per chapter runtime), including the main line's Jones handoff in 4:5. The
 * animation is the state: 7 an offer, 15 a held task not ready yet, 1 ready to hand in.
 */
export type QuestMarkerState = 1 | 7 | 15;
export type QuestMarker = { actorId: number; state: QuestMarkerState };

/** What the rules read off the live session. */
export type QuestMarkerQuery = {
  /** `status(task)`: -1 never offered, 1 held, 3 done. */
  status(task: number): number;
  /** `sourceEventStateComplete`. */
  complete(scene: number, room: number, group: number): boolean;
  /** `sourceEventStateInactive`: complete or retired. */
  inactive(scene: number, room: number, group: number): boolean;
  /** `sourceWorldFlags.contains(flag)`: an op20 quest item. */
  flag(flag: number): boolean;
  /** `sourcePetRecordObtained(_, species)`: the species is in the collection. */
  collected(speciesId: number): boolean;
  /** `sourceCanRemoveItem(itemId, quantity)`: that many of an ordinary bag item. */
  hasItems(itemId: number, quantity: number): boolean;
  mainTask: number;
  /** `BlcC1Runtime.blcTask22Ready`: the roster covers the four elements. */
  rosterCoversElements(): boolean;
  /** `NiemThoEggQuestProgress.isReady`: task 6's egg has hatched. */
  eggQuestReady(): boolean;
};

const ready = (value: boolean): QuestMarkerState => (value ? 1 : 15);

export function javaQuestMarkers(scene: number, room: number, q: QuestMarkerQuery): QuestMarker[] {
  const markers: QuestMarker[] = [],
    add = (actorId: number, state: QuestMarkerState) => markers.push({ actorId, state }),
    done = q.complete;
  // `QuestEngine.decideMarker`: Lâm's two tasks in 1:0 (actor 35) and Eliza's in 2:1 (actor 73).
  if (scene === 1 && room === 0) {
    const task0 = q.status(0);
    if (task0 === 3) {
      const task1 = q.status(1);
      if (done(1, 0, 8) && task1 !== 1 && task1 !== 3) add(35, 7);
    } else if (task0 === 1) add(35, ready(q.collected(23)));
    else if (done(1, 0, 6) || done(1, 0, 2) || done(1, 0, 3)) add(35, 7);
  }
  if (scene === 2 && room === 1) {
    const task1 = q.status(1);
    if (task1 === 1) add(73, ready(q.collected(68)));
    else if (task1 === 3 && done(2, 1, 6) && !done(2, 1, 7) && q.status(2) < 0) add(73, 7);
  }
  // `appendBichThuyHubMarker`.
  if (scene === 2 && room === 2) {
    const task16 = q.status(16);
    if (task16 < 0) add(13, 7);
    else if (task16 === 1) add(13, ready(q.hasItems(8, 3)));
  } else if (scene === 11 && room === 10 && q.status(13) < 0) add(7, 7);
  else if (scene === 11 && room === 11) {
    const task11 = q.status(11);
    if (task11 < 0) add(9, 7);
    else if (task11 === 1) add(9, ready(q.collected(88)));
  }
  // `appendNguyenMocHubMarkers`: Kate (51) and Arnold (52) in 3:3.
  if (scene === 3 && room === 3) {
    if (q.status(2) === 1 && !done(3, 3, 1)) add(51, ready(done(2, 1, 7) && q.collected(24)));
    else if (q.status(8) === 1 && !done(3, 3, 3)) add(51, ready(done(5, 3, 2) && q.collected(83)));
    else if (q.status(3) < 0 && done(3, 3, 1)) add(51, 7);
    else if (q.status(9) < 0 && done(3, 3, 3)) add(51, 7);
    else if (q.status(15) < 0 && done(3, 6, 1)) add(51, 7);
    if (q.status(13) === 1 && !done(3, 3, 8)) add(52, ready(done(11, 10, 0) && q.flag(0)));
    else if (q.status(18) < 0 && done(9, 1, 2)) add(52, 7);
  }
  // `appendNguyenMocDockMarker`: actor 25 in 3:6.
  if (scene === 3 && room === 6) {
    const task14 = q.status(14);
    if (task14 < 0 && !done(3, 6, 0)) add(25, 7);
    else if (task14 === 1 && !done(3, 6, 1)) add(25, ready(done(3, 6, 0) && q.collected(39)));
    else if (q.status(15) === 1 && !done(3, 6, 2)) add(25, ready(done(4, 7, 0)));
  }
  // `appendNiemThoSentaMarker`: Senta (10) in 4:2.
  if (scene === 4 && room === 2) {
    if (q.status(3) === 1 && !done(4, 2, 0)) add(10, ready(done(3, 3, 2) && q.flag(6)));
    else if (done(4, 2, 0) && q.status(4) < 0 && !done(4, 2, 1)) add(10, 7);
    else if (q.status(9) === 1 && !done(4, 2, 2)) add(10, ready(done(3, 3, 4)));
  }
  // `appendNiemThoC2Markers`.
  if (scene === 4 && room === 5) niemThoCity(q, add);
  else if (scene === 11 && room === 19) {
    if (q.status(10) < 0 && !done(11, 19, 0)) add(8, 7);
  } else if (scene === 11 && room === 21) {
    if (q.status(12) === 1 && !done(11, 21, 1)) add(9, ready(done(4, 5, 6) && q.flag(13)));
    else if (q.status(12) < 0 && !done(11, 21, 0)) add(9, 7);
  } else if (scene === 11 && room === 22) {
    if (q.status(19) === 1 && !done(11, 22, 0)) add(9, ready(done(4, 5, 11) && q.flag(12)));
    else if (done(11, 22, 0) && q.status(20) < 0 && !done(11, 22, 1)) add(9, 7);
  }
  // `appendNiemThoC4Marker`: task 10's hand-in in 4:12.
  if (scene === 4 && room === 12 && q.status(10) === 1 && !done(4, 12, 0))
    add(13, ready(done(11, 19, 0) && q.flag(7)));
  // `appendHacThachC2Marker`: actor 53 in 5:3.
  if (scene === 5 && room === 3) {
    if (q.status(7) === 1 && !done(5, 3, 1)) add(53, ready(q.flag(2)));
    else if (done(5, 3, 1) && q.status(8) < 0 && !done(5, 3, 2)) add(53, 7);
  }
  // `appendHacThachC3Marker`: actor 13 in 5:5.
  if (scene === 5 && room === 5) {
    if (q.status(20) === 1 && !done(5, 5, 0)) add(13, ready(done(11, 22, 1) && q.flag(1)));
    else if (done(5, 5, 0) && q.status(21) < 0 && !done(5, 5, 1)) add(13, 7);
    else if (q.status(21) === 1 && !done(5, 5, 2)) add(13, ready(done(5, 6, 0) && q.flag(3)));
  }
  // `appendBlcC1Markers`: Ms. Doranle's fruit (22 in 7:3), Karen's offers (22 in 7:6) and the
  // three fruit hand-ins in 11:3.
  if (scene === 7 && room === 3) {
    if (q.status(22) < 0 && !done(7, 3, 0)) add(22, 7);
    else if (q.status(22) === 1 && !done(7, 3, 1)) add(22, ready(q.rosterCoversElements()));
  } else if (scene === 7 && room === 6) {
    const offer =
      (q.status(24) < 0 && !done(7, 6, 0)) ||
      (done(11, 3, 0) && q.status(25) < 0 && !done(7, 6, 1)) ||
      (done(11, 3, 1) && q.status(26) < 0 && !done(7, 6, 2)) ||
      (done(7, 8, 0) && q.status(27) < 0 && !done(7, 6, 3));
    if (offer) add(22, 7);
  } else if (scene === 11 && room === 3) {
    const fruit = q.flag(20);
    if (q.status(24) === 1 && !done(11, 3, 0)) add(16, ready(fruit));
    if (q.status(25) === 1 && !done(11, 3, 1)) add(17, ready(fruit));
    if (q.status(27) === 1 && !done(11, 3, 6)) add(23, ready(fruit));
  }
  // `appendBlcC3Markers`.
  if (scene === 7 && room === 8 && q.status(26) === 1 && !done(7, 8, 0)) add(13, ready(q.flag(20)));
  else if (scene === 7 && room === 10) {
    if (q.status(23) < 0 && !done(7, 10, 0)) add(13, 7);
    else if (q.status(23) === 1 && !done(7, 10, 1)) add(13, 1);
  }
  // `appendSc8C1Markers`: 8:0 once its arrival (g4) is over.
  if (scene === 8 && room === 0 && q.inactive(8, 0, 4)) {
    if (q.status(28) < 0 && !done(8, 0, 0)) add(26, 7);
    else if (q.status(28) === 1 && !done(8, 0, 1)) add(26, ready(done(8, 4, 0)));
    if (done(8, 0, 1) && q.status(29) < 0 && !done(8, 0, 2)) add(27, 7);
    else if (q.status(29) === 1 && !done(8, 0, 3)) add(27, ready(q.hasItems(5, 20)));
  }
  return markers;
}

/** `appendNiemThoC2CityMarkers`: Niệm Thổ's five quest givers, Jones (34) included. */
function niemThoCity(q: QuestMarkerQuery, add: (actorId: number, state: QuestMarkerState) => void) {
  const done = q.complete;
  if (q.status(4) === 1 && !done(4, 5, 0)) add(27, ready(q.collected(38)));
  else if (done(4, 5, 0) && q.status(5) < 0 && !done(4, 5, 1)) add(27, 7);
  if (q.status(5) === 1 && !done(4, 5, 2)) add(43, ready(done(4, 5, 1)));
  else if (done(4, 5, 2) && q.status(6) < 0 && !done(4, 5, 3)) add(43, 7);
  else if (q.status(6) === 1 && !done(4, 5, 4)) add(43, ready(q.eggQuestReady()));
  else if (done(4, 5, 4) && q.status(7) < 0 && !done(4, 5, 5)) add(43, 7);
  if (q.status(17) < 0 && !done(4, 5, 7)) add(30, 7);
  else if (q.status(17) === 1 && !done(4, 5, 9)) add(30, ready(done(4, 5, 8) && q.flag(14)));
  if (q.status(18) === 1 && !done(4, 5, 10)) add(32, ready(done(3, 3, 7) && q.flag(11)));
  else if (done(4, 5, 10) && q.status(19) < 0 && !done(4, 5, 11)) add(32, 7);
  if (q.mainTask === 19 && !done(4, 5, 17)) add(34, 7);
  else if (q.mainTask === 20 && !done(4, 5, 18)) add(34, ready(q.collected(19)));
}
