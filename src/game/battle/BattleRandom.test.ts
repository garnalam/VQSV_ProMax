import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JavaRandom } from "../../core/JavaRandom";
import type { GoldenRngTable } from "../../data/GameData";
import { BATTLE_SEED, BattleRandom } from "./BattleRandom";

const table: GoldenRngTable = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "..", "..", "..", "public/pack/data/battle/golden-rng.json"),
    "utf8",
  ),
);

/** One answer the Java engine wrote, with the seed it came from. */
type RngRow = { seed: number; raw: number; percent: number };

function rows(table: GoldenRngTable): RngRow[] {
  return table.streams.flatMap((stream) =>
    stream.raw.map((raw, index) => ({ seed: stream.seed, raw, percent: stream.percent[index] })),
  );
}

/** Every row the port's stream answers differently from the Java engine's table. */
function disagreements(table: GoldenRngTable): RngRow[] {
  const wrong: RngRow[] = [];
  for (const stream of table.streams) {
    const raw = new JavaRandom(stream.seed);
    const percent = new BattleRandom(stream.seed);
    stream.raw.forEach((answer, index) => {
      // Both streams draw on every row: a short-circuited `||` would leave the percent generator
      // behind the table and report one edit as a cascade.
      const rawAnswer = raw.nextInt();
      const percentAnswer = percent.percent("battle.P7.test");
      if (rawAnswer !== answer || percentAnswer !== stream.percent[index])
        wrong.push({ seed: stream.seed, raw: answer, percent: stream.percent[index] });
    });
  }
  return wrong;
}

/** `raw % 100` on the signed draw: what a port that forgot Java's unsigned shift answers. */
function signedModuloStream(seed: number, count: number): number[] {
  const random = new JavaRandom(seed);
  return Array.from({ length: count }, () => {
    const signed = random.nextInt();
    return ((signed % 100) + 100) % 100;
  });
}

/** The same generator without `setSeed`'s xor, which is the other half of Java's seeding. */
function unseededStream(seed: number, count: number): number[] {
  let state = BigInt(seed) & ((1n << 48n) - 1n);
  return Array.from({ length: count }, () => {
    state = (state * 0x5deece66dn + 0xbn) & ((1n << 48n) - 1n);
    return ((Number(state >> 16n) | 0) >>> 1) % 100;
  });
}

describe("battle random stream", () => {
  it("replays every draw the Java engine wrote", () => {
    expect(table.streams.length).toBe(6);
    expect(rows(table)).toHaveLength(192);
    expect(disagreements(table)).toEqual([]);
    // The seeds the probe wrote include a negative one, so the mask on setSeed is graded too.
    expect(table.streams.map((stream) => stream.seed)).toContain(-1);
  });

  it("answers (raw >>> 1) % bound, and records each draw by its label", () => {
    const stream = table.streams[0];
    const random = new BattleRandom(stream.seed);
    expect(Array.from({ length: 3 }, () => random.next("battle.P17.catch", 100))).toEqual(
      stream.percent.slice(0, 3),
    );
    expect(random.draws()).toEqual(stream.percent.slice(0, 3).map((v) => `battle.P17.catch=${v}`));

    // A bound other than 100 walks the same raw stream, so `percent` is `next(label, 100)` and the
    // first bound-3 answer is the Java engine's own first raw shifted, taken modulo 3.
    const bounded = new BattleRandom(stream.seed);
    expect(bounded.next("battle.npcCharm.select", 3)).toBe(((stream.raw[0] >>> 1) % 3) | 0);
    expect(bounded.draws()).toHaveLength(1);
    expect(new BattleRandom(stream.seed).percent("x")).toBe(
      new BattleRandom(stream.seed).next("x", 100),
    );

    // A battle that names no seed starts from the port's fixed one, and that seed is a row the Java
    // engine wrote, so the default stream is a replayable one and not an invented one.
    const zero = table.streams.find((entry) => entry.seed === 0);
    expect(BATTLE_SEED).toBe(0n);
    expect(new BattleRandom().percent("battle.P7.test")).toBe(zero?.percent[0]);
  });

  it("has teeth: the shift and the seeding are the engine's own", () => {
    const noShift = table.streams.flatMap((stream) =>
      signedModuloStream(stream.seed, stream.percent.length).filter(
        (value, index) => value !== stream.percent[index],
      ),
    );
    const unseeded = table.streams.flatMap((stream) =>
      unseededStream(stream.seed, stream.percent.length).filter(
        (value, index) => value !== stream.percent[index],
      ),
    );
    expect(noShift).toHaveLength(190);
    expect(unseeded).toHaveLength(189);

    // An edited answer fails the same grading the suite runs above.
    const drifted: GoldenRngTable = {
      ...table,
      streams: table.streams.map((stream, index) =>
        index === 0
          ? { ...stream, percent: stream.percent.map((v, i) => (i === 0 ? v + 1 : v)) }
          : stream,
      ),
    };
    expect(disagreements(drifted)).toHaveLength(1);
    const rawDrifted: GoldenRngTable = {
      ...table,
      streams: table.streams.map((stream, index) =>
        index === 3 ? { ...stream, raw: stream.raw.map((v, i) => (i === 5 ? v + 1 : v)) } : stream,
      ),
    };
    expect(disagreements(rawDrifted)).toHaveLength(1);
  });
});
