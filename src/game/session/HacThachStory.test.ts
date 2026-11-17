import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Pack images are 1x1 stand-ins under Node; the host never reads pixels. */
vi.stubGlobal(
  "Image",
  class {
    complete = true;
    naturalWidth = 1;
    width = 1;
    height = 1;
    src = "";
  },
);
vi.stubGlobal("fetch", async (input: string) => {
  const file = resolve(
    import.meta.dirname,
    "../../../public",
    decodeURIComponent(String(input).split("?")[0].replace(/^\//, "")),
  );
  if (!existsSync(file)) return { ok: false, status: 404 };
  const bytes = readFileSync(file);
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(bytes.toString("utf8")),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  };
});

const { Pack } = await import("../../pack/Pack");
const { loadBootAssets } = await import("../../pack/boot");
const { GameAssets } = await import("../story/GameAssets");
const { MemorySaveStore } = await import("../../persistence/save/SaveStore");
const { SaveRepository } = await import("../../persistence/SaveRepository");
const { SaveService } = await import("../../persistence/SaveService");
const { scene1Save } = await import("../../dev/parityCheckpoints");
const { SCENE1_RESUME } = await import("../../persistence/save/migrations");
const { GameplayHost, gameplaySources } = await import("./GameplayHost");
type GameSave = import("../../persistence/save/GameSave").GameSave;
type Host = InstanceType<typeof GameplayHost>;
type TaskOptionView = import("../quest/TaskOption").TaskOptionView;
const { DIRECTION_UP } = await import("../world/MapCollision");
const { doubleBattleCommands } = await import("./StoryPlaythrough");
const { sourceDoors } = await import("../world/WorldTransition");

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot);

/** The actor a group is activated on: its op16, or the NPC an op43/op44 branch head names. */
function triggerActor(scene: number, room: number, group: number): number | undefined {
  const records = boot.sourceEvents.group(scene, room, group)!.records,
    head = records[0];
  if (head.opcode === 43 || head.opcode === 44) return head.short_args[4];
  return records.find((r) => r.opcode === 16)?.short_args[0];
}

/** Where a group's own op13 rect is entered, so the hero stands on it. */
function triggerPoint(scene: number, room: number, group: number): { x: number; y: number } {
  const rect = boot.sourceEvents
    .group(scene, room, group)!
    .records.find((r) => r.opcode === 13)?.short_args;
  if (rect) return { x: rect[0] + (rect[2] >> 1), y: rect[1] + (rect[3] >> 1) };
  return { x: 120, y: 160 };
}

/**
 * Resume `save` at the group's trigger — on its rect, or facing its actor and pressing 5 — play the
 * group to its end with the player's own input (confirm on every ready line; battles are won by
 * leaving the foe at 1 HP while the hero's pet stays whole; `taskOption.ui` answered with `answer`), and return the save a reload
 * would open: the one the session wrote, else what the menu's Lưu dữ liệu would write.
 */
