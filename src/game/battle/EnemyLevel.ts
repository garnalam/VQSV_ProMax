import type { GameData, PackCauVongPetLevel, PackPetLevel } from "../../data/GameData";

/**
 * `PetLevel.clamp` and `CauVongPetLevel.clampEnemyLevel` both hold a level at one, and Java writes
 * that bound as a literal in the method body rather than as a field, so no dump carries it.
 */
const MIN_LEVEL = 1;

/**
 * The level an enemy is built at.
 *
 * `CauVongPetLevel` boosts one authored region past the pet cap and leaves every other fight inside
 * it, and the two ceilings are different numbers: 150 for the boosted region, 100 for a normal
 * encounter. Which one applies is decided by the scene the encounter belongs to, so a fight reads
 * this rule before it reads any stat.
 */
export class EnemyLevel {
  private constructor(
    private readonly pet: PackPetLevel,
    private readonly cauVong: PackCauVongPetLevel,
  ) {}

  static async load(data: GameData): Promise<EnemyLevel> {
    const [pet, cauVong] = await Promise.all([data.petLevel(), data.cauVongPetLevel()]);
    return new EnemyLevel(pet, cauVong);
  }

  /** `CauVongPetLevel.SCENE_ID`: the one chapter whose enemy levels are authored pre-boosted. */
  get cauVongSceneId(): number {
    return this.cauVong.SCENE_ID;
  }

  /** `CauVongPetLevel.enemyForScene`: the ceiling this scene's authored level is held to. */
  forScene(sceneId: number, level: number): number {
    return sceneId === this.cauVong.SCENE_ID
      ? this.clampEnemy(level)
      : Math.max(MIN_LEVEL, Math.min(this.pet.MAX, level));
  }

  /** `CauVongPetLevel.clampEnemyLevel`: a level that is already boosted is capped, never raised. */
  clampEnemy(level: number): number {
    return Math.max(MIN_LEVEL, Math.min(this.cauVong.MAX_ENEMY_LEVEL, level));
  }

  /**
   * `PetLevel.requiredExp`: the EXP a pet needs to reach `targetLevel`.
   *
   * The curve is a formula Java writes in the method body, not a table it loads, so this port writes
   * the same formula rather than reading `golden-exp.json`'s `requiredExpPerLevel` — that array is
   * the referee's answer for all 100 levels and is never an input.
   */
  requiredExp(targetLevel: number): number {
    const level = Math.max(MIN_LEVEL, Math.min(this.pet.MAX, targetLevel));
    return Math.max(1, 15 * level * level - 200);
  }
}
