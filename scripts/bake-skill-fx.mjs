// Bake the Cầu Vồng skill effects into the pack (`public/pack/skill-fx`).
//
// The Java client draws a Cầu Vồng skill from one of six atlas groups (`status/rainbow/battle/s0..s5`:
// a PNG plus a binary table of frame rectangles, cells built from those frames, and timed animations
// over the cells), and CV-SKILL-32 from a vertical sheet (`status/vqsv4/skill-animations/32`). This
// script copies the PNGs and turns the binary tables and the sheet's properties into one JSON document,
// so the web build draws every effect without the Java tree. It is a bake step, like the Java tools:
//
//   node scripts/bake-skill-fx.mjs <rebuild_game/src/main/resources/vqsv>
//
// The skill → animation mapping is `RainbowSkillAnimationCatalog.descriptor`: CV-SKILL-n uses group
// min(5, n / 5) and animation n % 5 (n − 25 in group 5); CV-SKILL-32 uses its sheet; Phệ Thuẫn U Minh
// borrows CV-SKILL-20's.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const resources = process.argv[2];
if (!resources) throw new Error("usage: node scripts/bake-skill-fx.mjs <resources/vqsv>");
const out = resolve(import.meta.dirname, "..", "public", "pack", "skill-fx");
mkdirSync(out, { recursive: true });

const GROUP_COUNT = 6,
  SHEET_SKILLS = [32],
  SOURCE_TICK_MS = 60,
  ORIGINAL_TICK_MS = 66;

/** `RainbowSkillAnimationCatalog.Cursor`: big-endian u16 counts, i16 values. */
function readGroup(bytes) {
  let at = 0;
  const u16 = () => {
      if (at + 2 > bytes.length) throw new Error("truncated Cầu Vồng DATA");
      const value = (bytes[at] << 8) | bytes[at + 1];
      at += 2;
      return value;
    },
    i16 = () => {
      const value = u16();
      return value >= 0x8000 ? value - 0x10000 : value;
    },
    matrix = () => Array.from({ length: u16() }, () => Array.from({ length: u16() }, i16)),
    matrix3 = () => Array.from({ length: u16() }, matrix);
  const payload = u16();
  if (payload !== bytes.length - 2) throw new Error("Cầu Vồng DATA envelope mismatch");
  const frames = matrix(),
    cells = matrix3(),
    animations = matrix3();
  if (at !== bytes.length) throw new Error("unread Cầu Vồng DATA bytes");
  return {
    frames: frames.map((frame) => frame.slice(0, 4)),
    cells: cells.map((cell) => cell.map((part) => part.slice(0, 4))),
    animations: animations.map((animation) => animation.map((frame) => frame.slice(0, 2))),
  };
}

/** `AnimationTiming.scaleTicks`: 60 ms source frames spread over 66 ms game ticks. */
function scaleTicks(durations, sourceTickMs) {
  const sourceMs = durations.reduce((sum, d) => sum + Math.max(1, d) * sourceTickMs, 0);
  let remainingTicks = Math.max(
      durations.length,
      Math.max(1, Math.round(sourceMs / ORIGINAL_TICK_MS)),
    ),
    remainingMs = sourceMs;
  return durations.map((duration, i) => {
    const slotsLeft = durations.length - i;
    if (slotsLeft === 1) return Math.max(1, remainingTicks);
    const ideal = Math.max(1, duration) * sourceTickMs;
    let ticks = Math.round((ideal * remainingTicks) / Math.max(1, remainingMs));
    ticks = Math.max(1, Math.min(ticks, remainingTicks - (slotsLeft - 1)));
    remainingTicks -= ticks;
    remainingMs -= ideal;
    return ticks;
  });
}

function properties(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => [
        line.slice(0, line.indexOf("=")).trim(),
        line.slice(line.indexOf("=") + 1).trim(),
      ]),
  );
}

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex"),
  groups = [],
  sheets = [],
  sources = [];
