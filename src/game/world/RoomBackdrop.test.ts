import { describe, expect, it } from "vitest";
import { roomBackdropColor, roomBackPic } from "./RoomBackdrop";

describe("room backdrop (NguyenMocRoutePresentationPolicy.background / backgroundImage)", () => {
  it("hangs Thiên Giới and its guardian routes in the sky gradient over DEFAULT_BACK_PIC", () => {
    for (let room = 0; room <= 12; room++) {
      expect(roomBackPic(7, room)).toBe("sky");
      expect(roomBackdropColor(7, room)).toBe("#2db9c4");
    }
    for (let room = 1; room <= 7; room++) expect(roomBackPic(10, room)).toBe("sky");
    // Minh Vương Long's cave (10:8) and the temple (11:3) have the fill only.
    expect([roomBackPic(10, 8), roomBackdropColor(10, 8)]).toEqual([null, "#2db9c4"]);
    expect([roomBackPic(11, 3), roomBackdropColor(11, 3)]).toEqual([null, "#2db9c4"]);
  });

  it("puts Hắc Thạch's dark rooms over the abyss strip and keeps the policy's other colours", () => {
    for (const room of [0, 2, 3, 4, 5]) expect(roomBackPic(5, room)).toBe("abyss");
    expect(roomBackPic(5, 1)).toBeNull();
    expect(roomBackdropColor(3, 4)).toBe("#00a4ae");
    expect(roomBackdropColor(10, 13)).toBe("#00a4ae");
    expect(roomBackdropColor(8, 2)).toBe("#000000");
    expect(roomBackdropColor(10, 14)).toBe("#000000");
    expect(roomBackdropColor(1, 0)).toBe("#000000");
    expect(roomBackdropColor(98, 0)).toBe("#000000");
  });
});
