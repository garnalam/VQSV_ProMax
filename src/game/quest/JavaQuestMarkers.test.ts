import { describe, expect, it } from "vitest";
import { javaQuestMarkers, type QuestMarkerQuery } from "./JavaQuestMarkers";

function query(
  overrides: Partial<QuestMarkerQuery> & {
    tasks?: Record<number, number>;
    done?: string[];
    flags?: number[];
    species?: number[];
  } = {},
): QuestMarkerQuery {
  const { tasks = {}, done = [], flags = [], species = [], ...rest } = overrides;
  return {
    status: (task) => tasks[task] ?? -1,
    complete: (scene, room, group) => done.includes(`${scene}:${room}:${group}`),
    inactive: (scene, room, group) => done.includes(`${scene}:${room}:${group}`),
    flag: (flag) => flags.includes(flag),
    collected: (speciesId) => species.includes(speciesId),
    hasItems: () => false,
    mainTask: 0,
    rosterCoversElements: () => false,
    eggQuestReady: () => false,
    ...rest,
  };
}

describe("JavaSE quest markers (VqsvBranchQuestRuntime)", () => {
  it("Lâm (1:0, actor 35): no offer before the prologue, then offer, held, ready, gone", () => {
    expect(javaQuestMarkers(1, 0, query())).toEqual([]);
    expect(javaQuestMarkers(1, 0, query({ done: ["1:0:6"] }))).toEqual([{ actorId: 35, state: 7 }]);
    expect(javaQuestMarkers(1, 0, query({ tasks: { 0: 1 } }))).toEqual([
      { actorId: 35, state: 15 },
    ]);
    expect(javaQuestMarkers(1, 0, query({ tasks: { 0: 1 }, species: [23] }))).toEqual([
      { actorId: 35, state: 1 },
    ]);
    expect(javaQuestMarkers(1, 0, query({ tasks: { 0: 3 } }))).toEqual([]);
    expect(javaQuestMarkers(1, 0, query({ tasks: { 0: 3 }, done: ["1:0:8"] }))).toEqual([
      { actorId: 35, state: 7 },
    ]);
  });

  it("Jones (4:5, actor 34) carries the main line's task 19 offer and task 20 hand-in", () => {
    const jones = (q: QuestMarkerQuery) =>
      javaQuestMarkers(4, 5, q).filter((marker) => marker.actorId === 34);
    expect(jones(query({ mainTask: 19 }))).toEqual([{ actorId: 34, state: 7 }]);
    expect(jones(query({ mainTask: 20 }))).toEqual([{ actorId: 34, state: 15 }]);
    expect(jones(query({ mainTask: 20, species: [19] }))).toEqual([{ actorId: 34, state: 1 }]);
    expect(jones(query({ mainTask: 20, done: ["4:5:18"] }))).toEqual([]);
  });

  it("Kate (3:3, actor 51) moves from task 2's hand-in to task 3's offer", () => {
    expect(
      javaQuestMarkers(3, 3, query({ tasks: { 2: 1 }, done: ["2:1:7"], species: [24] })),
    ).toEqual([{ actorId: 51, state: 1 }]);
    expect(javaQuestMarkers(3, 3, query({ tasks: { 2: 3 }, done: ["3:3:1"] }))).toEqual([
      { actorId: 51, state: 7 },
    ]);
  });

  it("Thôn Tachi (8:0) shows nothing until its arrival group is over", () => {
    expect(javaQuestMarkers(8, 0, query())).toEqual([]);
    expect(javaQuestMarkers(8, 0, query({ done: ["8:0:4"] }))).toEqual([{ actorId: 26, state: 7 }]);
  });
});
