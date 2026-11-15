/**
 * Web-only shiny colours (the owner's redesign, replacing JavaSE `PetShinyPalette`'s hue collapse).
 *
 * A few hand-made themes, each a strict three-role palette: a main colour for the pet's largest
 * colour region, a second colour for its next region, and an accent for the small details. Every
 * role is a six-stop ramp drawn by hand (deep shadow → highlight, the hue turning a little along
 * the way as pixel artists shade), so a shiny never shows more than three colour families and
 * never a stray colour.
 *
 * A sprite is read once per visual (`analyzeSprite`): its colour regions by hue, ranked by area,
 * each with its own lightness range. A pixel takes the ramp of its region's role at the place its
 * lightness holds inside that region, so the region keeps its full shading. Outlines, whites and
 * greys keep their colour.
 *
 * A pet with a shiny nature (7, 8, 9) is given one of the themes at random when it becomes shiny
 * (`SavedPet.shinyColor`), so two shinies of the same species can wear different colours. A theme
 * changes colour, not value, so a shiny reads as clearly as the normal pet.
 */

// ---------------------------------------------------------------------------------------------
// OKLCH (perceptual lightness, chroma, hue)

type Lch = { l: number; c: number; h: number };

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function rgbToLch(rgb: number): Lch {
  const r = toLinear((rgb >>> 16) & 0xff),
    g = toLinear((rgb >>> 8) & 0xff),
    b = toLinear(rgb & 0xff),
    l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
    m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b),
    L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c: Math.hypot(A, B), h };
}

const hueDistance = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
};

// ---------------------------------------------------------------------------------------------
// The themes

/** Deep shadow → highlight, as 0xRRGGBB. */
export type Ramp = readonly number[];
export type ThemeKind = "light" | "dark" | "vivid";
export type ShinyTheme = {
  id: string;
  name: string;
  kind: ThemeKind;
  /** Metal themes shade in reflective bands (a bright streak across the main colour). */
  metal?: boolean;
  /** Main, second, accent. */
  ramps: readonly [Ramp, Ramp, Ramp];
};

const ramp = (...hex: string[]): Ramp => hex.map((h) => parseInt(h.slice(1), 16));

const GOLD = ramp("#3d2304", "#7a4a0c", "#b97c17", "#e3ad2e", "#f8d76a", "#fff3c4");
const TEAL = ramp("#043a3a", "#0a6a68", "#12a39a", "#3cd5c2", "#8cf0dc", "#dafff4");
const ROSE = ramp("#4a1030", "#8a2050", "#c84478", "#ee7aa2", "#fbb4c8", "#ffe6ee");
const IVORY = ramp("#3a2a12", "#6e5226", "#a88446", "#d6b678", "#f2deb2", "#fffaf0");

/**
 * Each ramp turns its hue along the way, as pixel artists shade: shadows lean cool (towards blue
 * or violet), highlights lean warm (towards yellow), so the colour stays rich instead of fading
 * to grey or white.
 */
