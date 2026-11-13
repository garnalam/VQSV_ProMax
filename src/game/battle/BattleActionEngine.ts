/**
 * The decisions `BattleActionEngine` owns about a hit that has already been computed: whether it can
 * miss, whether the roll landed, whether the hit is allowed to finish the target, and what the skill
 * still owes once the damage step is over.
 *
 * The rest of that engine — the active-status gate and walk, and the post-damage modifiers — lives
 * where its inputs already are in this port: the status walk in `StatusState`, the modifiers beside
 * the reflect they throw back. Moving them here would only rename proven code.
 *
 * They are graded by `battle/golden-held-items.json` and the `postSkillResolution` section of
 * `battle/golden-status-presentation.json`, both of which ask the Java engine the same questions over
 * the same inputs, and are consumed by `BattleRuntime`'s P7 step.
 */

/** `BattleActionEngine.AGILITY_EVASION_CAP`: the most miss chance an agility gap can produce. */
const AGILITY_EVASION_CAP = 20;

/** The miss chance cap the engine applies last, after item 9 has already answered zero. */
const MISS_CHANCE_CAP = 95;

/**
 * `BattleActionEngine.HitChanceInput`.
 *
 * `attackerSpeed` is `BattleUnit.sourceHitCheckSpeed()`, which is the projected speed plus a badge
 * passive this port does not carry, so it is the projected speed; `targetSpeed` is the target's
 * projected speed as the runtime reads it.
 */
export type HitChanceInput = {
  attackerSpeed: number;
  targetSpeed: number;
  attackerHasDebuff4: boolean;
  /** `debuffSlots[4][1]`, the blind debuff's own stored percent. */
  debuff4Value: number;
  attackerHasHeldItem9: boolean;
};

/**
 * `BattleActionEngine.HpFloorInput`.
 *
 * `contextAllowsFloor` is the runtime's whole reason for asking: in the 1v1 owner it is "capturing is
 * not forbidden here, the player is the attacker and the enemy is the one being hit". `floor` is read
 * off item 10's row whether or not the attacker holds it, so the held-item test alone gates it.
 */
export type HpFloorInput = {
  contextAllowsFloor: boolean;
  attackerHasHeldItem10: boolean;
  targetHp: number;
  floor: number;
  /**
   * Web rules only: the target's HP before the hit. Cảm Lãm Chi Diệp says the hit "cannot take the
   * target below 10 HP", so a target already under the floor stays where it was instead of being
   * lifted back to 10. Omitted, the Java answer stands (the floor is set whatever the HP was before).
   */
  targetHpBefore?: number;
};

/** `BattleActionEngine.planHeldItemHpFloor`'s answer. */
/** `apply`: set the target's HP to `hp`. */
export type HpFloorPlan = { apply: boolean; hp: number };

/**
 * `BattleActionEngine.calculateMissChance` under the unified skill profile, which is the profile
 * every dump in this port is taken under: half the agility gap, rounded up, capped at 20, plus the
 * blind debuff's stored percent.
 *
 * Item 9 returns zero *after* both terms and *before* the cap, so it also erases a blind debuff the
 * attacker is carrying — the one case where holding an item makes a hit worse than not holding it
 * would.
 */
export function calculateMissChance(input: HitChanceInput): number {
  const agilityGap = Math.max(0, input.targetSpeed - input.attackerSpeed);
  let miss = Math.min(AGILITY_EVASION_CAP, Math.trunc((agilityGap + 1) / 2));
  if (input.attackerHasDebuff4) miss += Math.max(0, input.debuff4Value);
  if (input.attackerHasHeldItem9) return 0;
  return Math.max(0, Math.min(MISS_CHANCE_CAP, miss));
}

/** `BattleActionEngine.isHit`. */
export function isHit(hitRoll: number, missChance: number): boolean {
  return hitRoll >= missChance;
}

/** `BattleActionEngine.ActionResolutionInput`, the three numbers a hit is decided from. */
export type ActionResolutionInput = {
  rawDamage: number;
  missChance: number;
  hitRoll: number;
};

/**
 * `BattleActionEngine.planActionResolution`'s two answers a fight consumes before any status lands.
 *
 * The damage is the formula's answer floored at one *whether or not the roll landed* — the engine
 * stores that number and only spends it when `hit` says so, which is why a miss still shows the
 * number the attack would have done. The plan's side-effect mode is the commit of the debuff the
 * formula rolled, and a fight with no statuses installed has nothing to commit.
 */
export function planActionResolution(input: ActionResolutionInput): {
  damage: number;
  hit: boolean;
} {
  return {
    damage: Math.max(1, input.rawDamage),
    hit: isHit(input.hitRoll, input.missChance),
  };
}

/** `BattleActionEngine.shouldApplyHeldItemHpFloor`: a floor of zero is no floor at all. */
export function shouldApplyHeldItemHpFloor(currentHp: number, floor: number): boolean {
  return floor > 0 && currentHp <= floor;
}

/**
 * `BattleActionEngine.planHeldItemHpFloor`. The runtime that gets a `true` sets the receiver's HP to
 * the floor, which lifts an already-dead target back to it: the floor is checked against the HP the
 * hit left behind, not against the HP before the hit.
 */
export function planHeldItemHpFloor(input: HpFloorInput): HpFloorPlan {
  const gated = input.contextAllowsFloor && input.attackerHasHeldItem10;
  if (input.targetHpBefore === undefined)
    return {
      apply: gated && shouldApplyHeldItemHpFloor(input.targetHp, input.floor),
      hp: input.floor,
    };
  // Web: the floor never heals. It holds at the floor, or at the HP the target already had if lower.
  const hp = Math.min(input.floor, Math.max(0, input.targetHpBefore));
  return { apply: gated && input.floor > 0 && input.targetHp < hp, hp };
}

