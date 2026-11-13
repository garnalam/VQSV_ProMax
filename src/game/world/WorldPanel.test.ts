import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SourceUiLayout } from "../../rendering/SourceUiLayout";
import {
  GAME_MENU_SCROLLBAR,
  MENU_LABELS,
  bagSlotAt,
  bagTabAt,
  MENU_ROW_BAG,
  MENU_ROW_SAVE,
  MENU_ROW_TASK,
  MENU_ROW_WIDGETS,
  MENU_TITLE_TOKENS,
  SAVE_TEXT,
  TASK_ROW_BACKGROUNDS,
  TASK_SCROLLBAR,
  SYSTEM_LABELS,
  SYSTEM_ROW_WIDGETS,
  WorldPanel,
  panelBackHit,
  panelConfirmHit,
  worldPlateAt,
} from "./WorldPanel";

/**
 * The three `.ui` files the free-world softkey plates and their panels are drawn from. They are baked
 * by the Java layout loader into `public/pack/ui/layout`, so this guard reads the shipped bytes rather
 * than a hand-written expectation.
 */
function layout(name: string): SourceUiLayout {
  return new SourceUiLayout(
    JSON.parse(readFileSync(`public/pack/ui/layout/${name}.json`, "utf8")) as never,
  );
}
const world = layout("world"),
  gamemenu = layout("gamemenu"),
  gamesystem = layout("gamesystem"),
  shopUi = layout("shop"),
  shopbuyUi = layout("shopbuy"),
  petstateUi = layout("petstate");

/** The widget's id/geometry/alt-image as one comparable tuple. */
function box(source: SourceUiLayout, id: number) {
  const widget = source.widget(id);
  return widget ? [widget.x, widget.y, widget.w, widget.h, widget.altId ?? -1] : null;
}

describe("baked world panel layout", () => {
  it("carries the two plates the free-world HUD draws", () => {
    expect(box(world, 7)).toEqual([0, 303, 18, 17, 175]);
    expect(box(world, 5)).toEqual([222, 303, 16, 17, 68]);
  });

  it("carries the gamemenu frame, bands, rows and softkeys the renderer consumes", () => {
    expect(box(gamemenu, 1)).toEqual([78, 73, 90, 145, 0]);
    expect(box(gamemenu, 13)).toEqual([0, 3, 214, 28, 27]);
    expect(MENU_ROW_WIDGETS.map((id) => box(gamemenu, id))).toEqual([
      [93, 105, 59, 15, 6],
      [93, 122, 59, 15, 6],
      [93, 139, 59, 15, 6],
      [93, 156, 59, 15, 6],
      [93, 173, 59, 15, 6],
      [93, 190, 59, 15, 6],
    ]);
    expect(MENU_ROW_WIDGETS.map((id) => gamemenu.widget(id)?.imageId)).toEqual([7, 7, 7, 7, 7, 7]);
    expect(box(gamemenu, 12)).toEqual([1, 296, 43, 24, 28]);
    expect(box(gamemenu, 11)).toEqual([197, 296, 43, 24, 28]);
    expect(box(gamemenu, 16)).toEqual([88, 205, 13, 13, 83]);
    expect(box(gamemenu, 17)).toEqual([118, 205, 13, 13, 84]);
    expect([gamemenu.text(10, ""), gamemenu.h(2, 0), gamemenu.h(3, 0), gamemenu.h(4, 0)]).toEqual([
      "Menu trò chơi",
      7,
      102,
      8,
    ]);
  });

  it("carries the gamesystem rows, title and softkeys the renderer consumes", () => {
    expect(box(gamesystem, 1)).toEqual([78, 73, 90, 145, 0]);
    expect(SYSTEM_ROW_WIDGETS.map((id) => box(gamesystem, id))).toEqual([
      [94, 115, 59, 15, 6],
      [94, 136, 59, 15, 6],
      [94, 157, 59, 15, 6],
      [94, 178, 59, 15, 6],
    ]);
    expect(box(gamesystem, 10)).toEqual([1, 296, 43, 24, 28]);
    expect(box(gamesystem, 11)).toEqual([197, 296, 43, 24, 28]);
    expect(gamesystem.text(2, "")).toBe("Hệ thống menu");
    expect([gamesystem.widget(10)?.lColor, gamesystem.widget(11)?.lColor]).toEqual([-1, -1]);
  });

  it("keeps the scrollbar rect the renderer and the thumb math share", () => {
    expect(GAME_MENU_SCROLLBAR).toEqual({ x: 157, y: 105, w: 4, h: 100, minThumbHeight: 18 });
  });
});