async function playGroup(
  save: GameSave,
  scene: number,
  room: number,
  group: number,
  answer: "confirm" | "back" = "confirm",
  /** Throw a Tất Trung Cầu (guaranteed) at the first menu instead of knocking the foe out. */
  catchFoe = false,
) {
  await assets.prepareRoom(scene, room);
  const repository = new SaveRepository(new MemorySaveStore()),
    saves = new SaveService(repository),
    host: Host = new GameplayHost(
      sources,
      saves,
      { onExit: () => {} },
      {
        kind: "resume",
        save: {
          ...save,
          location: {
            sceneId: scene,
            roomIndex: room,
            ...triggerPoint(scene, room, group),
            direction: 3,
          },
        },
      },
    ),
    lines: string[] = [],
    awards: number[] = [],
    offers: TaskOptionView[] = [];
  while (host.mapLoadingActive) host.step([]);
  const actorId = triggerActor(scene, room, group),
    actor = actorId === undefined ? undefined : host.world!.actors.get(actorId);
  if (actor) {
    host.world!.player.x = actor.x;
    host.world!.player.y = actor.y + 20;
    host.world!.player.direction = DIRECTION_UP;
  }
  let battles = 0;
  for (let i = 0; i < 20000; i++) {
    const world = host.world!;
    if (host.mapLoadingActive) {
      host.step([]);
      continue;
    }
    if (world.doubleBattle) {
      battles++;
      host.step(doubleBattleCommands(world.doubleBattle));
      continue;
    }
    if (world.battle) {
      battles++;
      const battle = world.battle,
        foe = battle.core?.activeUnit("enemy");
      if (catchFoe && battle.interactiveStage === "fight" && foe?.alive() && !battle.complete)
        (battle as unknown as { submitToCore(c: object): void }).submitToCore({
          kind: "catch",
          itemId: 0,
        });
      else if (!catchFoe && foe?.alive()) foe.setHp(1);
      // The hero's side never falls: a story fight is about its branch, not the damage roll.
      const mine = battle.core?.activeUnit("player");
      if (mine?.alive()) mine.setHp(mine.maxHp());
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
      host.step([answer]);
      continue;
    }
    const event = world.eventScene;
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
  return { host, world, saved, lines, battles, awards, offers };
}

/** Open a session from a stored save and report what the reload restored. */
function reload(save: GameSave) {
  const host = new GameplayHost(
    sources,
    new SaveService(new SaveRepository(new MemorySaveStore())),
    { onExit: () => {} },
    { kind: "resume", save },
  );
  return { host, world: host.world! };
}

/** The ledger a player holds on arrival at Hắc Thạch (task 25, 5:1:g0 done). */
function arrival(): GameSave {
  const base = new GameplayHost(
      sources,
      new SaveService(new SaveRepository(new MemorySaveStore())),
      { onExit: () => {} },
      {
        kind: "resume",
        save: scene1Save({
          location: { sceneId: 1, roomIndex: 0, x: 200, y: 200, direction: 1 },
          owner: SCENE1_RESUME.bunnyReturnRoom0,
          bunnyCaught: true,
          pets: [
            { speciesId: 68, level: 40, quality: 2 },
            { speciesId: 19, level: 40, quality: 2 },
          ],
        }),
      },
    ),
    save = base.snapshot(base.world!);
  return {
    ...save,
    eventStates: {
      ...save.eventStates,
      "3:6:3": 3,
      "4:0:0": 3,
      "4:5:12": 3,
      "4:5:13": 3,
      "4:5:17": 3,
      "4:5:18": 3,
      "4:5:19": 3,
      "4:8:0": 3,
      "9:2:1": 3,
      "5:1:0": 3,
      // Jani Las's own errand (branch 20) is done: her rescue offer (5:5:g1, op43 columns 5–7)
      // waits for 5:5:g0 (`HacThachC3Runtime.tickSecondCity`).
      "5:5:0": 3,
    },
    progress: { ...save.progress, mainTaskProgress: 25 },
    world: { ...save.world!, mainTaskProgress: 25 },
    story: { ...save.story, quest: { node: "hac-thach-frontier" } },
  };
}

/** The three upper-gym trainers (9:4 g0–g2), beaten in turn: Dbell only accepts after them. */
async function upperGymTrainers(save: GameSave): Promise<GameSave> {
  for (const group of [0, 1, 2]) save = (await playGroup(save, 9, 4, group)).saved;
  return save;
}

// Gym fights are real 2v2s now (played through their menus), so the gym cases take longer.
describe(
  "Hắc Thạch main line, played through the session with save and reload",
  { timeout: 120_000 },
  () => {
    it("25→26: Dbell's challenge at the upper gym grants the badge and sends the hero to Yafei", async () => {
      const shut = await playGroup(arrival(), 9, 4, 3);
      expect(shut.lines).toEqual([]);
      const dbell = await playGroup(await upperGymTrainers(arrival()), 9, 4, 3);
      expect(dbell.lines[0]).toBe("Đánh bại ta mới có thể qua được thử thách."); // op53 shows Liệt Hỏa Chương in badge.ui and the group waits for 5 before its task tip.
      expect(dbell.awards).toEqual([0]);
      expect(dbell.world.flags.snapshot().badgesAchieved[0]).toBeGreaterThan(0);
      expect(dbell.saved.eventStates?.["9:4:3"]).toBe(3);
      expect(dbell.saved.progress.mainTaskProgress).toBe(26);
      expect(dbell.saved.story.quest?.node).toBe("meet-yafei-hac-thach");
      const back = reload(dbell.saved);
      expect(back.host.director?.node.id).toBe("meet-yafei-hac-thach");
      expect(back.world.questState.mainTaskProgress).toBe(26);
      expect(back.world.flags.snapshot().badgesAchieved[0]).toBeGreaterThan(0);
      expect(back.world.eventState.sourceEventState(9, 4, 3)).toBe(3);

      // Yafei's handoff in the first city waits for the gym (op86 9:4:3) and raises task 27.
      const yafei = await playGroup(dbell.saved, 5, 3, 4);
      expect(yafei.lines.at(-1)).toBe("Hiện tại có thể tự do di chuyển.");
      expect(yafei.saved.progress.mainTaskProgress).toBe(27);
      expect(yafei.saved.story.quest?.node).toBe("hac-thach-lower-gym");
      const again = reload(yafei.saved);
      expect(again.host.director?.node.id).toBe("hac-thach-lower-gym");
      expect(again.world.questState.mainTaskProgress).toBe(27);
      expect(again.world.eventState.sourceEventState(5, 3, 4)).toBe(3);
    });

    it("keeps Yafei's handoff shut until the upper gym is beaten", async () => {
      const early = await playGroup(await upperGymTrainers(arrival()), 5, 3, 4);
      expect(early.world.eventState.sourceEventState(5, 3, 4)).not.toBe(3);
      expect(early.lines).toEqual([]);
    });

    it("27→28: the lower gym's trainers, then its leader's Đại Địa Chương sends the hero to the dungeon", async () => {
      let save = (await playGroup(await upperGymTrainers(arrival()), 9, 4, 3)).saved;
      save = (await playGroup(save, 5, 3, 4)).saved;
      // The leader waits for all three trainers.
      expect((await playGroup(save, 9, 5, 3)).lines).toEqual([]);
      expect(save.progress.mainTaskProgress).toBe(27);
      for (const group of [0, 1, 2]) {
        const trainer = await playGroup(save, 9, 5, group);
        expect(trainer.saved.eventStates?.[`9:5:${group}`]).toBe(3);
        expect(trainer.saved.progress.mainTaskProgress).toBe(27);
        save = trainer.saved;
      }
      const leader = await playGroup(save, 9, 5, 3);
      expect(leader.lines[0]).toMatch(/^Đã lâu không thấy con người xuất hiện/);
      expect(leader.awards).toEqual([2]);
      expect(leader.lines.at(-1)).toBe("Đến [Địa lao Hắc Thạch] lấy Hắc Tinh Thạch.");
      expect(leader.saved.progress.mainTaskProgress).toBe(28);
      expect(leader.saved.story.quest?.node).toBe("hac-tinh-thach");
      const back = reload(leader.saved);
      expect(back.host.director?.node.id).toBe("hac-tinh-thach");
      expect(back.world.flags.snapshot().badgesAchieved[2]).toBeGreaterThan(0);
    });

    it("George at the dungeon gate fights on his op16 actor, pays the item and stays beaten", async () => {
      const before = arrival(),
        held = before.inventory?.items?.["5"] ?? 0,
        george = await playGroup(before, 5, 4, 0);
      expect(george.lines[0]).toBe("Thế nào? Không có việc muốn khiêu khích hả?!");
      expect(george.battles).toBeGreaterThan(0);
      expect(george.lines.at(-1)).toBe("Đạt được: Chocolate x 1");
      expect(george.saved.eventStates?.["5:4:0"]).toBe(3);
      expect(george.saved.inventory?.items?.["5"]).toBe(held + 1);
      const back = reload(george.saved);
      expect(back.world.eventState.sourceEventState(5, 4, 0)).toBe(3);
    });

    it("Jani Las's rescue offer opens taskOption.ui; Tiếp nhận takes branch 21, Back leaves it", async () => {
      const declined = await playGroup(arrival(), 5, 5, 1, "back");
      expect(declined.offers).toHaveLength(1);
      expect(declined.offers[0]).toMatchObject({
        taskId: 21,
        options: ["Tiếp nhận", "Từ chối"],
        rewards: [{ sheet: 258, label: "Dây cương cưỡi sủng 2 ×1" }],
      });
      expect(declined.lines.at(-1)).toBe("Ta biết ngươi khó xử, ta sẽ nghĩ cách!");
      expect(declined.saved.eventStates?.["5:5:1"] ?? 0).not.toBe(3);
      expect(declined.host.director?.log.branchStatus(21)).not.toBe(1);

      const accepted = await playGroup(arrival(), 5, 5, 1);
      expect(accepted.offers).toHaveLength(1);
      expect(accepted.lines).toContain("Đến địa lao Hắc Thạch cứu Edern.");
      expect(accepted.saved.eventStates?.["5:5:1"]).toBe(3);
      expect(accepted.host.director?.log.branchStatus(21)).toBe(1);
      const back = reload(accepted.saved);
      expect(back.host.director?.log.branchStatus(21)).toBe(1);
      expect(back.world.eventState.sourceEventState(5, 5, 1)).toBe(3);
    });

    /** Task 28 reached: the lower gym is beaten and Jani Las's rescue (branch 21) is taken. */
    async function inDungeon(): Promise<GameSave> {
      const save = arrival();
      return {
        ...save,
        eventStates: {
          ...save.eventStates,
          "9:4:3": 3,
          "5:3:4": 3,
          "9:5:0": 3,
          "9:5:1": 3,
          "9:5:2": 3,
          "9:5:3": 3,
        },
        progress: { ...save.progress, mainTaskProgress: 28 },
        world: { ...save.world!, mainTaskProgress: 28 },
        story: { ...save.story, quest: { node: "hac-tinh-thach" } },
        // Three Tất Trung Cầu for the three captures.
        inventory: { ...save.inventory!, items: { ...save.inventory!.items, "0": 3 } },
      };
    }

    it("28→29: Edern, the three captures that free Hắc Tinh Thạch (op78), then Yafei's handoff", async () => {
      let save = (await playGroup(await inDungeon(), 5, 5, 1)).saved;
      const edern = await playGroup(save, 5, 6, 0);
      expect(edern.lines.at(-1)).toBe("Trở về giao cho Jani Las.");
      expect(edern.saved.eventStates?.["5:6:0"]).toBe(3);
      save = edern.saved;

      // The barrier only warns until the stone is freed.
      const barrier = await playGroup(save, 5, 6, 6);
      expect(barrier.lines[0]).toMatch(/^Bị chặn, hẳn phải có cơ quan mật/);
      save = barrier.saved;

      // A knockout is a miss: "Lại bỏ lỡ cơ hội!" and the pet stays; a catch hides it and closes.
      const missed = await playGroup(save, 5, 6, 3);
      expect(missed.lines).toEqual(["Rốt cục tìm được rồi.", "Lại bỏ lỡ cơ hội!"]);
      expect(missed.world.actors.get(10)?.visible).toBe(true);
      for (const group of [3, 4, 5]) {
        const caught = await playGroup(save, 5, 6, group, "confirm", true);
        expect(caught.lines.at(-1), `5:6:${group}`).toBe("Rất đơn giản.");
        expect(caught.saved.eventStates?.[`5:6:${group}`]).toBe(3);
        save = caught.saved;
      }
      // op78 [5:6:3, 5:6:4, 5:6:5] is satisfied: the chained unlock runs by itself and lifts the
      // barrier (op23 5:6:6).
      const unlock = await playGroup(save, 5, 6, 2);
      expect(unlock.lines).toEqual(["Hiện tại có thể mang theo Hắc Tinh Thạch."]);
      save = unlock.saved;
      expect(save.eventStates?.["5:6:2"]).toBe(3);
      expect(save.eventStates?.["5:6:6"]).toBe(3);

      const yafei = await playGroup(save, 5, 6, 1);
      expect(yafei.lines).toContain("Lấy được Hắc Tinh Thạch.");
      expect(yafei.lines.at(-1)).toBe("Đến [Phượng Hoàng Di Tích] tìm Hỏa Phượng Hoàng.");
      expect(yafei.saved.progress.mainTaskProgress).toBe(29);
      expect(yafei.saved.story.quest?.node).toBe("phoenix-relic");
      const back = reload(yafei.saved);
      expect(back.host.director?.node.id).toBe("phoenix-relic");
      expect(back.world.eventState.sourceEventState(5, 6, 1)).toBe(3);
    });

    describe("gym NPCs fight a real 2v2 (no win by talking)", () => {
      /** Talk to 9:4:g0's trainer (Quincy) and step until his fight is seated. */
      async function challenge(save: GameSave) {
        await assets.prepareRoom(9, 4);
        const { host } = reload({
          ...save,
          location: { sceneId: 9, roomIndex: 4, ...triggerPoint(9, 4, 0), direction: 3 },
        });
        while (host.mapLoadingActive) host.step([]);
        const world = host.world!,
          quincy = world.actors.get(2)!;
        world.player.x = quincy.x;
        world.player.y = quincy.y + 20;
        world.player.direction = DIRECTION_UP;
        for (let i = 0; i < 2000 && !world.battle && !world.doubleBattle; i++)
          host.step(i % 2 === 0 ? ["confirm"] : []);
        return { host, world };
      }
      function fight(host: Host, world: Host["world"] & object, lose: boolean) {
        for (let i = 0; i < 20000 && world.phase === "battleEntry"; i++) host.step([]);
        for (let i = 0; i < 20000 && world.doubleBattle; i++)
          host.step(doubleBattleCommands(world.doubleBattle, lose));
      }

      it("won: the 2v2 engine seats both pets, pays the NPC, shares EXP, and op47 closes the group", async () => {
        const { host, world } = await challenge(arrival());
        expect(world.battle).toBeNull();
        const battle = world.doubleBattle!;
        expect(battle).not.toBeNull();
        expect(battle.core.occupant(2)).toEqual({ side: "player", index: 0 });
        expect(battle.core.occupant(3)).toEqual({ side: "player", index: 1 });
        const money = world.currency.money,
          exp = world.pets.map((pet) => [pet.level, pet.experience ?? 0]);
        fight(host, world, false);
        expect(world.currency.money).toBeGreaterThan(money);
        expect(
          world.pets.some((pet, i) => pet.level > exp[i][0] || (pet.experience ?? 0) > exp[i][1]),
        ).toBe(true);
        for (let i = 0; i < 4000 && world.phase === "event"; i++)
          host.step(world.eventScene?.textReady ? ["confirm"] : []);
        expect(world.eventState.sourceEventState(9, 4, 0)).toBe(3);
      });

      it("lost: the group stays open and the party is revived", async () => {
        const { host, world } = await challenge(arrival());
        expect(world.doubleBattle).not.toBeNull();
        fight(host, world, true);
        expect(world.phase).toBe("freeworld");
        expect(world.eventState.sourceEventState(9, 4, 0)).not.toBe(3);
        for (const pet of world.pets) expect(pet.currentHp).toBe(pet.maxHp);
      });

      // Web rule (owner): Java falls back to a 1v1 here; the web refuses the gym fight instead.
      for (const [label, pets] of [
        ["one living pet", (save: GameSave) => save.pets.map((pet, i) => (i === 0 ? pet : { ...pet, currentHp: 0 }))],
        ["a one-pet party", (save: GameSave) => save.pets.slice(0, 1)],
      ] as const)
        it(`with ${label} the gym refuses the fight (no 1v1) and says two pets are needed`, async () => {
          const save = arrival();
          await assets.prepareRoom(9, 4);
          const { host } = reload({
            ...save,
            pets: pets(save),
            location: { sceneId: 9, roomIndex: 4, ...triggerPoint(9, 4, 0), direction: 3 },
          });
          while (host.mapLoadingActive) host.step([]);
          const world = host.world!,
            quincy = world.actors.get(2)!;
          world.player.x = quincy.x;
          world.player.y = quincy.y + 20;
          world.player.direction = DIRECTION_UP;
          const texts = new Set<string>();
          for (let i = 0; i < 2000 && !world.battle && !world.doubleBattle; i++) {
            if (world.eventScene?.textReady) texts.add(world.eventScene.currentText ?? "");
            host.step(i % 2 === 0 ? ["confirm"] : []);
          }
          expect(world.battle).toBeNull();
          expect(world.doubleBattle).toBeNull();
          expect([...texts].some((t) => t.startsWith("Đạo quán đấu đôi 2v2"))).toBe(true);
          // Back on the free map (this save roams in "returnWorld"), the group still open.
          expect(["freeworld", "returnWorld"]).toContain(world.phase);
          expect(world.eventState.sourceEventState(9, 4, 0)).not.toBe(3);
        });
    });

    it("an unbeaten gym trainer seals its tile; once beaten the hero walks past", async () => {
      await assets.prepareRoom(9, 4);
      const walkInto = (save: GameSave) => {
        const host = reload(save).host;
        while (host.mapLoadingActive) host.step([]);
        const world = host.world!,
          quincy = world.actors.get(2)!;
        // Stand just below Quincy and walk up into him.
        world.player.x = quincy.x;
        world.player.y = quincy.y + 26;
        world.player.direction = DIRECTION_UP;
        const startY = world.player.y;
        for (let i = 0; i < 8; i++) world.tick(["up"]);
        return { moved: startY - world.player.y, top: quincy.y + 16 + 8 };
      };
      const before = walkInto({
        ...arrival(),
        location: { sceneId: 9, roomIndex: 4, x: 50, y: 300, direction: 2 },
      });
      expect(before.moved).toBeLessThanOrEqual(26 - 24);
      const beaten = await playGroup(arrival(), 9, 4, 0);
      const after = walkInto({
        ...beaten.saved,
        location: { sceneId: 9, roomIndex: 4, x: 50, y: 300, direction: 2 },
      });
      expect(after.moved).toBeGreaterThan(before.moved);
    });

    /** Talk to a dock's captain, read his line and open his wharf menu. */
    async function boardAt(save: GameSave, scene: number, room: number, captain: number) {
      await assets.prepareRoom(scene, room);
      const host = reload({
        ...save,
        location: { sceneId: scene, roomIndex: room, x: 0, y: 0, direction: 2 },
      }).host;
      while (host.mapLoadingActive) host.step([]);
      const world = host.world!,
        actor = world.actors.get(captain)!;
      world.player.x = actor.x;
      world.player.y = actor.y + 20;
      world.player.direction = DIRECTION_UP;
      for (let i = 0; i < 200 && !host.panel.visible; i++) host.step(["confirm"]);
      return host;
    }

    it("Hắc Thạch Mã Đầu's captain: a closed route warns, an open one sails to Bích Thủy", async () => {
      const closed = await boardAt(arrival(), 5, 2, 10);
      expect(closed.panel.mode).toBe("wharf");
      expect(closed.panel.wharf).toMatchObject({
        title: "Hắc Thạch Mã Đầu",
        labels: ["Bắc Bích Thủy Thành", "Hắc Long Thần Điện", "Không ra hàng"],
      });
      expect(closed.panel.wharfLayoutName).toBe("wharf1");
      closed.step(["confirm"]);
      expect(closed.panel.wharfMessage?.text).toBe("Đường thủy chưa mở");
      closed.step(["confirm"]);
      expect(closed.panel.wharfMessage).toBeNull();
      closed.step(["down"]);
      closed.step(["down"]);
      closed.step(["confirm"]);
      expect(closed.panel.visible).toBe(false);
      expect(closed.wharfTravel).toBeNull();

      // With Hắc Tinh Thạch in hand (5:6:1) the first route is open.
      const open = arrival();
      open.eventStates = { ...open.eventStates, "5:6:1": 3 };
      await assets.prepareRoom(1, 5);
      const host = await boardAt(open, 5, 2, 10);
      host.step(["confirm"]);
      const travel = host.wharfTravel!;
      expect(travel.route).toMatchObject({
        target: { scene: 1, room: 5, x: 272, y: 128, direction: 3 },
        boatMode: 0,
      });
      const phases: number[] = [];
      let ticks = 0;
      while (host.wharfTravel && ticks < 500) {
        host.step(["confirm"]);
        ticks++;
        if (phases.at(-1) !== host.wharfTravel?.phase) phases.push(host.wharfTravel?.phase ?? 5);
      }
      // Fade (16 ticks), bars in, the crossing, ashore, bars out — and no map-loading screen.
      expect(phases).toEqual([1, 2, 3, 4, 5]);
      expect(ticks).toBeGreaterThan(16 + 6 + 60);
      expect(host.mapLoadingActive).toBe(false);
      const world = host.world!;
      expect([world.sceneId, world.roomIndex, world.player.x, world.player.y]).toEqual([
        1, 5, 272, 128,
      ]);
      const back = reload(host.snapshot(world));
      expect([back.world.sceneId, back.world.roomIndex]).toEqual([1, 5]);
    });

    it("29→30: the relic's torches open its door, Hỏa Phượng Hoàng joins, and the village story runs", async () => {
      const start = await inDungeon();
      let save: GameSave = {
        ...start,
        eventStates: { ...start.eventStates, "5:5:1": 3, "5:6:0": 3, "5:6:2": 3, "5:6:1": 3 },
        progress: { ...start.progress, mainTaskProgress: 29 },
        world: { ...start.world!, mainTaskProgress: 29 },
        story: { ...start.story, quest: { node: "phoenix-relic" } },
      };
      for (const room of [3]) await assets.prepareRoom(1, room);
      for (const room of [13, 14]) await assets.prepareRoom(10, room);
      save = (await playGroup(save, 1, 3, 8)).saved;
      const arrive = await playGroup(save, 10, 13, 0);
      expect(arrive.lines[0]).toBe("Chúng ta đã đến.");
      save = arrive.saved;
      save = (await playGroup(save, 10, 13, 2)).saved;

      // Light both torches (op59 [2,3]); the door (op60 actor 1) opens and 10:13:1 closes.
      const relic = reload({
        ...save,
        location: { sceneId: 10, roomIndex: 13, x: 120, y: 160, direction: 2 },
      }).host;
      while (relic.mapLoadingActive) relic.step([]);
      const world = relic.world!;
      // The relic door (kind-1 actor 1, opened by 10:13:1's op60) does not lead on yet.
      const door = sourceDoors(boot.sourceEvents, 10, 13).find((d) => d.actorId === 1)!;
      const tryDoor = (host: Host) => {
        while (host.mapLoadingActive) host.step([]);
        const w = host.world!;
        w.player.x = door.x;
        w.player.y = door.y;
        w.player.direction = door.requiredDirection;
        host.step([]);
        while (host.mapLoadingActive) host.step([]);
        return `${w.sceneId}:${w.roomIndex}`;
      };
      expect(tryDoor(relic)).toBe("10:13");
      for (const torch of [2, 3]) {
        const actor = world.actors.get(torch)!;
        world.player.x = actor.x;
        world.player.y = actor.y + 20;
        world.player.direction = DIRECTION_UP;
        relic.step(["confirm"]);
        for (let i = 0; i < 120; i++) relic.step([]);
        expect(world.actors.get(torch)!.state, `torch ${torch}`).toBe(2);
      }
      for (let i = 0; i < 300 && world.eventState.sourceEventState(10, 13, 1) !== 3; i++)
        relic.step(world.eventScene?.textReady ? ["confirm"] : []);
      expect(world.eventState.sourceEventState(10, 13, 1)).toBe(3);
      expect(world.actors.get(1)!.state).toBe(2);
      save = relic.snapshot(world);
      // The door stays open across a reload.
      const back = reload({
        ...save,
        location: { sceneId: 10, roomIndex: 13, x: 120, y: 160, direction: 2 },
      });
      expect(back.world.actors.get(1)!.state).toBe(2);
      expect(back.world.actors.get(2)!.state).toBe(2);
      expect(tryDoor(back.host)).toBe("10:14");

      // The fight's win goes to its op47 record: the op36 reward, then the farewell, then the village.
      const phoenix = await playGroup(save, 10, 14, 0);
      expect(phoenix.battles).toBeGreaterThan(0);
      expect(phoenix.lines).toContain("Đạt được: Hỏa Phượng Hoàng");
      expect(phoenix.lines.at(-1)).toBe("... Ừm! Cám ơn đã hiểu ta.");
      expect([phoenix.world.sceneId, phoenix.world.roomIndex]).toEqual([1, 3]);
      // PhoenixSavePrompt: 10:14:1's save prompt ran in the Phoenix room before the village return.
      expect(phoenix.world.eventState.sourceEventState(10, 14, 1)).toBe(3);
      expect(phoenix.world.eventState.sourceEventState(10, 14, 0)).toBe(3);
      expect(phoenix.saved.pets?.some((pet) => pet.speciesId === 15)).toBe(true);

      const village = await playGroup(phoenix.saved, 1, 3, 6);
      expect(village.lines[0]).toBe("Hiện tại chúng ta đang có Hỏa Tinh Thạch!");
      expect(village.saved.progress.mainTaskProgress).toBe(30);
      expect(village.saved.story.quest?.node).toBe("tran-phong-story");
      expect(reload(village.saved).host.director?.node.id).toBe("tran-phong-story");
    });

    it("30→32: the elder's story, the boat to Hắc Long Thần Điện, its gym's vortices, Sophie", async () => {
      const start = await inDungeon();
      const done = [
        "5:5:1",
        "5:6:0",
        "5:6:2",
        "5:6:1",
        "1:3:8",
        "10:13:0",
        "10:13:1",
        "10:13:2",
        "10:14:0",
        "10:14:1",
        "1:3:6",
      ];
      let save: GameSave = {
        ...start,
        eventStates: { ...start.eventStates, ...Object.fromEntries(done.map((key) => [key, 3])) },
        progress: { ...start.progress, mainTaskProgress: 30 },
        world: { ...start.world!, mainTaskProgress: 30 },
        story: { ...start.story, quest: { node: "tran-phong-story" } },
      };
      for (const [scene, room] of [
        [1, 0],
        [1, 5],
        [6, 0],
        [6, 1],
        [9, 6],
      ])
        await assets.prepareRoom(scene, room);

      const elder = await playGroup(save, 1, 0, 10);
      expect(elder.lines[0]).toBe("Neil! Đã trở lại đấy hả?");
      expect(elder.lines.at(-1)).toBe("Đến [Hắc Long Thần Điện] tìm Sophie.");
      expect(elder.saved.progress.mainTaskProgress).toBe(31);
      expect(elder.saved.story.quest?.node).toBe("sophie-hoa-tinh-thach");
      save = elder.saved;

      // The south dock's captain: "Hắc Long Thần Điện" opens once 1:0:10 is done.
      const dock = await boardAt(save, 1, 5, 26);
      expect(dock.panel.wharf?.title).toBe("Bến tàu phía Nam");
      dock.step(["down"]);
      dock.step(["confirm"]);
      expect(dock.wharfTravel?.route.target).toMatchObject({ scene: 6, room: 0, x: 112, y: 224 });
      for (let i = 0; i < 500 && dock.wharfTravel; i++) dock.step([]);
      expect([dock.world!.sceneId, dock.world!.roomIndex]).toEqual([6, 0]);
      save = dock.snapshot(dock.world!);

      // Thần Điện Mã Đầu (Q4, wharf2.ui): its routes' gate is 0:0:0, closed by the opening.
      const temple = await boardAt(save, 6, 0, 2);
      expect(temple.panel.wharfLayoutName).toBe("wharf2");
      temple.step(["confirm"]);
      expect(temple.panel.wharfMessage).toBeNull();
      expect(temple.wharfTravel?.route.target).toMatchObject({ scene: 1, room: 5 });

      const guard = await playGroup(save, 6, 0, 0);
      expect(guard.lines[0]).toMatch(/^Hắc Long Thần Điện là khu vực nghiêm cấm/);
      expect(guard.battles).toBeGreaterThan(0);
      save = guard.saved;

      // The leader waits for both trainers, then awards the Hắc Long badge.
      expect((await playGroup(save, 9, 6, 2)).lines).toEqual([]);
      for (const group of [0, 1]) save = (await playGroup(save, 9, 6, group)).saved;
      // A vortex (kind-1 behavior 4 into its own room) spins the hero onto its partner, no reload.
      const gym = reload({
        ...save,
        location: { sceneId: 9, roomIndex: 6, x: 136, y: 328, direction: 2 },
      }).host;
      while (gym.mapLoadingActive) gym.step([]);
      const vortices = sourceDoors(boot.sourceEvents, 9, 6),
        from = vortices.find((d) => d.actorId === 0)!,
        to = vortices.find((d) => d.actorId === from.target.actor)!;
      expect(to.actorId).toBe(5);
      gym.world!.player.x = from.x;
      gym.world!.player.y = from.y;
      let ticks = 0;
      gym.step([]);
      while (ticks < 60 && (gym.world!.player.x !== to.x - (to.x % 16) || ticks < 33)) {
        gym.step([]);
        ticks++;
      }
      expect(gym.mapLoadingActive).toBe(false);
      expect([gym.world!.player.x, gym.world!.player.y]).toEqual([
        to.x - (to.x % 16),
        to.y - (to.y % 16),
      ]);
      expect([gym.world!.sceneId, gym.world!.roomIndex]).toEqual([9, 6]);

      const leader = await playGroup(save, 9, 6, 2);
      expect(leader.awards).toEqual([6]);
      save = leader.saved;

      const sophie = await playGroup(save, 6, 1, 0);
      expect(sophie.lines).toContain("Sophie!");
      expect(sophie.saved.progress.mainTaskProgress).toBe(32);
      expect(sophie.saved.story.quest?.node).toBe("chase-airship");
      const back = reload(sophie.saved);
      expect(back.host.director?.node.id).toBe("chase-airship");
      expect(back.host.director?.atFrontier).toBe(false);
    });

    it("32→33: the airship base, Silia aboard Phi Không Đĩnh, Sophie's rescue, the crash in Thiên Giới", async () => {
      const start = await inDungeon();
      const done = [
        ...["5:5:1", "5:6:0", "5:6:2", "5:6:1", "1:3:8", "10:13:0", "10:13:1", "10:13:2"],
        ...["10:14:0", "10:14:1", "1:3:6", "1:0:10", "6:0:0", "9:6:0", "9:6:1", "9:6:2", "6:1:0"],
      ];
      let save: GameSave = {
        ...start,
        eventStates: { ...start.eventStates, ...Object.fromEntries(done.map((key) => [key, 3])) },
        progress: { ...start.progress, mainTaskProgress: 32 },
        world: { ...start.world!, mainTaskProgress: 32 },
        story: { ...start.story, quest: { node: "chase-airship" } },
      };
      for (const [scene, room] of [
        [4, 8],
        [11, 2],
        [7, 6],
      ])
        await assets.prepareRoom(scene, room);

      // 4:8:g1 (`AirshipBasePursuit`): Red, then TeYaQi, then the phoenix carries the hero aboard.
      const base = await playGroup(save, 4, 8, 1);
      expect(base.lines[0]).toBe(
        "Ngươi rất can đảm. Nhưng ta không phải Yafei, không có chuyện nương tay đâu.",
      );
      expect(base.lines).toContain("Đứng lại!");
      expect(base.lines.at(-1)).toBe("Không thể ngăn. Ta sẽ đem nó theo trước.");
      expect(base.battles).toBeGreaterThan(0);
      expect(base.saved.eventStates?.["4:8:1"]).toBe(3);
      expect(base.saved.location).toMatchObject({ sceneId: 11, roomIndex: 2, x: 351, y: 98 });
      save = base.saved;

      // 11:2:g0 (`AirshipReveal`) plays the moment the hero is aboard.
      const reveal = await playGroup(save, 11, 2, 0);
      expect(reveal.lines[0]).toBe("Giờ thế nào?");
      expect(reveal.lines.at(-1)).toBe("Nhanh đến xem Sophie thế nào.");
      save = reveal.saved;
      // `reconcileRoomEntry`: Silia and the guards he sent off stay gone on the next load.
      const aboard = reload({
        ...save,
        location: { sceneId: 11, roomIndex: 2, x: 351, y: 98, direction: 2 },
      });
      for (const id of [10, 6, 7, 13, 20, 21, 22])
        expect(aboard.world.actors.get(id)!.visible).toBe(false);
      expect(aboard.world.actors.get(11)!.visible).toBe(true);

      const rescue = await playGroup(save, 11, 2, 1);
      expect(rescue.lines[0]).toBe("Sophie lúc này đang bần thần rơi lệ.");
      expect(rescue.lines.at(-1)).toBe("Vội vàng từ hướng cửa sổ nhảy ra ngoài.");
      save = rescue.saved;
      const after = reload({
        ...save,
        location: { sceneId: 11, roomIndex: 2, x: 351, y: 98, direction: 2 },
      });
      expect(after.world.actors.get(11)!.visible).toBe(false);

      // 11:2:g2 (`CrashTransition`): out of the window and down to 7:6.
      const crash = await playGroup(save, 11, 2, 2);
      expect(crash.saved.eventStates?.["11:2:2"]).toBe(3);
      expect(crash.saved.location).toMatchObject({ sceneId: 7, roomIndex: 6, x: 48, y: 192 });
      save = crash.saved;

      // 7:6:g4 (`CrashHandoff`): the landing, then task 33.
      const landing = await playGroup(save, 7, 6, 4);
      expect(landing.lines[0]).toMatch(/Phi Không Đĩnh nổ mạnh/);
      expect(landing.lines.slice(-2)).toEqual([
        "Tìm kiếm Sophie.",
        "Hiện tại có thể tự do di chuyển.",
      ]);
      expect(landing.saved.progress.mainTaskProgress).toBe(33);
      expect(landing.saved.story.quest?.node).toBe("thien-khong-chi-thanh");
      const back = reload(landing.saved);
      expect(back.host.director?.node.id).toBe("thien-khong-chi-thanh");
      expect(back.host.director?.atFrontier).toBe(false);
      expect(back.world.questState.mainTaskProgress).toBe(33);
    });
  },
);
