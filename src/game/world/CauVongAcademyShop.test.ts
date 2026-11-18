import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Node has no image decoder; the rooms never read pixels (see gameplayTrace.test.ts). */
class StubImage {
  complete = true;
  naturalWidth = 1;
  naturalHeight = 1;
  width = 1;
  height = 1;
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
}
vi.stubGlobal("Image", StubImage);
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
const { NewGameScreen } = await import("../../screens/NewGameScreen");
const { applyUrlParityCheckpoint } = await import("../../dev/parityCheckpoints");
const shopLogic = await import("./CauVongShop");
const { openingBranchRows } = await import("./CauVongOpening");
type AcademyDocument = import("./CauVongAcademy").CauVongAcademyDocument;
type ShopsDocument = import("./CauVongShop").CauVongShopsDocument;
type OpeningDocument = import("./CauVongOpening").CauVongOpeningDocument;

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
for (const room of [0, 2, 4, 43]) await assets.prepareRoom(98, room);

const read = (file: string) =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../public/pack", file), "utf8"));
const ACADEMY = read("cau-vong-world/academy.json") as AcademyDocument;
const SHOPS = read("cau-vong-world/shops.json") as ShopsDocument;
const OPENING = read("cau-vong-world/opening.json") as OpeningDocument;
const COLLISION = read("cau-vong-world/collision.json").rooms as Record<
  string,
  Record<string, { dx: number; dy: number }>