describe("worldPlateAt", () => {
  it("maps the two plate rects and the right-hand corner band", () => {
    expect(worldPlateAt(world, 9, 310)).toBe("system");
    expect(worldPlateAt(world, 230, 310)).toBe("menu");
    expect(worldPlateAt(world, 200, 300)).toBe("menu");
    expect(worldPlateAt(world, 120, 150)).toBeUndefined();
    expect(worldPlateAt(world, 19, 310)).toBeUndefined();
  });
});

describe("WorldPanel navigation", () => {
  it("opens the right plate as the nine-row game menu and the left plate as the system menu", () => {
    const panel = new WorldPanel();
    panel.open();
    expect([panel.visible, panel.mode, panel.rowWidgets, panel.labels.length]).toEqual([
      true,
      "gamemenu",
      MENU_ROW_WIDGETS,
      MENU_LABELS.length,
    ]);
    panel.close();
    panel.openSystem();
    expect([panel.mode, panel.rowWidgets, panel.labels.length]).toEqual([
      "gamesystem",
      SYSTEM_ROW_WIDGETS,
      SYSTEM_LABELS.length,
    ]);
  });

  it("clamps the cursor to the first and last row of each menu", () => {
    const panel = new WorldPanel();
    panel.open();
    panel.tick(["up"]);
    expect(panel.selected).toBe(0);
    for (let i = 0; i < MENU_LABELS.length + 3; i++) panel.tick(["down"]);
    expect(panel.selected).toBe(MENU_LABELS.length - 1);
    panel.openSystem();
    for (let i = 0; i < SYSTEM_LABELS.length + 3; i++) panel.tick(["up"]);
    expect(panel.selected).toBe(0);
  });

  it("scrolls the six-row game menu viewport to keep the cursor visible", () => {
    const panel = new WorldPanel();
    panel.open();
    for (let i = 0; i < 8; i++) panel.tick(["down"]);
    expect([panel.selected, panel.listScroll, panel.firstVisibleRow]).toEqual([8, 3, 3]);
    expect(panel.indexAtSlot(0)).toBe(3);
    expect(panel.menuTitle).toBe(MENU_TITLE_TOKENS[8]);
    for (let i = 0; i < 8; i++) panel.tick(["up"]);
    expect([panel.selected, panel.listScroll]).toEqual([0, 0]);
  });

  it("keeps an untouched cursor when the game menu re-opens", () => {
    const panel = new WorldPanel();
    panel.open();
    panel.tick(["down"]);
    panel.tick(["down"]);
    panel.close();
    panel.open();
    expect([panel.selected, panel.listScroll]).toEqual([2, 0]);
  });

  it("closes on back", () => {
    const panel = new WorldPanel();
    panel.open();
    panel.tick(["back"]);
    expect(panel.visible).toBe(false);
    panel.openSystem();
    panel.tick(["left"]);
    expect(panel.visible).toBe(true);
    expect(panel.selected).toBe(0);
  });
});

describe("WorldPanel confirm", () => {
  it("closes only the system menu's continue row, matching Java's sub-panel dispatch", () => {
    const panel = new WorldPanel();
    panel.open();
    panel.tick(["confirm"]);
    expect([panel.visible, panel.selected]).toEqual([true, 0]);
    panel.openSystem();
    panel.tick(["confirm"]);
    expect(panel.visible).toBe(false);
  });

  it("dispatches the help row into its JavaSE sub-panel", () => {
    const panel = new WorldPanel();
    panel.openSystem();
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect([panel.visible, panel.mode, panel.helpPage]).toEqual([true, "help", 0]);
  });
});

