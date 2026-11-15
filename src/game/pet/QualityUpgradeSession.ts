import type { InputCommand } from "../../core/input/GameCommand";
import type { SavedPet } from "../../persistence/save/GameSave";
import {
  CHARGE_COMMIT_TICK,
  QUALITY_MAX,
  ROLL_BOUND,
  attemptQualityUpgrade,
  contributionBasisPoints,
  qualityReason,
  resultDurationTicks,
  validateQualityUpgrade,
  type QualityAttempt,
  type QualityInvalidReason,
  type QualityRules,
} from "./QualityUpgrade";

/**
 * JavaSE `VqsvGameRuntime`'s Nâng phẩm screen (`openQualityUpgradeFromPetSetting`,
 * `tickQualityUpgrade`, `tickQualityUpgradePicker`, `commitQualityUpgrade`): three focus slots
 * (phôi 1, phôi 2, the NÂNG PHẨM button), a picker of valid phôi, then a charge (phase 1) and the
 * result (phase 2). Candidates retain their owner so a bank Pet is consumed from the bank.
 */
export type QualitySessionWorld = {
  roster: SavedPet[];
  bank: SavedPet[];
  equipment: number[];
  rules: QualityRules;
  /** `qualityUpgradeRandom.nextIntBounded(.., 10000)`. */
  roll: () => number;
};

export class QualityUpgradeSession {
  /** 0 phôi 1, 1 phôi 2, 2 the NÂNG PHẨM button. */
  focus = 0;
  /** 0 choosing, 1 charging, 2 result. */
  phase: 0 | 1 | 2 = 0;
  ticks = 0;
  rateBasisPoints = 0;
  status: string;
  readonly fodders: (SavedPet | null)[] = [null, null];
  result: Extract<QualityAttempt, { outcome: "SUCCESS" | "FAILURE" }> | null = null;
  pickerVisible = false;
  pickerIndex = 0;
  pickerScroll = 0;
  candidates: SavedPet[] = [];
  /** Set once the screen hands back to the pet list. */
  closed = false;

  constructor(
    private readonly world: QualitySessionWorld,
    readonly main: SavedPet,
  ) {
    this.status = main.quality >= QUALITY_MAX ? "Pet đã đạt phẩm tối đa" : "Chọn 1 hoặc 2 Pet phôi";
  }

  /** `closeQualityUpgradeToPetstate`: the list reopens on the main pet's new place. */
  get mainIndex(): number {
    return Math.max(0, this.world.roster.indexOf(this.main));
  }
  /** `qualityUpgradeResultReady`. */
  get resultReady(): boolean {
    return (
      this.phase === 2 &&
      this.result !== null &&
      this.ticks >= resultDurationTicks(this.result.outcome === "SUCCESS")
    );
  }
  /** `qualityUpgradeCandidateRateBasisPoints`. */
  candidateRate(pet: SavedPet): number {
    return contributionBasisPoints(this.world.rules, this.main, pet);
  }
  /** `qualityUpgradeCandidateFormDistance`. */
  candidateDistance(pet: SavedPet): number {
    return this.world.rules.formDistance(this.main.speciesId, pet.speciesId);
  }
  candidateLocation(pet: SavedPet): "Đội" | "Ngân hàng" {
    return this.world.bank.includes(pet) ? "Ngân hàng" : "Đội";
  }

  tick(pressed: readonly InputCommand[]): void {
    const has = (command: InputCommand) => pressed.includes(command);
    if (this.phase === 1) {
      this.ticks++;
      this.status =
        this.ticks < 4
          ? "Đang khóa thẻ nâng phẩm..."
          : this.ticks < 10
            ? "Lõi năng lượng đang nạp..."
            : "Đang truyền phẩm chất...";
      if (this.ticks >= CHARGE_COMMIT_TICK) this.commit();
      return;
    }
    if (this.phase === 2) {
      this.ticks++;
      const done = this.result ? resultDurationTicks(this.result.outcome === "SUCCESS") : 0;
      if (this.ticks >= done && this.result)
        this.status =
          this.result.outcome === "SUCCESS" ? "Nâng phẩm thành công!" : "Nâng phẩm thất bại";
      if (has("confirm") && this.ticks >= done) this.closed = true;
      return;
    }
    if (this.pickerVisible) {
      this.tickPicker(has);
      return;
    }
    if (has("left")) this.focus = (this.focus + 2) % 3;
    else if (has("right")) this.focus = (this.focus + 1) % 3;
    else if (has("back")) this.closed = true;
    else if (has("confirm")) {
      if (this.focus < 2) this.openPicker(this.focus);
      else this.start();
    }
  }

