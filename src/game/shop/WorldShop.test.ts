import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/** Pack images are 1x1 stand-ins under Node; this rig never reads pixels. */
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
const { gameplaySources } = await import("../session/GameplayHost");
const { WorldRuntime } = await import("../world/WorldRuntime");
const { WorldPanel } = await import("../world/WorldPanel");
const { scene1Save } = await import("../../dev/parityCheckpoints");
const { SCENE1_RESUME } = await import("../../persistence/save/migrations");
const shop = await import("./WorldShop");

const pack = await Pack.load();
const [boot, assets] = await Promise.all([loadBootAssets(pack), GameAssets.fromPack(pack)]);
const sources = gameplaySources(assets, boot).world;
const catalog = sources.bagItems!;

/** The Bích Thủy shop with the hero in front of ABell (actor 1). */
function shopWorld() {
  const merchant = sources.room(11, 8)!.actors.find((actor) => actor.id === 1)!,
    world = new WorldRuntime(
      assets.worldContract,
      sources,
      scene1Save({
        location: { sceneId: 11, roomIndex: 8, x: merchant.x, y: merchant.y + 24, direction: 2 },
        owner: SCENE1_RESUME.bunnyReturnRoom0,
        bunnyCaught: true,
        eventStates: { "1:1:0": 3 },
        pets: [{ speciesId: 68, level: 20, quality: 2 }],
      }),
    );
  for (let i = 0; i < 64 && world.mapLoading; i++) world.tickMapLoading();
  for (let dy = 12; dy <= 40 && world.talkPrompt?.actorId !== 1; dy++)
    world.player.y = merchant.y + dy;
  return world;
}

describe("WorldItemShopService / WorldPetRecoveryService", () => {
  it("lists held items at half their source price, bag stack first then the material copy", () => {
    const stock = { items: { "0": 2, "2": 0 }, materials: { "1002": 3, "12": 9 } },
      rows = shop.sellRows(catalog, stock);
    expect(rows.map((row) => [row.itemId, row.count])).toEqual([
      [0, 2],
      [2, 3],
    ]);
    const potion = rows[1];
    expect(potion.unitPrice).toBe(Math.trunc((catalog.consumable(2)!.columns[3] ?? 0) / 2));
    const currency = { money: 0 };
    expect(shop.sellItem(potion, 2, stock, currency)).toBe(true);
    expect([stock.materials["1002"], currency.money]).toEqual([1, potion.unitPrice * 2]);
    expect(shop.sellQuote(potion, 9)).toEqual({ quantity: 3, total: potion.unitPrice * 3 });
  });

  it("charges the largest HP gap in the party and refills HP and PP", () => {
    const pets = [
        { speciesId: 1, level: 5, quality: 1, currentHp: 70, skillIds: [10, -1], skillPp: [0, 0] },
        { speciesId: 2, level: 5, quality: 1, currentHp: 40 },
      ],
      max = () => 100;
    expect(shop.recoveryCost(pets, max)).toBe(60);
    expect(shop.recoverParty(pets, { money: 59 }, max, () => 25)).toBe("insufficient");
    const wallet = { money: 100 };
    expect(shop.recoverParty(pets, wallet, max, () => 25)).toBe("recovered");
    expect([wallet.money, pets[0].currentHp, pets[1].currentHp, pets[0].skillPp]).toEqual([
      40,
      100,
      100,
      [25, 0],
    ]);
    expect(shop.recoveryCost(pets, max)).toBe(-1);
  });
});

describe("town service NPCs (VqsvSourceNpcDispatchFlow)", () => {
  it("bakes every Liệt Hỏa merchant, clerk and envoy", () => {
    const all = assets.npcServices!.services,
      services = all.filter((service) => service.continuation !== "NONE");
    // 25 merchants, clerks and envoys, and the five wharf captains (Q0–Q4).
    expect(services).toHaveLength(30);
    // The ordinary NPCs of the same tables and of Hắc Thạch, the Phoenix chapters and Bích Lam
    // Cốc (its ambient tables and Leita, who escorts the hero into the temple): a line only.
    expect(all.filter((service) => service.continuation === "NONE")).toHaveLength(98);
    expect(
      services.filter((service) => service.continuation === "WHARF").map((s) => s.wharf),
    ).toEqual([2, 3, 1, 4, 0]);
    expect(
      services
        .filter((service) => service.scene === 11 && service.room === 8)
        .map((s) => s.speaker),
    ).toEqual(["ABell", "Lily", "Dbell"]);
  });

  it("shows ABell's line, then hands the item shop to the host", () => {
    const world = shopWorld();
    world.tick(["confirm"]);
    expect(world.npcDialog?.speaker).toBe("ABell");
    world.tick(["confirm"]);
    expect(world.npcDialog?.text).toBe("Hoan nghênh ghé qua");
    expect(world.takeServiceRequest()).toBeNull();
    world.tick(["confirm"]);
    expect(world.npcDialog).toBeNull();
    expect(world.takeServiceRequest()?.continuation).toBe("WORLD_ITEM_SHOP");
  });
});

