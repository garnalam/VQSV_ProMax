/**
 * Which script a scene's records are written in. Liệt Hỏa (`lh`, the default) and Cầu Vồng
 * (`cau-vong`, story/cau-vong-opcodes.json) share this container but not their opcode numbers:
 * the same number means different things, so a record is only read through its scene's dialect.
 */
export type StoryDialect = "lh" | "cau-vong";
export type StorySourceRecord = {
  opcode: number;
  total_arg_count: number;
  short_args: number[];
  string_args: Array<{ string_index: number; text: string }>;
  /** Cầu Vồng: byte offset in the group, the raw argument bytes, the untouched source text. */
  offset?: number;
  args_hex?: string;
  sourceText?: string;
};
export type StorySourceGroup = {
  group_index: number;
  scene_id: number;
  room_index: number;
  world_key: number;
  record_count: number;
  records: StorySourceRecord[];
  /** Cầu Vồng: whether the patched Java presents the group, and the chapter owners claiming it. */
  presentation?: { reviewed: boolean; owners: string[] };
  /** Cầu Vồng: parser warnings for bytes whose framing is not verified (kept opaque). */
  framingWarnings?: string[];
  bytes?: number;
  raw_hex?: string;
};
/** Cầu Vồng /4 table 1: a door tile and the door row it leads to. */
export type StorySourceDoor = {
  row: number;
  x: number;
  y: number;
  facing: number;
  fields: number[];
  target?: { scene: number; room: number; entry: number };
};
export type StorySourceActorRow = {
  kind: number;
  param_len: number;
  values: number[];
};
export type StorySourceRoom = {
  roomIndex: number;
  roomName: string;
  blockSize: number;
  roomStart: number;
  stringPool: string[];
  actors: StorySourceActorRow[];
  eventGroups: StorySourceGroup[];
  postActorStrings: string[];
  unknownAb: number;
  unknownSkip: number;
  /** Cầu Vồng: the /4 actor map (order, three actor groups, treasure and door tables). */
  sourceActors?: { order: number[]; groups: number[][][]; tables: number[][][] };
  names?: string[];
  doors?: StorySourceDoor[];
};
export type StorySourceScene = {
  format: string;
  sceneId: number | null;
  sourceFile: string;
  blockCount: number | null;
  blockSizes: number[];
  rooms: StorySourceRoom[];
  root?: unknown;
  signature?: string | null;
  dialect?: StoryDialect;
};
export type StorySourceRegistryDocument = {
  format: string;
  version: number;
  generatedFrom: string;
  sceneCount: number;
  scenes: StorySourceScene[];
};
export class StoryDataRegistry {
  private readonly byScene = new Map<number, StorySourceScene>();
  constructor(readonly document: StorySourceRegistryDocument) {
    for (const scene of document.scenes)
      if (scene.sceneId !== null) this.byScene.set(scene.sceneId, scene);
  }
  /**
   * One registry over several documents (Liệt Hỏa's event-scenes plus Cầu Vồng's). A scene id
   * declared twice is a data error, not something to resolve by order.
   */
  static combine(...documents: StorySourceRegistryDocument[]): StoryDataRegistry {
    const scenes: StorySourceScene[] = [],
      seen = new Set<number>();
    for (const document of documents)
      for (const scene of document.scenes) {
        if (scene.sceneId !== null) {
          if (seen.has(scene.sceneId)) throw new Error(`scene ${scene.sceneId} declared twice`);
          seen.add(scene.sceneId);
        }
        scenes.push(scene);
      }
    return new StoryDataRegistry({
      ...documents[0],
      sceneCount: scenes.length,
      scenes,
    });
  }
  dialect(sceneId: number): StoryDialect {
    return this.scene(sceneId)?.dialect ?? "lh";
  }
  scene(sceneId: number): StorySourceScene | undefined {
    return this.byScene.get(sceneId);
  }
  room(sceneId: number, roomIndex: number): StorySourceRoom | undefined {
    return this.scene(sceneId)?.rooms.find((room) => room.roomIndex === roomIndex);
  }
  group(sceneId: number, roomIndex: number, groupIndex: number): StorySourceGroup | undefined {
    return this.room(sceneId, roomIndex)?.eventGroups.find(
      (group) => group.group_index === groupIndex,
    );
  }
}
