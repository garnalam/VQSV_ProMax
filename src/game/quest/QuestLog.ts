/**
 * The player's quest log: the main storyline's task (mTask.mid, one at a time), the branch tasks
 * (bTask/bqTask, any number) and the quest tokens a script grants. Mutations follow Java's
 * `vqsv.quest.QuestEngine`: a branch task is added or updated in place, completion is status 3, an
 * unknown task reads as -1. Nothing here decides *when* a task moves — that is the story director's
 * job — so the log can never contradict itself (a task completed twice stays completed, a main task
 * never goes backwards).
 */
export const TASK_NONE = -1;
export const TASK_ACTIVE = 1;
export const TASK_COMPLETE = 3;
export type TaskStatus = typeof TASK_NONE | typeof TASK_ACTIVE | typeof TASK_COMPLETE;

/** What the save keeps (`story.quest` record: primitives only). */
export type QuestLogRecord = { main: number; mainDone: boolean; branch: string; tokens: string };

export class QuestLog {
  /** The current main task index (mTask row), -1 before the story has started. */
  main = -1;
  /** Whether the current main task is finished (the next one has not been given yet). */
  mainDone = false;
  private readonly branch = new Map<number, TaskStatus>();
  private readonly tokens = new Set<string>();

  /** Give main task `task`. The current or an earlier index is ignored: the storyline only moves forward. */
  startMain(task: number): boolean {
    if (task <= this.main) return false;
    this.main = task;
    this.mainDone = false;
    return true;
  }
  /** Finish main task `task` (only the current one can finish). */
  completeMain(task: number): boolean {
    if (task !== this.main || this.mainDone) return false;
    this.mainDone = true;
    return true;
  }

  /** `QuestEngine.unlockOrUpdate`; a completed branch task cannot be re-opened. */
  setBranch(task: number, status: TaskStatus): boolean {
    if (this.branchStatus(task) === TASK_COMPLETE && status !== TASK_COMPLETE) return false;
    this.branch.set(task, status);
    return true;
  }
  /** `QuestEngine.status`. */
  branchStatus(task: number): TaskStatus {
    return this.branch.get(task) ?? TASK_NONE;
  }
  /** Branch tasks in id order with their status. */
  branchTasks(): { task: number; status: TaskStatus }[] {
    return [...this.branch.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([task, status]) => ({ task, status }));
  }

  grantToken(name: string): void {
    this.tokens.add(name);
  }
  hasToken(name: string): boolean {
    return this.tokens.has(name);
  }

  snapshot(): QuestLogRecord {
    return {
      main: this.main,
      mainDone: this.mainDone,
      branch: this.branchTasks()
        .map(({ task, status }) => `${task}:${status}`)
        .join(","),
      tokens: [...this.tokens].sort().join("|"),
    };
  }
  /** Restore a record; anything malformed is skipped rather than invented. */
  restore(record: Partial<QuestLogRecord> | undefined): void {
    if (!record) return;
    if (typeof record.main === "number" && Number.isInteger(record.main) && record.main >= -1)
      this.main = record.main;
    this.mainDone = record.mainDone === true;
    this.branch.clear();
    for (const entry of (record.branch ?? "").split(",")) {
      const [task, status] = entry.split(":").map(Number);
      if (
        Number.isInteger(task) &&
        task >= 0 &&
        (status === TASK_ACTIVE || status === TASK_COMPLETE)
      )
        this.branch.set(task, status);
    }
    this.tokens.clear();
    for (const token of (record.tokens ?? "").split("|")) if (token) this.tokens.add(token);
  }
}
