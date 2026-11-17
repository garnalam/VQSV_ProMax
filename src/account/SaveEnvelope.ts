// The cloud save's envelope: what the game and the server send each other instead of plain JSON,
// so a save fetched from the F12 console cannot be read, edited and sent back.
//
// bytes = "VQE1" | 12-byte IV | AES-GCM(deflate-raw(UTF-8 JSON))
// key   = HKDF-SHA256(ikm = the session's ticket, salt = the build key, info = "vqsv-save-v1")
// AAD   = "vqsv1|<save id or new>|<revision>|<up|down>"
//
// The ticket is random per login and kept by the server; the build key is new on every deploy and
// lives only in the game bundle and the server. The AAD ties a sealed save to one save row, one
// revision and one direction, so neither an old copy nor a download can be uploaded again.
//
// Shared by the game and `server/app.mjs` (Node strips the types), so: WebCrypto only, no enums.

const MAGIC = [0x56, 0x51, 0x45, 0x31]; // "VQE1"
const IV_BYTES = 12;
const INFO = new TextEncoder().encode("vqsv-save-v1");

/** The key a dev build and the tests use; a deployed build always has its own (`deploy/build-keys.txt`). */
export const DEV_BUILD_KEY_HEX = "5f1c2a9d7b3e48c6a0d4e9f2b17c6a83d5e0f4a9c2b7d18e6f3a0c5b9d2e7f41";

export const hexBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));

const base64Bytes = (text: string): Uint8Array =>
  Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

/** The AAD a sealed save carries. `saveId` is null for a player's first upload. */
export const envelopeAad = (saveId: string | null, revision: number, direction: "up" | "down") =>
  `vqsv1|${saveId ?? "new"}|${revision}|${direction}`;

/** True when the bytes start like an envelope (the server refuses anything else). */
export const isEnvelope = (bytes: Uint8Array): boolean =>
  bytes.length > MAGIC.length + IV_BYTES && MAGIC.every((value, index) => bytes[index] === value);

/** Eight hex characters naming a build key, so the server answers in the key the game holds. */
export async function buildKeyId(buildKey: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buildKey as BufferSource));
  return Array.from(digest.slice(0, 4), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function aesKey(ticket: string, buildKey: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", base64Bytes(ticket) as BufferSource, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: buildKey as BufferSource, info: INFO },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const output = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(output).arrayBuffer());
}

/** Seals a save's JSON text for one save row, revision and direction. */
export async function sealSave(
  json: string,
  ticket: string,
  buildKey: Uint8Array,
  aad: string,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES)),
    packed = await pipe(new TextEncoder().encode(json), new CompressionStream("deflate-raw")),
    sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
        await aesKey(ticket, buildKey),
        packed as BufferSource,
      ),
    ),
    out = new Uint8Array(MAGIC.length + IV_BYTES + sealed.length);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(sealed, MAGIC.length + IV_BYTES);
  return out;
}

/**
 * The save's JSON text, or null when the bytes are not an envelope sealed with this ticket, one of
 * these build keys and this AAD (edited, another row, another revision, a stale build).
 */
export async function openSave(
  bytes: Uint8Array,
  ticket: string,
  buildKeys: readonly Uint8Array[],
  aad: string,
): Promise<string | null> {
  if (!isEnvelope(bytes)) return null;
  const iv = bytes.slice(MAGIC.length, MAGIC.length + IV_BYTES),
    sealed = bytes.slice(MAGIC.length + IV_BYTES),
    additionalData = new TextEncoder().encode(aad);
  for (const buildKey of buildKeys) {
    let packed: Uint8Array;
    try {
      packed = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv, additionalData },
          await aesKey(ticket, buildKey),
          sealed as BufferSource,
        ),
      );
    } catch {
      continue;
    }
    try {
      return new TextDecoder().decode(await pipe(packed, new DecompressionStream("deflate-raw")));
    } catch {
      return null;
    }
  }
  return null;
}