describe("Thương điếm panel (tickSourceWorldShop)", () => {
  it("sells through the quantity box and recovers with the post-recovery save", () => {
    const world = shopWorld(),
      panel = new WorldPanel();
    world.inventory["0"] = 4;
    world.currency.money = 900;
    panel.worldShopSource = {
      sellRows: () =>
        shop.sellRows(catalog, { items: world.inventory, materials: world.bag.materials }),
      sell: (row, quantity) =>
        shop.sellItem(
          row,
          quantity,
          { items: world.inventory, materials: world.bag.materials },
          world.currency,
        ),
      recoveryCost: () => shop.recoveryCost(world.pets, () => 100),
      recover: () =>
        shop.recoverParty(
          world.pets,
          world.currency,
          () => 100,
          () => 10,
        ),
      money: () => world.currency.money,
      badges: () => world.currency.badges,
    };
    panel.openWorldShop("item");
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect(panel.mode).toBe("worldShopSell");
    panel.tick(["confirm"]);
    panel.tick(["right"]);
    expect([panel.mode, panel.worldShopSellQuantity]).toEqual(["worldShopSellConfirm", 2]);
    panel.tick(["left"]);
    panel.tick(["left"]);
    expect(panel.worldShopSellQuantity).toBe(4);
    const unit = panel.worldShopSellRow!.unitPrice;
    panel.tick(["confirm"]);
    expect([world.inventory["0"], world.currency.money, panel.mode]).toEqual([
      0,
      900 + unit * 4,
      "worldShopSell",
    ]);
    panel.tick(["back"]);
    expect([panel.mode, panel.selected]).toEqual(["worldShop", 1]);

    world.pets[0].currentHp = 30;
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect([panel.mode, panel.worldShopRecoveryCost]).toEqual(["worldShopRecover", 70]);
    panel.tick(["confirm"]);
    expect(panel.worldShopMessage?.text).toBe("Ba lô sủng vật trạng thái toàn bộ khôi phục");
    panel.tick(["confirm"]);
    panel.tick([]);
    expect([panel.mode, panel.takeSaveRequest()]).toEqual(["save", true]);
    // The save answered: 5 acknowledges it and the shop is back on "Khôi phục".
    panel.saveFinished(true);
    panel.tick(["confirm"]);
    expect([panel.mode, panel.selected]).toEqual(["worldShop", 2]);
    // A full party gets the warning, the shop stays open.
    panel.openWorldShop("item");
    panel.tick(["down"]);
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect(panel.worldShopMessage?.text).toBe("Toàn bộ trạng thái đã đầy, không cần khôi phục");
  });

  it("buys through the shopbuy list and Back returns to the merchant", () => {
    const panel = new WorldPanel();
    panel.openWorldShop("material");
    panel.tick(["confirm"]);
    expect([panel.mode, panel.portableShopMaterial]).toEqual(["portableShopBuy", true]);
    panel.tick(["back"]);
    expect([panel.mode, panel.selected]).toEqual(["worldShop", 0]);
    panel.tick(["up"]);
    panel.tick(["down"]);
    panel.tick(["down"]);
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect(panel.visible).toBe(false);
  });
});

