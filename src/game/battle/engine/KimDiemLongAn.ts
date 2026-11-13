// CV0' Thiên Không: `vqsv.game.KimDiemLongAn` (rebuild_game/src/main/java), Kim Diễm Long Vương's
// Long Ấn. Battle-local, action-scoped memory: the player's damaging skill repeated on the dragon is
// cut to 70% and 120% of what it took is turned back on the attacker. Boss turns and secondary hits do
// not start new actions; an item or a switch forgets the skill (`interrupt`).

/** `KimDiemLongVuongCatalog.RUNTIME_ID`. */
export const KIM_DIEM_LONG_VUONG_SPECIES = 280;

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
