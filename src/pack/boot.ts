import { TextLayout, type TextMetricsDocument } from "../rendering/text/TextLayout";
import {
  StoryDataRegistry,
  type StorySourceRegistryDocument,
} from "../game/story/StoryDataRegistry";
import { SourceRouteCatalog, type SourceRoutesDocument } from "../game/story/SourceRoutes";
import { PanelFontRenderer } from "../rendering/PanelFontRenderer";
import { decodeSourceFont } from "../rendering/font/SourceFont";
import { SourceFontRenderer } from "../rendering/font/SourceFontRenderer";
import { SourceUiLayout } from "../rendering/SourceUiLayout";
import type { Pack } from "./Pack";
export type BootAssets = {
  logo: HTMLImageElement;
  menuBackground: HTMLImageElement;
  menuParticles: HTMLImageElement;
  panelFont: PanelFontRenderer;
  /** The original game font (font.bin), used wherever the Java rebuild drew with a system font. */
  sourceFont: SourceFontRenderer;
  /** JavaSE line breaking, dialog pages and typing length (Tahoma 9 advances). */
  textLayout: TextLayout;
  battleLayout: SourceUiLayout;
  npcEnemyLayout: SourceUiLayout;
  dialogLayout: SourceUiLayout;
  layouts: Map<string, SourceUiLayout>;
  effects: Map<string, HTMLImageElement>;
  statusIcons: Map<string, HTMLImageElement>;
  /** `NguyenMocRoutePresentationPolicy.backgroundImage` strips by pack entry name (`backpic`). */
  backPics: Map<string, HTMLImageElement>;
  /** The Cầu Vồng skill effect atlases and sheets, by pack entry name (`skill-fx`). */
  skillFx: Map<string, HTMLImageElement>;
  sourceEvents: StoryDataRegistry;
  sourceRoutes: SourceRouteCatalog;
  cell(sprite: number, index: number): HTMLImageElement | undefined;
  effect(name: string): HTMLImageElement | undefined;
  statusIcon(name: string): HTMLImageElement | undefined;
};

// Everything the pre-world screens need, assembled from the pack manifest; the cell sets,
// layout names and effect names all come from pack.json rather than from code.
export async function loadBootAssets(pack: Pack): Promise<BootAssets> {
  const [
    logo,
    menuBackground,
    menuParticles,
    cellSprites,
    effectNames,
    statusIconNames,
    fontGlyphs,
    fontMetrics,
    sourceFontBytes,
    textMetrics,
  ] = await Promise.all([
    pack.image("brand.logo"),
    pack.image("brand.title-background"),
    pack.image("brand.title-particles"),
    Promise.all(pack.cellSprites().map((sprite) => pack.cellSet(sprite))),
    Promise.resolve(pack.names("effect")),
    Promise.resolve(pack.names("status-icon")),
    pack.image("font.panel-glyphs"),
    pack.json<ConstructorParameters<typeof PanelFontRenderer>[1]>("font.panel-metrics"),
    pack.bytes("font.source"),
    pack.json<TextMetricsDocument>("font.text-metrics"),
  ]);
  const cells = new Map<number, Map<number, HTMLImageElement>>();
  pack.cellSprites().forEach((sprite, index) => cells.set(sprite, cellSprites[index]));
  const effectImages = await pack.imagesFor(effectNames.map((name) => `effect.${name}`)),
    statusIconImages = await pack.imagesFor(statusIconNames.map((name) => `status-icon.${name}`)),
    effects = new Map(effectNames.map((name, index) => [name, effectImages[index]])),
    statusIcons = new Map(statusIconNames.map((name, index) => [name, statusIconImages[index]])),
    backPicNames = pack.names("backpic"),
    backPicImages = await pack.imagesFor(backPicNames.map((name) => `backpic.${name}`)),
    backPics = new Map(backPicNames.map((name, index) => [name, backPicImages[index]])),
    skillFxNames = pack
      .names("skill-fx")
      .filter((name) => name !== "animations" && name !== "signatures"),
    skillFxImages = await pack.imagesFor(skillFxNames.map((name) => `skill-fx.${name}`)),
    skillFx = new Map(skillFxNames.map((name, index) => [name, skillFxImages[index]])),
    layoutNames = pack.names("ui-layout"),
    layoutDocuments = await Promise.all(
      layoutNames.map((name) =>
        pack.json<ConstructorParameters<typeof SourceUiLayout>[0]>(`ui-layout.${name}`),
      ),
    ),
    layouts = new Map(
      layoutNames.map((name, index) => [name, new SourceUiLayout(layoutDocuments[index])]),
    ),
    [eventRegistry, cauVongRegistry, routes] = await Promise.all([
      pack.json<StorySourceRegistryDocument>("story.event-scenes"),
      pack.json<StorySourceRegistryDocument>("story.cau-vong-event-scenes"),
      pack.json<SourceRoutesDocument>("story.routes"),
    ]);
  return {
    logo,
    menuBackground,
    menuParticles,
    panelFont: new PanelFontRenderer(fontGlyphs, fontMetrics),
    sourceFont: new SourceFontRenderer(decodeSourceFont(sourceFontBytes)),
    textLayout: new TextLayout(textMetrics),
    battleLayout: layouts.get("battle")!,
    npcEnemyLayout: layouts.get("npcEnemy")!,
    dialogLayout: layouts.get("dialog")!,
    layouts,
    effects,
    statusIcons,
    backPics,
    skillFx,
    sourceEvents: StoryDataRegistry.combine(eventRegistry, cauVongRegistry),
    sourceRoutes: new SourceRouteCatalog(routes),
    cell: (sprite, index) => cells.get(sprite)?.get(index),
    effect: (name) => effects.get(name),
    statusIcon: (name) => statusIcons.get(name),
  };
}
