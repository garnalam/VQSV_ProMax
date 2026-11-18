import { describe, expect, it } from "vitest";
import { encodeQr } from "./QrCode";
import { SUPPORT_VIETQR, emvCrc, supportCode, supportTransferNote, vietQrWithNote } from "./SupportPanel";

describe("SupportPanel's VietQR", () => {
  it("keeps the fund's own CRC valid", () => {
    expect(emvCrc(SUPPORT_VIETQR.slice(0, -4))).toBe(SUPPORT_VIETQR.slice(-4));
  });

  it("puts the note in field 62/08 and recomputes the CRC", () => {
    const qr = vietQrWithNote(SUPPORT_VIETQR, "VQSV TEST01");
    expect(qr).toBe(
      "00020101021138630010A000000727013300069710250119PSG26322128000000420208QRIBFTTA53037045802VN62710334mp_42671155_7qefqqvnmn5t4nwd9c845z0514MM_fund_detail0811VQSV TEST01630487D8",
    );
    // A second note replaces the first instead of adding another.
    expect(vietQrWithNote(qr, "VQSV TEST01")).toBe(qr);
  });

  it("names the player by 8 hex digits of the account id", () => {
    expect(supportCode("e046445f-9c55-4faf-a635-2c8a2dd0178e")).toBe("E046445F");
    expect(supportTransferNote("e046445f-9c55-4faf-a635-2c8a2dd0178e")).toBe("VQSV E046445F");
  });

  it("encodes the payment string as a square symbol of a valid version", () => {
    const grid = encodeQr(vietQrWithNote(SUPPORT_VIETQR, "VQSV E046445F"));
    expect(grid.length).toBe(grid[0].length);
    expect((grid.length - 17) % 4).toBe(0);
    // The three finder patterns' dark corners.
    expect([grid[0][0], grid[0][grid.length - 1], grid[grid.length - 1][0]]).toEqual([true, true, true]);
  });
});
