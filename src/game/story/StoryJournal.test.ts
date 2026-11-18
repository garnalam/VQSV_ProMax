import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EventStateLedger } from "../world/EventStateLedger";
import { cauVongPetReceiptKeys, rewardKeyPredicate } from "../world/CauVongRewardKeys";
import { isStoryJournal } from "../../persistence/save/GameSave";
import { applyStoryRewind, StoryJournal } from "./StoryJournal";

const at = (sceneId: number, roomIndex: number) => ({ sceneId, roomIndex, x: 10, y: 20, direction: 0 });

function play() {
  const ledger = new EventStateLedger();
  const journal = new StoryJournal();
  ledger.observer = (key, before) => journal.note(key, before);
  journal.begin({ id: "lh:a", label: "A", at: 1, location: at(1, 0), mainTask: 3, quest: { node: "a" } });
  ledger.op14CompleteEvent(1, 0, 1);
  ledger.markGiftReceived("gift:1:0:1:4:7");
  journal.begin({ id: "lh:b", label: "B", at: 2, location: at(2, 1), mainTask: 4, quest: { node: "b" } });
  ledger.op14CompleteEvent(2, 1, 0);
  ledger.op77RetireEvent(1, 0, 1); // 3 -> 4: the step changed a key an earlier step wrote
  ledger.op14CompleteEvent(98, 44, 824001); // the cafe pet receipt
  ledger.op14CompleteEvent(98, 3, 5); // a story flag
  journal.begin({ id: "lh:c", label: "C", at: 3, location: at(3, 0), mainTask: 5, quest: { node: "c" } });
  ledger.op14CompleteEvent(3, 0, 2);
  return { ledger, journal };
}

const save = (eventStates: Record<string, number>, journal: StoryJournal) => ({
  location: at(3, 0),
  progress: { mainTaskProgress: 5 },
  world: { mainTaskProgress: 5 },
  story: { quest: { node: "c" } },
  eventStates,
  storyJournal: journal.snapshot(),
});

const keepCafePet = (key: string) => key === "98:44:824001";

describe("StoryJournal", () => {
  it("records each step's changes with the value before", () => {
    const { journal } = play();
    const steps = journal.snapshot().steps;
    expect(isStoryJournal(journal.snapshot())).toBe(true);
    expect(steps.map((s) => [s.seq, s.added, s.changed])).toEqual([
      [1, ["1:0:1", "gift:1:0:1:4:7"], []],
      [2, ["2:1:0", "98:44:824001", "98:3:5"], [["1:0:1", 3]]],
      [3, ["3:0:2"], []],
    ]);
  });

  it("rewinds to a step as if it was never played, keeping pet receipts", () => {
    const { ledger, journal } = play();
    const rewound = applyStoryRewind({ ...save(ledger.snapshotStates(), journal), storyRewind: { seq: 2 } }, keepCafePet);
    expect(rewound.eventStates).toEqual({ "1:0:1": 3, "gift:1:0:1:4:7": 4, "98:44:824001": 3 });
    expect(rewound.location).toEqual({ ...at(2, 1), adminPlaced: true });
    expect(rewound.progress.mainTaskProgress).toBe(4);
    expect(rewound.world.mainTaskProgress).toBe(4);
    expect(rewound.story.quest).toEqual({ node: "b" });
    expect(rewound.storyJournal!.steps.map((s) => s.seq)).toEqual([1]);
    expect("storyRewind" in rewound).toBe(false);
  });

  it("rewinding to the first step clears its item gifts too", () => {
    const { ledger, journal } = play();
    const rewound = applyStoryRewind({ ...save(ledger.snapshotStates(), journal), storyRewind: { seq: 1 } }, keepCafePet);
    expect(rewound.eventStates).toEqual({ "98:44:824001": 3 });
  });

  it("drops a request for a step the journal no longer has", () => {
    const { ledger, journal } = play();
    const before = save(ledger.snapshotStates(), journal);
    const rewound = applyStoryRewind({ ...before, storyRewind: { seq: 99 } }, keepCafePet);
    expect(rewound.eventStates).toEqual(before.eventStates);
    expect("storyRewind" in rewound).toBe(false);
  });

  it("back to the start of Cầu Vồng clears its story but not its pets", () => {
    const { ledger, journal } = play();
    const rewound = applyStoryRewind(
      { ...save({ ...ledger.snapshotStates(), "gift:98:2:1:4:9": 4 }, journal), storyRewind: { cauVongStart: true } },
      keepCafePet,
    );
    expect(Object.keys(rewound.eventStates!).filter((k) => k.includes("98:"))).toEqual(["98:44:824001"]);
    expect(rewound.location.sceneId).toBe(98);
  });
});

describe("CauVongRewardKeys", () => {
  const pack = (name: string) => JSON.parse(readFileSync(`public/pack/cau-vong-world/${name}.json`, "utf8"));
  const documents = ["prep", "academy", "summoning"].map((name) => {
    try { return pack(name); } catch { return undefined; }
  }).filter(Boolean);

  it("keeps pet grants, rides and summon rewards, and nothing else", () => {
    const pets = cauVongPetReceiptKeys(documents);
    expect(pets.size).toBeGreaterThan(0);
    const keep = rewardKeyPredicate(documents);
    for (const key of pets) expect(keep(key)).toBe(true);
    expect(keep("98:0:700105")).toBe(true);
    expect(keep("98:51:653007")).toBe(true);
    expect(keep("98:3:5")).toBe(false);
    expect(keep("gift:98:3:5:4:1")).toBe(false);
    expect(keep("2:1:0")).toBe(false);
  });
});
