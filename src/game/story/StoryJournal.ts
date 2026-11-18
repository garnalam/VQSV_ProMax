// Web only: the story journal behind the admin "chơi lại từ chặng này" tool.
//
// Each story step (a Liệt Hỏa graph node, then each Cầu Vồng guidance line) opens a journal entry
// that remembers where the hero stood and the quest record when the step began, and every event
// ledger key the step changed with its value before. Rewinding to a step undoes, newest first,
// every change made from that step on, so the ledger is exactly what it was when the step began.
// The owner's rule: a rewound stretch plays as if it never happened (fights, scenes, item gifts all come
// back), but the receipts of pets the player already owns are kept, so no pet is handed over twice.

import type { EventStateSnapshot } from "../world/EventStateLedger";

export type StoryJournalLocation = {
  sceneId: number;
  roomIndex: number;
  x: number;
  y: number;
  direction: number;
};

export type StoryJournalStep = {
  seq: number;
  /** Stable step id: `lh:<node>` or `cv:<row title>|<guidance line>`. */
  id: string;
  /** What the admin tool lists. */
  label: string;
  /** Epoch milliseconds when the step began. */
  at: number;
  location: StoryJournalLocation;
  /** `save.story.quest` when the step began. */
  quest?: Record<string, unknown>;
  mainTask?: number;
  activeTask?: string;
  /** Ledger keys this step created. */
  added: string[];
  /** Ledger keys this step changed or removed, with their value before the step. */
  changed: [string, number][];
};

export type StoryJournalSnapshot = { v: 1; steps: StoryJournalStep[] };

/** What the admin asked for: back to a journal step, or to the start of Cầu Vồng. */
export type StoryRewindRequest = { seq: number } | { cauVongStart: true };

/** The most steps a save keeps; the oldest go first. */
export const STORY_JOURNAL_LIMIT = 300;

export class StoryJournal {
  private readonly steps: StoryJournalStep[];
  private touched = new Set<string>();

  constructor(snapshot?: StoryJournalSnapshot) {
    this.steps = (snapshot?.steps ?? []).map((step) => ({
      ...step,
      added: [...step.added],
      changed: step.changed.map(([key, value]) => [key, value] as [string, number]),
    }));
    const last = this.current;
    if (last) this.touched = new Set([...last.added, ...last.changed.map(([key]) => key)]);
  }

  get current(): StoryJournalStep | undefined {
    return this.steps.at(-1);
  }

  /** A new step begins (its id differs from the current one). */
  begin(step: Omit<StoryJournalStep, "seq" | "added" | "changed">): void {
    const seq = (this.current?.seq ?? 0) + 1;
    this.steps.push({ ...step, seq, added: [], changed: [] });
    this.touched = new Set();
    if (this.steps.length > STORY_JOURNAL_LIMIT) this.steps.splice(0, this.steps.length - STORY_JOURNAL_LIMIT);
  }

  /** A ledger key changed; only its first change inside a step matters for a rewind. */
  note(key: string, before: number | undefined): void {
    const step = this.current;
    if (!step || this.touched.has(key)) return;
    this.touched.add(key);
    if (before === undefined) step.added.push(key);
    else step.changed.push([key, before]);
  }

  snapshot(): StoryJournalSnapshot {
    return { v: 1, steps: this.steps.map((step) => ({ ...step })) };
  }
}

/** Where "Về đầu Cầu Vồng" puts the hero: the square, by the portal from Liệt Hỏa. */
export const CAU_VONG_START_LOCATION: StoryJournalLocation = {
  sceneId: 98,
  roomIndex: 0,
  x: 220,
  y: 580,
  direction: 0,
};

type RewindableSave = {
  location: StoryJournalLocation & { adminPlaced?: boolean };
  progress: { activeTask?: string; mainTaskProgress?: number };
  story: Record<string, unknown>;
  world?: { mainTaskProgress?: number; activeTask?: string };
  eventStates?: EventStateSnapshot;
  storyJournal?: StoryJournalSnapshot;
  storyRewind?: StoryRewindRequest;
};

/**
 * Apply the save's pending rewind and clear the request. `isReward` names the ledger keys that
 * must survive (receipts of pets the player owns). A request for a step the journal no longer has is dropped.
 */
export function applyStoryRewind<T extends RewindableSave>(
  save: T,
  isReward: (key: string) => boolean,
): T {
  const request = save.storyRewind;
  if (!request) return save;
  const next: T = { ...save, eventStates: { ...(save.eventStates ?? {}) } };
  delete next.storyRewind;
  const states = next.eventStates!;
  const steps = save.storyJournal?.steps ?? [];
  if ("cauVongStart" in request) {
    for (const key of Object.keys(states))
      if ((key.startsWith("98:") || key.startsWith("gift:98:")) && !isReward(key)) delete states[key];
    next.location = { ...CAU_VONG_START_LOCATION, adminPlaced: true };
    next.storyJournal = { v: 1, steps: steps.filter((step) => !step.id.startsWith("cv:")) };
    return next;
  }
  const at = steps.findIndex((step) => step.seq === request.seq);
  if (at < 0) return next;
  for (let i = steps.length - 1; i >= at; i--) {
    const step = steps[i];
    for (const key of step.added) if (!isReward(key)) delete states[key];
    for (const [key, before] of step.changed) if (!isReward(key)) states[key] = before;
  }
  const target = steps[at];
  next.location = { ...target.location, adminPlaced: true };
  if (target.quest) next.story = { ...next.story, quest: { ...target.quest } };
  if (target.mainTask !== undefined) {
    next.progress = { ...next.progress, mainTaskProgress: target.mainTask };
    if (next.world) next.world = { ...next.world, mainTaskProgress: target.mainTask };
  }
  if (target.activeTask !== undefined) next.progress = { ...next.progress, activeTask: target.activeTask };
  next.storyJournal = { v: 1, steps: steps.slice(0, at) };
  return next;
}
