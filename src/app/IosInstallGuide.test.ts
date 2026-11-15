import { describe, expect, it } from "vitest";
import { iosFlavor, iosSteps } from "./IosInstallGuide";

const IPHONE_18 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPHONE_26 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";

describe("iPhone home-screen guide", () => {
  it("finds where Share lives for each browser", () => {
    expect(iosFlavor(IPHONE_18)).toBe("toolbar");
    expect(iosFlavor(IPHONE_26)).toBe("floating");
    expect(iosFlavor(IPHONE_CHROME)).toBe("top");
    expect(iosFlavor(IPAD)).toBe("top");
  });

  it("walks every flavour from the first button to the home screen", () => {
    for (const flavor of ["toolbar", "floating", "top"] as const) {
      const steps = iosSteps(flavor, "vqsv.example");
      expect(steps.length).toBeGreaterThanOrEqual(4);
      for (const step of steps) expect(step.figure.startsWith("<svg")).toBe(true);
      expect(steps.at(-1)!.text).toContain("VQSV");
    }
    expect(
      iosSteps("floating", "vqsv.example")
        .map((step) => step.text)
        .join(" "),
    ).toContain("Mở dưới dạng ứng dụng web");
  });

  it("escapes the host drawn into the pictures", () => {
    const [first] = iosSteps("top", "<b>&host");
    expect(first!.figure).toContain("&lt;b&gt;&amp;host");
  });
});
