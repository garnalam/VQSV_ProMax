/**
 * The Java build's stored save bytes → its Properties text, as `SaveEnvelopeCodec.decodeCompatible`
 * reads them:
 * - "VQSVSAVE" v1: AES-256-GCM (the header is the associated data) over a gzip of the Properties;
 * - "VQSVSAVE" v2 (the web build's cloud saves): gzip of the Properties + SHA-256(header + gzip);
 * - anything else: the old plain Properties text.
 * Java writes Properties in ISO-8859-1 with \uXXXX escapes, so the text is read the same way.
 */

const MAGIC = "VQSVSAVE";
const HEADER = 16;
const NONCE = 12;
const GCM_TAG = 16;
const WEB_TAG = 32;

// The Java codec's key parts; the key is SHA-256 of their mix (SaveEnvelopeCodec.deriveKey).
const KEY_PART_A = [
  0x9a, 0xc9, 0x82, 0x48, 0x85, 0x24, 0x46, 0xbc, 0x5c, 0x5f, 0x4d, 0xbc, 0x63, 0xae, 0xbf, 0xfb,
  0xac, 0x6e, 0xa3, 0xfb, 0xae, 0x3d, 0x21, 0x11, 0x2c, 0xa6, 0x0d, 0x81, 0x58, 0xc6, 0x47, 0x49,
];
const KEY_PART_B = [
  0x0d, 0x93, 0x29, 0x78, 0x9c, 0xdd, 0x30, 0xc1, 0xf8, 0x22, 0xf9, 0x45, 0x53, 0x3d, 0x23, 0x5c,
  0x12, 0x5b, 0x50, 0x70, 0xad, 0xdc, 0x89, 0xdb, 0xd6, 0x99, 0xf8, 0x1c, 0x44, 0x3c, 0x12, 0x35,
];

export class JavaSaveEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JavaSaveEnvelopeError";
  }
}

let keyPromise: Promise<CryptoKey> | undefined;
function key(): Promise<CryptoKey> {
  keyPromise ??= (async () => {
    const material = new Uint8Array(KEY_PART_A.length);
    for (let i = 0; i < material.length; i++)
      material[i] = KEY_PART_A[i] ^ KEY_PART_B[(i * 11 + 7) % KEY_PART_B.length] ^ (i * 29) ^ 0xa7;
    const digest = await crypto.subtle.digest("SHA-256", material);
    return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
  })();
  return keyPromise;
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

function hasMagic(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length) return false;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
  return true;
}

export async function decodeJavaSaveBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (!hasMagic(bytes)) return latin1(bytes);
  if (bytes.length < HEADER) throw new JavaSaveEnvelopeError("save envelope is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    version = bytes[8],
    flags = bytes[9],
    nonceLength = bytes[10],
    reserved = bytes[11],
    length = view.getInt32(12),
    header = bytes.slice(0, HEADER);
  if (version === 2) {
    if (flags !== 3 || nonceLength !== 0 || reserved !== 0 || length < WEB_TAG)
      throw new JavaSaveEnvelopeError("unsupported web save envelope header");
    if (bytes.length !== HEADER + length)
      throw new JavaSaveEnvelopeError("web save envelope length mismatch");
    const end = bytes.length - WEB_TAG,
      compressed = bytes.slice(HEADER, end),
      expected = bytes.slice(end),
      signed = new Uint8Array(end);
    signed.set(bytes.subarray(0, end));
    const actual = new Uint8Array(await crypto.subtle.digest("SHA-256", signed));
    if (actual.some((byte, i) => byte !== expected[i]))
      throw new JavaSaveEnvelopeError("web save integrity check failed");
    return latin1(await gunzip(compressed));
  }
  if (version !== 1 || flags !== 1 || nonceLength !== NONCE || reserved !== 0)
    throw new JavaSaveEnvelopeError(`unsupported save envelope version ${version}`);
  if (length < GCM_TAG || bytes.length !== HEADER + NONCE + length)
    throw new JavaSaveEnvelopeError("save envelope length mismatch");
  let compressed: ArrayBuffer;
  try {
    compressed = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes.slice(HEADER, HEADER + NONCE),
        additionalData: header,
        tagLength: GCM_TAG * 8,
      },
      await key(),
      bytes.slice(HEADER + NONCE),
    );
  } catch {
    throw new JavaSaveEnvelopeError("encrypted save authentication failed");
  }
  return latin1(await gunzip(new Uint8Array(compressed)));
}
