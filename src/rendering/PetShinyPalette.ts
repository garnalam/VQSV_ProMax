/**
 * `vqsv.render.PetShinyPalette`: the runtime palette swap of every pet whose nature is 7, 8 or 9,
 * applied wherever `SpriteAnimator.setPaletteNature` draws one (a battle pet on either side).
 *
 * Every swap but Hỏa Diễm Hầu Vương's (3002, masked by position on its source sheets) reads only a
 * pixel's RGB, so it runs here per colour with Java's float arithmetic (`java.awt.Color`'s
 * `RGBtoHSB` / `HSBtoRGB` in `Math.fround` steps). The Bạch Long ramps come from
 * `public/pack/shiny/palette.json` (rebuild_game/tools/ExportWebShinyPalette.java), and
 * `shiny/sample.json` holds what Java produced for a spread of real pet colours, which the test
 * holds this port to. Hầu Vương's frames are baked whole (`shiny/n<nature>`).
 */

const f = Math.fround;

export type ShinyPaletteDocument = {
  natures: number[];
  /** The visuals with their own swap (120 Thố Di Lạc, 1036..1039 Bạch Long, 3001 Thiên Luân). */
  visualProfile: Record<string, string>;
  /** Visuals whose recoloured frames are baked whole (`n<nature>/sprites.json`). */
  framesBaked: number[];
  bachLongArmor: number[][];
  bachLongPale: number[][];
};

/** Where a whole-frame shiny bake (Hầu Vương) is seated among the sprites: base + nature·10000 + visual. */
export const SHINY_BAKED_BASE = 900000;
export function shinyBakedSpriteId(visual: number, nature: number): number {
  return SHINY_BAKED_BASE + nature * 10000 + visual;
}

export const FIRST_SHINY_NATURE = 7;
export const LAST_SHINY_NATURE = 9;

/** `PetShinyPalette.applies`. */
export function shinyApplies(nature: number | undefined): boolean {
  return nature !== undefined && nature >= FIRST_SHINY_NATURE && nature <= LAST_SHINY_NATURE;
}

/** `java.awt.Color.RGBtoHSB`. */
export function rgbToHsb(r: number, g: number, b: number): [number, number, number] {
  const cmax = Math.max(r, g, b),
    cmin = Math.min(r, g, b),
    brightness = f(cmax / 255),
    saturation = cmax !== 0 ? f((cmax - cmin) / cmax) : 0;
  let hue = 0;
  if (saturation !== 0) {
    const span = cmax - cmin,
      redc = f((cmax - r) / span),
      greenc = f((cmax - g) / span),
      bluec = f((cmax - b) / span);
    if (r === cmax) hue = f(bluec - greenc);
    else if (g === cmax) hue = f(f(2 + redc) - bluec);
    else hue = f(f(4 + greenc) - redc);
    hue = f(hue / 6);
    if (hue < 0) hue = f(hue + 1);
  }
  return [hue, saturation, brightness];
}

/** `java.awt.Color.HSBtoRGB`, without the alpha byte. */
export function hsbToRgb(hue: number, saturation: number, brightness: number): number {
  const byte = (v: number) => Math.trunc(f(f(v * 255) + 0.5));
  let r = 0,
    g = 0,
    b = 0;
  if (saturation === 0) r = g = b = byte(brightness);
  else {
    const h = f(f(hue - f(Math.floor(hue))) * 6),
      fr = f(h - f(Math.floor(h))),
      p = f(brightness * f(1 - saturation)),
      q = f(brightness * f(1 - f(saturation * fr))),
      t = f(brightness * f(1 - f(saturation * f(1 - fr))));
    switch (Math.trunc(h)) {
      case 0:
        [r, g, b] = [byte(brightness), byte(t), byte(p)];
        break;
      case 1:
        [r, g, b] = [byte(q), byte(brightness), byte(p)];
        break;
      case 2:
        [r, g, b] = [byte(p), byte(brightness), byte(t)];
        break;
      case 3:
        [r, g, b] = [byte(p), byte(q), byte(brightness)];
        break;
      case 4:
        [r, g, b] = [byte(t), byte(p), byte(brightness)];
        break;
      case 5:
        [r, g, b] = [byte(brightness), byte(p), byte(q)];
        break;
    }
  }
  return ((r << 16) | (g << 8) | b) & 0xffffff;
}

const F = {
  c045: f(0.045),
  c94: f(0.94),
  c20: f(0.2),
  c22: f(0.22),
  c48: f(0.48),
  c50: f(0.5),
  c72: f(0.72),
  c75: f(0.75),
  c25: f(0.25),
};

/** `recolored(argb, hue, saturation, value)`, RGB only. */
function recolored(hue: number, saturation: number, value: number): number {
  return hsbToRgb(f(hue), Math.max(0, Math.min(1, f(saturation))), Math.max(0, Math.min(1, value)));
}

