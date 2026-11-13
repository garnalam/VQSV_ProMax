import type {
  SourceGroupLocator,
  SourceRouteOptions,
  SourceRoutePatch,
} from "./SourceOpcodeInterpreter";

export type SourceRouteModifierKey = "openingSolidBlack" | "fadeAfterFirstText" | "stopAtTenYears";
export type SourceRouteModifier = { key: SourceRouteModifierKey; value: boolean };
export type SourceRouteRecord = {
  id: string;
  groups: SourceGroupLocator[];
  startEvent: number;
  initialRoom?: { scene: number; room: number; x: number; y: number };
  startupDelay?: number;
  modifiers?: SourceRouteModifier[];
  /** Where the JavaSE runtime deliberately differs from the decoded source groups. */
  patches?: SourceRoutePatch[];
};
export type SourceRoutesDocument = {
  format: string;
  version: number;
  composedFrom?: string;
  routes: SourceRouteRecord[];
};
export const ROUTE_ID = {
  openingIntro: "opening-intro",
  preTenYears: "pre-ten-years",
  scene1Start: "scene1-start",
  scene1ElderReturn: "scene1-elder-return",
} as const;

export class SourceRouteCatalog {
  private readonly byId = new Map<string, SourceRouteRecord>();
  constructor(readonly document: SourceRoutesDocument) {
    for (const route of document.routes) this.byId.set(route.id, route);
  }
  /**
   * The JavaSE deviations a free-world group carries (`world:<scene>:<room>:<group>`): a world
   * group is compiled on its own, so only its patches are read here.
   */
  patchesFor(id: string): SourceRoutePatch[] | undefined {
    return this.byId.get(id)?.patches;
  }
  has(id: string): boolean {
    return this.byId.has(id);
  }
  require(id: string): SourceRouteOptions {
    const record = this.byId.get(id);
    if (!record || record.groups.length === 0)
      throw new Error(`Missing source story route ${id} in /pack/story/routes.json`);
    const options: SourceRouteOptions = {
      id: record.id,
      groups: record.groups,
      startEvent: record.startEvent,
      initialRoom: record.initialRoom,
      startupDelay: record.startupDelay,
      patches: record.patches,
    };
    for (const modifier of record.modifiers ?? []) options[modifier.key] = modifier.value;
    return options;
  }
}