describe("WorldPanel save dialog (game.h.K over msgtip.ui)", () => {
  const msgtip = layout("msgtip");
  const toSave = () => {
    const panel = new WorldPanel();
    panel.open();
    for (let i = 0; i < MENU_ROW_SAVE; i++) panel.tick(["down"]);
    panel.tick(["confirm"]);
    return panel;
  };

  it("carries the msgtip plate, message line and the two softkey icons", () => {
    expect(box(msgtip, 1)).toEqual([51, 134, 150, 26, 124]);
    expect(box(msgtip, 2)).toEqual([56, 137, 138, 18, -1]);
    expect(msgtip.widget(2)?.b).toBe(4);
    expect(box(msgtip, 3)).toEqual([218, 298, 23, 23, 133]);
    expect(box(msgtip, 4)).toEqual([1, 298, 23, 23, 75]);
  });

  it("row 5 asks, confirm shows saving and requests exactly one write", () => {
    const panel = toSave();
    expect([panel.mode, panel.savePhase, panel.saveMessage]).toEqual(["save", 0, SAVE_TEXT.ask]);
    expect(panel.takeSaveRequest()).toBe(false);
    panel.tick(["confirm"]);
    expect([panel.savePhase, panel.saveMessage]).toEqual([1, SAVE_TEXT.saving]);
    // Java writes on the next tick, in phase 1.
    expect(panel.takeSaveRequest()).toBe(false);
    panel.tick(["back"]);
    expect(panel.takeSaveRequest()).toBe(true);
    expect(panel.takeSaveRequest()).toBe(false);
    panel.tick([]);
    expect(panel.takeSaveRequest()).toBe(false);
    expect([panel.visible, panel.savePhase]).toEqual([true, 1]);
  });

  it("shows the result until a press closes the whole panel", () => {
    for (const [ok, text] of [
      [true, SAVE_TEXT.success],
      [false, SAVE_TEXT.failure],
    ] as const) {
      const panel = toSave();
      panel.tick(["confirm"]);
      panel.tick([]);
      panel.takeSaveRequest();
      panel.saveFinished(ok);
      expect([panel.savePhase, panel.saveMessage]).toEqual([2, text]);
      panel.tick([]);
      expect(panel.visible).toBe(true);
      panel.tick(["confirm"]);
      expect([panel.visible, panel.savePhase, panel.saveMessage]).toEqual([false, 0, ""]);
    }
  });

  it("back from the question returns to the game menu on the save row", () => {
    const panel = toSave();
    panel.tick(["back"]);
    expect([panel.visible, panel.mode, panel.selected, panel.listScroll]).toEqual([
      true,
      "gamemenu",
      MENU_ROW_SAVE,
      0,
    ]);
  });

  it("only the softkey bands reach it; rows, hover and the wheel are inert", () => {
    const panel = toSave();
    panel.wheel(3);
    panel.hover(gamemenu, 120, 106);
    expect(panel.click(gamemenu, 120, 150)).toBe(true);
    panel.tick([]);
    expect([panel.mode, panel.savePhase, panel.selected]).toEqual(["save", 0, MENU_ROW_SAVE]);
    panel.click(gamemenu, 40, 300);
    panel.tick([]);
    expect(panel.savePhase).toBe(1);
  });
});

