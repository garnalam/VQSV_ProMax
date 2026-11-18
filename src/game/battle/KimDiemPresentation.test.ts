import { describe, expect, it } from "vitest";
import { kimDiemIntroPose, KIM_DIEM_INTRO_TICKS, kimDiemWorldFrame } from "./KimDiemPresentation";

describe("Kim Diễm presentation from Test Huy", () => {
  it("sets the arrival, impact and Long Uy poses on the reference ticks", () => {
    expect(KIM_DIEM_INTRO_TICKS).toBe(88);
    expect(kimDiemIntroPose(8)).toBeUndefined();
    expect(kimDiemIntroPose(9)).toEqual({ x: 28, y: -121, state: 1, elapsed: 0 });
    expect(kimDiemIntroPose(21)).toEqual({ x: 0, y: 0, state: 1, elapsed: 12 });
    expect(kimDiemIntroPose(52)).toEqual({ x: 0, y: 5, state: 1, elapsed: 7 });
    expect(kimDiemIntroPose(88)).toBeUndefined();
  });

  it("projects the cropped world frame against the Test Huy registration", () => {
    expect(kimDiemWorldFrame(-48, -78, 96, 86)).toEqual({
      x: -280,
      y: -88,
      width: 416,
      height: 372,
    });
  });
});
