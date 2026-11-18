/**
 * A small QR code encoder (byte mode, error correction level M), enough for a VietQR payment
 * string. It follows ISO/IEC 18004 the way Project Nayuki's reference encoder lays it out; the
 * game has no npm runtime packages, so it is written here.
 */

const ECC_PER_BLOCK_M = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const BLOCKS_M = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26,
  28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];
/** Level M's two format bits. */
const FORMAT_BITS_M = 0;

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

const dataCodewords = (version: number) =>
  Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK_M[version] * BLOCKS_M[version];

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMultiply(coef, factor)));
  }
  return result;
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2,
    size = version * 4 + 17,
    step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** The QR symbol for `text` (UTF-8), as rows of dark (true) / light modules, without a quiet zone. */
export function encodeQr(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 1;
  for (; version <= 40; version++) {
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(version) * 8) break;
  }
  if (version > 40) throw new Error("QR: text too long");
  const capacity = dataCodewords(version) * 8;

  // The bit stream: byte mode, the count, the bytes, a terminator, padding.
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));

  // Error correction, block by block, then interleaved.
  const blockCount = BLOCKS_M[version],
    eccLength = ECC_PER_BLOCK_M[version],
    raw = Math.floor(rawDataModules(version) / 8),
    shortBlocks = blockCount - (raw % blockCount),
    shortLength = Math.floor(raw / blockCount),
    divisor = rsDivisor(eccLength),
    blocks: number[][] = [];
  for (let i = 0, k = 0; i < blockCount; i++) {
    const block = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
    k += block.length;
    const ecc = rsRemainder(block, divisor);
    if (i < shortBlocks) block.push(0);
    blocks.push(block.concat(ecc));
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0].length; i++)
    blocks.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) codewords.push(block[i]);
    });

  const size = version * 4 + 17,
    modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
    isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fn = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  for (let i = 0; i < size; i++) {
    fn(6, i, i % 2 === 0);
    fn(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ])
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)),
          x = cx + dx,
          y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) fn(x, y, d !== 2 && d !== 4);
      }
  const align = alignmentPositions(version),
    last = align.length - 1;
  for (let i = 0; i < align.length; i++)
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          fn(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

  const drawFormat = (mask: number) => {
    const value = (FORMAT_BITS_M << 3) | mask;
    let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const format = ((value << 10) | rem) ^ 0x5412,
      bit = (i: number) => ((format >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) fn(8, i, bit(i));
    fn(8, 7, bit(6));
    fn(8, 8, bit(7));
    fn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) fn(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) fn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) fn(8, size - 15 + i, bit(i));
    fn(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const value = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((value >>> i) & 1) !== 0,
        a = size - 11 + (i % 3),
        b = Math.floor(i / 3);
      fn(a, b, dark);
      fn(b, a, dark);
    }
  }

  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j,
          y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (isFunction[y][x] || bit >= codewords.length * 8) continue;
        modules[y][x] = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) !== 0;
        bit++;
      }
  }

  const masked = (mask: number) =>
    modules.map((row, y) =>
      row.map((dark, x) => {
        if (isFunction[y][x]) return dark;
        const flip = [
          (x + y) % 2 === 0,
          y % 2 === 0,
          x % 3 === 0,
          (x + y) % 3 === 0,
          (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
          ((x * y) % 2) + ((x * y) % 3) === 0,
          (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
          (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
        ][mask];
        return dark !== flip;
      }),
    );
  // The mask with the lowest penalty (runs, 2×2 blocks, dark balance).
  const penalty = (grid: boolean[][]) => {
    let score = 0,
      dark = 0;
    const runs = (line: boolean[]) => {
      let run = 1;
      for (let i = 1; i <= line.length; i++) {
        if (i < line.length && line[i] === line[i - 1]) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
    };
    for (let y = 0; y < size; y++) {
      runs(grid[y]);
      runs(grid.map((row) => row[y]));
      for (let x = 0; x < size; x++) {
        if (grid[y][x]) dark++;
        if (
          x + 1 < size &&
          y + 1 < size &&
          grid[y][x] === grid[y][x + 1] &&
          grid[y][x] === grid[y + 1][x] &&
          grid[y][x] === grid[y + 1][x + 1]
        )
          score += 3;
      }
    }
    return score + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  };
  let best: boolean[][] = [],
    bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    drawFormat(mask);
    const grid = masked(mask),
      score = penalty(grid);
    if (score < bestScore) {
      best = grid;
      bestScore = score;
    }
  }
  return best;
}

/** Draws `text` as a QR code on a new canvas, `scale` pixels per module, with a 4-module margin. */
export function qrCanvas(text: string, scale = 6): HTMLCanvasElement {
  const grid = encodeQr(text),
    quiet = 4,
    side = (grid.length + quiet * 2) * scale,
    canvas = document.createElement("canvas");
  canvas.width = canvas.height = side;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, side, side);
  g.fillStyle = "#000";
  grid.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    }),
  );
  return canvas;
}
