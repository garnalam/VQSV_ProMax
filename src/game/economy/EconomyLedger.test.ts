import { describe, expect, it } from "vitest";
import type { SavedPet } from "../../persistence/save/GameSave";
import { EconomyLedger } from "./EconomyLedger";

const pet = (speciesId: number, level = 5): SavedPet & { uid?: string } => ({ speciesId, level, quality: 2 });

describe("money and pet log (owner, 2026-11-16)", () => {
  it("the first look learns the state: pets get a uid as baseline, money is not a line", () => {
    const ledger = new EconomyLedger(undefined, () => 1),
      pets = [pet(68), pet(70)];
    ledger.observe(100, pets, "world");
    const { entries, seq } = ledger.snapshot();
    expect(seq).toBe(2);
    expect(entries.map((e) => [e.kind, e.source])).toEqual([["pet+", "baseline"], ["pet+", "baseline"]]);
    expect(pets.every((p) => typeof p.uid === "string" && p.uid.length === 16)).toBe(true);
  });

  it("logs money changes and pets gained or lost with the source of the moment", () => {
    const ledger = new EconomyLedger(),
      pets = [pet(68)];
    ledger.observe(100, pets, "world");
    ledger.observe(150, pets, "battle:wild");
    pets.push(pet(90, 3));
    ledger.observe(150, pets, "battle:wild");
    const gone = pets.shift()!;
    ledger.observe(120, pets, "panel:worldShop");
    const lines = ledger.snapshot().entries.slice(1).map((e) => [e.kind, e.amount ?? e.pet?.speciesId, e.source]);
    expect(lines).toEqual([
      ["money", 50, "battle:wild"],
      ["pet+", 90, "battle:wild"],
      ["money", -30, "panel:worldShop"],
      ["pet-", gone.speciesId, "panel:worldShop"],
    ]);
  });

  it("a named source (a letter) wins over the context, and the log carries on after a reload", () => {
    const ledger = new EconomyLedger(),
      pets = [pet(68)];
    ledger.observe(0, pets, "world");
    ledger.expect("mail:7");
    pets.push(pet(12));
    ledger.observe(500, pets, "panel:gamemenu");
    const reloaded = new EconomyLedger(structuredClone(ledger.snapshot()));
    // The pets come back from the save with their uids: nothing new to log on the first look.
    reloaded.observe(500, structuredClone(pets), "world");
    expect(reloaded.snapshot().seq).toBe(ledger.snapshot().seq);
    expect(ledger.snapshot().entries.slice(1).map((e) => e.source)).toEqual(["mail:7", "mail:7"]);
  });

  it("a copied pet (two with one uid) gets a new uid of its own", () => {
    const ledger = new EconomyLedger(),
      pets = [pet(68)];
    ledger.observe(0, pets, "world");
    pets.push({ ...pets[0] });
    ledger.observe(0, pets, "event:1:2:3");
    expect(pets[0].uid).not.toBe(pets[1].uid);
    expect(ledger.snapshot().entries.at(-1)).toMatchObject({ kind: "pet+", source: "event:1:2:3" });
  });
});
