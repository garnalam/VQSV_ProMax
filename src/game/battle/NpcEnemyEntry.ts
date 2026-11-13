// `vqsv.battle.ui.VqsvBattleNpcEnemyEntryRenderState` (rebuild_game/src/main/java) and the timeline
// `VqsvBattleRuntime.tickNpcVsEntry` walks: the trainer fight's "VS" card, drawn over
// `/data/ui/npcEnemy.ui` with sprite 296's cells. One timeline frame is shown per tick.

/** `NPC_ENEMY_TIMELINE`: the steps and the 296 frames each one shows, one per tick. */
export const NPC_ENEMY_TIMELINE: readonly (readonly number[])[] = [
  [0],
  [1],
  [2],
  [3],
  [4, 5, 6, 7, 8],
  [9],
  [10],
  [11, 12],
  [13],
  [14, 15, 16, 17, 18, 19, 20],
  [21],
  [22],
];

/** Ticks the card lasts: one per timeline frame. */
export const NPC_ENEMY_ENTRY_TICKS = NPC_ENEMY_TIMELINE.reduce((sum, row) => sum + row.length, 0);

export type NpcEnemyEntryView = {
  step: number;
  frame: number;
  /** Per `npcEnemy.ui` widget: the 296 cell it shows, or -1. */
  cells: number[];
  /** Per widget: the portraits (2/3, 34/35, 4/5) that are shown. */
  visible: boolean[];
  mainCell: number;
  overlay36: boolean;
  exitSlotRows: boolean;
};

/** The step and frame `tickNpcVsEntry` has reached after `tick` ticks of the card (0-based). */
export function npcEnemyEntryAt(tick: number): { step: number; frame: number } {
  let left = Math.max(0, tick);
  for (let step = 0; step < NPC_ENEMY_TIMELINE.length; step++) {
    const frames = NPC_ENEMY_TIMELINE[step];
    if (left < frames.length) return { step, frame: frames[left] };
    left -= frames.length;
  }
  const last = NPC_ENEMY_TIMELINE.length - 1;
  return { step: last, frame: NPC_ENEMY_TIMELINE[last].at(-1)! };
}

/** `VqsvBattleNpcEnemyEntryRenderState(...)`: every step up to (step, frame) applied in order. */
export function npcEnemyEntryView(
  step: number,
  frame: number,
  playerCount: number,
  enemyCount: number,
): NpcEnemyEntryView {
  const view: NpcEnemyEntryView = {
    step,
    frame,
    cells: new Array<number>(37).fill(-1),
    visible: new Array<boolean>(37).fill(false),
    mainCell: 0,
    overlay36: false,
    exitSlotRows: false,
  };
  const players = Math.max(0, Math.min(6, playerCount)),
    enemies = Math.max(0, Math.min(6, enemyCount)),
    currentStep = step < 0 ? 0 : step,
    currentFrame = frame < 0 ? 0 : frame;
  for (let s = 0; s < NPC_ENEMY_TIMELINE.length && s <= currentStep; s++)
    for (const f of NPC_ENEMY_TIMELINE[s]) {
      apply(view, s, f, players, enemies);
      if (s === currentStep && f === currentFrame) return view;
    }
  return view;
}

function apply(
  view: NpcEnemyEntryView,
  step: number,
  frame: number,
  playerCount: number,
  enemyCount: number,
): void {
  const { cells, visible } = view,
    set = (widget: number, cell: number) => {
      if (widget >= 0 && widget < cells.length) cells[widget] = cell;
    };
  switch (step) {
    case 0:
      view.mainCell = frame;
      return;
    case 1:
      visible[2] = visible[3] = true;
      view.mainCell = frame;
      return;
    case 2:
      visible[2] = visible[3] = false;
      visible[34] = visible[35] = true;
      view.mainCell = frame;
      return;
    case 3:
      visible[34] = visible[35] = false;
      visible[4] = visible[5] = true;
      view.mainCell = frame;
      if (frame - 3 < enemyCount) set(6, 6);
      if (frame - 3 < playerCount) set(18, 6);
      return;
    case 4:
      set(6 + ((frame - 3) << 1), frame - 3 < enemyCount ? 6 : 5);
      set(7 + ((frame - 4) << 1), frame - 4 < enemyCount ? 6 : 5);
      set(19 + ((frame - 4) << 1), frame - 4 < playerCount ? 6 : 5);
      set(18 + ((frame - 3) << 1), frame - 3 < playerCount ? 6 : 5);
      return;
    case 5:
      set(7 + ((frame - 4) << 1), frame - 4 < enemyCount ? 6 : 5);
      set(19 + ((frame - 4) << 1), frame - 4 < playerCount ? 6 : 5);
      return;
    case 6:
      set(30, 8);
      set(31, 7);
      return;
    case 7:
      set(32, 8);
      set(33, 7);
      cells[30] = cells[31] = -1;
      return;
    case 8:
      view.overlay36 = true;
      return;
    case 9:
      view.overlay36 = false;
      return;
    case 10:
      view.mainCell = 4;
      cells[32] = cells[33] = -1;
      visible[4] = visible[5] = false;
      view.exitSlotRows = true;
      return;
    case 11:
      visible[4] = visible[5] = false;
      for (let id = 7; id < 19; id += 2) cells[id] = cells[id + 12] = -1;
      view.mainCell = 0;
      view.exitSlotRows = false;
      return;
  }
}
