// JavaSE owns the room-swap screen as literals: its tick count, bar width, ten-pixel ramp, seven
// elemental tips, exact fillRect geometry and colours are written inline in VqsvMapLoadingRuntime, and
// the gate that decides which room swaps get the screen at all sits in VqsvSceneLoaders, Scene.tick and
// GameFacade. None of them is harvestable data with a callable owner, so this guard re-reads the Java
// sources and refuses the port if any of them moves.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "..");
const java = (...parts) =>
  readFileSync(resolve(repo, "rebuild_game", "src", "main", "java", ...parts), "utf8").replace(
    /\r\n/g,
    "\n",
  );

/** The loading presentation itself: ticks, bar, ramp, tips and pixels. */
const RUNTIME = java("vqsv", "game", "VqsvMapLoadingRuntime.java");
/** The room loader that decides whether a swap shows the screen. */
const LOADERS = java("vqsv", "game", "VqsvSceneLoaders.java");
/** The tick and input owner that holds the whole session behind the screen. */
const GAME = java("vqsv", "game", "VqsvGameRuntime.java");
/** The host loop that refuses the extra x2 tick while the screen runs. */
const FACADE = java("vqsv", "game", "GameFacade.java");

const port = (...parts) =>
  readFileSync(resolve(root, "src", ...parts), "utf8").replace(/\r\n/g, "\n");
const TS_RUNTIME = port("game", "world", "MapLoadingRuntime.ts");
const TS_WORLD = port("game", "world", "WorldRuntime.ts");
const TS_HOST = port("game", "session", "GameplayHost.ts");
const TS_SCREEN = port("screens", "NewGameScreen.ts");
const TS_CLOCK = port("core", "GameplayClock.ts");

/** One `const NAME = <number>` on either side of the port. */
const int = (source, name) => {
  const match =
    source.match(new RegExp(`(?:static final )?int ${name} = (-?\\d+);?`)) ??
    source.match(new RegExp(`const ${name} = (-?\\d+);`));
  expect(match, `${name} is no longer a literal number where it was looked for`).toBeTruthy();
  return Number(match[1]);
};

/** Java writes the Vietnamese tips with \\uXXXX escapes; the port writes them as text. */
const unescape = (text) =>
  text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
const quoted = (body) => [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]);
const javaTips = () => {
  const array = RUNTIME.match(/String\[\] SOURCE_TIPS = \{([\s\S]*?)\n\s*\};/);
  expect(array, "Java no longer declares the SOURCE_TIPS array").toBeTruthy();
  return quoted(array[1]).map(unescape);
};
const tsTips = () => {
  const array = TS_RUNTIME.match(/MAP_LOADING_TIPS = \[([\s\S]*?)\] as const;/);
  expect(array, "the port no longer declares MAP_LOADING_TIPS").toBeTruthy();
  return quoted(array[1]);
};

/** The colour Java paints a given `g.fillRect(...)` call with, read from the `setColor` above it. */
const javaRectColor = (fillRectCall) => {
  const at = RUNTIME.indexOf(fillRectCall);
  expect(at, `Java no longer draws ${fillRectCall}`).toBeGreaterThan(-1);
  const before = RUNTIME.slice(0, at);
  const black = before.lastIndexOf("g.setColor(Color.BLACK);");
  const decimal = before.match(/g\.setColor\(new Color\((\d+)\)\);(?!.*g\.fillRect)/s);
  expect(decimal, `nothing sets a colour before ${fillRectCall}`).toBeTruthy();
  // A `Color.BLACK` line closer than the last decimal one means the rect is painted black.
  if (black > before.lastIndexOf(decimal[0])) return "#000000";
  return `#${Number(decimal[1]).toString(16).padStart(6, "0")}`;
};
/** The `fillStyle` the port paints a given `g.fillRect(...)` call with, from the line above it. */
const tsRectColor = (fillRectCall) => {
  const at = TS_RUNTIME.indexOf(fillRectCall);
  expect(at, `the port no longer draws ${fillRectCall}`).toBeGreaterThan(-1);
  const before = TS_RUNTIME.slice(0, at).match(
    /g\.fillStyle = "#([0-9a-f]{6})";(?!.*g\.fillRect)/s,
  );
  expect(before, `nothing sets a fillStyle before ${fillRectCall}`).toBeTruthy();
  return `#${before[1]}`;
};