for (let id = 0; id < GROUP_COUNT; id++) {
  const png = resolve(resources, "status/rainbow/battle", `s${id}.png`),
    data = resolve(resources, "status/rainbow/battle", `s${id}.data`);
  copyFileSync(png, resolve(out, `rainbow-s${id}.png`));
  groups.push({ id, image: `rainbow-s${id}`, ...readGroup(readFileSync(data)) });
  sources.push({
    file: `rainbow-s${id}.png`,
    from: `status/rainbow/battle/s${id}.png`,
    sha256: sha(png),
  });
  sources.push({ file: null, from: `status/rainbow/battle/s${id}.data`, sha256: sha(data) });
}
for (const skill of SHEET_SKILLS) {
  const png = resolve(resources, "status/vqsv4/skill-animations", `${skill}.png`),
    props = properties(
      readFileSync(
        resolve(resources, "status/vqsv4/skill-animations", `${skill}.properties`),
        "utf8",
      ),
    );
  copyFileSync(png, resolve(out, `sheet-${skill}.png`));
  sheets.push({
    id: `sheet-${skill}`,
    image: `sheet-${skill}`,
    frameWidth: Number(props.frame_width),
    frameHeight: Number(props.frame_height),
    durationTicks: scaleTicks(props.duration_ticks.split(",").map(Number), SOURCE_TICK_MS),
    anchor: props.anchor,
    anchorX: Number(props.anchor_x),
    anchorY: Number(props.anchor_y),
    originX: Number(props.origin_x),
    originY: Number(props.origin_y),
    globalTransform: Number(props.global_transform),
  });
  sources.push({
    file: `sheet-${skill}.png`,
    from: `status/vqsv4/skill-animations/${skill}.png`,
    sha256: sha(png),
  });
}

const skills = {};
for (let n = 0; n <= 32; n++) {
  const key = `CV-SKILL-${String(n).padStart(2, "0")}`;
  if (SHEET_SKILLS.includes(n)) {
    skills[key] = { sheet: `sheet-${n}` };
    continue;
  }
  const group = Math.min(5, Math.floor(n / 5)),
    animation = group === 5 ? n - 25 : n % 5;
  if (animation < groups[group].animations.length) skills[key] = { group, animation };
}
skills["USER-SKILL-QUY-SHIELD-BREAK"] = skills["CV-SKILL-20"];

writeFileSync(
  resolve(out, "animations.json"),
  JSON.stringify({
    schema: "vqsv-web-skill-fx-v1",
    note: "Baked by scripts/bake-skill-fx.mjs from the Java Cầu Vồng skill effects. groups: frames [x,y,w,h] in the group PNG, cells [frame,dx,dy,transform], animations [cell,ticks] in game ticks. sheets: vertical frame strips with ticks already scaled to the 66 ms game tick. flipToCaster: the two heals the web build always draws over the caster's own seat (Java drew them over the opposite one).",
    groups,
    sheets,
    skills,
    flipToCaster: ["CV-SKILL-27", "CV-SKILL-28"],
    sources,
  }) + "\n",
);
// The 258 pet-design signature effects (`SignatureSkillAnimationCatalog`): each is a few timed events,
// one existing world sprite animation each, drawn on the caster or the target. The sprites themselves
// are baked by ExportScene0WebAssets into the world pack.
const vfx = readFileSync(resolve(resources, "data/pet-design-v1/signature-vfx.tsv"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(1)
    .map((line) => line.split("\t")),
  signatures = {};
for (const [key, sprite, state, anchor, start, end, duration] of vfx) {
  if (anchor !== "caster" && anchor !== "target") throw new Error(`${key}: anchor ${anchor}`);
  const entry = (signatures[key] ??= { duration: Number(duration), events: [] });
  if (entry.duration !== Number(duration)) throw new Error(`${key}: two durations`);
  entry.events.push([Number(sprite), Number(state), anchor, Number(start), Number(end)]);
}
if (Object.keys(signatures).length !== 258) throw new Error("incomplete signature VFX");
writeFileSync(
  resolve(out, "signatures.json"),
  JSON.stringify({
    schema: "vqsv-web-signature-fx-v1",
    note: "Baked by scripts/bake-skill-fx.mjs from data/pet-design-v1/signature-vfx.tsv. Per skill: duration (game ticks the action plays) and events [sprite, state, anchor, startTick, endTick]: a world sprite animation played once from startTick, held on its last frame, until endTick, over the caster or the target, mirrored on the player's side.",
    skills: signatures,
  }) + "\n",
);
console.log(
  `baked ${groups.length} groups, ${sheets.length} sheet(s), ${Object.keys(skills).length} skills`,
);
