// JavaSE owns the Cầu Vồng chapter's walk-in connections as hand-written arithmetic in one method:
// `CauVongFourGateRoutes.exitTo` first scans its own PORTALS pad table, then reads the /4 door table
// in 20px tiles, switches the destination row's facing to a direction, adds the arrival's one-tile
// give, and gates some connections on chapter events or on the one exit a room's owner adopted. None
// of that is harvestable data, so this guard re-reads the Java methods and the port's constants and
// refuses the port if any of it moves.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CAU_VONG_DOOR_RULES, CAU_VONG_PORTAL_ROWS } from "../src/game/world/WorldTransition.ts";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "..");
const java = (...parts) =>
  readFileSync(resolve(repo, "rebuild_game", "src", "main", "java", ...parts), "utf8").replace(
    /\r\n/g,
    "\n",
  );
const port = (...parts) =>
  readFileSync(resolve(root, "src", ...parts), "utf8").replace(/\r\n/g, "\n");

/** The only owner of the chapter's native door loop. */
const ROUTES = java("vqsv", "game", "CauVongFourGateRoutes.java");
/** Where the chapter's per-room owners call that loop, one adopted exit at a time. */
const CHAPTER = java("vqsv", "game", "CauVongChapterRuntime.java");
/** Where Java defines the inclusive point test the loop uses. */
const FREE_WORLD = java("vqsv", "game", "VqsvFreeWorldRuntime.java");
const TS_TRANSITION = port("game", "world", "WorldTransition.ts");
const TS_INTERACTION = port("game", "world", "WorldInteractionEngine.ts");
const TS_DISPATCHER = port("game", "world", "WorldEventDispatcher.ts");
const TS_COLLISION = port("game", "world", "MapCollision.ts");

/** One `NAME = <number>` literal, in either language. */
const int = (source, name) => {
  const match =
    source.match(new RegExp(`(?:static final )?int ${name} = (-?\\d+);?`)) ??
    // TypeScript also declares these in a comma-separated list, so only the first one keeps `const`.
    source.match(new RegExp(`(?:(?:export )?const |,\\s*)${name} = (-?\\d+)`));
  expect(match, `${name} is no longer a literal number where it was looked for`).toBeTruthy();
  return Number(match[1]);
};
/** The body of one port function, from its signature to the next export. */
const tsBody = (signature, next) => {
  const start = TS_TRANSITION.indexOf(signature);
  expect(start, `the port no longer has ${signature}`).toBeGreaterThan(-1);
  const end = TS_TRANSITION.indexOf(next, start);
  expect(end, `${signature} is no longer followed by ${next}`).toBeGreaterThan(start);
  return TS_TRANSITION.slice(start, end);
};
/** A whitespace-tolerant source check, so Prettier line wrapping is not a parity signal. */
const has = (source, pattern, what) =>
  expect(new RegExp(pattern, "s").test(source), what).toBe(true);

/** Java's authored `eventDone` continues and single-connection adoptions, as door rules. */
const javaRules = () => {
  const start = ROUTES.indexOf("static boolean exitTo");
  const body = ROUTES.slice(start, ROUTES.indexOf("static int[][] doors", start));
  const rules = [];
  for (const match of body.matchAll(
    /room==(\d+)&&target==(\d+)&&!done\(s,(\d+),(\d+)\)|room==(\d+)&&\(target!=(\d+)\|\|!done\(s,(\d+),(\d+)\)\)/g,
  ))
    rules.push(
      match[1] !== undefined
        ? { room: +match[1], target: +match[2], requires: { room: +match[3], event: +match[4] } }
        : {
            room: +match[5],
            target: +match[6],
            requires: { room: +match[7], event: +match[8] },
            only: true,
          },
    );
  expect(rules.length, "Java no longer authors exactly four door gates").toBe(4);
  const byKey = new Map(rules.map((rule) => [`${rule.room}->${rule.target}`, rule]));
  for (const adopted of adoptedRules()) {
    const key = `${adopted.room}->${adopted.target}`;
    if (byKey.has(key)) byKey.get(key).only = true;
    else byKey.set(key, adopted);
  }
  return [...byKey.values()].sort((a, b) => a.room - b.room || a.target - b.target);
};

