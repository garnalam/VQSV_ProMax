/**
 * `vqsv.render.UnifiedItemIconRenderer`: a unified Item's own PNG (the Cầu Vồng icons) on the old
 * item surfaces. The image is cropped to its opaque pixels once, then scaled with nearest-neighbour
 * to fit `w`×`h` and centred, the way JavaSE draws it in the bag, the shop and the charm list.
 */
const cropped = new WeakMap<HTMLImageElement, HTMLCanvasElement>();

function crop(image: HTMLImageElement): HTMLCanvasElement {
  const cached = cropped.get(image);
  if (cached) return cached;
  const full = document.createElement("canvas");
  full.width = image.naturalWidth;
  full.height = image.naturalHeight;
  const g = full.getContext("2d")!;
  g.drawImage(image, 0, 0);
  const { data, width, height } = g.getImageData(0, 0, full.width, full.height);
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  let result = full;
  if (maxX >= minX && maxY >= minY) {
    result = document.createElement("canvas");
    result.width = maxX - minX + 1;
    result.height = maxY - minY + 1;
    result.getContext("2d")!.drawImage(full, -minX, -minY);
  }
  cropped.set(image, result);
  return result;
}

/** Returns false when the image has not loaded, so the caller can draw the sprite-258 cell. */
export function drawUnifiedItemIcon(
  g: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  if (!image || !image.complete || image.naturalWidth === 0) return false;
  const source = crop(image),
    scale = Math.min(width / Math.max(1, source.width), height / Math.max(1, source.height)),
    drawWidth = Math.max(1, Math.round(source.width * scale)),
    drawHeight = Math.max(1, Math.round(source.height * scale)),
    smoothing = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = false;
  g.drawImage(
    source,
    x + Math.trunc((width - drawWidth) / 2),
    y + Math.trunc((height - drawHeight) / 2),
    drawWidth,
    drawHeight,
  );
  g.imageSmoothingEnabled = smoothing;
  return true;
}
