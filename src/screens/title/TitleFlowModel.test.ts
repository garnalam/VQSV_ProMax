import { describe, expect, it } from "vitest";
import { TitleFlowModel } from "./TitleFlowModel";

describe("Java BootFlow title contract", () => {
  it("uses the exact menu order without a valid save", () => {
    expect(new TitleFlowModel(false, false).labels()).toEqual([
      "Chơi mới",
      "Tùy chọn",
      "Trợ giúp",
      "Giới thiệu",
      "Thoát",
    ]);
  });
  it("inserts Continue only for a valid save", () => {
    expect(new TitleFlowModel(true, true).labels()[0]).toBe("Chơi tiếp");
    expect(new TitleFlowModel(false, true).labels()).not.toContain("Chơi tiếp");
  });
  it("wraps previous and next selection", () => {
    const model = new TitleFlowModel(false, false);
    model.command("previous");
    expect(model.selected).toBe(4);
    model.command("next");
    expect(model.selected).toBe(0);
  });
  it("opens every source menu branch", () => {
    const expected = ["skipIntro", "settings", "help", "about", "exit"];
    expected.forEach((mode, index) => {
      const model = new TitleFlowModel(false, false);
      for (let i = 0; i < index; i++) model.command("next");
      model.command("confirm");
      expect(model.mode).toBe(mode);
    });
  });
  it("routes Continue to a load-save boundary", () => {
    const model = new TitleFlowModel(true, true);
    expect(model.command("confirm")).toEqual({ loadSave: true, skipIntro: false, speedX2: false });
    expect(model.mode).toBe("gameBoundary");
  });
  it("requires overwrite before new game when any save exists", () => {
    const model = new TitleFlowModel(false, true);
    model.command("confirm");
    expect(model.mode).toBe("overwrite");
    model.command("confirm");
    expect(model.mode).toBe("skipIntro");
  });
  it("supports both skip-intro choices and cancellation", () => {
    const yes = new TitleFlowModel(false, false);
    yes.command("confirm");
    expect(yes.command("confirm")).toEqual({ loadSave: false, skipIntro: true, speedX2: false });
    const no = new TitleFlowModel(false, false);
    no.command("confirm");
    expect(no.command("softRight")).toEqual({ loadSave: false, skipIntro: false, speedX2: false });
    const cancel = new TitleFlowModel(false, false);
    cancel.command("confirm");
    cancel.command("back");
    expect(cancel.mode).toBe("menu");
  });
  it("clamps settings volume, toggles speed and closes on confirm", () => {
    const model = new TitleFlowModel(false, false);
    model.selected = 1;
    model.command("confirm");
    for (let i = 0; i < 8; i++) model.command("next");
    expect(model.settingsLevel).toBe(3);
    model.toggleSpeed();
    expect(model.speedX2).toBe(true);
    model.command("confirm");
    expect(model.mode).toBe("menu");
  });
  it("passes the selected x2 mode into both new-game intro routes", () => {
    const play = new TitleFlowModel(false, false);
    play.selected = 1;
    play.command("confirm");
    play.toggleSpeed();
    play.command("back");
    play.selected = 0;
    play.command("confirm");
    expect(play.command("softRight")).toEqual({ loadSave: false, skipIntro: false, speedX2: true });
  });
  it("clamps three help pages, ignores confirm and resets on back", () => {
    const model = new TitleFlowModel(false, false);
    model.selected = 2;
    model.command("confirm");
    for (let i = 0; i < 8; i++) model.command("next");
    expect(model.helpPage).toBe(2);
    model.command("confirm");
    expect(model.mode).toBe("help");
    model.command("back");
    expect(model.mode).toBe("menu");
    expect(model.helpPage).toBe(0);
  });
  it("closes About and exit boundary with Back", () => {
    const about = new TitleFlowModel(false, false);
    about.selected = 3;
    about.command("confirm");
    about.command("back");
    expect(about.mode).toBe("menu");
    const exit = new TitleFlowModel(false, false);
    exit.selected = 4;
    exit.command("confirm");
    exit.command("back");
    expect(exit.mode).toBe("menu");
  });
});
