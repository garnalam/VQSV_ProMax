import type { BootProgress } from "./BootProgress";
export type PackProducer = {
  kind: "java-bake" | "java-tool" | "ts-exporter" | "copy" | "hand-authored" | "mixed";
  what: string;
  command?: string;
  guard?: string;
  note?: string;
};
export type PackEntry = {
  name: string;
  file: string;
  kind?: "image" | "json" | "audio" | "binary";
  from?: string;
  provenance?: string;
  producer?: PackProducer;
};
export type PackCellRange = { start: number; count: number };
export type PackCellSet = { sprite: number; available: PackCellRange; used: PackCellRange };
export type PackShape = { name: string; path: string; producer?: PackProducer };
export type PackDomain = {
  id: string;
  kind: "image" | "json" | "audio" | "root";
  resolution: "entries" | "template" | "cells" | "root";
  producer: PackProducer;
  entries?: PackEntry[];
  template?: string;
  names?: string[];
  sets?: PackCellSet[];
  root?: string;
  indexes?: { name: string; file: string }[];
  shapes?: PackShape[];
};
export type PackManifest = {
  schema: string;
  baseUrl: string;
  description?: string;
  preload: { introSprites: number[] };
  domains: PackDomain[];
};

export const PACK_SCHEMA = "vqsv-webnative-pack-v1";
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  AUDIO_EXTENSIONS = [".wav", ".mp3", ".ogg", ".m4a"];

