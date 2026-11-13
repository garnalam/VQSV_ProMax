import { describe, expect, it } from "vitest";
import {
  EVENT_STATE_COMPLETE,
  EVENT_STATE_FRESH,
  EVENT_STATE_RETIRED,
  EventStateLedger,
  eventStateKey,
} from "./EventStateLedger";

describe("source event state ledger", () => {
  it("starts every group fresh and dispatchable", () => {
    const ledger = new EventStateLedger();
    expect(ledger.sourceEventState(1, 0, 0)).toBe(EVENT_STATE_FRESH);
    expect(ledger.sourceEventStateDispatchable(1, 0, 0)).toBe(true);
    expect(ledger.sourceEventStateInactive(1, 0, 0)).toBe(false);
    expect(ledger.op86CheckEventState(1, 0, 0)).toBe(false);
    expect(ledger.op15CheckEventState(1, 0, 0)).toBe(false);
  });

  it("keeps one entry per scene, room and group", () => {
    const ledger = new EventStateLedger();
    ledger.op14CompleteEvent(1, 0, 0);
    expect(eventStateKey(1, 0, 0)).toBe("1:0:0");
    expect(ledger.sourceEventStateComplete(1, 0, 0)).toBe(true);
    expect(ledger.sourceEventStateComplete(1, 0, 1)).toBe(false);
    expect(ledger.sourceEventStateComplete(1, 1, 0)).toBe(false);
    expect(ledger.sourceEventStateComplete(0, 0, 0)).toBe(false);
  });

  it("treats op14 and op23 as the same completion state", () => {
    const ledger = new EventStateLedger();
    ledger.op14CompleteEvent(1, 1, 0);
    ledger.op23MarkEventComplete(1, 0, 1);
    expect(ledger.sourceEventState(1, 1, 0)).toBe(EVENT_STATE_COMPLETE);
    expect(ledger.sourceEventState(1, 0, 1)).toBe(EVENT_STATE_COMPLETE);
    for (const [scene, room, group] of [
      [1, 1, 0],
      [1, 0, 1],
    ]) {
      expect(ledger.op86CheckEventState(scene, room, group)).toBe(true);
      expect(ledger.op15CheckEventState(scene, room, group)).toBe(true);
      expect(ledger.sourceEventStateInactive(scene, room, group)).toBe(true);
      expect(ledger.sourceEventStateDispatchable(scene, room, group)).toBe(false);
    }
  });

  it("retires a completed group into state 4 so the dispatcher can run it again", () => {
    const ledger = new EventStateLedger();
    ledger.op14CompleteEvent(1, 0, 2);
    ledger.op77RetireEvent(1, 0, 2);
    expect(ledger.sourceEventState(1, 0, 2)).toBe(EVENT_STATE_RETIRED);
    expect(ledger.sourceEventStateComplete(1, 0, 2)).toBe(false);
    expect(ledger.op86CheckEventState(1, 0, 2)).toBe(false);
    expect(ledger.op15CheckEventState(1, 0, 2)).toBe(true);
    expect(ledger.sourceEventStateInactive(1, 0, 2)).toBe(true);
    expect(ledger.sourceEventStateDispatchable(1, 0, 2)).toBe(true);

    ledger.op42RepeatEvent(1, 1, 0);
    expect(ledger.sourceEventState(1, 1, 0)).toBe(EVENT_STATE_RETIRED);
    expect(ledger.sourceEventStateDispatchable(1, 1, 0)).toBe(true);
  });

  it("round-trips through a save snapshot", () => {
    const ledger = new EventStateLedger();
    ledger.op14CompleteEvent(1, 0, 0);
    ledger.op23MarkEventComplete(1, 0, 1);
    ledger.op77RetireEvent(1, 1, 0);
    const snapshot = ledger.snapshotStates();
    expect(snapshot).toEqual({ "1:0:0": 3, "1:0:1": 3, "1:1:0": 4 });

    const restored = new EventStateLedger();
    restored.restoreStates(snapshot);
    expect(restored.snapshotStates()).toEqual(snapshot);
    expect(restored.sourceEventState(1, 1, 0)).toBe(EVENT_STATE_RETIRED);
  });

  it("drops unknown states and missing snapshots instead of trusting them", () => {
    const ledger = new EventStateLedger();
    ledger.op14CompleteEvent(1, 0, 0);
    ledger.restoreStates({ "1:0:0": 3, "1:1:9": 7, "2:0:0": 0 });
    expect(ledger.snapshotStates()).toEqual({ "1:0:0": 3 });
    ledger.restoreStates(undefined);
    expect(ledger.snapshotStates()).toEqual({});
    expect(ledger.sourceEventState(1, 0, 0)).toBe(EVENT_STATE_FRESH);
  });
});
