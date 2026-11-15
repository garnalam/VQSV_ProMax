import type { InputCommand } from "../../core/input/GameCommand";
import type { SavedPet } from "../../persistence/save/GameSave";
import type { BattleServices } from "../battle/engine/BattleServices";
import {
  applyEvolution,
  evolvedForm,
  consumeEvolutionMaterials,
  evolutionMaterialCount,
  type EvolutionRule,
} from "./Evolution";

export class EvolutionSession {
  readonly previousSpecies: number;
  phase: 0 | 1 | 2 = 0;
  ticks = 0;
  succeeded = false;
  message = "";
  closed = false;
  readonly oldStats: [number, number, number, number];
  readonly newStats: [number, number, number, number];
  readonly oldSprite: number;
  readonly newSprite: number;
  readonly oldName: string;
  readonly newName: string;

  constructor(
    readonly petIndex: number,
    readonly pet: SavedPet,
    readonly rule: EvolutionRule,
    readonly materials: Record<string, number>,
    private readonly services: BattleServices,
    /** `collection.markCollected(target)`: the new form counts as owned. */
    private readonly onEvolved: (speciesId: number) => void = () => {},
  ) {
    this.previousSpecies = pet.speciesId;
    // The right column is the pet the evolution makes (`targetVisibleStats`): the target species
    // at its evolved stars, drawn with its own sprite.
    const old = services.partyMember(pet),
      next = evolvedForm(pet, rule.toSpecies, services);
    this.oldStats = [old.stats.hp, old.stats.attack, old.stats.defense, old.stats.speed];
    this.newStats = [next.stats.hp, next.stats.attack, next.stats.defense, next.stats.speed];
    this.oldSprite = old.spriteId ?? -1;
    this.newSprite = next.spriteId ?? -1;
    this.oldName = old.name ?? `Pet ${pet.speciesId}`;
    this.newName = next.name ?? `Pet ${rule.toSpecies}`;
  }

  materialCount(id: number): number {
    return evolutionMaterialCount(this.materials, id);
  }
  get ready(): boolean {
    return (
      this.pet.level >= this.rule.requiredLevel &&
      this.pet.quality >= this.rule.requiredQuality &&
      this.rule.ingredients.every((item) => this.materialCount(item.materialId) >= item.quantity)
    );
  }
  get eligibility(): string {
    if (this.phase === 1) return "Đang chuyển hóa...";
    if (this.succeeded) return "Chuyển hóa thành công";
    if (this.pet.level < this.rule.requiredLevel)
      return `Cần cấp ${this.rule.requiredLevel}  (hiện tại ${this.pet.level})`;
    if (this.pet.quality < this.rule.requiredQuality)
      return `Cần ${this.rule.requiredQuality} sao  (hiện tại ${this.pet.quality})`;
    for (const item of this.rule.ingredients) {
      const count = this.materialCount(item.materialId);
      if (count < item.quantity) return `Thiếu ${item.name}: ${count}/${item.quantity}`;
    }
    return this.rule.kind === "mutation" ? "Đủ điều kiện dị hóa" : "Đủ điều kiện tiến hóa";
  }
  tick(pressed: readonly InputCommand[]): void {
    if (this.phase === 1) {
      this.ticks++;
      if (this.ticks >= 24) {
        applyEvolution(this.pet, this.rule, this.services);
        this.onEvolved(this.rule.toSpecies);
        this.phase = 2;
        this.succeeded = true;
        this.message = `${this.rule.kind === "mutation" ? "Dị hoá" : "Tiến hóa"} thành ${this.newName}`;
      }
      return;
    }
    if (this.message) {
      if (pressed.includes("confirm")) {
        if (this.succeeded) this.closed = true;
        else this.phase = 0;
        this.message = "";
      }
      return;
    }
    if (pressed.includes("back") && this.phase < 2) this.closed = true;
    else if (pressed.includes("confirm")) {
      if (!this.ready) {
        this.message =
          this.pet.level < this.rule.requiredLevel
            ? `Cấp chưa đủ, cần cấp ${this.rule.requiredLevel}`
            : this.pet.quality < this.rule.requiredQuality
              ? `Phẩm chưa đủ, cần ${this.rule.requiredQuality} sao`
              : this.rule.kind === "mutation"
                ? "Tài liệu chưa đủ, không thể dị hoá"
                : "Tài liệu chưa đủ, không thể tiến hóa";
        this.phase = 2;
      } else if (consumeEvolutionMaterials(this.materials, this.rule.ingredients)) {
        this.phase = 1;
        this.ticks = 0;
      }
    }
  }
}
