import type { BranchTask, MainTask } from "./QuestCatalog";
import { TASK_COMPLETE, type TaskStatus } from "./QuestLog";

/**
 * The rows `task.ui` lists (`VqsvPanelRuntime.taskRowsForRender`) and its completion line
 * (`taskProgressText`). Pure data: the panel owns the cursor, the renderer the pixels.
 */
export type TaskRow = { number: number; title: string; detail: string; completed: boolean };

/** `taskTab`: 0 is "Nhiệm vụ chính" (mTask.mid), 1 is "Nhiệm vụ phụ" (bTask.mid). */
export type TaskTab = 0 | 1;

export type TaskBoardSource = {
  /** `mTask.mid`'s rows: the first half's names, the second half's objectives. */
  mainTasks: readonly MainTask[];
  /** `bTask.mid`'s rows, by task id. */
  branchCatalog: readonly BranchTask[];
  /** `mainTaskCursor`: the current main task index, never below 0. */
  mainCursor: number;
  /** `session.story.branchTasks`: the branch tasks the player holds, with their status. */
  branches: readonly { task: number; status: TaskStatus }[];
  /** `openingQuestRows` tab 0, the Cầu Vồng rows the web has reached, already gated on task 48. */
  openingRows?: readonly Omit<TaskRow, "number">[];
  /** `openingQuestRows` tab 1, the Cầu Vồng branch rows the flags show, gated on task 48. */
  openingBranchRows?: readonly Omit<TaskRow, "number">[];
};

/** `openingQuestRows` only joins from `mainTaskProgress` 48 on. */
export const OPENING_QUEST_TASK = 48;

/** `mainTaskCursor`. */
export function mainTaskCursor(progress: number): number {
  return Math.max(0, progress);
}

/**
 * `taskRowsForRender`. The main tab lists every task up to and including the current one, the
 * earlier ones marked done; the branch tab lists the held branch tasks, done at status 3.
 *
 * The opening Cầu Vồng quest rows (`openingQuestRows`) follow the main tasks on tab 0, numbered on.
 */
export function taskRows(tab: TaskTab, source: TaskBoardSource): TaskRow[] {
  if (tab === 1) {
    const half = Math.max(1, source.branchCatalog.length),
      count = Math.min(half, source.branches.length),
      rows: TaskRow[] = [];
    for (let i = 0; i < count; i++) {
      const held = source.branches[i],
        id = Math.max(0, Math.min(half - 1, held.task)),
        task = source.branchCatalog.find((candidate) => candidate.id === id);
      const title = task?.name ?? "";
      rows.push({
        number: i + 1,
        title,
        detail: task?.description || title,
        completed: held.status === TASK_COMPLETE,
      });
    }
    for (const row of source.openingBranchRows ?? [])
      rows.push({ number: rows.length + 1, ...row });
    return rows;
  }
  const half = source.mainTasks.length;
  if (half === 0) return [];
  const cursor = mainTaskCursor(source.mainCursor),
    count = Math.min(half, Math.max(1, cursor + 1)),
    rows: TaskRow[] = [];
  for (let i = 0; i < count; i++) {
    const task = source.mainTasks[i];
    rows.push({
      number: i + 1,
      title: task.name,
      detail: task.description || task.name,
      completed: i < cursor,
    });
  }
  for (const row of source.openingRows ?? []) rows.push({ number: rows.length + 1, ...row });
  return rows;
}

/**
 * `taskProgressText`. The main tab keeps the source's odd figure: per-mille divided by 50 with the
 * last digit forced to at least 1 (Java's premium percent flag is never set).
 */
export function taskProgressText(tab: TaskTab, source: TaskBoardSource): string {
  if (tab === 0) {
    const total = Math.max(1, source.mainTasks.length),
      raw = Math.trunc((mainTaskCursor(source.mainCursor) * 1000) / total),
      digit = raw % 10 === 0 ? 1 : raw % 10;
    return `${Math.trunc(raw / 50)}.${digit}%`;
  }
  const total = Math.max(1, source.branchCatalog.length),
    completed = source.branches.filter((task) => task.status === TASK_COMPLETE).length,
    raw = Math.trunc((completed * 1000) / total);
  return `${Math.trunc(raw / 10)}.${raw % 10}%`;
}