describe("WorldPanel task list (game.h.S over task.ui)", () => {
  const task = layout("task");
  const row = (n: number) => ({
    number: n + 1,
    title: `Nhiệm vụ ${n}`,
    detail: `Đến #2[Nơi ${n}]#0`,
    completed: false,
  });
  /** A panel whose main tab lists `main` rows (cursor on the last) and branch tab `branch` rows. */
  const maps = { count: 0 };
  const withTasks = (main: number, branch: number) => {
    const panel = new WorldPanel();
    panel.taskSource = {
      rows: (tab) => Array.from({ length: tab === 0 ? main : branch }, (_, i) => row(i)),
      mainCursor: () => main - 1,
      openMap: () => {
        maps.count++;
        return false;
      },
    };
    return panel;
  };
  const fromMenu = (panel: WorldPanel) => {
    panel.open();
    for (let i = 0; i < MENU_ROW_TASK; i++) panel.tick(["down"]);
    panel.tick(["confirm"]);
    return panel;
  };

  it("carries the rows, tabs, objective box and bar the renderer and hit tests use", () => {
    expect(TASK_ROW_BACKGROUNDS.map((id) => box(task, id))).toEqual([
      [50, 103, 126, 15, 25],
      [50, 118, 126, 15, 25],
      [50, 134, 126, 15, 25],
      [50, 150, 126, 15, 25],
      [50, 166, 126, 15, 25],
    ]);
    expect([box(task, 6), box(task, 7)]).toEqual([
      [49, 75, 64, 16, 107],
      [120, 75, 64, 16, 107],
    ]);
    expect([task.text(8, ""), task.text(9, ""), task.text(2, "")]).toEqual([
      "Nhiệm vụ chính",
      "Nhiệm vụ phụ",
      "Nhiệm vụ",
    ]);
    expect(box(task, 36)).toEqual([52, 192, 128, 30, -1]);
    const track = task.widget(39)!;
    expect([track.x, track.y, track.w]).toEqual([
      TASK_SCROLLBAR.x,
      TASK_SCROLLBAR.y,
      TASK_SCROLLBAR.w,
    ]);
  });

  it("menu row 4 opens the main tab on the current task; Back returns to row 4", () => {
    const panel = fromMenu(withTasks(7, 0));
    expect([panel.mode, panel.taskTab, panel.selected, panel.listScroll]).toEqual([
      "task",
      0,
      6,
      2,
    ]);
    panel.tick(["up"]);
    expect(panel.selected).toBe(5);
    panel.tick(["back"]);
    expect([panel.visible, panel.mode, panel.selected]).toEqual([true, "gamemenu", MENU_ROW_TASK]);
  });

  it("left/right switch tabs: the branch tab starts at the top, the main tab on the cursor", () => {
    const panel = fromMenu(withTasks(3, 2));
    panel.tick(["right"]);
    expect([panel.taskTab, panel.selected, panel.taskRows.length]).toEqual([1, 0, 2]);
    panel.tick(["down"]);
    panel.tick(["down"]);
    expect(panel.selected).toBe(1);
    panel.tick(["left"]);
    expect([panel.taskTab, panel.selected]).toEqual([0, 2]);
  });

  it("confirm asks the host for the map (JavaSE openTaskMap); back leaves to the menu row", () => {
    const panel = fromMenu(withTasks(7, 0));
    const before = maps.count;
    panel.tick(["up"]);
    panel.tick(["confirm"]);
    expect(maps.count).toBe(before + 1);
    expect([panel.mode, panel.selected]).toEqual(["task", 5]);
    panel.tick(["back"]);
    expect([panel.visible, panel.mode, panel.selected]).toEqual([true, "gamemenu", MENU_ROW_TASK]);
  });

  it("from the world shortcut, back closes straight to the map", () => {
    const panel = withTasks(2, 0);
    panel.openTasks(true);
    expect([panel.mode, panel.selected]).toEqual(["task", 1]);
    panel.tick(["back"]);
    expect(panel.visible).toBe(false);
  });

  it("mouse: tabs latch left/right, a row selects and confirms (its map), hover moves the cursor", () => {
    const panel = fromMenu(withTasks(7, 3));
    panel.click(task, 130, 80);
    panel.tick([]);
    expect(panel.taskTab).toBe(1);
    panel.click(task, 60, 80);
    panel.tick([]);
    expect([panel.taskTab, panel.selected]).toEqual([0, 6]);
    // Slot 1 of the window starting at row 2.
    panel.hover(task, 100, 121);
    expect(panel.selected).toBe(3);
    const before = maps.count;
    panel.click(task, 100, 137);
    panel.tick([]);
    expect([panel.mode, panel.selected, maps.count]).toEqual(["task", 4, before + 1]);
    panel.click(task, 220, 300);
    panel.tick([]);
    expect(panel.mode).toBe("gamemenu");
  });

  it("the wheel scrolls a long list and moves the cursor in a short one", () => {
    const long = fromMenu(withTasks(9, 0));
    long.wheel(-10);
    expect([long.listScroll, long.selected]).toEqual([0, 4]);
    const short = fromMenu(withTasks(3, 0));
    short.wheel(-1);
    expect([short.listScroll, short.selected]).toEqual([0, 1]);
  });

  it("the bar pages and drags a long list only", () => {
    const panel = fromMenu(withTasks(9, 0));
    expect(panel.listScroll).toBe(4);
    expect(panel.pressScrollbar(180, 106)).toBe(true);
    expect(panel.listScroll).toBeLessThan(4);
    expect(fromMenu(withTasks(3, 0)).pressScrollbar(180, 106)).toBe(false);
  });
});