/** `ramp(luminance, colors)`. */
function ramp(luminance: number, colors: number[]): number {
  const scaled = f(Math.max(0, Math.min(1, f(f(luminance - 40) / 215))) * (colors.length - 1)),
    low = Math.min(colors.length - 2, Math.trunc(scaled)),
    mix = f(scaled - low),
    a = colors[low],
    b = colors[low + 1],
    channel = (shift: number) =>
      Math.floor(f(f(((a >>> shift) & 0xff) * f(1 - mix)) + f(((b >>> shift) & 0xff) * mix)) + 0.5);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** `mappedHue(nature, sourceHue)`. */
function mappedHue(nature: number, sourceHue: number): number {
  const redFamily = sourceHue <= F.c045 || sourceHue >= F.c94,
    goldFamily = sourceHue > F.c045 && sourceHue < F.c20,
    greenFamily = sourceHue >= F.c22 && sourceHue <= F.c48;
  if (nature === 7) return goldFamily ? 0.115 : redFamily ? 0.985 : 0.965;
  if (nature === 8) return redFamily || greenFamily ? 0.4 : 0.115;
  if (redFamily || greenFamily) return 0.5;
  return goldFamily ? 0.92 : 0.79;
}

/**
 * What one RGB becomes for `nature` under `profile` ("default", "120", "1036", "3001"), or the
 * same RGB when the swap leaves it alone.
 */
export function shinyRgb(
  rgb: number,
  nature: number,
  profile: string,
  tables: Pick<ShinyPaletteDocument, "bachLongArmor" | "bachLongPale">,
): number {
  const red = (rgb >>> 16) & 0xff,
    green = (rgb >>> 8) & 0xff,
    blue = rgb & 0xff,
    max = Math.max(red, green, blue),
    min = Math.min(red, green, blue),
    luminance = Math.trunc((299 * red + 587 * green + 114 * blue) / 1000);
  // Outlines, white highlights and neutral details keep their colour (both families of swap).
  if (max < 72 || luminance < 48 || max - min < 18) return rgb;
  const [hue, saturation, value] = rgbToHsb(red, green, blue),
    index = nature - FIRST_SHINY_NATURE;
  switch (profile) {
    case "120": {
      const isRed = hue <= F.c045 || hue >= F.c94,
        warm = hue > F.c045 && hue < F.c20;
      if (!isRed && !warm) return rgb;
      const target = warm
        ? nature === 7
          ? 0.985
          : nature === 8
            ? 0.11
            : 0.79
        : nature === 7
          ? 0.025
          : nature === 8
            ? 0.42
            : 0.5;
      return recolored(
        target,
        Math.min(f(0.9), f(saturation * f(nature === 9 && warm ? 0.7 : 0.88))),
        value,
      );
    }
    case "3001": {
      const blueBody = hue >= F.c50 && hue <= F.c72,
        isRed = hue <= F.c045 || hue >= F.c94,
        warm = hue > F.c045 && hue < F.c20;
      if (!blueBody && !isRed && !warm) return rgb;
      const target = blueBody
        ? nature === 7
          ? 0.975
          : nature === 8
            ? 0.11
            : 0.79
        : warm
          ? nature === 7
            ? 0.985
            : nature === 8
              ? 0.11
              : 0.79
          : nature === 7
            ? 0.025
            : nature === 8
              ? 0.42
              : 0.5;
      return recolored(target, Math.min(f(0.9), f(saturation * f(blueBody ? 0.95 : 0.88))), value);
    }
    case "1036": {
      const blueBody = hue > F.c50 && hue < F.c75 && saturation > F.c20,
        pale = saturation < F.c25 && luminance > 125;
      if (!blueBody && !pale) return rgb;
      return ramp(luminance, (pale ? tables.bachLongPale : tables.bachLongArmor)[index]);
    }
    default: {
      const s = Math.max(f(0.55), Math.min(f(0.96), f(f(saturation * f(0.94)) + f(0.08))));
      return hsbToRgb(f(mappedHue(nature, hue)), s, value);
    }
  }
}

/** The palette profile of a visual (`PetShinyPalette.swap`'s dispatch). */
export function shinyProfile(document: ShinyPaletteDocument, visual: number): string {
  return document.visualProfile[String(visual)] ?? "default";
}

/**
 * `PetShinyPalette.image` for one frame image: a recoloured copy, cached per image and nature like
 * Java's `CACHE`. Undefined until the image has loaded.
 */
export class ShinyRecolorCache {
  private readonly cache = new WeakMap<CanvasImageSource, Map<string, HTMLCanvasElement>>();
  constructor(readonly document: ShinyPaletteDocument) {}

  image(
    source: HTMLImageElement,
    nature: number,
    visual: number,
  ): HTMLCanvasElement | HTMLImageElement {
    if (!shinyApplies(nature) || !source.complete || source.naturalWidth === 0) return source;
    const profile = shinyProfile(this.document, visual),
      key = `${profile}:${nature}`;
    let variants = this.cache.get(source);
    if (!variants) this.cache.set(source, (variants = new Map()));
    const cached = variants.get(key);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = source.naturalWidth;
    canvas.height = source.naturalHeight;
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(source, 0, 0);
    const pixels = g.getImageData(0, 0, canvas.width, canvas.height),
      data = pixels.data,
      memo = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      let to = memo.get(rgb);
      if (to === undefined) memo.set(rgb, (to = shinyRgb(rgb, nature, profile, this.document)));
      data[i] = (to >>> 16) & 0xff;
      data[i + 1] = (to >>> 8) & 0xff;
      data[i + 2] = to & 0xff;
    }
    g.putImageData(pixels, 0, 0);
    variants.set(key, canvas);
    return canvas;
  }
}
