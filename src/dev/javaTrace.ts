import type { InputCommand } from "../core/input/GameCommand";
import type { GameplayHost } from "../game/session/GameplayHost";
import type { StorySceneRuntime } from "../game/story/StorySceneRuntime";

/**
 * One row per tick, field for field what `RecordGameplayTrace.java` writes:
 * [tick, confirm, event, scene, room, cameraX, cameraY, text, ready, actors]
 * actors = visible source actors as [index, x, y, direction, state, cursor].
 */
export type TraceRow = [
  number,
  0 | 1,
  number,
  number,
  number,
  number,
  number,
  string | null,
  0 | 1,
  number[][],
];

export type JavaTrace = { source: "java"; scenario: string; policy: string; rows: TraceRow[] };

export type FrameCursor = (sprite: number, state: number, tick: number) => number;

function activeScene(host: GameplayHost): StorySceneRuntime {
  return host.story.scene as StorySceneRuntime;
}

/** The web side of `confirmWhenReady`: press confirm on a tick that starts with a ready text. */
export function recordWebTrace(host: GameplayHost, ticks: number, cursor: FrameCursor): TraceRow[] {
  const rows: TraceRow[] = [];
  for (let t = 0; t < ticks; t++) {
    const before = activeScene(host),
      confirm = before.currentText !== null && before.textReady;
    const commands: InputCommand[] = confirm ? ["confirm"] : [];
    host.step(commands);
    const s = activeScene(host);
    rows.push([
      t,
      confirm ? 1 : 0,
      s.eventIndex,
      s.sceneId,
      s.roomIndex,
      s.cameraX,
      s.cameraY,
      s.currentText,
      s.currentText !== null && s.textReady ? 1 : 0,
      [...s.actors.values()]
        .filter((a) => a.visible && a.id >= 0)
        .sort((a, b) => a.id - b.id)
        .map((a) => [
          a.id,
          a.x,
          a.y,
          a.direction,
          a.state,
          cursor(a.sprite, a.state, a.animationTick),
        ]),
    ]);
  }
  return rows;
}

export const FIELDS = [
  "tick",
  "confirm",
  "event",
  "scene",
  "room",
  "cameraX",
  "cameraY",
  "text",
  "ready",
  "actors",
] as const;

/**
 * Java keeps `TaggedText` colour tags (`#FFFFFF ...`) in the message; the web strips them when it
 * starts the text. Colour is presentation, so the trace compares everything else character for
 * character (dialog pages included: both drop the space at a soft line break).
 */
export function plainText(text: string | null): string | null {
  return text === null ? null : text.replace(/#[0-9A-Fa-f]{6}/g, "");
}

export type FieldDivergence = {
  field: string;
  firstTick: number;
  ticks: number;
  java: unknown;
  web: unknown;
};

/** For each field: the first tick it diverges, its values there, and how many ticks diverge. */
export function diffTraces(java: TraceRow[], web: TraceRow[]): FieldDivergence[] {
  const out = new Map<string, FieldDivergence>();
  const n = Math.min(java.length, web.length);
  for (let t = 0; t < n; t++)
    FIELDS.forEach((field, i) => {
      const a = field === "text" ? plainText(java[t][i] as string | null) : java[t][i],
        b = field === "text" ? plainText(web[t][i] as string | null) : web[t][i];
      if (JSON.stringify(a) === JSON.stringify(b)) return;
      const seen = out.get(field);
      if (seen) seen.ticks++;
      else out.set(field, { field, firstTick: t, ticks: 1, java: a, web: b });
    });
  return [...out.values()].sort((x, y) => x.firstTick - y.firstTick);
}