export const SHINY_THEMES: readonly ShinyTheme[] = [
  // ---- light
  {
    id: "lavender",
    name: "Oải hương",
    kind: "light",
    ramps: [
      ramp("#2c1a4a", "#523a80", "#8268b6", "#ad97da", "#d4c6f0", "#f6efff"),
      ramp("#16362c", "#2c5e48", "#4e8c6a", "#7cb894", "#b2dcbe", "#ecfaef"),
      GOLD,
    ],
  },

  {
    id: "spring",
    name: "Xuân hoa",
    kind: "light",
    ramps: [
      ramp("#4a1a36", "#8a3a56", "#c86a78", "#ee9c96", "#fac8b6", "#fff0e2"),
      ramp("#0e3a3a", "#1e6a5c", "#3ea284", "#72cfa6", "#aeeccb", "#e8fff2"),
      GOLD,
    ],
  },
  {
    id: "dawn",
    name: "Bình minh",
    kind: "light",
    ramps: [
      ramp("#4a1c20", "#8c3c2e", "#d0703e", "#f4a25c", "#ffd08e", "#fff2d4"),
      ramp("#14305a", "#24569a", "#4486d0", "#78b4ee", "#b2d8fa", "#eef8ff"),
      ROSE,
    ],
  },
  // ---- dark
  {
    id: "obsidian",
    name: "Hắc diệu",
    kind: "dark",
    ramps: [
      ramp("#09070f", "#16111f", "#271e38", "#3e3158", "#604d84", "#9a86c4"),
      ramp("#2a0410", "#560a1e", "#951430", "#d22d45", "#fa6168", "#ffaa9c"),
      GOLD,
    ],
  },
  {
    id: "galaxy",
    name: "Thiên hà",
    kind: "dark",
    ramps: [
      ramp("#0a0a2a", "#17184f", "#2a2988", "#4744c2", "#7a72e8", "#bdb6ff"),
      ramp("#300a3a", "#5e1468", "#9a2496", "#d046bf", "#f286dc", "#ffd0f2"),
      ramp("#03303d", "#06606e", "#0d9aa6", "#2fd0d6", "#86f0f0", "#dcffff"),
    ],
  },
  {
    id: "bloodmoon",
    name: "Huyết nguyệt",
    kind: "dark",
    ramps: [
      ramp("#1a0410", "#3a0818", "#681024", "#9a1e34", "#c83c48", "#f07a70"),
      ramp("#0a080e", "#17121c", "#271e2e", "#3c2e44", "#56425e", "#7a6080"),
      ramp("#2a3046", "#4e5a76", "#7e8ca8", "#b0bfd6", "#dce6f2", "#ffffff"),
    ],
  },
  {
    id: "nightwood",
    name: "Dạ lâm",
    kind: "dark",
    ramps: [ramp("#06140e", "#0c2418", "#143826", "#1f5236", "#2f704a", "#4c9466"), GOLD, ROSE],
  },

  // ---- vivid
  {
    id: "royal",
    name: "Hoàng kim",
    kind: "vivid",
    metal: true,
    ramps: [
      GOLD,
      ramp("#2e0612", "#5e0e24", "#9a1a38", "#cf3550", "#f06f7a", "#ffc0c0"),
      ramp("#0a1f33", "#163c5e", "#245f8c", "#3e88b8", "#79b6dc", "#c6e6f8"),
    ],
  },
  {
    id: "jade",
    name: "Lục bảo",
    kind: "vivid",
    ramps: [ramp("#062a20", "#0c4c3a", "#147656", "#24a374", "#5ccf9a", "#bff2d6"), GOLD, IVORY],
  },
  {
    id: "sakura",
    name: "Anh đào",
    kind: "vivid",
    ramps: [
      ramp("#3a0c2a", "#6c1a4a", "#a5326c", "#d65f96", "#f39fc2", "#ffe0ee"),
      ramp("#24104a", "#432284", "#6a40bc", "#966ee0", "#c6a6f6", "#efe4ff"),
      GOLD,
    ],
  },
  {
    id: "inferno",
    name: "Hỏa diệm",
    kind: "vivid",
    ramps: [
      ramp("#2a0904", "#5e1506", "#a0280c", "#da4f14", "#fa8a30", "#ffcf80"),
      ramp("#0e0a0c", "#211619", "#3a2428", "#58363a", "#7c4e50", "#a8716c"),
      GOLD,
    ],
  },
  {
    id: "amethyst",
    name: "Tử la",
    kind: "vivid",
    ramps: [ramp("#1e0a3a", "#3c1670", "#6228a8", "#8c4cd4", "#b886ee", "#e6d0ff"), GOLD, TEAL],
  },
  {
    id: "ocean",
    name: "Hải lam",
    kind: "vivid",
    ramps: [
      ramp("#06204a", "#0c3c86", "#1660c0", "#2e8ae6", "#6cb8f6", "#c4e6ff"),
      ramp("#4a120c", "#8a2a1a", "#cc4c32", "#f27a5a", "#ffaa8e", "#ffe0d2"),
      IVORY,
    ],
  },
];

// ---------------------------------------------------------------------------------------------
// Reading a sprite

/** Below this chroma a colour is grey (outline, white, steel) and is kept. */
const NEUTRAL_CHROMA = 0.04;
const isKept = (lch: Lch) => lch.l < 0.2 || lch.c < NEUTRAL_CHROMA;

export type SpriteRegion = {
  hue: number;
  /** Share of the coloured pixels. */
  weight: number;
  /** 0 main, 1 second, 2 accent. */
  role: number;
  /** Lightness range of the region (5th..95th percentile). */
  low: number;
  high: number;
};
export type SpriteAnalysis = { regions: SpriteRegion[] };

