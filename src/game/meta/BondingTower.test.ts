import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyTowerBond,
  craftTowerHearts,
  createTowerState,
  finishTowerBattle,
  nurtureTowerPet,
  towerCanChallenge,
  towerSweepOffer,
  sweepTower,
  type TowerContent,
} from "./BondingTower";

const day = Date.UTC(2026, 10, 15, 7);
const nextDay = day + 86_400_000;

describe("Tháp Gắn Kết progression", () => {
  it("includes all authored rosters and preserves the final floor's factors", () => {
    const url = new URL("../../../public/pack/story/bonding-tower.json", import.meta.url);
    const content = JSON.parse(readFileSync(url, "utf8")) as TowerContent;
    expect(content.floors.map((floor) => floor.floor)).toEqual(
      Array.from({ length: 200 }, (_, index) => index + 1),
    );
    const rosterSet = new Set(
      content.floors.map(({ team }) => [...team].sort((a, b) => a - b).join()),
    );
    expect(rosterSet.size).toBe(200);
    expect(
      content.floors.every(
        ({ floor, team, double }) =>
          team.every((id) => content.pets[id]) && double === (floor % 10 === 0),
      ),
    ).toBe(true);
    expect(content.floors[199]).toMatchObject({
      level: 100,
      quality: 5,
      factors: [6, 3, 2.25, 1.2],
    });
  });

  it("opens one floor at a time and pays each floor once per day", () => {
    const state = createTowerState();
    expect(towerCanChallenge(state, 2)).toBe(false);
    finishTowerBattle(state, 1, false, day);
    expect(state.highest).toBe(0);
    for (let floor = 1; floor <= 6; floor++) finishTowerBattle(state, floor, true, day);
    expect(state).toMatchObject({ highest: 6, fragments: 10, hearts: 1 });
    finishTowerBattle(state, 5, true, day);
    expect(state.hearts).toBe(1);
    finishTowerBattle(state, 6, true, nextDay);
    expect(state.fragments).toBe(10);
    finishTowerBattle(state, 5, true, nextDay);
    expect(state).toMatchObject({ highest: 6, hearts: 2, repeats: 1 });
  });

  it("shares the daily claims across fights and priced sweeps", () => {
    const state = createTowerState(),
      wallet = { badges: 1370 };
    for (let floor = 1; floor <= 40; floor++) finishTowerBattle(state, floor, true, day);
    finishTowerBattle(state, 40, true, nextDay);
    expect(towerSweepOffer(state, nextDay)).toMatchObject({ cost: 0, floors: [36, 37, 38, 39] });
    expect(sweepTower(state, wallet, nextDay)).toBeNull();
    const poorWallet = { badges: 0 };
    expect(sweepTower(state, poorWallet, nextDay)).toMatch(/20 huy hiệu/);
    expect(state.sweeps).toBe(1);
    for (let use = 2; use <= 6; use++) expect(sweepTower(state, wallet, nextDay)).toBeNull();
    expect(wallet.badges).toBe(0);
    expect(state.repeats).toBe(30);
    expect(sweepTower(state, wallet, nextDay)).toMatch(/6 lượt/);
    finishTowerBattle(state, 41, true, nextDay);
    expect(state.highest).toBe(41);
  });

  it("crafts hearts and keeps cultivation on the individual pet", () => {
    const state = { ...createTowerState(), fragments: 42, hearts: 254 };
    const pet = { speciesId: 1, level: 90, quality: 5, currentHp: 100, maxHp: 1000 };
    expect(craftTowerHearts(state, 2)).toBeNull();
    expect(nurtureTowerPet(state, pet, 255, 1000)).toBeNull();
    expect(nurtureTowerPet(state, pet, 1, 1000)).toMatch(/255/);
    expect(state).toMatchObject({ fragments: 2, hearts: 1 });
    expect(pet).toMatchObject({ towerBond: 255, currentHp: 355, maxHp: 1255 });
    expect(applyTowerBond({ hp: 1000, attack: 1000, defense: 1000, speed: 1000 }, 255)).toEqual({
      hp: 1255,
      attack: 1255,
      defense: 1255,
      speed: 1000,
    });
  });
});
