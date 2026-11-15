/**
 * Web rule (the owner's call, 2026-11-14): a fight where both teams have run out of PP would pass
 * turns forever — Java has no Struggle and lets it stall. Once every living pet on both sides is dry,
 * the team that ran dry first loses.
 *
 * A team counts as dry from the action that emptied its last slot until a PP item or a refund gives a
 * living pet a usable slot again. When both went dry in the same action (a drain charm emptying the
 * foe with the blow that spent the actor's last PP), the acting team spent its PP first and loses.
 */

type Side = "player" | "enemy";

/** The pets a team still fights with: a living pet with a skill that has PP left keeps it going. */
export type PpTeam = readonly {
  alive(): boolean;
  skillIds: readonly number[];
  skillPp: readonly number[];
}[];

export function teamOutOfPp(team: PpTeam): boolean {
  const living = team.filter((unit) => unit.alive());
  return (
    living.length > 0 &&
    living.every((unit) => unit.skillIds.every((id, slot) => id < 0 || unit.skillPp[slot] <= 0))
  );
}

export class PpExhaustion {
  private readonly dryAt = new Map<Side, number>();
  private step = 0;

  /** After one action: record who is dry, and answer the losing side once both are. */
  observe(player: PpTeam, enemy: PpTeam, actor: Side | undefined): Side | undefined {
    this.step++;
    for (const [side, team] of [
      ["player", player],
      ["enemy", enemy],
    ] as const) {
      if (!teamOutOfPp(team)) this.dryAt.delete(side);
      else if (!this.dryAt.has(side)) this.dryAt.set(side, this.step);
    }
    const playerAt = this.dryAt.get("player"),
      enemyAt = this.dryAt.get("enemy");
    if (playerAt === undefined || enemyAt === undefined) return undefined;
    if (playerAt !== enemyAt) return playerAt < enemyAt ? "player" : "enemy";
    return actor ?? "player";
  }
}