describe("map-loading screen port matches the Java source", () => {
  it("keeps Java's tick count, bar width and ten-pixel ramp", () => {
    expect(int(TS_RUNTIME, "MAP_LOADING_TOTAL_TICKS")).toBe(int(RUNTIME, "TOTAL_TICKS"));
    expect(int(TS_RUNTIME, "SOURCE_BAR_WIDTH")).toBe(int(RUNTIME, "SOURCE_BAR_WIDTH"));
    const ramp = RUNTIME.match(
      /int progressPixels\(\) \{\s*return Math\.min\(SOURCE_BAR_WIDTH, elapsedTicks \* (\d+)\);/,
    );
    expect(ramp, "progressPixels no longer ramps elapsedTicks by a literal").toBeTruthy();
    expect(int(TS_RUNTIME, "PROGRESS_PIXELS_PER_TICK")).toBe(Number(ramp[1]));
    expect(TS_RUNTIME).toContain(
      "Math.min(SOURCE_BAR_WIDTH, this.elapsedTicks * PROGRESS_PIXELS_PER_TICK)",
    );
  });

  it("keeps the seven elemental tips in order, and the label they are drawn with", () => {
    expect(tsTips()).toEqual(javaTips());
    const draw = RUNTIME.match(/SOURCE_RANDOM\.a\(\s*"([^"]+)",\s*SOURCE_TIPS\.length/);
    expect(draw, "the tip draw no longer uses the source label and the tip count").toBeTruthy();
    expect(TS_RUNTIME).toContain(`MAP_LOADING_TIP_LABEL = "${draw[1]}"`);
    expect(TS_RUNTIME).toContain("draw(MAP_LOADING_TIP_LABEL, MAP_LOADING_TIPS.length)");
  });

  it("keeps Java's exact frame, bar, tip and colour geometry", () => {
    const rows = [
      [
        "g.fillRect(0, 0, VqsvGameRuntime.W, VqsvGameRuntime.H);",
        "fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT)",
      ],
      [
        "g.fillRect(45, VqsvGameRuntime.H - 48, 150, 5);",
        "fillRect(45, LOGICAL_HEIGHT - 48, 150, 5)",
      ],
      [
        "g.fillRect(46, VqsvGameRuntime.H - 47, SOURCE_BAR_WIDTH, 3);",
        "fillRect(46, LOGICAL_HEIGHT - 47, SOURCE_BAR_WIDTH, 3)",
      ],
      [
        "g.fillRect(46, VqsvGameRuntime.H - 47, progressPixels(), 3);",
        "fillRect(46, LOGICAL_HEIGHT - 47, this.progressPixels(), 3)",
      ],
    ];
    for (const [javaLine, tsLine] of rows) {
      expect(RUNTIME, `Java no longer draws ${javaLine}`).toContain(javaLine);
      expect(TS_RUNTIME, `the port no longer draws ${tsLine}`).toContain(tsLine);
    }
    expect(RUNTIME).toContain(
      "int x = Math.max(0, (VqsvGameRuntime.W - s.font.taggedWidth(text)) / 2);",
    );
    expect(TS_RUNTIME).toContain(
      "const x = Math.max(0, Math.floor((LOGICAL_WIDTH - font.width(this.tip)) / 2));",
    );
    expect(RUNTIME).toContain("s.font.drawTaggedLine(g, text, x, VqsvGameRuntime.H - 70,");
    expect(TS_RUNTIME).toContain('font.draw(g, this.tip, x, LOGICAL_HEIGHT - 70, "#ffffff")');
    expect(tsRectColor("g.fillRect(46, LOGICAL_HEIGHT - 47, SOURCE_BAR_WIDTH, 3);")).toBe(
      javaRectColor("g.fillRect(46, VqsvGameRuntime.H - 47, SOURCE_BAR_WIDTH, 3);"),
    );
    expect(tsRectColor("g.fillRect(46, LOGICAL_HEIGHT - 47, this.progressPixels(), 3);")).toBe(
      javaRectColor("g.fillRect(46, VqsvGameRuntime.H - 47, progressPixels(), 3);"),
    );
  });

  it("shows the screen on a room change, and on the session's first room", () => {
    for (const line of [
      "boolean roomChanged = !s.session.world.useMap",
      "|| previousScene != room.sceneId",
      "|| previousRoom != room.roomIndex;",
      "if (roomChanged && showMapLoading) {",
    ])
      expect(LOADERS, `loadCanonicalRoom no longer reads ${line}`).toContain(line);
    expect(TS_WORLD).toContain(
      "const roomChanged = !this.mapLoaded || previousScene !== scene || previousRoom !== room;",
    );
    expect(TS_WORLD).toContain("this.mapLoading = MapLoadingRuntime.begin(");
  });

  it("holds the whole session behind the screen and refuses the extra x2 tick", () => {
    expect(GAME).toContain("&& this.sourceMapLoading.tick(this)) {");
    expect(TS_HOST).toContain("if (this.world?.tickMapLoading()) {");
    expect(FACADE).toContain("if (scene.speedX2Enabled() && !scene.sourceMapLoadingActive()) {");
    expect(TS_CLOCK).toContain("if (this.speedX2 && !speedX2Suppressed()) tick(input.heldOnly());");
    expect(TS_SCREEN).toContain("return this.host.mapLoadingActive;");
  });

  it("samples no pointer input while the screen owns the frame", () => {
    /** The Java input entry points that read `sourceMapLoading.active()` before routing anything. */
    for (const method of ["pointerPressedGame", "pointerMovedGame", "clickGame", "mouseWheel"]) {
      const at = GAME.indexOf(`void ${method}(`);
      expect(at, `Java no longer owns ${method}`).toBeGreaterThan(-1);
      expect(
        GAME.slice(at, at + 400).includes("sourceMapLoading.active()"),
        `Java no longer gates ${method} behind the load screen`,
      ).toBe(true);
    }
    for (const method of ["pointer(", "pointerPress(", "pointerMove(", "wheel("]) {
      const at = TS_HOST.indexOf(`\n  ${method}`);
      expect(at, `the port no longer owns ${method}`).toBeGreaterThan(-1);
      expect(
        TS_HOST.slice(at, at + 260).includes("this.mapLoadingActive"),
        `the port no longer gates ${method} behind the load screen`,
      ).toBe(true);
    }
  });
});