/**
 * `BattleActionEngine.PostSkillMode`: what a finished skill still owes, read off the route the pack
 * exported from the engine's own switch rather than off a re-typed list of skill ids.
 */
export type PostSkillMode =
  | "NONE"
  | "NO_DAMAGE_DEBUFF"
  | "HEAL_FROM_ATTACK"
  | "APPLY_ATTACKER_BUFF"
  | "LEECH_AND_BUFF"
  | "COPY_TARGET_BUFFS"
  | "APPLY_TARGET_BUFF";

/** `BattleActionEngine.PostSkillBuffOwner`: which live unit the owed status goes onto. */
export type PostSkillBuffOwner = "NONE" | "ATTACKER" | "TARGET";

const POST_SKILL_MODES: readonly PostSkillMode[] = [
  "NONE",
  "NO_DAMAGE_DEBUFF",
  "HEAL_FROM_ATTACK",
  "APPLY_ATTACKER_BUFF",
  "LEECH_AND_BUFF",
  "COPY_TARGET_BUFFS",
  "APPLY_TARGET_BUFF",
];

/** Whether a name from the pack is a route the engine's switch can answer. */
export function isPostSkillMode(mode: string): mode is PostSkillMode {
  return (POST_SKILL_MODES as readonly string[]).includes(mode);
}

/**
 * `BattleActionEngine.PostSkillPlan`, as `battle/status-mechanics.json` shipped it: the mode, the
 * effect id the route carries, the buff the route still installs when the attack missed, and the roll
 * the runtime draws before it asks this engine to resolve the route at all.
 *
 * The hit gate survives as data rather than as a copy of the gated skill ids: a route that gates says
 * -1 and one that does not repeats its own effect id. `leechGateChance` is the same trick for the
 * leech gate — `VqsvBattleRuntime.sourceP7LeechRollPassed` draws one roll and only lets the route heal
 * when it lands on or below its own chance, and zero says the runtime draws nothing for this skill.
 */
export type PostSkillRoute = {
  mode: PostSkillMode;
  effectId: number;
  buffIdWhenAttackMissed: number;
  leechGateChance: number;
};

/**
 * `BattleActionEngine.PostSkillResolutionInput`.
 *
 * `attackerBaseAttack` is `BattleUnit.sourceBaseAttackForCurrentTarget()` and `damage` is the hit the
 * damage step already committed, which is the number the leech is a percent of; `chanceOrParam` is the
 * skill row's own column, and the two booleans are the gates the runtime drew before asking.
 */
export type PostSkillResolutionInput = {
  route: PostSkillRoute;
  chanceOrParam: number;
  attackerBaseAttack: number;
  damage: number;
  leechRollPassed: boolean;
  targetAvailable: boolean;
  attackHit: boolean;
};

/**
 * `BattleActionEngine.PostSkillResolutionPlan`.
 *
 * `sourceTargetSelf` starts as the true the engine initialises it with and is only turned off by the
 * one arm that aims a buff at another unit, so a route that installs nothing still reports itself as
 * self-aimed — which is what the runtime's side-of-screen choice then reads for a heal.
 *
 * An owner is not a buff: the leech-and-buff route names the attacker as its owner and carries no buff
 * id at all, because the ids that route owns (52 and 58) ask for a `Leech` whose status column is -1.
 */
export type PostSkillResolutionPlan = {
  mode: PostSkillMode;
  heal: number;
  buffId: number;
  buffOwner: PostSkillBuffOwner;
  sourceTargetSelf: boolean;
  noDamageDebuff: boolean;
  copyTargetBuffs: boolean;
};

/** `BattleActionEngine.percentAmount`, with Java's integer divide and its floor at zero. */
function percentAmount(base: number, percent: number): number {
  return Math.max(0, Math.trunc((base * percent) / 100));
}

/** `BattleActionEngine.planPostSkillResolution`. */
export function planPostSkillResolution(input: PostSkillResolutionInput): PostSkillResolutionPlan {
  const plan: PostSkillResolutionPlan = {
    mode: input.route.mode,
    heal: 0,
    buffId: -1,
    buffOwner: "NONE",
    sourceTargetSelf: true,
    noDamageDebuff: false,
    copyTargetBuffs: false,
  };
  switch (input.route.mode) {
    case "NO_DAMAGE_DEBUFF":
      plan.noDamageDebuff = true;
      break;
    case "HEAL_FROM_ATTACK":
      // Java's own integer expression, and unlike the leech it is floored at one instead of zero.
      plan.heal = Math.max(1, Math.trunc((input.attackerBaseAttack * input.chanceOrParam) / 100));
      break;
    case "APPLY_ATTACKER_BUFF":
      plan.buffId = input.attackHit ? input.route.effectId : input.route.buffIdWhenAttackMissed;
      if (plan.buffId >= 0) plan.buffOwner = "ATTACKER";
      break;
    case "LEECH_AND_BUFF":
      if (input.leechRollPassed) plan.heal = percentAmount(input.damage, input.chanceOrParam);
      plan.buffId = input.route.effectId;
      plan.buffOwner = "ATTACKER";
      break;
    case "COPY_TARGET_BUFFS":
      plan.buffId = input.route.effectId;
      plan.buffOwner = "ATTACKER";
      plan.copyTargetBuffs = true;
      break;
    case "APPLY_TARGET_BUFF":
      if (input.targetAvailable) {
        plan.buffId = input.route.effectId;
        plan.buffOwner = "TARGET";
        plan.sourceTargetSelf = false;
      }
      break;
    case "NONE":
      break;
  }
  return plan;
}