>;
const flatten = (text: string) =>
  text
    .normalize("NFC")
    .replace(/#[0-9A-Fa-f]{6}/g, "")
    .replace(/\s+/g, "");

/** Registered at the academy, Tứ Môn told (3:102, the `alliance` checkpoint), `flags` set, then `room` at (x, y). */
const CV3_DONE: [number, number][] = [
  [6, 100],
  [0, 101],
  [2, 100],
  [2, 101],
  [2, 140],
  [2, 830000],
  [3, 100],
  [3, 102],
];
function enter(room: number, x: number, y: number, flags: [number, number][] = []) {
  const screen = new NewGameScreen(
    false,
    assets,
    boot,
    new SaveRepository(new MemorySaveStore()),
    () => {},
  );
  expect(applyUrlParityCheckpoint(screen, new URLSearchParams("cauVongRoom=0"))).toBe(true);
  const world = screen.host.world!;
  for (let tick = 0; tick < 3000 && world.eventVisible; tick++)
    world.tick(world.eventScene?.textReady ? ["confirm"] : []);
  for (const [r, event] of [...CV3_DONE, ...flags])
    world.eventState.op14CompleteEvent(98, r, event);
  for (const pet of world.pets) {
    pet.level = 100;
    pet.currentHp = undefined;
  }
  world.warp({ scene: 98, room, x, y, direction: 0 });
  expect([world.sceneId, world.roomIndex]).toEqual([98, room]);
  return { screen, world, panel: screen.host.panel };
}
type World = ReturnType<typeof enter>["world"];
const done = (world: World, room: number, event: number) =>
  world.eventState.sourceEventStateComplete(98, room, event);

/** Ticks, confirming every box and winning (or losing) a fight, until quiet or a choice opens. */
function play(world: World, lose = false, limit = 40000) {
  const seen: string[] = [];
  const fights: number[] = [];
  let quiet = 0,
    last: unknown = null;
  for (let tick = 0; tick < limit; tick++) {
    const battle = world.battle;
    if (battle) {
      if (battle !== last) {
        last = battle;
        fights.push(battle.core!.enemySetup(0).speciesId);
      }
      const foe = battle.core?.activeUnit("enemy"),
        mine = battle.core?.activeUnit("player");
      if (lose) {
        if (mine?.alive()) mine.setHp(0);
      } else {
        if (foe?.alive()) foe.setHp(0);
        if (mine?.alive()) mine.setHp(mine.maxHp());
      }
      const ui = battle.ui,
        row = ui.rows[ui.selectedIndex];
      const shut =
        ui.mode === "CHOICE_SKILL" &&
        !!mine &&
        (row?.enabled === false ||
          (mine.rainbowCharmSealed()
            ? ui.selectedIndex < mine.rainbowCharmSealedSkillSlots
            : !mine.canUseSkillTier(row?.tier ?? 0)));
      world.tick([shut ? "down" : "confirm"]);
      continue;
    }
    const scene = world.eventScene;
    if (scene?.choice) return { seen, fights };
    if (scene?.currentText && seen.at(-1) !== scene.currentText) seen.push(scene.currentText);
    const busy = world.eventVisible || world.phase !== "freeworld";
    quiet = busy ? 0 : quiet + 1;
    if (quiet > 3) return { seen, fights };
    world.tick(scene?.textReady || world.phase === "battleReport" ? ["confirm"] : []);
  }
  throw new Error("The room kept playing");
}
const showed = (seen: string[], lines: string[]) =>
  lines.every((line) => seen.some((box) => flatten(line).startsWith(flatten(box).slice(0, 12))));
const says = (name: string) =>
  ACADEMY.parts[name].steps.flatMap((cue) => (cue.k === "say" ? [cue.text] : []));
function ask(world: World, id: number, above = false) {
  const actor = world.actors.get(id)!,
    mechanic = COLLISION[`98:${world.roomIndex}`]?.[String(id)] ?? { dx: 0, dy: 0 };
  world.player.x = actor.x + mechanic.dx;
  world.player.y = actor.y + mechanic.dy + (above ? -16 : 16);
  world.player.direction = above ? 0 : 2;
  world.tick(["confirm"]);
}
function choose(world: World, index: number) {
  for (let i = 0; i < index; i++) world.tick(["down"]);
  world.tick(["confirm"]);
}
function stand(world: World, x: number, y: number) {
  world.player.x = x;
  world.player.y = y;
  world.tick([]);
}
/** The shop the room asked the host for (`takeServiceRequest`), opened on the panel. */
function openService(world: World, panel: ReturnType<typeof enter>["panel"]) {
  const service = world.takeServiceRequest();
  expect(service).not.toBeNull();
  if (service!.continuation === "CAU_VONG_SHOP") panel.openCauVongShop(service!.shopCategory ?? 0);
  return service!;
}
/** Into the shop from the yard's east door; the intro plays once. */
function intoShop(flags: [number, number][] = []) {
  const entered = enter(2, 300, 300, flags);
  stand(entered.world, 519, 193);
  expect(entered.world.roomIndex).toBe(43);
  play(entered.world);
  return entered;
}
const shop43 = ACADEMY.shop43,
  actorOf = (canonical: number) => shop43.npcs.find((npc) => npc.canonical === canonical)!.actorId;

describe("Cầu Vồng CV3b: the campus shop (43), the arena merchant and the later principal", () => {
  it("bakes Java's shop owner, stock and fights", () => {
    expect(ACADEMY.parts.SHOP_INTRO).toMatchObject({
      room: 43,
      flag: 1600,
      started: 1700,
      cue: 246000,
    });
    expect(ACADEMY.parts.SHOP_POTTER_POST).toMatchObject({
      flag: 1611,
      started: 1711,
      cue: 251500,
    });
    expect(shop43.flags).toEqual({ infoPaid: 1650, harryWon: 1651, potterWon: 1652 });
    expect(shop43.npcs.map((npc) => npc.canonical)).toEqual([0, 1, 2, 3, 5, 6, 7]);
    // `request(9)`: 43:9's odd payload runs two pets; Potter has three.
    expect(ACADEMY.battles.harry.members).toHaveLength(2);
    expect(ACADEMY.battles.potter.members).toHaveLength(3);
    // The three gifts, each once under `CauVongAcademyTransactions.gift`'s receipt.
    const awards = (name: string) =>
      ACADEMY.parts[name].steps.flatMap((cue) =>
        cue.k === "award" ? [[cue.receipt, cue.kind, cue.rewardId, cue.qty]] : [],
      );
    expect(awards("SHOP_EVOLUTION_POST")).toEqual([[20118, "MATERIAL", 3000, 2]]);
    expect(awards("SHOP_SCROLL")).toEqual([[21136, "EQUIPMENT", 5037, 1]]);
    expect(awards("SHOP_POTTER_POST")).toEqual([[21065, "SPECIAL", 8065, 1]]);
    expect(SHOPS.stock.map((category) => category.length)).toEqual([14, 10, 16]);
    expect(SHOPS.stock[2].every((offer) => offer.badges)).toBe(true);
    expect(SHOPS.mutation).toMatchObject({ source: 34, price: 1500, name: "Dị hóa tài liệu" });
    expect(ACADEMY.laterPrincipal).toEqual({
      actor: 153,
      north: [59, 131],
      investigation: [59, 121],
    });
  });

  it("2 ↔ 43: the yard's east door, the intro once, and the way back", () => {
    const { world } = enter(2, 300, 300);
    stand(world, 519, 193);
    expect([world.roomIndex, world.player.x, world.player.y]).toEqual([43, 200, 450]);
    const intro = play(world);
    expect(showed(intro.seen, says("SHOP_INTRO"))).toBe(true);
    expect(done(world, 43, 1600)).toBe(true);
    // The ghost stays hidden until he shows himself.
    expect(world.actors.get(shop43.ghost)?.visible).toBe(false);
    stand(world, 200, 500);
    expect([world.roomIndex, world.player.x, world.player.y]).toEqual([2, 490, 260]);
    stand(world, 519, 193);
    expect(world.roomIndex).toBe(43);
    expect(play(world).seen).toEqual([]);
  });

  it("the item clerk: greeting, the shop (buy and sell), then her farewell", () => {
    const { world, panel } = intoShop();
    world.currency.money = 1000;
    ask(world, actorOf(0));
    expect(showed(play(world).seen, says("SHOP_ITEMS"))).toBe(true);
    expect(openService(world, panel)).toMatchObject({
      continuation: "CAU_VONG_SHOP",
      shopCategory: 0,
    });
    expect(panel.mode).toBe("cauVongShop");
    const drink = SHOPS.stock[0][0],
      held = world.inventory[String(drink.runtimeId)] ?? 0;
    // Mua vật phẩm → the first offer → quantity 2 → confirm.
    panel.tick(["confirm"]);
    panel.tick(["confirm"]);
    panel.tick(["right"]);
    panel.tick(["confirm"]);
    expect(panel.cauVongShop.message).toBe(`Đã mua 2 ${drink.name}`);
    expect(world.inventory[String(drink.runtimeId)]).toBe(held + 2);
    expect(world.currency.money).toBe(1000 - 2 * drink.price);
    // The result returns to the list; Back to the main menu, Bán vật phẩm: the drink is listed at its sale price.
    panel.tick(["back"]);
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    const sale = panel.cauVongShop.offers.find((offer) => offer.runtimeId === drink.runtimeId)!;
    expect(sale).toBeDefined();
    panel.cauVongShop.selected = panel.cauVongShop.offers.indexOf(sale);
    const before = world.currency.money;
    panel.tick(["confirm"]);
    panel.tick(["confirm"]);
    expect(panel.cauVongShop.message).toBe(`Đã bán 1 ${sale.name}`);
    expect(world.currency.money).toBe(before + sale.price);
    expect(world.inventory[String(drink.runtimeId)]).toBe(held + 1);
    for (let i = 0; i < 3 && panel.visible; i++) panel.tick(["back"]);
    expect(panel.visible).toBe(false);
    // The world resumes with the farewell.
    expect(showed(play(world).seen, says("SHOP_ITEMS_BYE"))).toBe(true);
  });

  it("the merchant also keeps the pet bank (web-only): a deposit, then her farewell", () => {
    const { world, panel } = intoShop();
    // A second pet, so the roster keeps one after the deposit.
    world.pets.push({ ...structuredClone(world.pets[0]), slot: 1 });
    ask(world, actorOf(0));
    play(world);
    openService(world, panel);
    expect(shopLogic.shopMainMenu(0)).toEqual([
      "Mua vật phẩm",
      "Bán vật phẩm",
      "Ngân hàng sủng vật",
      "Rời đi",
    ]);
    expect(shopLogic.shopMainMenu(2)).toEqual(["Mua / trao đổi", "Ngân hàng sủng vật", "Rời đi"]);
    // The mutation document's counter sells its one offer and nothing else.
    expect(shopLogic.shopMainMenu(3)).toEqual(["Mua / trao đổi", "Rời đi"]);
    // Ngân hàng sủng vật: the Liệt Hỏa bank menu, then Gửi: the roster's last pet goes in.
    panel.tick(["down"]);
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect(panel.mode).toBe("petBank");
    const roster = world.pets.length,
      banked = world.meta.campaign.petBank.length;
    panel.tick(["confirm"]);
    panel.selected = roster - 1;
    panel.tick(["confirm"]);
    for (let i = 0; i < 4 && world.pets.length === roster; i++) panel.tick(["confirm"]);
    expect(world.pets).toHaveLength(roster - 1);
    expect(world.meta.campaign.petBank).toHaveLength(banked + 1);
    for (let i = 0; i < 4 && panel.visible; i++) panel.tick(["back"]);
    expect(panel.visible).toBe(false);
    expect(showed(play(world).seen, says("SHOP_ITEMS_BYE"))).toBe(true);
  });

  it("the material clerk's evolution scene, its gift, then the scroll and its charm", () => {
    const { world, panel } = intoShop();
    ask(world, actorOf(3));
    expect(showed(play(world).seen, says("SHOP_EVOLUTION_PRE"))).toBe(true);
    expect(openService(world, panel)).toMatchObject({ shopCategory: 1 });
    panel.close();
    // `EVOLUTION_POST` follows by itself: Thụ chướng thạch × 2, once.
    play(world);
    expect(done(world, 43, 1602)).toBe(true);
    expect(world.bag.materials["3000"]).toBe(2);
    ask(world, actorOf(2));
    expect(showed(play(world).seen, says("SHOP_SCROLL"))).toBe(true);
    expect(world.bag.equipment).toContain(5037);
    expect(world.campaign.charms.tiers["5037"]).toBe(1);
    expect(openService(world, panel)).toMatchObject({ shopCategory: 2 });
    panel.close();
    // Later the two clerks only greet and open their shops.
    play(world);
    ask(world, actorOf(3));
    expect(showed(play(world).seen, says("SHOP_MATERIALS"))).toBe(true);
    expect(world.bag.materials["3000"]).toBe(2);
  });

  it("parks the hero within talking reach of Mỹ Mỹ and Harry after an offer, so the key asks again", () => {
    const { world } = intoShop();
    // Java walks the hero to y 139, one pixel short of the 4 px talk query: confirm did nothing
    // until he stepped up. The web stops at y 135, where the walk up stops anyway.
    world.currency.money = 0;
    const offer = (id: number, x: number, answer: number) => {
      ask(world, id);
      play(world);
      expect([world.player.x, world.player.y, !!world.eventScene?.choice]).toEqual([x, 135, true]);
      choose(world, answer);
      play(world);
      expect(world.phase).toBe("freeworld");
      // The key alone, where the offer left him: the question and its menu again.
      world.tick(["confirm"]);
      play(world);
      expect(world.eventScene?.choice).toBeTruthy();
      choose(world, 1);
      play(world);
    };
    // Mỹ Mỹ: pay without the 500 kim, then decline.
    offer(actorOf(5), 310, 0);
    world.currency.money = 600;
    ask(world, actorOf(5));
    play(world);
    choose(world, 0);
    play(world);
    expect(done(world, 43, shop43.flags.infoPaid)).toBe(true);
    // Harry: decline.
    offer(actorOf(6), 350, 1);
  });

  it("Harry & Potter: the 500-kim tip, the two fights, a loss kept, and the egg once", () => {
    const { world } = intoShop();
    world.currency.money = 100;
    ask(world, actorOf(5));
    play(world);
    expect(world.eventScene?.choice).toBeTruthy();
    choose(world, 0);
    // Not enough money: nothing taken.
    expect(showed(play(world).seen, says("SHOP_INFO_NO_MONEY"))).toBe(true);
    expect([world.currency.money, done(world, 43, shop43.flags.infoPaid)]).toEqual([100, false]);
    world.currency.money = 600;
    ask(world, actorOf(5));
    play(world);
    choose(world, 0);
    expect(showed(play(world).seen, says("SHOP_INFO"))).toBe(true);
    expect(world.currency.money).toBe(100);
    // Harry: a loss reads his decline; the retry needs no second payment.
    ask(world, actorOf(6));
    play(world);
    choose(world, 0);
    const lost = play(world, true);
    expect(lost.fights).toEqual([ACADEMY.battles.harry.members[0][0]]);
    expect(done(world, 43, shop43.flags.harryWon)).toBe(false);
    ask(world, actorOf(6));
    play(world);
    choose(world, 0);
    const won = play(world);
    expect(showed(won.seen, says("SHOP_HARRY_POST"))).toBe(true);
    expect(done(world, 43, shop43.flags.harryWon)).toBe(true);
    // Potter: the loss line, then the win and the egg.
    ask(world, actorOf(7));
    expect(showed(play(world, true).seen, says("SHOP_POTTER_LOSS"))).toBe(true);
    ask(world, actorOf(7));
    expect(showed(play(world).seen, says("SHOP_POTTER_POST"))).toBe(true);
    expect(world.bag.specials.filter((id) => id === 8065)).toHaveLength(1);
    // Over: Potter only chats now.
    ask(world, actorOf(7));
    expect(play(world).fights).toEqual([]);
  });

  it("the ghost merchant appears once, then sells one mutation document at a time", () => {
    const { world, panel } = intoShop();
    stand(world, 150, 130);
    expect(showed(play(world).seen, says("SHOP_GHOST"))).toBe(true);
    expect(world.actors.get(shop43.ghost)?.visible).toBe(true);
    world.currency.money = 4000;
    ask(world, shop43.ghostTalk);
    expect(showed(play(world).seen, says("SHOP_GHOST_TALK"))).toBe(true);
    expect(openService(world, panel)).toMatchObject({ shopCategory: 3 });
    // Mua / trao đổi → the document → confirm: bought, then refused while one is held.
    panel.tick(["confirm"]);
    panel.tick(["confirm"]);
    panel.tick(["confirm"]);
    expect(panel.cauVongShop.message).toBe(SHOPS.mutationText.ok);
    expect(world.bag.materials[String(SHOPS.mutation.runtimeId)]).toBe(1);
    panel.tick(["confirm"]);
    panel.tick(["confirm"]);
    expect(panel.cauVongShop.message).toBe(SHOPS.mutationText.owned);
    expect(world.currency.money).toBe(4000 - 1500);
  });

  it("the arena merchant (4, actor 49) greets, opens the shop, then says goodbye", () => {
    const { world, panel } = enter(4, 120, 300, [[4, 104]]);
    play(world);
    ask(world, ACADEMY.merchant);
    expect(showed(play(world).seen, says("MERCHANT_GREETING"))).toBe(true);
    expect(openService(world, panel)).toMatchObject({
      continuation: "CAU_VONG_SHOP",
      shopCategory: 0,
    });
    panel.tick(["back"]);
    expect(panel.visible).toBe(false);
    expect(showed(play(world).seen, says("MERCHANT_BYE"))).toBe(true);
  });

  it("the later principal waits in 4 for each report once its story part is over", () => {
    const { world } = enter(4, 120, 300, [
      [4, 104],
      [59, 131],
    ]);
    play(world);
    const principal = world.actors.get(ACADEMY.laterPrincipal.actor)!;
    expect(principal.visible).toBe(true);
    ask(world, principal.id);
    expect(showed(play(world).seen, says("LATER_NORTH"))).toBe(true);
    expect(done(world, 4, 1500)).toBe(true);
  });

  it("the branch tab (openingQuestRows tab 1): Harry & Potter's row follows the flags", () => {
    const { world } = intoShop();
    const rows = () =>
      openingBranchRows(OPENING.branchQuests, (room, event) => done(world, room, event), 0);
    const harry = () => rows().find((row) => row.title.includes("Harry và Potter"));
    expect(harry()).toBeUndefined();
    world.currency.money = 600;
    ask(world, actorOf(5));
    play(world);
    const quest = OPENING.branchQuests.find((row) => row.title.includes("Harry và Potter"))!;
    expect(harry()).toEqual({
      title: quest.title,
      detail: quest.variants[2].text,
      completed: false,
    });
    choose(world, 0);
    play(world);
    expect(harry()?.detail).toBe(quest.variants[1].text);
    world.eventState.op14CompleteEvent(98, 43, shop43.flags.harryWon);
    expect(harry()?.detail).toBe(quest.variants[0].text);
    // The trang viên row counts the Cầu Vồng species.
    const manor = openingBranchRows(
      OPENING.branchQuests,
      (room, event) => room === 6 && event === 100,
      7,
    );
    expect(manor).toHaveLength(1);
    expect(manor[0].detail).toContain(": 7/40");
  });

  it("CauVongShopRuntime: equipment is one identity, a held piece is never sold, badges pay", () => {
    const purse = {
      items: {} as Record<string, number>,
      materials: {} as Record<string, number>,
      equipment: [] as number[],
      held: () => [5048],
      tiers: {} as Record<string, number>,
      ownsCharm(id: number) {
        return this.tiers[String(id)] !== undefined;
      },
      grantCharm(id: number) {
        this.tiers[String(id)] ??= 1;
      },
      currency: { money: 0, badges: 3 },
    };
    const badgeCharm = SHOPS.stock[2].find((offer) => offer.runtimeId === 5039)!;
    expect(shopLogic.shopBuy(SHOPS, purse, badgeCharm, 1, false)).toBe("NO_MONEY");
    purse.currency.badges = 10;
    expect(shopLogic.shopBuy(SHOPS, purse, badgeCharm, 1, false)).toBe("OK");
    expect([purse.equipment, purse.tiers["5039"], purse.currency.badges]).toEqual([[5039], 1, 4]);
    expect(shopLogic.shopBuy(SHOPS, purse, badgeCharm, 1, false)).toBe("ALREADY_OWNED");
    // A pet holds 5048: it counts as owned and cannot be sold.
    const star = SHOPS.stock[2].find((offer) => offer.runtimeId === 5048)!;
    expect(shopLogic.shopBuy(SHOPS, purse, star, 1, false)).toBe("ALREADY_OWNED");
    const starSale = SHOPS.sale.find((offer) => offer.runtimeId === 5048);
    if (starSale) expect(shopLogic.shopSell(SHOPS, purse, starSale, 1)).toBe("NO_ITEM");
    // A forged price never trades.
    const drink = SHOPS.stock[0][0];
    expect(shopLogic.shopBuy(SHOPS, purse, { ...drink, price: 1 }, 1, false)).toBe("INVALID");
    // 99 is the cap of a bag row.
    purse.currency.money = 1_000_000;
    purse.items[String(drink.runtimeId)] = 98;
    expect(shopLogic.shopBuy(SHOPS, purse, drink, 2, false)).toBe("FULL");
    expect(shopLogic.shopBuy(SHOPS, purse, drink, 1, false)).toBe("OK");
  });
  it.each([
    ["shop", 43, "SHOP_INTRO"],
    ["harry", 43, "SHOP_HARRY_OFFER"],
    ["arenaMerchant", 4, "MERCHANT_GREETING"],
    ["laterPrincipal", 4, "LATER_NORTH"],
  ])("?cauVongOpening=%s opens room %i on %s", (stage, room, part) => {
    const screen = new NewGameScreen(
      false,
      assets,
      boot,
      new SaveRepository(new MemorySaveStore()),
      () => {},
    );
    expect(applyUrlParityCheckpoint(screen, new URLSearchParams("cauVongOpening=" + stage))).toBe(
      true,
    );
    const world = screen.host.world!;
    expect(world.roomIndex).toBe(room);
    const text = world.eventScene?.currentText ?? "";
    expect(says(part).some((line) => flatten(line).startsWith(flatten(text).slice(0, 12)))).toBe(
      true,
    );
  });

  it("?cauVongOpening=badges opens the badge exchange on its offers", () => {
    const screen = new NewGameScreen(
      false,
      assets,
      boot,
      new SaveRepository(new MemorySaveStore()),
      () => {},
    );
    expect(applyUrlParityCheckpoint(screen, new URLSearchParams("cauVongOpening=badges"))).toBe(
      true,
    );
    const panel = screen.host.panel;
    expect([panel.mode, panel.cauVongShop.category, panel.cauVongShop.menu]).toEqual([
      "cauVongShop",
      2,
      1,
    ]);
    expect(panel.cauVongShop.offers.map((offer) => offer.name)).toEqual(
      // Less Đại sư cầu, which no shop sells (owner 2026-11-18).
      SHOPS.stock[2].map((offer) => offer.name).filter((name) => name !== "Đại sư cầu"),
    );
  });
});
