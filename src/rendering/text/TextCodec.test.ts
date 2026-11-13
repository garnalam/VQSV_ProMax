import { describe, expect, it } from "vitest";
import { decodeMojibake } from "./TextCodec";

describe("decodeMojibake", () => {
  it("composes combining tone marks into the precomposed letters the fonts carry", () => {
    expect(decodeMojibake("trường")).toBe("trường");
    expect(decodeMojibake("ấ")).toBe("ấ");
    expect(decodeMojibake("ế")).toBe("ế");
    expect(decodeMojibake("sẵn sàng")).toBe("sẵn sàng");
  });

  it("reads a UTF-8 string misread as windows-1252 back", () => {
    const mojibake = new TextDecoder("windows-1252").decode(new TextEncoder().encode("Sẵn sàng"));
    expect(mojibake).not.toBe("Sẵn sàng");
    expect(decodeMojibake(mojibake)).toBe("Sẵn sàng");
  });

  it("leaves correct text alone", () => {
    for (const text of [
      "Sẵn sàng",
      "Xuất chiến",
      "Nhấn nút 5 để tiếp tục",
      "â ê ô",
      "",
      "HP 120/120",
    ])
      expect(decodeMojibake(text)).toBe(text);
  });
});
