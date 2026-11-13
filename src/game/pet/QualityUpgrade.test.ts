import { describe, expect, it } from "vitest";
import type { SavedPet } from "../../persistence/save/GameSave";
import {
  CHARGE_COMMIT_TICK,
  attemptQualityUpgrade,
  combinedRateBasisPoints,
  contributionBasisPoints,
  qualityAfterFailure,
  qualityPercent,
  qualityReason,
  resultDurationTicks,
  validateQualityUpgrade,
  type QualityRules,
} from "./QualityUpgrade";
import { QualityUpgradeSession } from "./QualityUpgradeSession";

const pet = (speciesId: number, quality: number, extra: Partial<SavedPet> = {}): SavedPet =>
  ({ slot: 0, speciesId, level: 10, quality, experience: 0, ...extra }) as SavedPet;
/** Species 2 evolved from 1, which evolved from 0; 9 is unrelated; 7 is protected. */
const rules: QualityRules = {
  formDistance: (main, fodder) =>
    main === fodder ? 0 : main === 2 && fodder === 1 ? 1 : main === 2 && fodder === 0 ? 2 : -1,
  protectedPet: (p) => p.speciesId === 7,
  maxHp: (p) => 100 + p.quality * 10,
};

describe("PetQualityUpgradeService rules", () => {
  it("rates by stars and form distance, and two same-star phôi add up", () => {
    const main = pet(2, 3);
    expect(contributionBasisPoints(rules, main, pet(2, 3))).toBe(1800);
    expect(contributionBasisPoints(rules, main, pet(1, 3))).toBe(1260);
    expect(contributionBasisPoints(rules, main, pet(0, 2))).toBe(360);
    expect(combinedRateBasisPoints(rules, main, [pet(2, 3), pet(1, 3)])).toBe(3060);
    expect(combinedRateBasisPoints(rules, pet(2, 1), [pet(2, 1), pet(2, 1)])).toBe(8000);
    expect(qualityAfterFailure(3)).toBe(3);
    expect(qualityAfterFailure(4)).toBe(3);
    expect([qualityPercent(1800), qualityPercent(1260), qualityPercent(5)]).toEqual([
      "18%",
      "12,6%",
      "0,0%",
    ]);
  });

  it("rejects every case JavaSE names, with its line", () => {
    const main = pet(2, 3),
      leader = pet(2, 1),
      roster = [leader, main, pet(9, 1), pet(7, 1), pet(2, 4), pet(2, 2), pet(2, 3)];
    const reason = (fodders: SavedPet[], m = main) => {
      const v = validateQualityUpgrade(rules, roster, [], m, fodders);
      return v.valid ? "ok" : qualityReason(v.reason);
    };
    expect(reason([], pet(2, 5))).toBe("Không thể nâng phẩm với lựa chọn này");
    expect(reason([])).toBe("Hãy chọn ít nhất 1 Pet phôi");
    expect(reason([leader])).toBe("Pet đang xuất chiến không thể làm phôi");
    expect(reason([roster[2]])).toBe("Chỉ dùng cùng form hoặc form tiến hóa trước");
    expect(reason([roster[3]])).toBe("Pet bảo hộ không thể làm phôi");
    expect(reason([roster[4]])).toBe("Sao phôi không được cao hơn Pet chính");
    expect(reason([roster[5], roster[6]])).toBe("Hai Pet phôi phải cùng số sao");
    expect(reason([roster[6], roster[6]])).toBe("Hai ô không thể dùng cùng một Pet");
    expect(reason([roster[6]])).toBe("ok");
  });

  it("consumes the phôi, returns their gear and scales the main pet's HP", () => {
    const main = pet(2, 3, { currentHp: 65 }),
      fodder = pet(2, 3, { heldEquipmentId: 4 }),
      roster = [pet(9, 1), main, fodder],
      equipment: number[] = [];
    const won = attemptQualityUpgrade(rules, roster, [], equipment, main, [fodder], 1799);
    expect(won).toMatchObject({ outcome: "SUCCESS", qualityBefore: 3, qualityAfter: 4 });
    expect(roster).toEqual([roster[0], main]);
    expect(roster.map((p) => p.slot)).toEqual([0, 1]);
    expect(equipment).toEqual([4]);
    expect(main.currentHp).toBe(Math.trunc((65 * 140 + 65) / 130));
    const second = pet(2, 4);
    roster.push(second);
    const lost = attemptQualityUpgrade(rules, roster, [], equipment, main, [second], 1800);
    expect(lost).toMatchObject({ outcome: "FAILURE", qualityAfter: 3 });
  });
});

describe("Nâng phẩm screen (tickQualityUpgrade)", () => {
  it("picks a phôi, charges, rolls and hands back on the main pet", () => {
    const main = pet(2, 2),
      fodder = pet(1, 2),
      roster = [pet(9, 1), main, fodder],
      session = new QualityUpgradeSession(
        { roster, bank: [], equipment: [], rules, roll: () => 0 },
        main,
      );
    expect(session.status).toBe("Chọn 1 hoặc 2 Pet phôi");
    session.tick(["confirm"]);
    expect([session.pickerVisible, session.candidates]).toEqual([true, [fodder]]);
    session.tick(["confirm"]);
    expect([session.fodders[0], session.rateBasisPoints, session.status]).toEqual([
      fodder,
      Math.trunc((3000 * 70 + 50) / 100),
      "Sẵn sàng nâng phẩm",
    ]);
    session.tick(["left"]);
    expect(session.focus).toBe(2);
    session.tick(["confirm"]);
    expect(session.phase).toBe(1);
    for (let i = 1; i < CHARGE_COMMIT_TICK; i++) session.tick([]);
    expect(session.phase).toBe(1);
    session.tick([]);
    expect([session.phase, session.result?.outcome, main.quality]).toEqual([2, "SUCCESS", 3]);
    session.tick(["confirm"]);
    expect(session.closed).toBe(false);
    for (let i = 0; i < resultDurationTicks(true); i++) session.tick([]);
    expect([session.resultReady, session.status]).toEqual([true, "Nâng phẩm thành công!"]);
    session.tick(["confirm"]);
    expect([session.closed, session.mainIndex]).toEqual([true, 1]);
  });

  it("a maxed pet says so and finds no phôi", () => {
    const main = pet(2, 5),
      session = new QualityUpgradeSession(
        {
          roster: [pet(9, 1), main, pet(2, 5)],
          bank: [],
          equipment: [],
          rules,
          roll: () => 0,
        },
        main,
      );
    expect(session.status).toBe("Pet đã đạt phẩm tối đa");
    session.tick(["confirm"]);
    expect(session.status).toBe("Không có Pet phôi phù hợp");
    session.tick(["back"]);
    session.tick(["back"]);
    expect(session.closed).toBe(true);
  });

  it("labels and consumes a bank phôi without treating it as the active Pet", () => {
    const main = pet(2, 2),
      bankFodder = pet(1, 2, { heldEquipmentId: 6 }),
      roster = [pet(9, 1), main],
      bank = [bankFodder],
      equipment: number[] = [],
      session = new QualityUpgradeSession({ roster, bank, equipment, rules, roll: () => 0 }, main);
    session.tick(["confirm"]);
    expect(session.candidates).toEqual([bankFodder]);
    expect(session.candidateLocation(bankFodder)).toBe("Ngân hàng");
    session.tick(["confirm"]);
    session.tick(["left"]);
    session.tick(["confirm"]);
    for (let i = 0; i < CHARGE_COMMIT_TICK; i++) session.tick([]);
    expect(bank).toEqual([]);
    expect(equipment).toEqual([6]);
  });
});
