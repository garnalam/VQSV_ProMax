import { describe, expect, it } from "vitest";
import { TitleScreen } from "../TitleScreen";
import { TitleFlowModel, type StartRequest } from "./TitleFlowModel";
import { InputSnapshot } from "../../core/input/InputSnapshot";
import { KEY } from "../../core/input/KeyCode";
import type { BootAssets } from "../../pack/boot";

const screen = (validSave = false, anySave = false) => {
  const started: StartRequest[] = [],
    model = new TitleFlowModel(validSave, anySave),
    title = new TitleScreen(
      {} as BootAssets,
      model,
      (r) => started.push(r),
    );
  return { title, model, started };
};

describe("TitleScreen input (BootFlowState title phases)", () => {
  it("moves the menu with up/left/8/4 and down/right/2/6", () => {
    const { title, model } = screen();
    title.tick(InputSnapshot.keys(KEY.DOWN));
    title.tick(InputSnapshot.keys(KEY.D6));
    expect(model.selected).toBe(2);
    title.tick(InputSnapshot.keys(KEY.LEFT));
    title.tick(InputSnapshot.keys(KEY.NUMPAD8));
    expect(model.selected).toBe(0);
  });
  it("applies one action per tick, previous before next", () => {
    const { title, model } = screen();
    title.tick(InputSnapshot.keys(KEY.UP, KEY.DOWN));
    expect(model.selected).toBe(4);
  });
  it("uses the three bottom-band pointer zones", () => {
    const { title, model } = screen();
    title.tick(InputSnapshot.tap(200, 300));
    expect(model.selected).toBe(1);
    title.tick(InputSnapshot.tap(20, 300));
    expect(model.selected).toBe(0);
    title.tick(InputSnapshot.tap(120, 300));
    expect(model.mode).toBe("skipIntro");
  });
  it("skip-intro prompt: Space/softLeft skips, softRight plays the intro", () => {
    let s = screen();
    s.title.tick(InputSnapshot.keys(KEY.ENTER));
    s.title.tick(InputSnapshot.keys(KEY.SPACE));
    expect(s.started).toEqual([{ loadSave: false, skipIntro: true, speedX2: false }]);
    s = screen();
    s.title.tick(InputSnapshot.keys(KEY.ENTER));
    s.title.tick(InputSnapshot.tap(230, 310));
    expect(s.started).toEqual([{ loadSave: false, skipIntro: false, speedX2: false }]);
  });
  it("skip-intro prompt ignores a tap outside the softkey corners", () => {
    const s = screen();
    s.title.tick(InputSnapshot.keys(KEY.ENTER));
    s.title.tick(InputSnapshot.tap(60, 200));
    expect(s.started).toEqual([]);
    expect(s.model.mode).toBe("skipIntro");
  });
  it("overwrite prompt: Backspace cancels", () => {
    const s = screen(true, true);
    s.title.tick(InputSnapshot.keys(KEY.DOWN));
    s.title.tick(InputSnapshot.keys(KEY.ENTER));
    expect(s.model.mode).toBe("overwrite");
    s.title.tick(InputSnapshot.keys(KEY.BACK_SPACE));
    expect(s.model.mode).toBe("menu");
  });
});
