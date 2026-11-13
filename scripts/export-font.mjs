// Copy the original game font into the pack. The runtime decodes font.bin itself
// (src/rendering/font/SourceFont.ts), so there is no rasterising or Java step.
import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sourcePackRoot } from "./source-pack.mjs";

const from = resolve(sourcePackRoot(), "modules", "root_misc", "original", "font.bin"),
  to = resolve(process.cwd(), "public", "pack", "font", "font.bin");
await mkdir(resolve(to, ".."), { recursive: true });
await copyFile(from, to);
console.log(`font.bin -> ${to}`);
