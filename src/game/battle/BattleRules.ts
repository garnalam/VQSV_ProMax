import { SignatureFx, SkillFx } from "./SkillFx";
import type { GameData } from "../../data/GameData";
import { DamageCalculator } from "./DamageCalculator";
import { DesignTraitProjection } from "./DesignTraitProjection";
import { DesignTraitCatalog, DesignTraitMechanics } from "./DesignTraits";
import { TraitMechanicRegistry } from "./PhysicalTraits";
import { StatusPresentationProjector } from "./StatusPresentation";
import { StatusEffects, type StatusRandom } from "./StatusState";
import { StatusWebRules } from "./StatusWebRules";
import { SourceSkillAnimation } from "./SourceSkillAnimation";
import { StateOneLEffect } from "./StateOneLEffect";

/**
 * The rules one battle is fought by: the damage formula, the status lifecycle, the trait catalog, and
 * the strip the HUD puts beside each combatant.
 *
 * Everything here is loaded once with the rest of the shipped assets and shared by every battle, which is what
 * Java does by holding one engine per runtime instead of one per fight. The held-item table is not a
 * third field because both of these already carry it — `StatusEffects.heldItems` is the same catalog
 * the formula reads item 0, 3 and 4 from — and a unit asks its own `StatusUnit.heldItemParam`, so a
 * runtime that reached for a separate copy would be reading the table behind the unit's back.
 *
 * The trait projection is the one piece that is *not* shared, and `newTraitProjection` is why this
 * object exposes a factory instead of a field: `PetTraitBattleProjection` owns per-fight state (who
 * stands in which slot, who planted whose damage-over-time) and the talent seams draw their chance
 * rolls from the fight's own stream, so a projection built once for the whole runtime would consume
 * draws that belong to whoever is fighting.
 */
export type BattleRules = {
  damage: DamageCalculator;
  status: StatusEffects;
  /**
   * The web build's buff/debuff rules (`battle/status-web-rules.json`). Absent only for rules built
   * with `{ web: false }`, which is the Java engine the golden parity tables grade.
   */
  web?: StatusWebRules;
  /** The Cầu Vồng skill effects (`skill-fx/animations.json`): which frames play and for how long. */
  fx: SkillFx;
  /** The pet-design signature effects (`skill-fx/signatures.json`): timed world sprite events. */
  signatureFx: SignatureFx;
  /** The original effect.mid/speffect.mid chunk player shared by all Liệt Hỏa skills. */
  sourceFx: SourceSkillAnimation;
  /** The state-1 L effect of the species that have one (`l-effect/l-effect.json`). */
  lEffect?: StateOneLEffect;
  presentation: StatusPresentationProjector;
  /** `PetDesignTraitMechanics`: the 280 species characteristics, shared and stateless. */
  traits: DesignTraitMechanics;
  /** `PetTraitMechanicsRegistry`: the family and hook table the 19 talents are read through. */
  traitRegistry: TraitMechanicRegistry;
  /** One `PetTraitBattleProjection` for one fight, bound to that fight's draw stream. */
  newTraitProjection: (
    random: StatusRandom,
    formation?: "ONE_V_ONE" | "TWO_V_TWO",
  ) => DesignTraitProjection;
};

export async function loadBattleRules(
  data: GameData,
  options: { web?: boolean } = {},
): Promise<BattleRules> {
  // The characteristic engine is built on the status catalog, so that one is loaded first. A Thực
  // Loại producer freezes its delayed hit with the damage formula, so the catalog gets that hook.
  const formula = await DamageCalculator.load(data);
  const status = await StatusEffects.load(data, {
    delayedStatusDamage: (source, target, power) =>
      formula.delayedStatusDamage(source, target, power),
  });
  const web = options.web === false ? undefined : await StatusWebRules.load(data, status);
  const [
    javaDamage,
    mechanics,
    traitRegistry,
    traitMechanics,
    fx,
    signatureFx,
    sourceFx,
    lDocument,
  ] = await Promise.all([
    formula,
    data.statusMechanics(),
    TraitMechanicRegistry.load(data),
    DesignTraitMechanics.load(data, status, web ? await webTraitCatalog(data) : undefined),
    data.skillFx().then((document) => new SkillFx(document)),
    data.signatureFx().then((document) => new SignatureFx(document)),
    data.sourceSkillAnimations().then((document) => new SourceSkillAnimation(document)),
    data.stateOneLEffect(),
  ]);
  const damage = web ? javaDamage.withWebRules(web) : javaDamage;
  return {
    damage,
    status,
    web,
    fx,
    signatureFx,
    sourceFx,
    lEffect: new StateOneLEffect(lDocument, (id) => sourceFx.special(id)?.values),
    presentation: new StatusPresentationProjector(mechanics.statusPresentation),
    traits: traitMechanics,
    traitRegistry,
    newTraitProjection: (random, formation = "ONE_V_ONE") =>
      new DesignTraitProjection(
        traitMechanics,
        // `PetTraitBattleProjection.production(formation)`: 1v1 fights, or the simultaneous 2v2.
        formation,
        random,
        traitRegistry,
      ),
  };
}

/**
 * The characteristics the web build fights with: Java's 280 rows with each value taken from the
 * user's balance workbook (`balance/pet-design-traits.json`). The two agree on 229 of them; the six
 * Power families (51 rows) count flat Power there — "+96 Power" where Java stored "+25%" — and that is
 * the number `flatPowerBonus` adds. The Java-parity rules keep Java's values.
 */
async function webTraitCatalog(data: GameData): Promise<DesignTraitCatalog> {
  const [rows, balance] = await Promise.all([
    data.designTraits(),
    data.designTraitBalanceBySpecies(),
  ]);
  return new DesignTraitCatalog(
    rows.map((row) => {
      const tuned = balance.get(row.speciesId);
      // The two mutation forms fight with their own characteristic (HV-01, TL-01) instead.
      if (tuned?.exclusiveTrait)
        return {
          speciesId: row.speciesId,
          type: tuned.type,
          value: tuned.value,
          cooldownTurns: tuned.cooldownTurns,
          immuneStatuses: tuned.immuneStatuses,
        };
      if (tuned && tuned.type !== row.type)
        throw new Error(`species ${row.speciesId}: balance says ${tuned.type}, Java ${row.type}`);
      return { speciesId: row.speciesId, type: row.type, value: tuned?.value ?? row.value };
    }),
  );
}
