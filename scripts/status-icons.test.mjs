// The buff and debuff icons the game shows are cells of one 12x12 sprite sheet. Which cell belongs to
// which status is no longer restated here: `BattleStatusPresentationProjector` is harvested into
// `public/pack/data/battle/status-mechanics.json` by the Java bake, and this guard reads that table and
// checks the shipped bytes behind it. A re-baked sheet, a re-decoded sprite table, a cell the pack does
// not declare, or a bake that stops agreeing with the projector fails here instead of putting the wrong
// picture next to the right name.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "..");

/** `BattleStatusPresentationProjector`: the Liệt Hỏa icons are cells of this sprite. */
const ICON_SPRITE = 325;
/** `SpriteTable` row 325: the one sheet that sprite's cells are cut from. */
const ICON_SHEET_IMAGE = 804;
/** `VqsvBattleRenderer.durationCell`: the remaining-round badges sit in this sprite. */
const DURATION_SPRITE = 257;
/** The counts and names the source catalog owns, read out of the bake instead of written out here. */
const readData = (file) =>
  JSON.parse(readFileSync(resolve(root, "public", "pack", "data", "battle", file), "utf8"));
const statusRows = readData("statuses.json");
const mechanics = readData("status-mechanics.json");
/**
 * `BattleStatusPresentationProjector.project`, as the bake harvested it: the Liệt Hỏa icons are cells of
 * one sprite sheet and the source is the only place that says which cell belongs to which status, so
 * the cells are read out of `battle/status-mechanics.json` rather than restated here. What this guard
 * adds on top of that harvest is the shipped bytes: a cell the table names must exist in the pack and
 * must be the picture the source sprite table cuts.
 */
const presentation = mechanics.statusPresentation;
/** `LietHoaStatusCatalog.BUFF_COUNT` / `DEBUFF_COUNT`: the two rule tables the bake dumped. */
const BUFF_COUNT = mechanics.buffRules.length;
const DEBUFF_COUNT = readData("debuff-producers.json").rules.length;
/** `LietHoaStatusCatalog.BUFF_NAMES` / `DEBUFF_NAMES`, in id order, as the catalog spells them. */
const lietHoaNames = (bank, count) =>
  statusRows
    .filter((row) => row.sourceBank === bank && row.sourceNumericId < count)
    .sort((a, b) => a.sourceNumericId - b.sourceNumericId)
    .map((row) => row.displayName);
const BUFF_NAMES = lietHoaNames(0, BUFF_COUNT);
const DEBUFF_NAMES = lietHoaNames(1, DEBUFF_COUNT);

/** An 8-bit PNG, decoded to RGBA. These sheets are palette or truecolor, never interlaced. */
function decodePng(file) {
  const buf = readFileSync(file);
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette = null;
  let transparent = null;
  const data = [];
  for (;;) {
    const length = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const chunk = buf.subarray(off + 8, off + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      colorType = chunk[9];
      expect(chunk[8], `${file} is not 8-bit`).toBe(8);
      expect(chunk[12], `${file} is interlaced`).toBe(0);
    } else if (type === "PLTE") palette = chunk;
    else if (type === "tRNS") transparent = chunk;
    else if (type === "IDAT") data.push(chunk);
    else if (type === "IEND") break;
    off += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 3 ? 1 : 0;
  expect(channels, `${file} has color type ${colorType}`).toBeGreaterThan(0);
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  let current = new Uint8Array(stride);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at++];
    const line = raw.subarray(at, at + stride);
    at += stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? current[i - channels] : 0;
      const up = previous[i];
      const corner = i >= channels ? previous[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const a = Math.abs(up - corner);
        const b = Math.abs(left - corner);
        const c = Math.abs(left + up - 2 * corner);
        value += a <= b && a <= c ? left : b <= c ? up : corner;
      } else expect(filter, `${file} scanline ${y} has filter ${filter}`).toBe(0);
      current[i] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4;
      if (colorType === 3) {
        const index = current[x];
        rgba[out] = palette[index * 3];
        rgba[out + 1] = palette[index * 3 + 1];
        rgba[out + 2] = palette[index * 3 + 2];
        rgba[out + 3] = transparent && transparent.length > index ? transparent[index] : 255;
      } else {
        for (let k = 0; k < 3; k++) rgba[out + k] = current[x * channels + k];
        rgba[out + 3] = channels === 4 ? current[x * channels + 3] : 255;
      }
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return { width, height, rgba };
}

/**
 * `SpriteData.load`: a frame table, then a cell table that points each cell at one frame, then a
 * fixed 12-byte metadata block. The parse has to consume the file exactly, or a format this guard
 * does not understand would be read as if it were the one it does.
 */