/** The colour regions of a sprite frame (RGBA bytes), heaviest first, with their roles. */
export function analyzeSprite(data: Uint8ClampedArray | number[]): SpriteAnalysis {
  const BINS = 36,
    weight = new Float64Array(BINS),
    memo = new Map<number, Lch>(),
    pixels: Lch[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    let lch = memo.get(rgb);
    if (!lch) memo.set(rgb, (lch = rgbToLch(rgb)));
    if (isKept(lch)) continue;
    pixels.push(lch);
    weight[Math.floor(lch.h / 10) % BINS] += 1;
  }
  if (!pixels.length) return { regions: [] };
  // Peaks of the smoothed hue histogram are the regions.
  const smooth = Array.from({ length: BINS }, (_, i) => {
    let sum = 0;
    for (let k = -1; k <= 1; k++) sum += weight[(i + k + BINS) % BINS] * (k ? 1 : 2);
    return sum;
  });
  const peaks: number[] = [];
  for (let i = 0; i < BINS; i++) {
    const here = smooth[i];
    if (here <= 0) continue;
    let peak = true;
    for (let k = -2; k <= 2 && peak; k++)
      if (k && smooth[(i + k + BINS) % BINS] > here - (k < 0 ? 1e-9 : 0)) peak = false;
    if (peak) peaks.push(i * 10 + 5);
  }
  // Each coloured pixel joins its nearest peak; regions under 4% fold into their nearest big one.
  const join = (hues: number[], h: number) =>
    hues.reduce((best, hue, k) => (hueDistance(h, hue) < hueDistance(h, hues[best]) ? k : best), 0);
  const counts = peaks.map(() => 0);
  for (const p of pixels) counts[join(peaks, p.h)]++;
  const kept = peaks.filter((_, k) => counts[k] / pixels.length >= 0.04);
  const hues = kept.length ? kept : [peaks[counts.indexOf(Math.max(...counts))]];
  const members: number[][] = hues.map(() => []);
  for (const p of pixels) members[join(hues, p.h)].push(p.l);
  const regions = hues
    .map((hue, k) => {
      const ls = members[k].sort((a, b) => a - b),
        at = (q: number) => ls[Math.min(ls.length - 1, Math.floor(q * ls.length))] ?? 0.5;
      return { hue, weight: ls.length / pixels.length, role: 2, low: at(0.05), high: at(0.95) };
    })
    .sort((a, b) => b.weight - a.weight);
  // The largest region is the main colour; the next one far enough in hue is the second colour
  // (a near neighbour is just more of the main); everything else is accent.
  regions.forEach((region, k) => {
    if (k === 0) region.role = 0;
    else if (hueDistance(region.hue, regions[0].hue) < 30 && region.weight > 0.1) region.role = 0;
    else if (!regions.some((other) => other.role === 1) && region.weight >= 0.1) region.role = 1;
    else region.role = 2;
  });
  return { regions };
}

// ---------------------------------------------------------------------------------------------
// Recolouring

type Lab = [number, number, number];