/** A chapter constant declared as `static final int NAME = n`. */
const javaInt = (name) => {
  const match = CHAPTER.match(new RegExp(`int ${name} = (\\d+)`));
  expect(match, `${name} is no longer a literal number in the chapter runtime`).toBeTruthy();
  return Number(match[1]);
};
/** The last match of `pattern` that starts before `site`. */
const lastBefore = (source, pattern, site) => {
  let found = null;
  for (const match of source.matchAll(pattern)) if (match.index < site) found = match;
  return found;
};
/**
 * `exitTo(s, X_ROOM_INDEX)` call sites, each read with the room whose owner makes the call: either an
 * inline `currentRoomIndex == X` guard or a per-room tick method dispatched from such a guard.
 */
const adoptedRules = () => {
  const methodRooms = {};
  for (const match of CHAPTER.matchAll(
    /currentRoomIndex == (\w+_ROOM_INDEX)\)\s*\{\s*return (\w+)\(s\);/g,
  ))
    methodRooms[match[2]] = javaInt(match[1]);
  const adopted = new Map();
  for (const match of CHAPTER.matchAll(/exitTo\(s, (\w+_ROOM_INDEX)\)/g)) {
    const guard = lastBefore(CHAPTER, /currentRoomIndex == (\w+_ROOM_INDEX)\)/g, match.index);
    const owner = lastBefore(CHAPTER, /private (?:static )?boolean (\w+)\(/g, match.index);
    let room;
    if (guard && (!owner || guard.index > owner.index)) room = javaInt(guard[1]);
    else {
      expect(
        methodRooms[owner[1]],
        `the owner ${owner[1]} that calls exitTo is dispatched by no room guard`,
      ).not.toBeUndefined();
      room = methodRooms[owner[1]];
    }
    adopted.set(`${room}->${javaInt(match[1])}`, {
      room,
      target: javaInt(match[1]),
      only: true,
    });
  }
  expect(adopted.size, "Java no longer adopts exactly two single-connection rooms").toBe(2);
  return [...adopted.values()];
};

/** The chapter's `PORTALS` pad rows, read straight off the Java literal. */
const javaPortals = () => {
  const start = ROUTES.indexOf("int[][] PORTALS");
  const body = ROUTES.slice(start, ROUTES.indexOf("static boolean exit", start));
  const rows = [...body.matchAll(/\{([-\d,\s]+)\}/g)].map((match) =>
    match[1]
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value) => !Number.isNaN(value)),
  );
  expect(rows.length, "Java no longer authors thirteen portal pads").toBe(13);
  for (const row of rows) expect(row, `pad ${row[0]} no longer has nine columns`).toHaveLength(9);
  return rows;
};

