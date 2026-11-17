import { describe, expect, it } from "vitest";
import { buildKey } from "./BuildKey";
import { DEV_BUILD_KEY_HEX, envelopeAad, hexBytes, isEnvelope, openSave, sealSave } from "./SaveEnvelope";
import { RemoteSaveStore, type ApiFetch } from "./RemoteAccountService";

const ticket = btoa(String.fromCharCode(...new Uint8Array(32).fill(3))),
  key = hexBytes(DEV_BUILD_KEY_HEX),
  json = JSON.stringify({ currency: { money: 12 }, pets: [{ speciesId: 68 }] });

describe("save envelope (owner, 2026-11-16: no editing saves from the F12 console)", () => {
  it("seals to bytes that are not JSON, and opens back to the same text", async () => {
    const aad = envelopeAad("row", 3, "up"),
      sealed = await sealSave(json, ticket, key, aad);
    expect(isEnvelope(sealed)).toBe(true);
    expect(() => JSON.parse(new TextDecoder().decode(sealed))).toThrow();
    expect(await openSave(sealed, ticket, [key], aad)).toBe(json);
  });

  it("refuses an edited byte, another row, revision or direction, another ticket and another build", async () => {
    const aad = envelopeAad("row", 3, "up"),
      sealed = await sealSave(json, ticket, key, aad),
      flipped = sealed.slice();
    flipped[flipped.length - 1] ^= 1;
    expect(await openSave(flipped, ticket, [key], aad)).toBeNull();
    expect(await openSave(sealed, ticket, [key], envelopeAad("other", 3, "up"))).toBeNull();
    expect(await openSave(sealed, ticket, [key], envelopeAad("row", 2, "up"))).toBeNull();
    expect(await openSave(sealed, ticket, [key], envelopeAad("row", 3, "down"))).toBeNull();
    expect(await openSave(sealed, btoa("x".repeat(32)), [key], aad)).toBeNull();
    expect(await openSave(sealed, ticket, [new Uint8Array(32)], aad)).toBeNull();
    expect(await openSave(new TextEncoder().encode(json), ticket, [key], aad)).toBeNull();
    // The previous deploy's key is still tried.
    expect(await openSave(sealed, ticket, [new Uint8Array(32), key], aad)).toBe(json);
  });

  it("the game's store uploads sealed and reads the sealed download", async () => {
    const stored = { value: "", revision: 0 };
    const api: ApiFetch = async (path, init) => {
      if (path === "/saves" && !init?.method)
        return Response.json({
          saves: stored.revision ? [{ id: "row", gameVersion: "web-native", revision: stored.revision }] : [],
          ticket,
        });
      if (init?.method === "POST" || init?.method === "PUT") {
        const file = (init.body as FormData).get("file") as Blob,
          text = await openSave(new Uint8Array(await file.arrayBuffer()), ticket, [key], envelopeAad(stored.revision ? "row" : null, stored.revision, "up"));
        if (text === null) return Response.json({ error: "refused" }, { status: 400 });
        stored.value = text;
        stored.revision++;
        return Response.json({ id: "row", gameVersion: "web-native", revision: stored.revision });
      }
      const bytes = await sealSave(stored.value, ticket, key, envelopeAad("row", stored.revision, "down"));
      return new Response(bytes as BodyInit);
    };
    const store = new RemoteSaveStore(api);
    expect(buildKey()).toEqual(key);
    await store.putAll([["active", { money: 5 }]]);
    await store.putAll([["active", { money: 9 }]]);
    expect(JSON.parse(stored.value)).toEqual({ money: 9 });
    expect(await new RemoteSaveStore(api).get("active")).toEqual({ money: 9 });
  });
});