function rgbToLab(rgb: number): Lab {
  const r = toLinear((rgb >>> 16) & 0xff),
    g = toLinear((rgb >>> 8) & 0xff),
    b = toLinear(rgb & 0xff),
    l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
    m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labToRgb([L, A, B]: Lab): number {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3,
    m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3,
    s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3,
    out = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map((v) => {
      const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055;
      return Math.round(Math.max(0, Math.min(1, c)) * 255);
    });
  return (out[0] << 16) | (out[1] << 8) | out[2];
}

const mixLab = (a: Lab, b: Lab, k: number): Lab => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

const rampLabs = new Map<Ramp, Lab[]>();
function rampLab(colors: Ramp, t: number): Lab {
  let labs = rampLabs.get(colors);
  if (!labs) rampLabs.set(colors, (labs = colors.map(rgbToLab)));
  const scaled = Math.max(0, Math.min(1, t)) * (labs.length - 1),
    low = Math.min(labs.length - 2, Math.floor(scaled));
  return mixLab(labs[low], labs[low + 1], scaled - low);
}

/**
 * How much of a pixel's lightness comes from the sprite itself rather than the ramp. A theme
 * changes colour, not value: the pet stays exactly as readable as the normal one (fur strokes,
 * face, muscles), on the dark battle grounds too, and a dark theme cannot sink it into one blob.
 */
const VALUE_KEPT = 0.72;

/** The ramp's colour at `t` carried at (mostly) the sprite's own lightness `lightness`. */
function themed(colors: Ramp, t: number, lightness: number): number {
  const [L, A, B] = rampLab(colors, t),
    target = VALUE_KEPT * lightness + (1 - VALUE_KEPT) * L,
    // A ramp colour lifted towards white or pressed towards black keeps a believable chroma.
    room = Math.min(
      1,
      (1 - Math.abs(target - 0.6) / 0.45) / Math.max(0.35, 1 - Math.abs(L - 0.6) / 0.45),
    );
  return labToRgb([target, A * Math.max(0.9, room), B * Math.max(0.9, room)]);
}

export type ShinyDesign = { theme: ShinyTheme; analysis: SpriteAnalysis };

function regionOf(lch: Lch, regions: readonly SpriteRegion[]): SpriteRegion {
  let region = regions[0];
  for (const candidate of regions)
    if (hueDistance(lch.h, candidate.hue) < hueDistance(lch.h, region.hue)) region = candidate;
  return region;
}

/**
 * A pixel's place on its ramp: mostly where it sits inside its own region's shading, partly its
 * absolute lightness, so a region drawn all light stays light and one drawn dark stays dark.
 */
function rampPosition(lch: Lch, region: SpriteRegion): number {
  const span = Math.max(0.12, region.high - region.low),
    inside = Math.max(0, Math.min(1, (lch.l - region.low) / span)),
    absolute = Math.max(0, Math.min(1, (lch.l - 0.25) / 0.7));
  return 0.1 + 0.82 * (0.6 * inside + 0.4 * absolute);
}

/** Metal: a reflective band (dark under a bright streak) laid over the plain shading. */
const metalCurve = (t: number) => t + 0.06 * Math.sin(t * Math.PI * 2.4 - 0.9);

/** What one RGB becomes under `design`, without the lighting pass (no neighbours known). */
export function designRgb(rgb: number, design: ShinyDesign): number {
  const lch = rgbToLch(rgb),
    regions = design.analysis.regions;
  if (isKept(lch) || !regions.length) return rgb;
  const region = regionOf(lch, regions);
  let t = rampPosition(lch, region);
  if (design.theme.metal && region.role === 0) t = metalCurve(t);
  return themed(design.theme.ramps[region.role], t, lch.l);
}

const OUTLINE = 1,
  NEUTRAL = 2,
  COLOURED = 3;

/**
 * Recolours a whole frame (RGBA bytes, in place) under `design`, with the lighting pass:
 * - a faint rim light along the silhouette's top and left edges and a faint shadow along its
 *   bottom and right ones, and a gentle gradient, so the body reads as lit from above-left
 *   without washing out the sprite's own shading;
 * - metal themes shade the main colour in reflective bands;
 * - outlines take the darkest stop of the colour they border (a coloured outline, not flat black),
 *   and whites and greys a faint wash of the main colour, so the whole sprite belongs to the theme.
 */
export function recolorPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  design: ShinyDesign,
): void {
  const regions = design.analysis.regions;
  if (!regions.length) return;
  const n = width * height,
    kind = new Uint8Array(n),
    role = new Int8Array(n).fill(-1),
    base = new Float32Array(n),
    lchs: (Lch | undefined)[] = new Array(n),
    memo = new Map<number, Lch>();
  let top = height,
    bottom = 0,
    left = width,
    right = 0;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128) continue;
    const rgb = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
    let lch = memo.get(rgb);
    if (!lch) memo.set(rgb, (lch = rgbToLch(rgb)));
    lchs[i] = lch;
    const y = Math.floor(i / width);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    left = Math.min(left, i % width);
    right = Math.max(right, i % width);
    if (lch.l < 0.2) kind[i] = OUTLINE;
    else if (lch.c < NEUTRAL_CHROMA) kind[i] = NEUTRAL;
    else {
      kind[i] = COLOURED;
      const region = regionOf(lch, regions);
      role[i] = region.role;
      base[i] = rampPosition(lch, region);
    }
  }
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : kind[y * width + x];
  // Open space one or two pixels away (past the outline) on that side: the silhouette's edge.
  const edge = (x: number, y: number, dx: number, dy: number) =>
    at(x + dx, y + dy) === 0 ||
    (at(x + dx, y + dy) === OUTLINE && at(x + 2 * dx, y + 2 * dy) === 0);
  const span = Math.max(1, bottom - top),
    across = Math.max(1, right - left),
    theme = design.theme,
    mainLabs = theme.ramps[0];
  const write = (i: number, rgb: number) => {
    data[i * 4] = (rgb >>> 16) & 0xff;
    data[i * 4 + 1] = (rgb >>> 8) & 0xff;
    data[i * 4 + 2] = rgb & 0xff;
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        k = kind[i],
        lch = lchs[i];
      if (!k || !lch) continue;
      if (k === COLOURED) {
        let t = base[i];
        if (theme.metal && role[i] === 0) t = metalCurve(t);
        // Light from above-left: brighter top, darker feet.
        const u = (x - left) / across,
          v = (y - top) / span;
        // Kept gentle: the sprite's own shading carries the form, a strong light washes it out.
        t += 0.05 * (0.5 - v) + 0.02 * (0.5 - u);
        // A faint rim on the silhouette's lit edges, a faint core shadow on the far ones.
        const lit = edge(x, y, 0, -1) || edge(x, y, -1, 0),
          shaded = edge(x, y, 0, 1) || edge(x, y, 1, 0);
        if (lit) t += 0.06;
        if (shaded && !lit) t -= 0.06;
        // Never past the second-brightest stop on the body, so highlights do not blow out.
        t = Math.min(t, 0.9);
        write(i, themed(theme.ramps[role[i]], t, lch.l));
      } else if (k === OUTLINE) {
        // The colour this outline pixel borders, if any (first coloured 4-neighbour).
        let near = -1;
        for (const [dx, dy] of [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ]) {
          const nx = x + dx,
            ny = y + dy;
          if (
            nx >= 0 &&
            ny >= 0 &&
            nx < width &&
            ny < height &&
            kind[ny * width + nx] === COLOURED
          ) {
            near = role[ny * width + nx];
            break;
          }
        }
        if (near < 0) continue;
        const own = rgbToLab((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]);
        write(i, labToRgb(mixLab(own, rampLab(theme.ramps[near], 0), 0.7)));
      } else {
        const own = rgbToLab((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]),
          wash = rampLab(mainLabs, Math.max(0, Math.min(1, (lch.l - 0.2) / 0.8)));
        write(i, labToRgb(mixLab(own, wash, lch.l > 0.9 ? 0.12 : 0.2)));
      }
    }
}