// Keys are "<domain>.<name>", "<domain>.<sprite>.<index>" for cell sets and
// "<domain>.<pack-relative-path>" for root domains such as the world bake.
export class Pack {
  private readonly domains = new Map<string, PackDomain>();
  private readonly urls = new Map<string, string>();
  private readonly images = new Map<string, HTMLImageElement>();
  private readonly imageLoads = new Map<string, Promise<HTMLImageElement>>();
  private readonly jsonDocuments = new Map<string, unknown>();
  private readonly audioElements = new Map<string, HTMLAudioElement>();
  private progress: BootProgress | null = null;
  private constructor(readonly manifest: PackManifest) {
    for (const domain of manifest.domains) {
      if (this.domains.has(domain.id)) throw new Error(`pack domain declared twice: ${domain.id}`);
      this.domains.set(domain.id, domain);
    }
  }
  static async load(progress?: BootProgress): Promise<Pack> {
    const url = "/pack/pack.json";
    progress?.book(url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`pack manifest http ${response.status} ${url}`);
    const manifest = (await response.json()) as PackManifest;
    if (manifest.schema !== PACK_SCHEMA)
      throw new Error(`pack manifest schema ${manifest.schema} is not ${PACK_SCHEMA}`);
    const pack = new Pack(manifest);
    pack.progress = progress ?? null;
    progress?.complete(url);
    return pack;
  }
  /**
   * Counts every later fetch in `progress`. The boot screen calls this before it asks for any
   * resource; `stopTracking` is its counterpart once the world takes the canvas.
   */
  track(progress: BootProgress): void {
    this.progress = progress;
  }
  stopTracking(): void {
    this.progress = null;
  }
  domain(id: string): PackDomain {
    const domain = this.domains.get(id);
    if (!domain) throw new Error(`pack has no domain ${id}`);
    return domain;
  }
  domainOf(key: string): PackDomain {
    const dot = key.indexOf(".");
    if (dot <= 0 || dot === key.length - 1)
      throw new Error(`pack key "${key}" must be "<domain>.<name>"`);
    return this.domain(key.slice(0, dot));
  }
  url(key: string): string {
    const cached = this.urls.get(key);
    if (cached) return cached;
    const dot = key.indexOf("."),
      domain = this.domainOf(key),
      rest = key.slice(dot + 1),
      file = this.resolve(domain, rest);
    if (domain.root && !file.startsWith(`${domain.root}/`))
      throw new Error(`pack file ${file} escapes domain root ${domain.root}`);
    const url = `${this.manifest.baseUrl}/${file}`;
    this.urls.set(key, url);
    return url;
  }
  private resolve(domain: PackDomain, rest: string): string {
    switch (domain.resolution) {
      case "entries": {
        const entry = domain.entries?.find((candidate) => candidate.name === rest);
        if (!entry) throw new Error(`pack entry ${domain.id}.${rest} is not declared`);
        return entry.file;
      }
      case "template": {
        if (!domain.names?.includes(rest))
          throw new Error(`pack template name ${domain.id}.${rest} is not declared`);
        return domain.template!.replace("{name}", rest);
      }
      case "cells": {
        const [spriteText, indexText] = rest.split(".");
        if (spriteText === undefined || indexText === undefined || rest.split(".").length !== 2)
          throw new Error(`pack cell key ${domain.id}.${rest} must be "<sprite>.<index>"`);
        const sprite = Number(spriteText),
          index = Number(indexText),
          set = domain.sets?.find((candidate) => candidate.sprite === sprite);
        if (!Number.isInteger(sprite) || !Number.isInteger(index))
          throw new Error(`pack cell key ${domain.id}.${rest} is not numeric`);
        if (!set) throw new Error(`pack cell set ${domain.id}.${sprite} is not declared`);
        if (index < set.available.start || index >= set.available.start + set.available.count)
          throw new Error(
            `pack cell ${domain.id}.${sprite}.${index} is outside ${set.available.start}..${
              set.available.start + set.available.count - 1
            }`,
          );
        return domain.template!.replace("{sprite}", spriteText).replace("{index}", indexText);
      }
      case "root":
        return this.resolveRootRelative(domain, rest);
    }
  }
  private resolveRootRelative(domain: PackDomain, rest: string): string {
    const index = (domain.indexes ?? []).find((candidate) => candidate.name === rest);
    if (index) return index.file;
    if (rest.startsWith("/") || rest.split("/").some((part) => part === ".." || part === ""))
      throw new Error(`pack path ${domain.id}.${rest} is not pack-relative`);
    const shapes = domain.shapes ?? [];
    if (!shapes.some((shape) => shapePattern(shape.path).test(rest)))
      throw new Error(`pack path ${domain.id}.${rest} matches no declared shape`);
    return `${domain.root}/${rest}`;
  }
  async json<T>(key: string): Promise<T> {
    const cached = this.jsonDocuments.get(key);
    if (cached) return cached as T;
    const url = this.url(key);
    if (!url.endsWith(".json")) throw new Error(`pack key ${key} is not a json resource`);
    this.progress?.book(url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`pack http ${response.status} ${url}`);
    const document: unknown = await response.json();
    this.jsonDocuments.set(key, document);
    this.progress?.complete(url);
    return document as T;
  }
  /** Raw bytes of a binary entry (for example the source font, decoded in TypeScript). */
  async bytes(key: string): Promise<Uint8Array> {
    const url = this.url(key);
    if (!url.endsWith(".bin")) throw new Error(`pack key ${key} is not a binary resource`);
    this.progress?.book(url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`pack http ${response.status} ${url}`);
    this.progress?.complete(url);
    return new Uint8Array(await response.arrayBuffer());
  }
  imageElement(key: string): HTMLImageElement {
    const cached = this.images.get(key);
    if (cached) return cached;
    const url = this.url(key);
    if (!IMAGE_EXTENSIONS.some((extension) => url.endsWith(extension)))
      throw new Error(`pack key ${key} is not an image resource`);
    const element = new Image();
    element.src = url;
    this.images.set(key, element);
    return element;
  }
  image(key: string): Promise<HTMLImageElement> {
    const pending = this.imageLoads.get(key);
    if (pending) return pending;
    const url = this.url(key);
    const element = this.imageElement(key);
    this.progress?.book(url);
    if (element.complete) {
      this.progress?.complete(url);
      return Promise.resolve(element);
    }
    // One promise per image: an element has a single onload slot, so two concurrent waits used to
    // leave the first one hanging forever when the second replaced its handler.
    const loading = new Promise<HTMLImageElement>((resolve, reject) => {
      element.onload = () => {
        this.progress?.complete(url);
        resolve(element);
      };
      element.onerror = () => {
        this.imageLoads.delete(key);
        reject(new Error(`pack image failed ${url}`));
      };
    });
    this.imageLoads.set(key, loading);
    return loading;
  }
  imagesFor(keys: string[]): Promise<HTMLImageElement[]> {
    return Promise.all(keys.map((key) => this.image(key)));
  }
  audioElement(key: string): HTMLAudioElement {
    const cached = this.audioElements.get(key);
    if (cached) return cached;
    const url = this.url(key);
    if (!AUDIO_EXTENSIONS.some((extension) => url.endsWith(extension)))
      throw new Error(`pack key ${key} is not an audio resource`);
    const element = new Audio(url);
    this.audioElements.set(key, element);
    return element;
  }
  /** The encoded bytes of an audio entry, for Web Audio to decode (gapless loops, crossfades). */
  async audioBytes(key: string): Promise<ArrayBuffer> {
    const url = this.url(key);
    if (!AUDIO_EXTENSIONS.some((extension) => url.endsWith(extension)))
      throw new Error(`pack key ${key} is not an audio resource`);
    this.progress?.book(url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`pack http ${response.status} ${url}`);
    const bytes = await response.arrayBuffer();
    this.progress?.complete(url);
    return bytes;
  }
  cellSprites(): number[] {
    return (this.domain("ui-cell").sets ?? []).map((set) => set.sprite);
  }
  async cellSet(sprite: number): Promise<Map<number, HTMLImageElement>> {
    const set = (this.domain("ui-cell").sets ?? []).find(
      (candidate) => candidate.sprite === sprite,
    );
    if (!set) throw new Error(`pack cell set ${sprite} is not declared`);
    const keys = Array.from(
      { length: set.used.count },
      (_, offset) => `ui-cell.${sprite}.${set.used.start + offset}`,
    );
    const loaded = await this.imagesFor(keys);
    return new Map(loaded.map((image, index) => [set.used.start + index, image]));
  }
  names(domainId: string): string[] {
    const domain = this.domain(domainId);
    if (domain.resolution === "entries") return (domain.entries ?? []).map((entry) => entry.name);
    if (domain.resolution === "template") return [...(domain.names ?? [])];
    throw new Error(`pack domain ${domainId} has no declared name list`);
  }
  entry(domainId: string, name: string): PackEntry {
    const entry = (this.domain(domainId).entries ?? []).find(
      (candidate) => candidate.name === name,
    );
    if (!entry) throw new Error(`pack entry ${domainId}.${name} is not declared`);
    return entry;
  }
  worldKey(relativePath: string): string {
    return `world.${relativePath}`;
  }
  introSpriteIds(): number[] {
    return this.manifest.preload.introSprites;
  }
}

function shapePattern(declared: string): RegExp {
  const source = declared
    .split(/\{[^}]+\}/)
    .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]+");
  return new RegExp(`^${source}$`);
}