describe("WorldPanel bag (JavaSE tickBag / VqsvBagUiLayout)", () => {
  const item = (id: number) => ({ id, icon: 25, name: `Đồ ${id}`, status: "1", description: "" });
  const withBag = (counts: number[]) => {
    const panel = new WorldPanel();
    panel.bagSource = {
      rows: (tab) => Array.from({ length: counts[tab] }, (_, i) => item(tab * 100 + i)),
      use: (tab, row) => (tab === 0 && row.id === 0 ? "Không thể sử dụng" : null),
      eggActive: () => false,
      accelerateEgg: () => null,
      eggPreview: () => null,
    };
    panel.open();
    for (let i = 0; i < MENU_ROW_BAG; i++) panel.tick(["down"]);
    panel.tick(["confirm"]);
    return panel;
  };

  it("hit tests the redesigned surface: four tabs, five 20 px rows on a 22 px stride", () => {
    expect([bagTabAt(16, 80), bagTabAt(68, 80), bagTabAt(225, 80), bagTabAt(16, 96)]).toEqual([
      0, 1, -1, -1,
    ]);
    expect([
      bagSlotAt(20, 115),
      bagSlotAt(20, 136),
      bagSlotAt(20, 137),
      bagSlotAt(20, 203),
    ]).toEqual([0, -1, 1, 4]);
  });

  it("menu row 2 opens Tiêu hao on its first row; left/right wrap around the four tabs", () => {
    const panel = withBag([3, 1, 0, 2]);
    expect([panel.mode, panel.bagTab, panel.selected]).toEqual(["bag", 0, 0]);
    panel.tick(["left"]);
    expect(panel.bagTab).toBe(3);
    panel.tick(["right"]);
    expect(panel.bagTab).toBe(0);
    for (let i = 0; i < 3; i++) panel.tick(["down"]);
    expect(panel.selected).toBe(2);
    panel.tick(["right"]);
    expect([panel.bagTab, panel.selected, panel.bagAction]).toEqual([1, 0, "Sử dụng"]);
    panel.tick(["right"]);
    expect([panel.bagTab, panel.bagAction]).toEqual([2, null]);
    panel.tick(["back"]);
    expect([panel.mode, panel.selected]).toEqual(["gamemenu", MENU_ROW_BAG]);
  });

  it("a used item's line holds every key until 5 closes it", () => {
    const panel = withBag([3, 0, 0, 0]);
    panel.tick(["confirm"]);
    expect(panel.bagMessage).toEqual({
      text: "Không thể sử dụng",
      prompt: "Nhấn nút 5 để tiếp tục",
    });
    panel.tick(["back"]);
    panel.tick(["down"]);
    expect([panel.mode, panel.selected, !!panel.bagMessage]).toEqual(["bag", 0, true]);
    panel.tick(["confirm"]);
    expect(panel.bagMessage).toBeNull();
    // Rows whose screen is not ported answer nothing.
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect(panel.bagMessage).toBeNull();
  });

  it("mouse: a tab switches to it, a row moves the cursor, the two buttons act as 5 / Back", () => {
    const panel = withBag([3, 0, 2, 0]);
    const surface = layout("gamemenu");
    panel.click(surface, 130, 80);
    expect(panel.bagTab).toBe(2);
    panel.hover(surface, 40, 140);
    expect(panel.selected).toBe(1);
    panel.click(surface, 160, 270);
    panel.tick([]);
    expect(panel.mode).toBe("gamemenu");
  });
});

describe("WorldPanel pointer latches", () => {
  it("maps campaign service cards to their keyboard-equivalent action", () => {
    const panel = new WorldPanel();
    panel.openWorldShop();
    // "Bán đi" (widget 7 of shop.ui).
    expect(panel.click(shopUi, 110, 140)).toBe(true);
    panel.tick([]);
    expect(panel.mode).toBe("worldShopSell");

    // "Lấy ra" (widget 7 of shop.ui) opens the bank's pet list.
    panel.openPetBank();
    panel.click(shopUi, 110, 140);
    panel.tick([]);
    expect([panel.mode, panel.petPurpose, panel.petActionLabel]).toEqual([
      "pet",
      "bankWithdraw",
      "Lấy ra",
    ]);
  });

  it("opens the convenience material catalog and returns to the envoy", () => {
    const panel = new WorldPanel();
    panel.openConvenience();
    panel.tick(["down"]);
    panel.tick(["down"]);
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect([panel.mode, panel.portableShopMaterial]).toEqual(["portableShopBuy", true]);
    panel.tick(["back"]);
    expect(panel.mode).toBe("convenience");
  });

  it("consumes a row click on the next tick, like Java's key0 latch", () => {
    const panel = new WorldPanel();
    panel.openSystem();
    expect(panel.click(gamesystem, 120, 158)).toBe(true);
    expect([panel.visible, panel.selected]).toEqual([true, 2]);
    panel.tick([]);
    expect(panel.visible).toBe(true);
    expect([panel.mode, panel.settingsLevel]).toEqual(["settings", 0]);
  });

  it("maps the first game-menu slot through the scrolled viewport", () => {
    const panel = new WorldPanel();
    panel.open();
    for (let i = 0; i < 8; i++) panel.tick(["down"]);
    expect(panel.click(gamemenu, 120, 106)).toBe(true);
    expect([panel.selected, panel.listScroll]).toEqual([3, 3]);
    // The click latched confirm on row 3, "Đồ giám", which opens `record.ui`.
    panel.tick([]);
    expect(panel.mode).toBe("record");
  });

  it("latches the two softkey bands and ignores a row outside every rect", () => {
    const panel = new WorldPanel();
    panel.open();
    expect(panel.click(gamemenu, 40, 300)).toBe(true);
    expect(panelConfirmHit(90, 280)).toBe(true);
    expect(panelConfirmHit(91, 280)).toBe(false);
    expect(panelBackHit(145, 280)).toBe(true);
    expect(panelBackHit(144, 320)).toBe(false);
    panel.tick([]);
    expect(panel.visible).toBe(true);
    expect(panel.mode).toBe("portableShop");
    panel.click(gamemenu, 220, 300);
    panel.tick([]);
    expect(panel.mode).toBe("gamemenu");
    panel.click(gamemenu, 220, 300);
    panel.tick([]);
    expect(panel.visible).toBe(false);
    expect(new WorldPanel().click(gamemenu, 120, 106)).toBe(false);
  });
});