describe("Cầu Vồng native doors match the Java loop", () => {
  it("keeps the table in 20px tiles with the same anchor maths", () => {
    expect(ROUTES).toContain("playerSourcePointInRect(door[0]*20,door[1]*20,20,20)");
    expect(int(TS_TRANSITION, "SOURCE_TILE")).toBe(20);
    has(
      tsBody("export const roomDoorTriggerRect", "export function roomDoorRow"),
      "x:\\s*door\\.x \\* SOURCE_TILE,\\s*y:\\s*door\\.y \\* SOURCE_TILE,\\s*width:\\s*SOURCE_TILE,\\s*height:\\s*SOURCE_TILE",
      "the door rectangle is no longer one 20px tile at the row's own column",
    );
  });
  it("uses the raw source point, not the padded 16px body box", () => {
    has(
      FREE_WORLD,
      "return s\\.player\\.x >= x\\s*&&\\s*s\\.player\\.x <= x \\+ w\\s*&&\\s*s\\.player\\.y >= y\\s*&&\\s*s\\.player\\.y <= y \\+ h",
      "Java's point test is no longer inclusive on the raw position",
    );
    has(
      TS_INTERACTION,
      "return x >= rect\\.x &&\\s*x <= rect\\.x \\+ rect\\.width &&\\s*y >= rect\\.y &&\\s*y <= rect\\.y \\+ rect\\.height",
      "the port's point test no longer mirrors Java's",
    );
    has(
      TS_DISPATCHER,
      "playerSourcePointInRect\\(\\s*view\\.x,\\s*view\\.y,\\s*roomDoorTriggerRect\\(door\\)\\s*\\)",
      "the chapter loop no longer tests the door tile with the point",
    );
    expect(TS_DISPATCHER).not.toMatch(/playerIntersectsSourceRect\([^)]*roomDoorTriggerRect/s);
  });
  it("maps the destination row's facing to the same four directions", () => {
    expect(ROUTES).toContain("switch(nativeFacing){case 1->0;case 2->2;case 3->1;case 4->3;");
    expect(ROUTES).toContain('default->throw new IllegalStateException("Native door facing")');
    const body = tsBody(
      "export function nativeFacingToEngineDirection",
      "export function roomDoorArrival",
    );
    for (const [facing, constant, value] of [
      [1, "DIRECTION_DOWN", 0],
      [2, "DIRECTION_UP", 2],
      [3, "DIRECTION_RIGHT", 1],
      [4, "DIRECTION_LEFT", 3],
    ]) {
      expect(int(TS_COLLISION, constant), `${constant} is not Java's direction ${value}`).toBe(
        value,
      );
      has(
        body,
        `case ${facing}:\\s*return ${constant};`,
        `case ${facing} no longer returns ${constant}`,
      );
    }
    has(body, "default:\\s*return -1;", "an unmapped facing is no longer rejected");
  });
  it("arrives on the row's centre and foot line, one tile back from its facing", () => {
    expect(ROUTES).toContain("int x=destination[0]*20+10+(direction==1?20:direction==3?-20:0);");
    expect(ROUTES).toContain("int y=destination[1]*20+19+(direction==0?20:direction==2?-20:0);");
    expect(int(TS_TRANSITION, "SOURCE_TILE_CENTER")).toBe(10);
    expect(int(TS_TRANSITION, "SOURCE_TILE_FEET")).toBe(19);
    const body = tsBody("export function roomDoorArrival", "export function roomEntryArrival");
    // Checked as pieces: the arrival expression is long enough that Prettier breaks it in more than
    // one place, and where it breaks is not a parity signal.
    for (const [axis, row, line, down, up] of [
      ["x", "row\\.x", "SOURCE_TILE_CENTER", "DIRECTION_RIGHT", "DIRECTION_LEFT"],
      ["y", "row\\.y", "SOURCE_TILE_FEET", "DIRECTION_DOWN", "DIRECTION_UP"],
    ]) {
      has(
        body,
        `${axis}:\\s*${row} \\* SOURCE_TILE \\+`,
        `the arrival ${axis} is off the row tile`,
      );
      has(body, `\\+\\s*${line}`, `the arrival ${axis} is no longer on the row's own ${line}`);
      has(
        body,
        `${down}\\s*\\?\\s*SOURCE_TILE\\b(?!_)`,
        `the arrival ${axis} no longer steps a tile with ${down}`,
      );
      has(
        body,
        `${up}\\s*\\?\\s*-SOURCE_TILE`,
        `the arrival ${axis} no longer steps a tile back with ${up}`,
      );
    }
  });
  it("declares the same chapter-event gates and one-connection rooms as data", () => {
    expect([...CAU_VONG_DOOR_RULES].sort((a, b) => a.room - b.room || a.target - b.target)).toEqual(
      javaRules(),
    );
  });
  it("keeps a row Java calls a data error inert here", () => {
    expect(ROUTES).toContain("if(target<0||target>=68||entry<0||entry>=DOORS[target].length)");
    expect(ROUTES).toContain('throw new IllegalStateException("Unresolved native door "');
    expect(ROUTES).toContain("private static final int[][][] DOORS=new int[68][][];");
    has(
      tsBody("export function sourceRoomDoors", "export const roomDoorTriggerRect"),
      "filter\\(\\(door\\) => \\{[\\s\\S]*?roomDoorRow\\(\\s*registry,\\s*door\\.target\\.scene,\\s*door\\.target\\.room,\\s*door\\.target\\.entry,?\\s*\\)",
      "the port no longer drops rows whose destination is out of range",
    );
    has(
      TS_TRANSITION,
      "return !!destination && nativeFacingToEngineDirection\\(destination\\.facing\\) >= 0;",
      "the port no longer treats an unmapped destination as inert",
    );
  });
});

