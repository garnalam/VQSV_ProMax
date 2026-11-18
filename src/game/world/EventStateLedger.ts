// JavaSE parity: vqsv/world/event/VqsvEventState.
// Source ledger keys are "scene:room:group"; the only states the engine writes are
// 0 (fresh), 3 (completed by op14/op23) and 4 (retired by op42/op77).
export const EVENT_STATE_FRESH = 0;
export const EVENT_STATE_COMPLETE = 3;
export const EVENT_STATE_RETIRED = 4;

export type EventStateSnapshot = Record<string, number>;

export const eventStateKey = (sceneId: number, roomIndex: number, groupIndex: number): string =>
  `${sceneId}:${roomIndex}:${groupIndex}`;

/** The receipt of one gift (`EventStateLedger.giftReceived`): group, item table and item. */
export const giftReceiptKey = (
  sceneId: number,
  roomIndex: number,
  groupIndex: number,
  table: number,
  itemId: number,
): string => `gift:${sceneId}:${roomIndex}:${groupIndex}:${table}:${itemId}`;

export class EventStateLedger {
  private readonly states = new Map<string, number>();
  /**
   * Web only: told of every key the game writes, with its value before (`StoryJournal`). Restoring a
   * save is not reported.
   */
  observer?: (key: string, before: number | undefined) => void;

  sourceEventState(sceneId: number, roomIndex: number, groupIndex: number): number {
    return this.states.get(eventStateKey(sceneId, roomIndex, groupIndex)) ?? EVENT_STATE_FRESH;
  }

  sourceEventStateComplete(sceneId: number, roomIndex: number, groupIndex: number): boolean {
    return this.sourceEventState(sceneId, roomIndex, groupIndex) === EVENT_STATE_COMPLETE;
  }

  // A group stops dispatching in either terminal state: 3 is ordinary completion,
  // 4 is an op77 retirement of a group that had already completed.
  sourceEventStateInactive(sceneId: number, roomIndex: number, groupIndex: number): boolean {
    const state = this.sourceEventState(sceneId, roomIndex, groupIndex);
    return state === EVENT_STATE_COMPLETE || state === EVENT_STATE_RETIRED;
  }

  sourceEventStateDispatchable(sceneId: number, roomIndex: number, groupIndex: number): boolean {
    const state = this.sourceEventState(sceneId, roomIndex, groupIndex);
    return state === EVENT_STATE_FRESH || state === EVENT_STATE_RETIRED;
  }

  op15CheckEventState(sceneId: number, roomIndex: number, groupIndex: number): boolean {
    const state = this.sourceEventState(sceneId, roomIndex, groupIndex);
    return state === EVENT_STATE_COMPLETE || state === EVENT_STATE_RETIRED;
  }

  op86CheckEventState(sceneId: number, roomIndex: number, groupIndex: number): boolean {
    return this.sourceEventStateComplete(sceneId, roomIndex, groupIndex);
  }

  snapshotStates(): EventStateSnapshot {
    return Object.fromEntries(this.states);
  }

  restoreStates(snapshot: EventStateSnapshot | undefined): void {
    this.states.clear();
    // Java restores the map verbatim; a save is external input here, so entries that are
    // not a state the engine can write are discarded rather than replayed.
    for (const [key, state] of Object.entries(snapshot ?? {})) {
      if (state === EVENT_STATE_COMPLETE || state === EVENT_STATE_RETIRED)
        this.states.set(key, state);
    }
  }

  /**
   * Web-only gift receipts (JavaSE has the same hole): an op17/op18 gift of a group that has not
   * completed yet, such as Fruita's Tất Trung Cầu ahead of the Uy Qua Đệ Đệ fight (2:2:0), is handed
   * over once; a replay after a lost or fled fight skips it. The receipt rides in the same saved map
   * under its own "gift:" key, stored as 4 so the save validator keeps it and the story director,
   * which only reads 3s, never takes it for a finished group.
   */
  giftReceived(key: string): boolean {
    return this.states.has(key);
  }

  markGiftReceived(key: string): void {
    if (!this.states.has(key)) this.observer?.(key, undefined);
    this.states.set(key, EVENT_STATE_RETIRED);
  }

  op14CompleteEvent(sceneId: number, roomIndex: number, groupIndex: number): void {
    this.setSourceEventState(sceneId, roomIndex, groupIndex, EVENT_STATE_COMPLETE);
  }

  op23MarkEventComplete(sceneId: number, roomIndex: number, groupIndex: number): void {
    this.setSourceEventState(sceneId, roomIndex, groupIndex, EVENT_STATE_COMPLETE);
  }

  op42RepeatEvent(sceneId: number, roomIndex: number, groupIndex: number): void {
    this.setSourceEventState(sceneId, roomIndex, groupIndex, EVENT_STATE_RETIRED);
  }

  op77RetireEvent(sceneId: number, roomIndex: number, groupIndex: number): void {
    this.setSourceEventState(sceneId, roomIndex, groupIndex, EVENT_STATE_RETIRED);
  }

  /** Web-only: a group back to fresh (state 0), for a room puzzle the web lets the player redo. */
  resetEvent(sceneId: number, roomIndex: number, groupIndex: number): void {
    const key = eventStateKey(sceneId, roomIndex, groupIndex);
    if (!this.states.has(key)) return;
    this.observer?.(key, this.states.get(key));
    this.states.delete(key);
  }

  private setSourceEventState(
    sceneId: number,
    roomIndex: number,
    groupIndex: number,
    state: number,
  ): void {
    const key = eventStateKey(sceneId, roomIndex, groupIndex),
      before = this.states.get(key);
    if (before === state) return;
    this.observer?.(key, before);
    this.states.set(key, state);
  }
}
