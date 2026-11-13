import { describe, expect, it } from "vitest";
import type { BranchTask, MainTask } from "./QuestCatalog";
import { TASK_ACTIVE, TASK_COMPLETE } from "./QuestLog";
import { taskProgressText, taskRows, type TaskBoardSource } from "./TaskBoard";

const main = (n: number): MainTask[] =>
  Array.from({ length: n }, (_, i) => ({ name: `M${i}`, description: `#2[Nơi ${i}]#0` }));
const branch = (n: number): BranchTask[] =>
  Array.from({ length: n }, (_, id) => ({
    id,
    name: `B${id}`,
    description: `Phụ ${id}`,
    offer: { scene: 1, room: 0, group: id },
    completion: { scene: 1, room: 0, group: id + 100 },
  }));
const source = (patch: Partial<TaskBoardSource> = {}): TaskBoardSource => ({
  mainTasks: main(49),
  branchCatalog: branch(30),
  mainCursor: 0,
  branches: [],
  ...patch,
});

describe("taskRowsForRender", () => {
  it("lists the main tasks up to the cursor, the earlier ones done", () => {
    expect(taskRows(0, source())).toEqual([
      { number: 1, title: "M0", detail: "#2[Nơi 0]#0", completed: false },
    ]);
    const rows = taskRows(0, source({ mainCursor: 2 }));
    expect(rows.map((r) => [r.number, r.title, r.completed])).toEqual([
      [1, "M0", true],
      [2, "M1", true],
      [3, "M2", false],
    ]);
    expect(taskRows(0, source({ mainCursor: 60 }))).toHaveLength(49);
    expect(taskRows(0, source({ mainTasks: [] }))).toEqual([]);
  });

  it("lists the held branch tasks in order, done at status 3", () => {
    const rows = taskRows(
      1,
      source({
        branches: [
          { task: 4, status: TASK_ACTIVE },
          { task: 0, status: TASK_COMPLETE },
        ],
      }),
    );
    expect(rows).toEqual([
      { number: 1, title: "B4", detail: "Phụ 4", completed: false },
      { number: 2, title: "B0", detail: "Phụ 0", completed: true },
    ]);
    expect(taskRows(1, source())).toEqual([]);
  });
  it("numbers the Cầu Vồng opening rows on after the main tasks (`openingQuestRows`)", () => {
    const opening = { title: "Cầu Vồng — khám phá di tích", detail: "Gặp Lucy", completed: false };
    const rows = taskRows(0, source({ mainCursor: 48, openingRows: [opening] }));
    expect(rows).toHaveLength(50);
    expect(rows[49]).toEqual({ number: 50, ...opening });
    expect(taskRows(1, source({ openingRows: [opening] }))).toEqual([]);
  });
});

describe("taskProgressText", () => {
  it("keeps the main tab's per-mille/50 figure with the last digit forced to 1", () => {
    expect(taskProgressText(0, source())).toBe("0.1%");
    // 2 * 1000 / 49 = 40 per mille: 40 / 50 = 0, digit 0 -> 1.
    expect(taskProgressText(0, source({ mainCursor: 2 }))).toBe("0.1%");
    // 48 * 1000 / 49 = 979: 979 / 50 = 19, digit 9.
    expect(taskProgressText(0, source({ mainCursor: 48 }))).toBe("19.9%");
  });

  it("gives the branch tab a plain percentage of completed tasks", () => {
    expect(taskProgressText(1, source())).toBe("0.0%");
    expect(
      taskProgressText(
        1,
        source({
          branches: [
            { task: 0, status: TASK_COMPLETE },
            { task: 1, status: TASK_ACTIVE },
          ],
        }),
      ),
    ).toBe("3.3%");
  });
});