describe("Tiện lợi điếm and Ngân hàng Sủng vật", () => {
  it("keeps the evolve rows shut before the tutorial and counts the Dẫn thưởng milestones", () => {
    const world = shopWorld(),
      panel = new WorldPanel();
    panel.serviceSource = {
      evolutionArmed: () => world.evolutionNoticeArmed,
      claimReward: () => world.claimConvenienceReward(),
    };
    panel.openConvenience(true);
    expect(panel.convenienceLabels).toHaveLength(7);
    panel.tick(["confirm"]);
    expect(panel.serviceMessage?.text).toMatch(/^Hiện đã thu thập \d+ loài sủng vật\. Cần 10 loài/);
    panel.tick(["confirm"]);
    for (let id = 0; id < 10; id++) world.collection.markCollected(id);
    const badges = world.currency.badges;
    panel.tick(["confirm"]);
    expect([panel.serviceMessage?.text, world.currency.badges]).toEqual([
      "Đạt được 1 huy hiệu",
      badges + 1,
    ]);
    panel.tick(["confirm"]);
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect(panel.serviceMessage?.text).toBe("Công năng theo đạo học sau mở ra");
    panel.tick(["confirm"]);
    // The envoy's Dị hóa row is open without the tutorial (`envoyMutation`).
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect([panel.mode, panel.petActionLabel]).toEqual(["pet", "Dị hoá"]);
    panel.tick(["back"]);
    expect([panel.mode, panel.selected]).toEqual(["convenience", 2]);
    const snapshot = world.snapshot();
    expect(snapshot.convenienceRewardsClaimed?.slice(0, 2)).toEqual([true, false]);
  });

  it("deposits through the pet list, refusing the last living pet, and withdraws back", () => {
    const panel = new WorldPanel(),
      roster = [
        { speciesId: 68, level: 5, quality: 1, heldEquipmentId: 3 },
        { speciesId: 58, level: 5, quality: 1, currentHp: 0 },
      ],
      bank: typeof roster = [];
    panel.petSource = {
      ...panel.petSource,
      cards: () => roster.map((pet) => ({ name: String(pet.speciesId) }) as never),
      bankCards: () => bank.map((pet) => ({ name: String(pet.speciesId) }) as never),
      bankDeposit: (index) => {
        if (!roster.some((pet, at) => at !== index && (pet.currentHp ?? 1) > 0))
          return "last-living";
        bank.push(roster.splice(index, 1)[0]);
        return "deposited";
      },
      bankWithdraw: (index) => {
        roster.push(bank.splice(index, 1)[0]);
        return "withdrawn";
      },
    };
    panel.openPetBank();
    panel.tick(["confirm"]);
    expect([panel.mode, panel.petActionLabel]).toEqual(["pet", "Gởi lại"]);
    panel.tick(["confirm"]);
    expect(panel.petMessage?.text).toBe("Ba lô phải lưu ít nhất 1 sủng vật");
    panel.tick(["confirm"]);
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect([roster.length, bank.length]).toEqual([1, 1]);
    panel.tick(["back"]);
    expect(panel.mode).toBe("petBank");
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect(panel.petActionLabel).toBe("Lấy ra");
    panel.tick(["confirm"]);
    // The bank emptied: back on the bank menu.
    expect([roster.length, bank.length, panel.mode]).toEqual([2, 0, "petBank"]);
  });
});

describe("portable shop stock (ExportWebShopStock)", () => {
  it("lists JavaSE's shopbuy rows from item 1 with portableShopPrice", async () => {
    const { stockOffers } = await import("./PortableShop");
    const stock = assets.shopStock!,
      items = stockOffers(stock, false),
      materials = stockOffers(stock, true);
    expect([items.length, materials.length]).toEqual([24, 33]);
    expect([items[0].name, items[0].unitPrice, items[0].currency]).toEqual([
      "Phong ấn cầu",
      75,
      "money",
    ]);
    expect([materials[0].name, materials[0].currency]).toEqual(["Mạn Đà La Thạch", "badges"]);
  });
});

describe("V4 pet sprites (ExportWebV4PetSprites)", () => {
  it("merges the 72 cute V4 visuals with idle and action states", () => {
    const ids = Array.from({ length: 400 }, (_, i) => 2000 + i).filter(
      (id) => assets.sprites[String(id)],
    );
    expect(ids).toHaveLength(72);
    const states = assets.sprites["2000"].states;
    expect(Object.keys(states)).toEqual(["0", "1", "2"]);
    expect([states["0"].length, states["1"].length]).toEqual([4, 4]);
    expect(assets.frame(2000, 0, 0)?.file).toBe("@v4/sprites/2000/0/0.png");
  });
});