describe("Cầu Vồng portal pads match the Java table", () => {
  it("carries the same thirteen rows, column for column", () => {
    expect(javaPortals()).toEqual(CAU_VONG_PORTAL_ROWS.map((row) => [...row]));
  });
  it("arms the pad tile, warps to the script's own tile and reads the flag column", () => {
    expect(ROUTES).toContain("if(p[0]==room");
    expect(ROUTES).toContain("playerSourcePointInRect(p[1]*20,p[2]*20,20,20)");
    expect(ROUTES).toContain("transition(s,p[3],p[4]*20+10,p[5]*20+19)");
    expect(ROUTES).toContain("CauVongCutsceneSequence.face(-1,p[6])");
    expect(ROUTES).toContain("(p[7]<0||done(s,p[7],p[8]))");
    expect(ROUTES).toContain("for(int[] p:PORTALS)");
    const body = tsBody("export function sourceRoomPortals", "export const roomPortalTriggerRect");
    has(
      body,
      "CAU_VONG_PORTAL_ROWS\\.filter\\(\\(row\\) => row\\[0\\] === room\\)",
      "the pads are no longer picked by room column",
    );
    for (const [column, name] of [
      [4, "SOURCE_TILE_CENTER"],
      [5, "SOURCE_TILE_FEET"],
    ])
      has(
        body,
        `row\\[${column}\\] \\* SOURCE_TILE \\+ ${name}`,
        `the pad arrival no longer uses the ${name} anchor on column ${column}`,
      );
    has(
      body,
      "direction: row\\[6\\]",
      "the pad's own direction column is no longer the arrival facing",
    );
    has(body, "row\\[7\\] >= 0", "an ungated pad is no longer read from the -1 flag column");
    has(
      tsBody("export const roomPortalTriggerRect", "export function roomPortalUnlocked"),
      "x:\\s*portal\\.x \\* SOURCE_TILE",
      "the pad rectangle is no longer one 20px tile at its own column",
    );
  });
  it("scans the pads ahead of the doorway rows, in Java and here", () => {
    expect(ROUTES.indexOf("for(int[] p:PORTALS)")).toBeLessThan(
      ROUTES.indexOf("for(int[] door:DOORS"),
    );
    expect(TS_DISPATCHER.indexOf("for (const portal of this.portals)")).toBeLessThan(
      TS_DISPATCHER.indexOf("for (const door of this.roomDoors)"),
    );
  });
  it("keeps the pads in the chapter scene, and never in another one's same-numbered room", () => {
    has(
      TS_TRANSITION,
      "if\\s*\\(\\s*scene !== CAU_VONG_ROUTE_SCENE\\s*\\)\\s*return\\s*\\[\\s*\\];",
      "the pad table is no longer scoped to the chapter scene",
    );
    expect(int(TS_TRANSITION, "CAU_VONG_ROUTE_SCENE")).toBe(javaInt("SCENE_ID"));
  });
});
