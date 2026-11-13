/**
 * Test kit for story playthroughs on the real pack: resume a save at an event group's trigger,
 * play the group with the player's own input (5 on every ready line, fights won, panels answered)
 * and hand back what a reload would open. Story tests import it; the game never does.
 */
import { GameplayHost, type GameplaySources } from "./GameplayHost";
import type { GameAssets } from "../story/GameAssets";
import type { StoryDataRegistry } from "../story/StoryDataRegistry";
import type { GameSave } from "../../persistence/save/GameSave";
import type { TaskOptionView } from "../quest/TaskOption";
import { MemorySaveStore } from "../../persistence/save/SaveStore";
import { SaveRepository } from "../../persistence/SaveRepository";
import { SaveService } from "../../persistence/SaveService";
import { DIRECTION_UP } from "../world/MapCollision";
import type { DoubleBattleRuntime } from "../battle/DoubleBattleRuntime";
import type { InputCommand } from "../../core/input/GameCommand";

export type PlayedGroup = {
  host: GameplayHost;
  world: NonNullable<GameplayHost["world"]>;
  saved: GameSave;
  lines: string[];
  battles: number;
  awards: number[];
  offers: TaskOptionView[];
  /** Every `op35` box the group asked, with the option the player took. */
  choices: { options: readonly string[]; picked: number }[];
};

export type PlayOptions = {
  /** How `taskOption.ui` is answered: 5 accepts, back declines. */
  answer?: "confirm" | "back";
  /** Throw a Tất Trung Cầu at the first menu instead of knocking the foe out. */
  catchFoe?: boolean;
  /** The option to take in each `op35` choice box, in order (default: the first). */
  choices?: number[];
  /** Lose every fight instead (the foe stays whole and the hero's pet falls). */
  lose?: boolean;
};

/**
 * One tick of a gym 2v2 played the way a player would, for story tests: Chiến đấu → first skill →
 * first target, and in a forced replacement the cursor walks down to a living benched pet (the list
 * opens on row 0, as in Java). The foes stand at 1 HP and the hero's pair at full — or the reverse
 * to lose — so the fight is about its branch, not the damage roll.
 */
export function doubleBattleCommands(battle: DoubleBattleRuntime, lose = false): InputCommand[] {
  const core = battle.core;
  for (const slot of [0, 1, 2, 3] as const) {
    const unit = core.unit(slot);
    if (!unit?.alive()) continue;
    const weak = slot < 2 === !lose;
    unit.setHp(weak ? Math.min(unit.hp(), 1) : unit.maxHp());
    // The round resolves at once when the last command goes in, so the side meant to lose also
    // hits for next to nothing (a gym leader's spread skills would otherwise still decide it).
    if (weak) unit.baseStats.attack = unit.currentStats.attack = 1;
  }
  if (battle.stage === "pet" && battle.ui.mode === "PET_STATE") {
    const member = battle.ui.selectedIndex,
      fielded = ([2, 3] as const).some((slot) => {
        const at = core.occupant(slot);
        return at.side === "player" && at.index === member && core.unit(slot).alive();
      });
    if (!core.playerUnit(member)?.alive() || fielded) return ["down"];
  }
  return ["confirm"];
}

