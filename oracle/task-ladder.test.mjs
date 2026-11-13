// The main task ladder is one integer, `session.story.mainTaskProgress`, and the chapter gates read
// it directly (`CauVongChapterRuntime` opens only at >= 48). In Java the opcode that writes it is
// op45: `taskNoticeOp45` sets the flag and then shows the tip in the same tick, so every rung of the
// ladder is announced by a script record the exported pack already carries. A port that drops the
// write cannot reach a gated chapter by playing, however correct its maps are. This guard re-reads
// the two Java owners, the exported rows, and the port's compile of the opcode.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "..");
const java = (...parts) =>
  readFileSync(resolve(repo, "rebuild_game", "src", "main", "java", ...parts), "utf8");
const port = (...parts) => readFileSync(resolve(root, "src", ...parts), "utf8");
const packFile = (...parts) =>
  JSON.parse(readFileSync(resolve(root, "public", "pack", ...parts), "utf8"));

const SUPPORT = java("vqsv", "game", "VqsvSceneScriptSupport.java");
const RUNTIME = java("vqsv", "game", "VqsvGameRuntime.java");
const CHAPTER = java("vqsv", "game", "CauVongChapterRuntime.java");
const INTERPRETER = port("game", "story", "SourceOpcodeInterpreter.ts");
const SCENE = port("game", "story", "StorySceneRuntime.ts");
const FLAGS = port("game", "world", "WorldFlags.ts");

const TASKS = packFile("story", "main-tasks.json").tasks;

/** One method body, from its signature to the closing brace at the file's indent. */
function method(source, signature, indent) {
  const start = source.indexOf(signature);
  expect(start, `${signature} no longer exists`).toBeGreaterThan(-1);
  const end = source.indexOf(`\n${indent}}`, start);
  expect(end, `${signature} no longer ends at indent ${indent.length}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

/** Every op45 record the exported Liệt Hỏa scenes carry, with the group and the tip it announces. */
const op45Rows = (() => {
  const rows = [];
  for (const scene of packFile("story", "event-scenes.json").scenes)
    for (const room of scene.rooms)
      for (const group of room.eventGroups ?? [])
        for (const record of group.records)
          if (record.opcode === 45)
            rows.push({
              ref: `${scene.sceneId}:${room.roomIndex}:${group.group_index}`,
              flag: record.short_args[0],
              tip: record.string_args[0]?.text ?? "",
            });
  return rows;
})();

it("keeps op45 the ladder's writer and the tip its only companion", () => {
  const notice = method(
    SUPPORT,
    "static Event taskNoticeOp45(int taskFlag, String text, String routeLabel)",
    "    ",
  );
  // The flag goes in first: the write belongs to the tick the tip opens, not to the key that closes it.
  expect(notice.indexOf("s.sourceSetMainTaskProgress(taskFlag,")).toBeGreaterThanOrEqual(0);
  expect(notice.indexOf("s.sourceSetMainTaskProgress(taskFlag,")).toBeLessThan(
    notice.indexOf("s.text = TextBox.taskTip(text);"),
  );
  expect(notice.indexOf("s.text = TextBox.taskTip(text);")).toBeLessThan(
    notice.indexOf("return waitForText();"),
  );
  // The plain notice the Scene 1 return-to-elder tip uses writes nothing at all.
  const plain = method(SUPPORT, "static Event taskNotice(String text)", "    ");
  expect(plain).not.toContain("MainTaskProgress");
  // The owner is a bare clamp-and-assign: nothing else in Java moves the ladder from an op45.
  const write = method(RUNTIME, "void sourceSetMainTaskProgress(int var1, String var2)", "      ");
  expect(write).toContain("this.session.story.mainTaskProgress = Math.max(0, var1);");
  expect(write.match(/mainTaskProgress =/g)).toHaveLength(1);
});

it("keeps the port compiling op45 to the write and the tip, in that order", () => {
  const start = INTERPRETER.indexOf("if (opcode === 45)");
  expect(start, "the interpreter no longer compiles opcode 45").toBeGreaterThan(-1);
  const compiled = INTERPRETER.slice(start, INTERPRETER.indexOf("];", start));
  expect(compiled).toContain('{ type: "taskProgress", flag: s[0] ?? 0 }');
  expect(compiled).toContain('kind: "tasktip"');
  expect(compiled.indexOf("taskProgress")).toBeLessThan(compiled.indexOf("tasktip"));
  // The write happens on the tick the event first runs, so it lands with the tip, not after it.
  const handled = SCENE.slice(SCENE.indexOf('if (e.type === "taskProgress")'));
  expect(handled).toContain("if (elapsed === 1) this.services.taskProgress?.(e.flag);");
  // The scalar is stored exactly as Java stores it: clamped at zero, and never held back once raised.
  expect(FLAGS).toContain("this.mainTaskProgress = Math.max(0, progress);");
});

it("exports a writer for every ladder row the gates count", () => {
  expect(TASKS).toHaveLength(49);
  const flags = [...new Set(op45Rows.map((row) => row.flag))].sort((a, b) => a - b);
  expect(flags).toEqual(Array.from({ length: 48 + 1 }, (_, flag) => flag));
  for (const row of op45Rows) expect(TASKS[row.flag], `${row.ref} names no task`).toBeDefined();
});

it("keeps the chapter gate inside the ladder the scripts announce", () => {
  expect(CHAPTER).toContain("s.session.story.mainTaskProgress >= 48");
  const epilogue = op45Rows.filter((row) => row.flag === 48);
  expect(epilogue.map((row) => row.ref)).toEqual(["1:2:4"]);
  // The tip is the sentence the game shows, the row name the card's title: Java authors both, and
  // only the flag ties them.
  expect(epilogue[0].tip.length).toBeGreaterThan(0);
  expect(TASKS[48].name.length).toBeGreaterThan(0);
});