describe("world panel mouse (Java PC QoL)", () => {
  const rowCenter = (source: SourceUiLayout, id: number) => {
    const widget = source.widget(id)!;
    return { x: widget.x + 10, y: widget.y + 5 };
  };

  it("moves the cursor onto the hovered row, through the scrolled window", () => {
    const panel = new WorldPanel();
    panel.open();
    const third = rowCenter(gamemenu, MENU_ROW_WIDGETS[2]);
    panel.hover(gamemenu, third.x, third.y);
    expect(panel.selected).toBe(2);
    panel.wheel(3);
    panel.hover(gamemenu, third.x, third.y);
    expect(panel.selected).toBe(5);
    panel.hover(gamemenu, 5, 5);
    expect(panel.selected).toBe(5);
  });

  it("scrolls the nine-row game menu with the wheel and keeps the cursor in the window", () => {
    const panel = new WorldPanel();
    panel.open();
    panel.wheel(2);
    expect(panel.listScroll).toBe(2);
    expect(panel.selected).toBe(2);
    panel.wheel(5);
    expect(panel.listScroll).toBe(MENU_LABELS.length - 6);
    panel.wheel(-5);
    expect(panel.listScroll).toBe(0);
    expect(panel.selected).toBe(3);
  });

  it("moves the system menu's cursor with the wheel (it does not scroll)", () => {
    const panel = new WorldPanel();
    panel.openSystem();
    panel.wheel(2);
    expect(panel.selected).toBe(2);
    panel.wheel(5);
    expect(panel.selected).toBe(SYSTEM_LABELS.length - 1);
  });

  it("hovers and clicks the full portable-shop cards and buy rows", () => {
    const panel = new WorldPanel();
    panel.portableShopSource.offers = () => [
      {
        id: 1,
        inventoryId: 1,
        kind: "item",
        name: "A",
        description: "A",
        icon: 0,
        unitPrice: 1,
        currency: "money",
      },
      {
        id: 2,
        inventoryId: 2,
        kind: "item",
        name: "B",
        description: "B",
        icon: 1,
        unitPrice: 1,
        currency: "money",
      },
    ];
    panel.portableShopSource.quote = (_offer, quantity) => ({
      outcome: "ready",
      quantity,
      maxQuantity: 9,
      total: quantity,
      currentCount: 0,
    });
    panel.openPortableShop();
    panel.hover(gamemenu, 40, 79 + 2 * 29 + 10);
    expect(panel.selected).toBe(2);
    panel.click(gamemenu, 40, 79 + 10);
    panel.tick([]);
    expect(panel.mode).toBe("portableShopBuy");
    panel.hover(shopbuyUi, 40, 99 + 21 + 5);
    expect(panel.selected).toBe(1);
    panel.click(shopbuyUi, 40, 99 + 21 + 5);
    panel.tick([]);
    expect(panel.mode).toBe("portableShopConfirm");
  });

  it("opens fashion from the portable shop and owns every JavaSE fashion hit area", () => {
    const panel = new WorldPanel();
    let bags = 3,
      fragments = 100,
      purchases = 0;
    panel.wardrobeSource.catalog = () => ({
      profileVersion: "unified-fashion-economy-v1",
      poolVersion: "FASH-POOL-SOURCE-V1",
      bagPrice: 500,
      bagCapacity: 99,
      fragmentCapacity: 999999,
      tiers: [
        {
          code: "COMMON",
          label: "Phổ thông",
          probabilityBps: 10000,
          duplicateFragments: 10,
          exchangeFragments: 20,
        },
      ],
      entries: [{ key: "FASH-LH-SPR030-A00", tier: "COMMON" }],
    });
    panel.wardrobeSource.bags = () => bags;
    panel.wardrobeSource.fragments = () => fragments;
    panel.wardrobeSource.buy = (quantity) => {
      bags += quantity;
      purchases += quantity;
      return "purchased";
    };
    panel.openPortableShop();
    panel.click(gamemenu, 40, 79 + 2 * 29 + 10);
    panel.tick([]);
    expect(panel.mode).toBe("fashionShop");

    panel.hover(gamemenu, 150, 130);
    expect(panel.selected).toBe(1);
    panel.click(gamemenu, 150, 80);
    panel.tick([]);
    expect(panel.mode).toBe("fashionBuyConfirm");
    panel.click(gamemenu, 165, 165);
    panel.tick([]);
    expect(panel.fashionPurchaseQuantity).toBe(2);
    panel.click(gamemenu, 100, 210);
    panel.tick([]);
    expect([panel.mode, purchases, bags]).toEqual(["fashionShop", 2, 5]);

    panel.tick(["confirm"]); // dismiss purchase message
    panel.hover(gamemenu, 150, 190);
    expect(panel.selected).toBe(2);
    panel.click(gamemenu, 150, 190);
    panel.tick([]);
    expect(panel.mode).toBe("fashionExchange");
    panel.hover(gamemenu, 60, 80);
    expect(panel.selected).toBe(0);
    panel.wheel(1);
    expect(panel.selected).toBe(0);
    fragments = 0;
  });

  it("moves the pet dashboard cursor on hover and wheel", () => {
    const panel = new WorldPanel();
    panel.petSource.cards = () => [{ name: "A" }, { name: "B" }] as never;
    panel.open();
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect(panel.mode).toBe("pet");
    panel.hover(petstateUi, 102, 233);
    expect(panel.selected).toBe(1);
    panel.wheel(-1);
    expect(panel.selected).toBe(0);
  });

  it("drags the scrollbar thumb and pages on the track", () => {
    const panel = new WorldPanel(),
      { x, y, h } = GAME_MENU_SCROLLBAR;
    panel.open();
    expect(panel.pressScrollbar(x + 1, y + 2)).toBe(true);
    expect(panel.scrollbarDragging).toBe(true);
    panel.dragScrollbar(y + h);
    expect(panel.listScroll).toBe(MENU_LABELS.length - 6);
    expect(panel.selected).toBe(MENU_LABELS.length - 6);
    panel.releaseScrollbar();
    expect(panel.scrollbarDragging).toBe(false);
    // A press on the track above the thumb pages back up.
    expect(panel.pressScrollbar(x + 1, y + 1)).toBe(true);
    expect(panel.listScroll).toBe(0);
    expect(panel.scrollbarDragging).toBe(false);
    expect(panel.pressScrollbar(x - 20, y + 1)).toBe(false);
  });
});