export function storyPlaythrough(
  sources: GameplaySources,
  assets: GameAssets,
  registry: StoryDataRegistry,
) {
  const newHost = (
    save: GameSave,
    saves = new SaveService(new SaveRepository(new MemorySaveStore())),
  ) => new GameplayHost(sources, saves, { onExit: () => {} }, { kind: "resume", save });

  /** The actor a group is activated on: its op16, or the NPC an op43/op44/op79 head names. */
  function triggerActor(scene: number, room: number, group: number): number | undefined {
    const records = registry.group(scene, room, group)!.records,
      head = records[0];
    if (head.opcode === 43 || head.opcode === 44) return head.short_args[4];
    if (head.opcode === 79) return head.short_args[3];
    return records.find((r) => r.opcode === 16)?.short_args[0];
  }

  /** Where a group's own op13 rect is entered, so the hero stands on it. */
  function triggerPoint(scene: number, room: number, group: number): { x: number; y: number } {
    const rect = registry
      .group(scene, room, group)!
      .records.find((r) => r.opcode === 13)?.short_args;
    if (rect) return { x: rect[0] + (rect[2] >> 1), y: rect[1] + (rect[3] >> 1) };
    return { x: 120, y: 160 };
  }

  /** Open a session from a stored save and let its room load. */
  function reload(save: GameSave) {
    const host = newHost(save);
    while (host.mapLoadingActive) host.step([]);
    return { host, world: host.world! };
  }

  /** Resume `save` standing at (x, y) in scene:room. */
  async function standAt(
    save: GameSave,
    scene: number,
    room: number,
    x: number,
    y: number,
    direction: number,
  ) {
    await assets.prepareRoom(scene, room);
    return reload({ ...save, location: { sceneId: scene, roomIndex: room, x, y, direction } });
  }

  /** Play one event group from its trigger to its end (see the module comment). */
  async function playGroup(
    save: GameSave,
    scene: number,
    room: number,
    group: number,
    options: PlayOptions = {},
  ): Promise<PlayedGroup> {
    await assets.prepareRoom(scene, room);
    const repository = new SaveRepository(new MemorySaveStore()),
      saves = new SaveService(repository),
      host = newHost(
        {
          ...save,
          location: {
            sceneId: scene,
            roomIndex: room,
            ...triggerPoint(scene, room, group),
            direction: 3,
          },
        },
        saves,
      ),
      lines: string[] = [],
      awards: number[] = [],
      offers: TaskOptionView[] = [],
      choices: { options: readonly string[]; picked: number }[] = [];
    while (host.mapLoadingActive) host.step([]);
    const actorId = triggerActor(scene, room, group),
      actor = actorId === undefined ? undefined : host.world!.actors.get(actorId);
    if (actor) {
      host.world!.player.x = actor.x;
      host.world!.player.y = actor.y + 20;
      host.world!.player.direction = DIRECTION_UP;
    }
    let battles = 0,
      lastChoice: unknown = null;
    for (let i = 0; i < 20000; i++) {
      const world = host.world!;
      if (host.mapLoadingActive) {
        host.step([]);
        continue;
      }
      if (world.doubleBattle) {
        battles++;
        host.step(doubleBattleCommands(world.doubleBattle, !!options.lose));
        continue;
      }
      if (world.battle) {
        battles++;
        const battle = world.battle,
          foe = battle.core?.activeUnit("enemy"),
          mine = battle.core?.activeUnit("player");
        if (options.lose) {
          if (mine?.alive()) mine.setHp(1);
          if (foe?.alive()) foe.setHp(foe.maxHp());
        } else if (
          options.catchFoe &&
          battle.interactiveStage === "fight" &&
          foe?.alive() &&
          !battle.complete
        )
          (battle as unknown as { submitToCore(c: object): void }).submitToCore({
            kind: "catch",
            itemId: 0,
          });
        else {
          // At 1 HP a foe that heals first (Thủy Linh Hồi Sinh) outlasts any hit, so at the command
          // menu it is already down.
          if (foe?.alive()) foe.setHp(battle.interactiveStage === "fight" ? 0 : 1);
          // The hero's side never falls: a story fight is about its branch, not the damage roll.
          if (mine?.alive()) mine.setHp(mine.maxHp());
        }
        // A long fight runs a skill dry: like a player, move on to one with PP left.
        const view = battle as unknown as { ui: { selectedIndex: number } };
        if (
          battle.interactiveStage === "skillList" &&
          mine &&
          (mine.skillPp[view.ui.selectedIndex] ?? 0) <= 0 &&
          mine.skillPp.some((pp) => pp > 0)
        ) {
          host.step(["down"]);
          continue;
        }
        host.step(["confirm"]);
        continue;
      }
      if (host.panel.badgeAwardOpen) {
        awards.push(host.panel.badgeEntries[host.panel.selected]?.id ?? -1);
        host.step(["confirm"]);
        continue;
      }
      if (host.panel.taskOptionOpen) {
        offers.push(host.panel.taskOption!);
        host.step([options.answer ?? "confirm"]);
        continue;
      }
      const event = world.eventScene;
      if (event?.choice && event.choice !== lastChoice) {
        lastChoice = event.choice;
        const picked = options.choices?.[choices.length] ?? 0;
        choices.push({ options: event.choice.options, picked });
        for (let k = 0; k < picked; k++) event.moveChoice(1);
        host.step(["confirm"]);
        continue;
      }
      if (event?.textReady && event.currentText && lines.at(-1) !== event.currentText)
        lines.push(event.currentText);
      if (world.eventState.sourceEventState(scene, room, group) >= 3 && !world.eventVisible) break;
      if (
        lines.length > 0 &&
        world.activeEventGroup === null &&
        !world.battle &&
        !world.battleEntryVisible &&
        world.phase !== "event"
      )
        break;
      host.step(i === 0 || event?.textReady || !world.eventVisible ? ["confirm"] : []);
    }
    await saves.flush();
    const world = host.world!,
      saved = (await repository.load()) ?? host.snapshot(world);
    return { host, world, saved, lines, battles, awards, offers, choices };
  }

  return { playGroup, reload, standAt, triggerActor, triggerPoint };
}
