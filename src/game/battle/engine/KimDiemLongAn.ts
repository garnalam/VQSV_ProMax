// CV0' Thiên Không: `vqsv.game.KimDiemLongAn` (rebuild_game/src/main/java), Kim Diễm Long Vương's
// Long Ấn. Battle-local, action-scoped memory: the player's damaging skill repeated on the dragon is
// cut to 70% and 120% of what it took is turned back on the attacker. Boss turns and secondary hits do
// not start new actions; an item or a switch forgets the skill (`interrupt`).

import type { DesignTraitUnit } from "../DesignTraits";
import type { StatusInstance } from "../StatusState";

/** `KimDiemLongVuongCatalog.RUNTIME_ID`. */
export const KIM_DIEM_LONG_VUONG_SPECIES = 280;

/** An effect-scoped snapshot: only new or changed debuffs are sent back by Long Ấn. */
export class KimDiemDebuffReflection {
  private readonly before = new Map<number, { original: StatusInstance; saved: StatusInstance }>();

  constructor(private readonly boss: DesignTraitUnit) {
    for (let bank = 0; bank < 3; bank++) {
      for (const id of boss.statuses.activeIds(bank)) {
        const status = boss.statuses.get(bank, id)!;
        if (status.definition.kind === "DEBUFF")
          this.before.set(bank * 100 + id, { original: status, saved: status.copy() });
      }
    }
  }

  returnTo(attacker: DesignTraitUnit): boolean {
    let changed = false;
    for (let bank = 0; bank < 3; bank++) {
      for (const id of this.boss.statuses.activeIds(bank)) {
        const status = this.boss.statuses.get(bank, id)!;
        if (status.definition.kind !== "DEBUFF") continue;
        const previous = this.before.get(bank * 100 + id);
        if (previous && previous.original === status && unchanged(previous.saved, status)) continue;
        if (previous) this.boss.statuses.put(previous.saved);
        else this.boss.statuses.remove(bank, id);
        if (attacker.alive()) {
          const reflected = status.copy();
          reflected.sourceSide = this.boss.ownerSide;
          reflected.sourceSlot = this.boss.formationSlot;
          attacker.statuses.put(reflected);
        }
        changed = true;
      }
    }
    if (changed) {
      this.boss.restoreSourceStatusState();
      attacker.restoreSourceStatusState();
    }
    return changed;
  }
}

function unchanged(saved: StatusInstance, current: StatusInstance): boolean {
  return (
    saved.remainingTurns === current.remainingTurns &&
    saved.remainingActions === current.remainingActions &&
    saved.primaryValue === current.primaryValue &&
    saved.secondaryValue === current.secondaryValue &&
    saved.stackCount === current.stackCount &&
    saved.flags === current.flags &&
    saved.sourceSide === current.sourceSide &&
    saved.sourceSlot === current.sourceSlot &&
    saved.sourceSkillId === current.sourceSkillId
  );
}

export class KimDiemLongAn {
  private rememberedSkill = -1;
  private actionSkill = -1;
  private repeatedSkill = false;
  private actionDamage = 0;
  private reflected = 0;

  beginAction(skill: number, damagingBoss: boolean): void {
    this.actionSkill = skill;
    this.repeatedSkill = damagingBoss && skill >= 0 && this.rememberedSkill === skill;
    if (!this.repeatedSkill) this.rememberedSkill = -1;
    this.actionDamage = 0;
    this.reflected = 0;
  }
  interrupt(): void {
    this.rememberedSkill = this.actionSkill = -1;
    this.repeatedSkill = false;
    this.actionDamage = 0;
    this.reflected = 0;
  }
  project(damage: number): number {
    return this.repeatedSkill ? Math.trunc((Math.max(0, damage) * 70) / 100) : Math.max(0, damage);
  }
  afterHit(actualHpLost: number): number {
    if (actualHpLost <= 0 || this.actionSkill < 0) return 0;
    if (!this.repeatedSkill) {
      this.rememberedSkill = this.actionSkill;
      return 0;
    }
    this.rememberedSkill = -1;
    this.actionDamage += actualHpLost;
    const total = Math.min(2147483647, Math.trunc((this.actionDamage * 120) / 100)),
      delta = total - this.reflected;
    this.reflected = total;
    return delta;
  }
  get remembered(): number {
    return this.rememberedSkill;
  }
  get repeated(): boolean {
    return this.repeatedSkill;
  }
}