function parseSprite(file) {
  const buf = readFileSync(file);
  const word = (at) => buf.readUInt16BE(at);
  const frameCount = word(0);
  let at = 4;
  const frames = [];
  for (let index = 0; index < frameCount; index++) {
    frames.push({
      slot: word(at),
      x: word(at + 2),
      y: word(at + 4),
      w: word(at + 6),
      h: word(at + 8),
    });
    at += 10;
  }
  const cellCount = word(at);
  const columns = word(at + 2);
  at += 4;
  const cells = [];
  for (let index = 0; index < cellCount; index++) {
    cells.push({ states: word(at), frame: word(at + 2), dx: word(at + 4), dy: word(at + 6) });
    at += 10;
  }
  return { frames, cells, columns, body: at, length: buf.length };
}

function cellFile(sprite, index) {
  return resolve(root, "public", "pack", "ui", "cell", String(sprite), `cell-${index}.png`);
}

const sheet = decodePng(
  resolve(repo, "modules", "img", "decoded", `data__img__img_${ICON_SHEET_IMAGE}.mid.png`),
);
const sprite = parseSprite(
  resolve(repo, "modules", "spr", "original", `spr_${ICON_SPRITE}_all(r)`),
);

describe("status icons", () => {
  it("ships a sheet whose every cell is the source image at the rect the sprite table names", () => {
    expect(sprite.body + 12, "the sprite table has a tail this guard does not account for").toBe(
      sprite.length,
    );
    expect(sprite.frames.length).toBe(27);
    expect(sprite.cells.length).toBe(27);
    for (const frame of sprite.frames) {
      expect(frame.slot).toBe(0);
      expect(frame.w).toBe(12);
      expect(frame.h).toBe(12);
      expect(frame.x + frame.w).toBeLessThanOrEqual(sheet.width);
      expect(frame.y + frame.h).toBeLessThanOrEqual(sheet.height);
    }
    for (let cell = 0; cell < sprite.cells.length; cell++) {
      const entry = sprite.cells[cell];
      expect(entry.states, `cell ${cell} animates, so one PNG cannot hold it`).toBe(1);
      expect(entry.dx, `cell ${cell} is offset`).toBe(0);
      expect(entry.dy, `cell ${cell} is offset`).toBe(0);
      const frame = sprite.frames[entry.frame];
      const baked = decodePng(cellFile(ICON_SPRITE, cell));
      expect([baked.width, baked.height], `cell ${cell} size`).toEqual([frame.w, frame.h]);
      for (let y = 0; y < frame.h; y++) {
        for (let x = 0; x < frame.w; x++) {
          const source = ((frame.y + y) * sheet.width + (frame.x + x)) * 4;
          const mine = (y * baked.width + x) * 4;
          // Alpha is what reaches the screen. The RGB of a transparent pixel does not, and the
          // exporter zeroes it, so only a difference a player could see is a difference.
          expect(baked.rgba[mine + 3], `cell ${cell} alpha at ${x},${y}`).toBe(
            sheet.rgba[source + 3],
          );
          if (sheet.rgba[source + 3] === 0) continue;
          for (let k = 0; k < 3; k++) {
            expect(baked.rgba[mine + k], `cell ${cell} channel ${k} at ${x},${y}`).toBe(
              sheet.rgba[source + k],
            );
          }
        }
      }
    }
  });

  it("gives every Liệt Hỏa status its own icon, and every status an icon that exists", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "public", "pack", "pack.json"), "utf8"));
    const domain = manifest.domains.find((row) => row.id === "ui-cell");
    const iconSet = domain.sets.find((row) => row.sprite === ICON_SPRITE);
    const durationSet = domain.sets.find((row) => row.sprite === DURATION_SPRITE);
    expect(iconSet.available).toEqual({ start: 0, count: 27 });
    expect(iconSet.used).toEqual({ start: 1, count: 26 });
    for (let cell = 0; cell < 27; cell++)
      expect(existsSync(cellFile(ICON_SPRITE, cell))).toBe(true);

    // Which cell belongs to which status is the projector's answer, harvested into the pack, so this
    // guard stops restating it and checks the thing the harvest cannot: that the picture it names is
    // shipped, inside the cell range the pack declares for that sprite.
    const atlas = new Map();
    for (const row of presentation.rows) {
      if (!row.visible || row.iconKind !== "LIET_HOA_ATLAS") continue;
      const cell = row.lietHoaAtlasCell;
      atlas.set(`${row.sourceBank}:${row.sourceNumericId}`, cell);
      const inRange = cell >= iconSet.available.start && cell < iconSet.available.count;
      expect(inRange, `${row.stableKey} points at cell ${cell}`).toBe(true);
      expect(existsSync(cellFile(ICON_SPRITE, cell)), `${row.stableKey} cell ${cell}`).toBe(true);
    }
    const lietHoaCells = [];
    for (let id = 0; id < DEBUFF_COUNT; id++) lietHoaCells.push(atlas.get(`1:${id}`));
    for (let id = 0; id < BUFF_COUNT; id++) lietHoaCells.push(atlas.get(`0:${id}`));
    expect(
      lietHoaCells.every((cell) => cell !== undefined),
      "a Liệt Hỏa status has no icon",
    ).toBe(true);
    expect(new Set(lietHoaCells).size, "the 26 Liệt Hỏa icons must not overlap").toBe(26);
    // The signature statuses above the Liệt Hỏa half of bank 0 are drawn with a Liệt Hỏa buff's
    // picture on purpose, which is why the strip shows them without any new art on the sheet.
    for (const [key, cell] of atlas) {
      if (!key.startsWith("0:") || Number(key.slice(2)) < BUFF_COUNT) continue;
      expect(lietHoaCells, `signature status ${key} reuses a Liệt Hỏa buff`).toContain(cell);
    }

    // `VqsvBattleRenderer.durationCell`, also harvested: the badge beside an icon, including the empty
    // and saturated cells the strip falls back to.
    const badge = presentation.durationBadge;
    expect(badge.cells.length).toBe(badge.sampleMax - badge.sampleMin + 1);
    for (const row of badge.cells) {
      expect(
        row.cell >= durationSet.available.start && row.cell < durationSet.available.count,
        `duration ${row.duration} points at cell ${row.cell}`,
      ).toBe(true);
      expect(existsSync(cellFile(DURATION_SPRITE, row.cell)), `cell ${row.cell}`).toBe(true);
    }
    for (const duration of [badge.sampleMin - 50, badge.sampleMax + 50]) {
      const clamped = Math.max(badge.sampleMin, Math.min(duration, badge.sampleMax));
      expect(
        badge.cells.find((row) => row.duration === clamped).cell,
        `duration ${duration} clamps to the flat end of the sample`,
      ).toBe(badge.saturatedCell);
    }
  });

  it("ships the Cầu Vồng pictures the source has bytes for, and no others", () => {
    // `VqsvBattleRenderer.rainbowStatusIcon` opens the resource path the projector names and draws
    // whatever the classpath hands back — including nothing at all when it hands back nothing. The bake
    // hashed exactly those bytes, so a shipped icon is only correct if it is the same file, and a path
    // the source has no bytes for must stay unshipped: inventing art there is what puts a picture on
    // the screen that the baseline battle never shows.
    const manifest = JSON.parse(readFileSync(resolve(root, "public", "pack", "pack.json"), "utf8"));
    const entries = manifest.domains.find((domain) => domain.id === "status-icon")?.entries;
    expect(entries, "the pack declares no status-icon domain").toBeTruthy();
    const shipped = new Map(entries.map((entry) => [entry.name, entry.file]));
    const digestOf = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

    for (const row of presentation.rows) {
      if (!row.visible || row.iconKind !== "RAINBOW_RESOURCE") continue;
      const name = row.resourcePath
        .split("/")
        .pop()
        .replace(/\.png$/, "");
      const file = resolve(root, "public", "pack", `status/rainbow/${name}.png`);
      if (!row.resourceSha256) {
        expect(
          shipped.has(name) || existsSync(file),
          `${row.stableKey} draws nothing in the source but the pack ships ${name}`,
        ).toBe(false);
        continue;
      }
      expect(shipped.get(name), `${row.stableKey} ships from the wrong file`).toBe(
        `status/rainbow/${name}.png`,
      );
      const entry = entries.find((candidate) => candidate.name === name);
      expect(
        digestOf(resolve(repo, entry.from)),
        `${name} is not the Java resource it claims`,
      ).toBe(row.resourceSha256);
      expect(digestOf(file), `${name} is not the byte the source draws`).toBe(row.resourceSha256);
    }
    // e1 and e2 exist in the source tree but belong to the two Cầu Vồng ids the projector refuses,
    // so shipping them would declare art nothing can reach.
    expect([...shipped.keys()].sort()).toEqual(["e0", "e3", "e4", "e5", "e6"]);
  });

  it("lists the help screen's statuses in the order their icons are drawn", () => {
    // `VqsvPanelRuntime.renderHelp` walks entry 0..25 and draws cell `entry + 1`, so entry order is
    // the cell order: the eleven debuffs first, then the fifteen buffs.
    const expected = [...DEBUFF_NAMES, ...BUFF_NAMES];
    expect(expected.length).toBe(26);

    // `VqsvPanelRuntime.helpEffectText`: the name comes out of the decoded string table, which is the
    // authority on spelling and on order.
    const chs = JSON.parse(
      readFileSync(
        resolve(repo, "modules", "script", "decoded", "data__script__chs.mid.json"),
        "utf8",
      ),
    );
    const token = (entry) => chs.rows[entry <= 10 ? 311 + entry : 333 + entry - 11].join("|");
    expect([...Array(26).keys()].map(token)).toEqual(expected);

    // The port's own list, read out of the screen that renders it.
    const source = readFileSync(resolve(root, "src", "screens", "TitleScreen.ts"), "utf8");
    const start = source.indexOf("const HELP = [");
    expect(start, "TitleScreen no longer declares HELP inline").toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("];", start));
    const help = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(help).toEqual(expected);
  });
});