  private selected(): SavedPet[] {
    return this.fodders.filter((pet): pet is SavedPet => pet !== null);
  }
  /** `openQualityUpgradePicker`. */
  private openPicker(slot: number): void {
    this.focus = Math.max(0, Math.min(1, slot));
    this.rebuildCandidates();
    this.pickerIndex = 0;
    this.pickerScroll = 0;
    this.pickerVisible = true;
    this.status =
      this.candidates.length > 0
        ? "Chọn Pet phôi"
        : this.refusal
          ? `Không có Pet phôi phù hợp: ${qualityReason(this.refusal)}`
          : "Không có Pet phôi phù hợp";
  }
  /**
   * Web-only: why the closest pet was left out of an empty picker — one of the main pet's own
   * family (same species, or one form of its line in either direction) — so the player is told
   * "it is the pet fighting" or "too many stars" instead of a bare "none fits".
   */
  refusal: QualityInvalidReason | null = null;
  /** `rebuildQualityUpgradeCandidates`: party pets after the first, then bank pets, like JavaSE. */
  private rebuildCandidates(): void {
    this.candidates = [];
    this.refusal = null;
    if (this.main.quality >= QUALITY_MAX) {
      this.refusal = "ALREADY_MAX_QUALITY";
      return;
    }
    const other = this.fodders[this.focus === 0 ? 1 : 0],
      { rules, roster, bank } = this.world,
      family = (pet: SavedPet) =>
        rules.formDistance(this.main.speciesId, pet.speciesId) >= 0 ||
        rules.formDistance(pet.speciesId, this.main.speciesId) >= 0;
    // The lead is listed for the explanation only: JavaSE never offers it.
    for (const pet of [...roster, ...bank]) {
      if (pet === this.main) continue;
      const check = validateQualityUpgrade(
        rules,
        roster,
        bank,
        this.main,
        other ? [other, pet] : [pet],
      );
      if (check.valid) {
        if (pet !== roster[0]) this.candidates.push(pet);
      } else if (this.refusal === null && family(pet)) this.refusal = check.reason;
    }
  }
  /** `tickQualityUpgradePicker`: up/down wrap, five rows show. */
  private tickPicker(has: (command: InputCommand) => boolean): void {
    const size = this.candidates.length;
    if (has("back")) {
      this.pickerVisible = false;
      this.updateRate();
      return;
    }
    if (size === 0) return;
    if (has("up")) this.pickerIndex = (this.pickerIndex + size - 1) % size;
    else if (has("down")) this.pickerIndex = (this.pickerIndex + 1) % size;
    else if (has("confirm")) {
      this.fodders[this.focus] = this.candidates[this.pickerIndex];
      this.pickerVisible = false;
      this.updateRate();
      return;
    }
    if (this.pickerIndex < this.pickerScroll) this.pickerScroll = this.pickerIndex;
    else if (this.pickerIndex >= this.pickerScroll + 5) this.pickerScroll = this.pickerIndex - 4;
  }
  /** `updateQualityUpgradeRate`. */
  private updateRate(): void {
    const v = validateQualityUpgrade(
      this.world.rules,
      this.world.roster,
      this.world.bank,
      this.main,
      this.selected(),
    );
    this.rateBasisPoints = v.valid ? v.rateBasisPoints : 0;
    this.status = v.valid ? "Sẵn sàng nâng phẩm" : qualityReason(v.reason);
  }
  /** `startQualityUpgradeAttempt`. */
  private start(): void {
    const v = validateQualityUpgrade(
      this.world.rules,
      this.world.roster,
      this.world.bank,
      this.main,
      this.selected(),
    );
    if (!v.valid) {
      this.rateBasisPoints = 0;
      this.status = qualityReason(v.reason);
      return;
    }
    this.rateBasisPoints = v.rateBasisPoints;
    this.status = "Đang khóa thẻ nâng phẩm...";
    this.phase = 1;
    this.ticks = 0;
  }
  /** `commitQualityUpgrade`. */
  private commit(): void {
    const roll = Math.max(0, Math.min(ROLL_BOUND - 1, Math.trunc(this.world.roll()))),
      attempt = attemptQualityUpgrade(
        this.world.rules,
        this.world.roster,
        this.world.bank,
        this.world.equipment,
        this.main,
        this.selected(),
        roll,
      );
    if (attempt.outcome === "INVALID") {
      this.phase = 0;
      this.ticks = 0;
      this.status = qualityReason(attempt.reason);
      return;
    }
    this.result = attempt;
    this.phase = 2;
    this.ticks = 0;
    this.status = "Đang mở khóa phẩm mới...";
  }
}