describe("WorldPanel meta-system rows", () => {
  it("opens the regional challenge, cycles to Giftcode and accepts source keyboard text", () => {
    const panel = new WorldPanel();
    panel.challengeSource = {
      rematches: () => [
        {
          region: 0,
          name: "Bích Thủy",
          descriptor: "BICH_THUY",
          encounterKey: "encounter",
          rewardMoney: 425,
          title: "Tái đấu Thủ lĩnh Bích Thủy",
        },
      ],
      initialRegion: () => 0,
      cycleRegion: () => 0,
      status: () => ({
        available: true,
        usedCount: 0,
        remainingUses: 3,
        remainingMillis: 1000,
        clockRollback: false,
      }),
      start: () => true,
    };
    panel.giftCodeSource.redeem = (code) => ({ outcome: "redeemed", code, message: "Đã nhận" });
    panel.open();
    for (let i = 0; i < 7; i++) panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect(panel.mode).toBe("challenge");
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    panel.typeText("truong con_1-!");
    expect(panel.giftCodeInput).toBe("TRUONGCON_1-");
    panel.tick(["confirm"]);
    expect(panel.giftCodeMessage).toBe("Đã nhận");
  });

  it("opens the Fan Card and switches between Free, VIP and mission help", () => {
    const panel = new WorldPanel();
    panel.battlePassSource.catalog = () => ({
      seasonKey: "test",
      title: "Thẻ Fan Cứng",
      maxLevel: 50,
      vipPriceBadges: 20,
      xpPerLevel: 1000,
      seasonDays: 18,
      missions: [],
      levels: [],
    });
    panel.open();
    for (let i = 0; i < 8; i++) panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect(panel.mode).toBe("battlePass");
    panel.tick(["down"]);
    expect(panel.battlePassVipTrack).toBe(true);
    panel.click(gamemenu, 210, 80);
    expect(panel.mode).toBe("battlePassHelp");
    panel.tick(["back"]);
    expect(panel.mode).toBe("battlePass");
  });
});

