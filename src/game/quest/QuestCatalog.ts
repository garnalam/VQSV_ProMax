/** A main storyline task (`mTask.mid`): its name and the objective the task card shows. */
export type MainTask = { name: string; description: string };
export type GroupRef = { scene: number; room: number; group: number };
/** A branch task (`bTask.mid` + `bqTask.mid`): where it is offered and where it completes. */
export type BranchTask = {
  id: number;
  name: string;
  description: string;
  offer: GroupRef;
  completion: GroupRef;
  terms?: {
    options: string[];
    rewards: { id: number; quantity: number; type: string }[];
    grantedQuestTokenLabel: string;
    grantedWorldFlag: number;
  } | null;
};

/** Every task the game knows, read from the pack (`story/main-tasks`, `data/quest/branch-tasks`). */
export class QuestCatalog {
  constructor(
    readonly mainTasks: readonly MainTask[],
    readonly branchTasks: readonly BranchTask[],
  ) {}
  main(index: number): MainTask | undefined {
    return this.mainTasks[index];
  }
  branch(id: number): BranchTask | undefined {
    return this.branchTasks.find((task) => task.id === id);
  }
  /** The branch tasks a group offers (op43) or completes. */
  branchesOfferedAt(ref: GroupRef): BranchTask[] {
    return this.branchTasks.filter((task) => sameGroup(task.offer, ref));
  }
  branchesCompletedAt(ref: GroupRef): BranchTask[] {
    return this.branchTasks.filter((task) => sameGroup(task.completion, ref));
  }
}

export const sameGroup = (a: GroupRef, b: GroupRef): boolean =>
  a.scene === b.scene && a.room === b.room && a.group === b.group;