// ---------------------------------------------------------------------------------------------
// A pet's colour

/**
 * `SavedPet.shinyColor` of a shiny that was already in a save before the redesign (owner,
 * 2026-11-15): it keeps Java's palette (`PetShinyPalette.shinyRgb`, Hầu Vương's baked frames).
 */
export const LEGACY_SHINY_COLOR = -1;

/** How many shiny colours there are; a pet's `shinyColor` is an index into `SHINY_THEMES`. */
export const SHINY_COLOR_COUNT = SHINY_THEMES.length;

function hash(...values: number[]): number {
  let h = 0x9e3779b1;
  for (const v of values) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** A fresh random colour for a pet that has just become shiny. */
export function rollShinyColor(random: () => number = Math.random): number {
  return Math.min(SHINY_COLOR_COUNT - 1, Math.floor(random() * SHINY_COLOR_COUNT));
}

/**
 * Draws a pet's shiny colour the first time it is seen with a shiny nature (7..9), and keeps it for
 * good after that (a later nature change does not redraw it).
 */
export function giveShinyColor(
  pet: { nature?: number; shinyColor?: number },
  random: () => number = Math.random,
): void {
  const nature = pet.nature ?? 0;
  if (pet.shinyColor === undefined && nature >= 7 && nature <= 9)
    pet.shinyColor = rollShinyColor(random);
}

/**
 * The colour of a shiny that owns none (a wild or trainer pet in a fight, a pet in the wiki): fixed
 * by what it is, so the same wild pet keeps its colour from the fight into the bag when caught.
 */
export function defaultShinyColor(speciesOrVisual: number, nature: number): number {
  return hash(speciesOrVisual, nature) % SHINY_COLOR_COUNT;
}

/** The theme of a colour index (any integer, wrapped). */
export function shinyTheme(color: number): ShinyTheme {
  const index = ((Math.trunc(color) % SHINY_COLOR_COUNT) + SHINY_COLOR_COUNT) % SHINY_COLOR_COUNT;
  return SHINY_THEMES[index];
}