describe("WorldPanel badge award and branch offer (op53 / op49)", () => {
  const taskOption = layout("taskOption"),
    offer = {
      taskId: 21,
      options: ["Tiếp nhận", "Từ chối"],
      rewards: [{ sheet: 258 as const, cell: 44, label: "Dây cương cưỡi sủng 2 ×1" }],
      summary: "",
    };

  it("bakes taskOption.ui with its two answer rows, reward slots and softkeys", () => {
    expect(box(taskOption, 10)).toEqual([83, 123, 72, 15, 150]);
    expect(box(taskOption, 11)).toEqual([83, 146, 72, 15, 150]);
    expect(taskOption.text(12, "")).toBe("Thưởng");
    expect(taskOption.text(19, "")).toBe("Xác định");
    expect(taskOption.text(20, "")).toBe("Quay lại");
  });

  it("answers the row under the cursor on 5 and 1 on Back, then hands the world back", () => {
    const panel = new WorldPanel();
    panel.openTaskOption(offer);
    expect(panel.taskOptionOpen).toBe(true);
    panel.tick(["down"]);
    panel.tick(["up"]);
    panel.tick(["confirm"]);
    expect(panel.visible).toBe(false);
    expect(panel.takeTaskOptionAnswer()).toBe(0);
    expect(panel.takeTaskOptionAnswer()).toBeNull();
    panel.openTaskOption(offer);
    panel.tick(["back"]);
    expect(panel.takeTaskOptionAnswer()).toBe(1);
  });

  it("a press on a row answers it; the rows are 15 px high and 23 px apart", () => {
    const panel = new WorldPanel();
    panel.openTaskOption(offer);
    // The top of "Từ chối" (y 146) must not answer "Tiếp nhận".
    expect(panel.click(taskOption, 100, 145)).toBe(true);
    panel.tick([]);
    expect(panel.takeTaskOptionAnswer()).toBe(1);
    panel.openTaskOption(offer);
    panel.click(taskOption, 100, 130);
    panel.tick([]);
    expect(panel.takeTaskOptionAnswer()).toBe(0);
  });

  it("an award opens badge.ui on the won badge and 5 closes it straight to the world", () => {
    const panel = new WorldPanel();
    panel.recordSource = {
      ...panel.recordSource,
      badges: () =>
        [0, 1, 2].map((id) => ({
          id,
          name: `badge ${id}`,
          description: "",
          status: "",
          achieved: id === 2,
        })),
    };
    panel.openBadgeAward(2);
    expect(panel.badgeAwardOpen).toBe(true);
    expect(panel.selected).toBe(2);
    panel.tick(["confirm"]);
    expect(panel.visible).toBe(false);
    expect(panel.badgeAwardOpen).toBe(false);
  });
});

describe("WorldPanel wharf (tickSourceEastWharf over wharf1.ui / wharf2.ui)", () => {
  const dock = {
    index: 3,
    title: "Hắc Thạch Mã Đầu",
    labels: ["Bắc Bích Thủy Thành", "Hắc Long Thần Điện", "Không ra hàng"],
    routes: [
      [5, 6, 1, 1, 5, 272, 128, 3, 0],
      [1, 0, 10, 6, 0, 112, 224, 2, 0],
    ],
  };
  const panelWith = (open: (scene: number, room: number, group: number) => boolean) => {
    const panel = new WorldPanel();
    panel.wharfSource = { gateOpen: open };
    panel.openWharf(dock);
    return panel;
  };

  it("bakes wharf1.ui with three destination rows", () => {
    const wharf1 = layout("wharf1");
    for (const id of [5, 6, 7, 8, 9, 10]) expect(wharf1.widget(id), `widget ${id}`).toBeDefined();
  });

  it("warns on a route whose gate group is not complete, and sails on one that is", () => {
    const shut = panelWith(() => false);
    shut.tick(["confirm"]);
    expect(shut.wharfMessage?.text).toBe("Đường thủy chưa mở");
    expect(shut.takeWharfTravel()).toBeNull();
    shut.tick(["confirm"]);
    expect(shut.wharfMessage).toBeNull();
    expect(shut.visible).toBe(true);

    const open = panelWith((scene, room, group) => scene === 5 && room === 6 && group === 1);
    open.tick(["confirm"]);
    expect(open.visible).toBe(false);
    expect(open.takeWharfTravel()).toMatchObject({
      gate: { scene: 5, room: 6, group: 1 },
      target: { scene: 1, room: 5, x: 272, y: 128, direction: 3 },
      boatMode: 0,
      label: "Bắc Bích Thủy Thành",
    });
  });

  it("closes on Back or on 5 over the last row, and the temple dock uses wharf2.ui", () => {
    const panel = panelWith(() => true);
    panel.tick(["down"]);
    panel.tick(["down"]);
    panel.tick(["confirm"]);
    expect(panel.visible).toBe(false);
    expect(panel.takeWharfTravel()).toBeNull();
    panel.openWharf({ ...dock, index: 4 });
    expect(panel.wharfLayoutName).toBe("wharf2");
    expect(panel.wharfRowWidgets).toHaveLength(5);
    panel.tick(["back"]);
    expect(panel.visible).toBe(false);
  });
});
