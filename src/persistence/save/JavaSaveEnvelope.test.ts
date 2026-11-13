import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeJavaSaveBytes, JavaSaveEnvelopeError } from "./JavaSaveEnvelope";
import { parseJavaProperties } from "./JavaSaveImport";

// The .bin fixtures were written by the Java build's own SaveEnvelopeCodec from the .properties
// fixture: v1 is its encrypted envelope, v2 the web cloud's gzip + SHA-256 envelope.
const fixture = (name: string) =>
  new Uint8Array(readFileSync(resolve(import.meta.dirname, "fixtures", name)));
const plain = parseJavaProperties(
  readFileSync(resolve(import.meta.dirname, "fixtures/java-save-scene3.properties"), "latin1"),
);

describe("decodeJavaSaveBytes (Java build's stored save → Properties text)", () => {
  it.each(["java-save-scene3.v1.bin", "java-save-scene3.v2.bin", "java-save-scene3.properties"])(
    "reads %s back to the same save",
    async (name) => {
      const decoded = parseJavaProperties(await decodeJavaSaveBytes(fixture(name)));
      expect(decoded.get("scene")).toBe("3");
      expect(decoded.get("money")).toBe(plain.get("money"));
      expect(decoded).toEqual(plain);
    },
  );

  it("refuses an envelope that was tampered with", async () => {
    for (const name of ["java-save-scene3.v1.bin", "java-save-scene3.v2.bin"]) {
      const bytes = fixture(name);
      bytes[bytes.length - 40] ^= 0xff;
      await expect(decodeJavaSaveBytes(bytes)).rejects.toBeInstanceOf(JavaSaveEnvelopeError);
    }
  });
});
