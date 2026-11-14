import type { StoryDataRegistry, StorySourceRecord } from "./StoryDataRegistry";

export type TextKind = "full" | "dialog" | "box" | "openbox" | "tasktip";
/** The db.mid group an item event draws from: 4 consumables, 3 equipment/materials, 5 specials. */
export type ItemTable = 3 | 4 | 5;
export type RuntimeStoryEvent =
  | {
      type: "text";
      text: string;
      wait: boolean;
      kind: TextKind;
      speaker?: string;
      /**
       * `TextBox.dialog`'s `dialogMode`: 0 (the default) draws the speaker tab, -1 draws no tab at all
       * (`TextBoxRenderer.renderDialogFrame` only draws it for 0 and 1).
       */
      mode?: number;
      /**
       * `TextBox.withRainbowPortrait(index)`: a Cầu Vồng source face beside the box (-1 or absent: none).
       */
      portrait?: number;
      effect?: string;
      clearEffectOnConfirm?: boolean;
      box?: { x: number; y: number; width: number; height: number };
    }
  | { type: "delay"; ticks: number }
  | { type: "effect"; name: string; ticks: number }
  | { type: "active"; ids: number[]; dirs: number[] }
  | { type: "hide"; ids: number[] }
  | { type: "move"; ids: number[]; dx: number[]; dy: number[]; tx: number[]; ty: number[] }
  | { type: "path"; ids: number[]; xs: number[][]; ys: number[][] }
  | { type: "camera"; x: number; y: number; speed: number }
  | { type: "cameraActor"; actor: number; speed: number }
  | { type: "action"; ids: number[]; modes: number[]; dirs: number[] }
  /** op24 `startShake(mode, 2, repeats)`: the view jolts −5/+10/−5 px per repeat (x for mode 0). */
  | { type: "shake"; mode: number; repeats: number }
  /** op60: the actors play `modes` once (`ActorCycle`, ≤ 90 ticks) and keep them — a door opening. */
  | { type: "actorCycle"; ids: number[]; modes: number[] }
  | { type: "timed"; ids: number[]; dirs: number[]; speeds: number[]; durations: number[] }
  | { type: "actorEffect"; actor: number; state: number }
  | {
      type: "load";
      scene: number;
      room: number;
      x: number;
      y: number;
      updateWorld: boolean;
      direction?: number;
    }
  | { type: "place"; x: number; y: number }
  /** op58 `[actor, x, y, trigger]` (`LaserReset.resetActor`): a block back on its reset tile. */
  | { type: "placeActor"; actor: number; x: number; y: number }
  | { type: "item"; mode: number; itemId: number; quantity: number; table?: ItemTable }
  /** op31 `[mode, kind, amount]`: mode 0 adds, 1 removes; kind 0 money, 1 badges. */
  | { type: "currency"; mode: number; kind: number; amount: number }
  /** op53: grant one source progression badge by id. */
  | { type: "badge"; badgeId: number }
  /** op39: restore every owned Pet's HP and skill PP. */
  | { type: "refreshPets" }
  /** op66: mark one of JavaSE's seven source feature rows complete. */
  | { type: "featureUnlock"; feature: number }
  /** op20: add/remove one invisible source quest item (`game.e.D`). */
  | { type: "sourceFlag"; mode: number; flag: number }
  /** op43/op49: offer a branch task and follow the selected source record. */
  | { type: "branchChoice"; task: number; options: string[]; next: number[] }
  /** op44: the dispatch gate already proved the objective; mark the branch task complete. */
  | { type: "completeBranch"; task: number }
  /** `VqsvSceneScriptSupport.taskNoticeOp45`'s first half: the main task the tip announces. */
  | { type: "taskProgress"; flag: number }
  | { type: "routeBoundary"; scene: number; room: number; x: number; y: number }
  | { type: "battle"; context: BattleContext }
  /**
   * op47. `branchTargets` are the source's raw record numbers (1-based) per result; `next` holds
   * their program indices, the record each result goes on from (`consumeOp47`'s cursor).
   */
  | { type: "consumeBattle"; branchTargets: number[]; next?: (number | undefined)[] }
  | { type: "counter" }
  | { type: "retire" }
  | { type: "markComplete"; ref: { scene: number; room: number; group: number } }
  | { type: "markRetired"; ref: { scene: number; room: number; group: number } }
  | { type: "savePrompt" }
  | { type: "groupEnd" }
  /** Stop following an actor; the camera stays where it is (`Scene.stopCameraFollow`). */
  | { type: "cameraStop" }
  /** Keep the camera on an actor from now on (`Scene.followActor`); takes effect this tick. */
  | { type: "followActor"; actor: number }
  /** Centre the camera on an actor's current position at once (`setCameraCenter(a.x, a.y)`). */
  | { type: "centerOnActor"; actor: number }
  /**
   * Several commands in ONE tick, as a single Java `Event` that does them all before returning:
   * every child but the last must finish at once; the last one may wait.
   */
  | { type: "atomic"; events: RuntimeStoryEvent[] }
  /**
   * op38: keep the free world alive and wait until the player activates one of `ids`; `next` is the
   * program index of the record each id's branch target names, in the same order.
   */
  | { type: "waitForActor"; ids: number[]; next: number[] }
  /**
   * op35: the two-option box. `next` holds the program index of each option's branch target, in the
   * same order as `options`; the box waits until the player confirms one.
   */
  | { type: "choice"; options: string[]; next: number[] }
  /** op41: continue at another record of the same group. */
  | { type: "jump"; next: number }
  /**
   * op84 `[actor, 0, counter]`: the speaker's line with its two `%s` filled from a live count —
   * counter 0 is Jones' collection (found, still missing), 1 the Lục Hành Điểu race (runs, time).
   */
  | { type: "countText"; speaker: string; template: string; counter: number }
  /**
   * op83 `[yes, no]`, Jones' exchange (`NiemThoC2Runtime.JonesExchange`): buy an ordinary
   * egg for the yes branch's op31 money (`pay`), or leave via the no branch (`leave`).
   * `next` holds the raw record numbers until compiled.
   */
  | {
      type: "eggExchange";
      next: [number, number];
      cost: number;
      pay: number;
      leave: number;
    }
  /**
   * op88 `[target, _]` (`NiemThoC1Runtime.Task9Challenge`): with six pets in the party and the Pet
   * bank full, the group goes on at `next` (its "Sủng vật đã đầy" line) instead of the reward.
   */
  | { type: "petsFull"; next: number }
  /**
   * A step of a room runtime's own script (never compiled from records): the world runs `hook`
   * each tick until it reports done, or a branch whose program index is `next[branch]`.
   */
  | { type: "worldHook"; hook: string; next?: number[] }
  /** op36/op87 mode 0: give the player a source-defined pet; op87 may choose the roster slot. */
  | {
      type: "grantPet";
      speciesId: number;
      level: number;
      quality: number;
      nature: number;
      skillIds: [number, number];
      slot?: number;
    };
export type GrantedPet = Omit<Extract<RuntimeStoryEvent, { type: "grantPet" }>, "type">;
export type BattleContext = {
  actorId: number;
  encounter: [number, number, number];
  flags: [number, number];
  mode: [number, number];
  branchTargets: number[];
};
export type SourceGroupLocator = {
  sceneId: number;
  roomIndex: number;
  groupIndex: number;
  entry?: { x: number; y: number };
};
export type SourceRouteOptions = {
  id: string;
  groups: readonly SourceGroupLocator[];
  startEvent: number;
  initialRoom?: { scene: number; room: number; x: number; y: number };
  startupDelay?: number;
  openingSolidBlack?: boolean;
  fadeAfterFirstText?: boolean;
  stopAtTenYears?: boolean;
  patches?: readonly SourceRoutePatch[];
};
/**
 * A JavaSE deviation from the decoded source data, kept as data next to the route. `at` and
 * `expect` are positions/contents in the program compiled from the source groups; `expect` must
 * match (as a subset) or compiling fails, so a data change can never silently shift a patch.
 */
export type SourceRoutePatch = {
  at: number;
  expect: Record<string, unknown>[];
  why: string;
} & (
  | { with: RuntimeStoryEvent[] }
  /**
   * Run the matched events as one atomic command, after merging `merge[i]` into event i and
   * adding `append` at the end of the block.
   */
  | { atomic: true; merge?: Record<string, unknown>[]; append?: RuntimeStoryEvent[] }
);
export type SourceProgram = {
  id: string;
  groups: readonly SourceGroupLocator[];
  events: RuntimeStoryEvent[];
  startEvent: number;
  initialRoom?: { scene: number; room: number; x: number; y: number };
  startupDelay: number;
  stopAtTenYears: boolean;
};
type CompileState = {
  transition?: { x: number; y: number; updateWorld: boolean; direction?: number };
  firstText: boolean;
  battleContext?: BattleContext;
  /**
   * The group's op16 actor: the one the hero activated, which is `worldEventActor` when the group
   * names no op67 owner, so its op37/op32 battle is fought against that actor.
   */
  eventActor?: number;
  /** op43 owns the branch id; op49's short args describe the requested item, not the task. */
  branchTask?: number;
  /** op44's task: it is completed where the group completes (op14), not where it starts. */
  completesBranch?: number;
};
const ints = (value: string | undefined) => value?.split(",").filter(Boolean).map(Number) ?? [];
const matrices = (value: string | undefined) => value?.split("#").map(ints) ?? [];
const text = (record: StorySourceRecord, index: number) => record.string_args[index]?.text ?? "";

/**
 * The actor a group is started on (`worldEventActor`): its op16, or the NPC an op43/op44 branch
 * head names in its fifth short, after any op15/op86 gates. Undefined for rect and chain groups.
 */
export function groupActivationActor(
  records: readonly { opcode: number; short_args: readonly number[] }[],
): number | undefined {
  for (const record of records) {
    if (record.opcode === 15 || record.opcode === 86) continue;
    if (record.opcode === 16) return record.short_args[0];
    if (record.opcode === 43 || record.opcode === 44) return record.short_args[4];
    return undefined;
  }
  return undefined;
}

const newBattleContext = (actorId: number): BattleContext => ({
  actorId,
  encounter: [0, 0, 0],
  flags: [0, 0],
  mode: [0, 0],
  branchTargets: [],
});

export class SourceOpcodeInterpreter {
  constructor(private readonly registry: StoryDataRegistry) {}
  compile(options: SourceRouteOptions): SourceProgram {
    const events: RuntimeStoryEvent[] = [],
      state: CompileState = { firstText: true },
      // Where each source record of each group starts in `events`, so a branch target that names a
      // record of its own group can be turned into a program index once the whole route is built.
      recordStarts = new Map<string, number>(),
      branches: {
        at: number;
        groupAt: number;
        event: Extract<
          RuntimeStoryEvent,
          | { type: "waitForActor" }
          | { type: "choice" }
          | { type: "branchChoice" }
          | { type: "jump" }
          | { type: "consumeBattle" }
          | { type: "eggExchange" }
          | { type: "petsFull" }
        >;
      }[] = [];
    for (let groupAt = 0; groupAt < options.groups.length; groupAt++) {
      state.branchTask = undefined;
      const locator = options.groups[groupAt],
        group = this.registry.group(locator.sceneId, locator.roomIndex, locator.groupIndex);
      if (!group)
        throw new Error(
          `Missing source group ${locator.sceneId}:${locator.roomIndex}:${locator.groupIndex}`,
        );
      state.eventActor = groupActivationActor(group.records);
      for (let recordAt = 0; recordAt < group.records.length; recordAt++) {
        recordStarts.set(`${groupAt}:${recordAt}`, events.length);
        const at = events.length;
        events.push(...this.decode(group.records[recordAt], state, options));
        for (let i = at; i < events.length; i++) {
          const event = events[i];
          if (
            event.type === "waitForActor" ||
            event.type === "choice" ||
            event.type === "branchChoice" ||
            event.type === "jump" ||
            event.type === "consumeBattle" ||
            event.type === "eggExchange" ||
            event.type === "petsFull"
          )
            branches.push({ at: i, groupAt, event });
        }
      }
      if (groupAt < options.groups.length - 1 && events.at(-1)?.type === "groupEnd") {
        events.pop();
        const next = options.groups[groupAt + 1];
        if (next.entry)
          events.push({
            type: "routeBoundary",
            scene: next.sceneId,
            room: next.roomIndex,
            x: next.entry.x,
            y: next.entry.y,
          });
      }
    }
    for (const branch of branches) {
      const at = (target: number) => {
        const resolved = recordStarts.get(`${branch.groupAt}:${target - 1}`);
        if (resolved === undefined)
          throw new Error(
            `${options.id}: branch target ${target} is not a record of group ${branch.groupAt}`,
          );
        return resolved;
      };
      if (branch.event.type === "consumeBattle") {
        // Each result's raw record (1-based; 0 reads on). An ordinary fight names the record right
        // after op47; a capture fight's result 0 names its "missed" lines, and Hỏa Phượng Hoàng's
        // win names the op36 reward the plain reading would skip.
        const groupAt = branch.groupAt;
        events[branch.at] = {
          ...branch.event,
          next: branch.event.branchTargets.map((target) =>
            target > 0 ? recordStarts.get(`${groupAt}:${target - 1}`) : undefined,
          ),
        };
      } else if (branch.event.type === "jump")
        events[branch.at] = { type: "jump", next: at(branch.event.next) };
      else if (branch.event.type === "petsFull")
        events[branch.at] = { type: "petsFull", next: at(branch.event.next) };
      else if (branch.event.type === "eggExchange") {
        const [yes, no] = branch.event.next,
          pay = at(yes),
          payment = events[pay],
          done = events.findIndex((event, i) => i >= pay && event.type === "groupEnd");
        if (payment?.type !== "currency" || done < 0)
          throw new Error(`${options.id}: op83's yes branch is not a payment ending in op14`);
        events[branch.at] = {
          type: "eggExchange",
          next: [yes, no],
          cost: payment.amount,
          pay,
          leave: at(no + 1),
        };
      } else if (branch.event.type === "waitForActor")
        events[branch.at] = {
          type: "waitForActor",
          ids: branch.event.ids,
          next: branch.event.next.map(at),
        };
      else if (branch.event.type === "choice")
        events[branch.at] = {
          type: "choice",
          options: branch.event.options,
          next: branch.event.next.map(at),
        };
      else
        events[branch.at] = {
          type: "branchChoice",
          task: branch.event.task,
          options: branch.event.options,
          next: branch.event.next.map(at),
        };
    }
    applyPatches(events, options);
    return {
      id: options.id,
      groups: options.groups,
      events,
      startEvent: options.startEvent,
      initialRoom: options.initialRoom,
      startupDelay: options.startupDelay ?? 0,
      stopAtTenYears: options.stopAtTenYears ?? false,
    };
  }
  private decode(
    record: StorySourceRecord,
    state: CompileState,
    options: SourceRouteOptions,
  ): RuntimeStoryEvent[] {
    const s = record.short_args,
      opcode = record.opcode;
    if (opcode === 0 || opcode === 15) return [];
    if (opcode === 67) {
      state.battleContext = newBattleContext(s[0] ?? -1);
      return [];
    }
    // No op67: the battle belongs to the actor the group was activated on (`worldEventActor`).
    if ((opcode === 37 || opcode === 52 || opcode === 32) && !state.battleContext)
      if (state.eventActor !== undefined) state.battleContext = newBattleContext(state.eventActor);
    if (opcode === 37) {
      if (state.battleContext) state.battleContext.encounter = [s[0] ?? 0, s[1] ?? 0, s[2] ?? 0];
      return [];
    }
    if (opcode === 52) {
      if (state.battleContext) state.battleContext.flags = [s[0] ?? 0, s[1] ?? 0];
      return [];
    }
    if (opcode === 32) {
      if (state.battleContext) {
        state.battleContext.mode = [s[0] ?? 0, s[1] ?? 0];
        return [{ type: "battle", context: state.battleContext }];
      }
      return [];
    }
    if (opcode === 1) {
      const first = state.firstText,
        event: RuntimeStoryEvent = {
          type: "text",
          text: text(record, 0),
          wait: true,
          kind: "full",
        };
      if (first && options.openingSolidBlack) {
        event.effect = "solid-black";
        event.clearEffectOnConfirm = true;
      }
      state.firstText = false;
      return first && options.fadeAfterFirstText
        ? [event, { type: "effect", name: "fade-in", ticks: 16 }]
        : [event];
    }
    if (opcode === 48) {
      const event: RuntimeStoryEvent = {
        type: "text",
        text: text(record, 0),
        wait: s[5] === 1,
        kind: "box",
        box: { x: s[1] ?? 10, y: s[2] ?? 260, width: s[3] ?? 220, height: s[4] ?? 50 },
      };
      return s[5] === 1 ? [{ type: "counter" }, event] : [event];
    }
    if (opcode === 51)
      return [
        {
          type: "text",
          text: text(record, 0),
          wait: false,
          kind: "box",
          box: { x: s[1] ?? 10, y: s[2] ?? 260, width: s[3] ?? 220, height: s[4] ?? 50 },
        },
      ];
    if (opcode === 4)
      return [
        {
          type: "text",
          text: text(record, 1),
          speaker: text(record, 0),
          wait: true,
          kind: "dialog",
        },
      ];
    // A negative count is the source's player sentinel. Its following strings still contain
    // ordinary numeric fields, so parsing string 0 as an actor list accidentally targeted actor 0/1
    // and left present-day Neil visible through the room-3 promise memory.
    if (opcode === 2)
      return [
        {
          type: "active",
          ids: s[0] === -1 ? [-1] : ints(text(record, 0)),
          dirs: s[0] === -1 ? [Number(text(record, 1) ?? 0)] : ints(text(record, 1)),
        },
      ];
    if (opcode === 3) return [{ type: "hide", ids: s[0] === -1 ? [-1] : ints(text(record, 0)) }];
    // op56 commits capture presentation. Mode 1 hides the listed room actor(s); this is how the
    // rare Pet at 3:5:g0 disappears only after a successful capture branch.
    if (opcode === 56 && s[0] === 1 && options.id.startsWith("world:"))
      return [{ type: "hide", ids: ints(text(record, 0)) }];
    // Mode 0 (`op56ActorVisibility`) shows them again, each facing its listed direction, standing.
    if (opcode === 56 && s[0] === 0 && options.id.startsWith("world:"))
      return [{ type: "active", ids: ints(text(record, 0)), dirs: ints(text(record, 1)) }];
    if (opcode === 5) return [{ type: "actorEffect", actor: s[0] === 0 ? -1 : s[1], state: s[2] }];
    if (opcode === 24) {
      if (s[1] !== 2) return [];
      return [{ type: "shake", mode: s[0] ?? 0, repeats: Math.max(1, s[2] ?? 1) }];
    }
    if (opcode === 60)
      return [{ type: "actorCycle", ids: ints(text(record, 0)), modes: ints(text(record, 1)) }];
    if (opcode === 7)
      return [
        {
          type: "action",
          ids: ints(text(record, 0)),
          modes: ints(text(record, 1)),
          dirs: ints(text(record, 2)),
        },
      ];
    // op10 with the player sentinel (-1): strings are [0, direction, speed, ticks] and the walker is
    // the hero (`op10PlayerTimedAction`), not actor 0.
    if (opcode === 10 && s[0] === -1)
      return [
        {
          type: "timed",
          ids: [-1],
          dirs: ints(text(record, 1)),
          speeds: ints(text(record, 2)),
          durations: ints(text(record, 3)),
        },
      ];
    if (opcode === 10)
      return [
        {
          type: "timed",
          ids: ints(text(record, 0)),
          dirs: ints(text(record, 1)),
          speeds: ints(text(record, 2)),
          durations: ints(text(record, 3)),
        },
      ];
    if (opcode === 11)
      return s[3] >= 0
        ? [{ type: "cameraActor", actor: s[3], speed: s[7] ?? 0 }]
        : [{ type: "camera", x: s[4], y: s[5], speed: s[7] ?? 0 }];
    if (opcode === 12) return [{ type: "delay", ticks: s[0] }];
    // op57 is the contact trigger itself (`WorldEventCatalog`); op58 performs the reset.
    if (opcode === 57) return [];
    if (opcode === 58) return [{ type: "placeActor", actor: s[0], x: s[1], y: s[2] }];
    if (opcode === 17)
      return [{ type: "item", mode: s[0] ?? 0, itemId: s[1] ?? 0, quantity: s[2] ?? 0 }];
    // op18: equipment/materials (db.mid group 3), same [mode, id, quantity] record as op17.
    if (opcode === 18)
      return [{ type: "item", mode: s[0] ?? 0, itemId: s[1] ?? 0, quantity: s[2] ?? 0, table: 3 }];
    // op31, `VqsvSourceOps.op31CurrencyReward(mode, kind, amount)`: a task's money or badges.
    if (opcode === 31)
      return [{ type: "currency", mode: s[0] ?? 0, kind: s[1] ?? 0, amount: s[2] ?? 0 }];
    // op39 calls PetSourceAdapter.reviveFull for every roster member.
    if (opcode === 39) return [{ type: "refreshPets" }];
    // `a.a.f = arg; a.a.b(0, 3)`: select one of seven source feature rows and mark it complete.
    if (opcode === 66) return [{ type: "featureUnlock", feature: s[0] ?? -1 }];
    // op53 [badgeId, mode] grants the regional badge; mode is zero in the Liệt Hỏa source.
    if (opcode === 53) return [{ type: "badge", badgeId: s[0] ?? -1 }];
    // op19: a special item (group 5) is only ever granted: [id, quantity].
    if (opcode === 19)
      return [{ type: "item", mode: 0, itemId: s[0] ?? 0, quantity: s[1] ?? 0, table: 5 }];
    // op20 owns invisible quest items such as Công cụ, Thư mật and Bao vây vật tư.
    if (opcode === 20) return [{ type: "sourceFlag", mode: s[0] ?? 0, flag: s[1] ?? -1 }];
    // op36 mode 0 is the ordinary story reward (`VqsvSourceOps.op36PetReward`). Unlike op87 it
    // carries no destination slot: Java appends it to the party, or sends it to the Pet bank when
    // the six party slots are occupied.
    if (opcode === 36) {
      if ((s[0] ?? 1) !== 0) return [];
      return [
        {
          type: "grantPet",
          speciesId: s[1] ?? 0,
          level: s[2] ?? 1,
          quality: s[3] ?? 0,
          nature: s[4] ?? 0,
          skillIds: [s[5] ?? 0, s[6] ?? 0],
        },
      ];
    }
    // op87 mode 0 is `game.j.a(slot, species, level, quality, nature, skillA, skillB)`: the source
    // gives an actor a pet outright. Any other mode is unknown in JavaSE too, so it stays dropped.
    if (opcode === 87) {
      if ((s[0] ?? 1) !== 0) return [];
      return [
        {
          type: "grantPet",
          speciesId: s[1] ?? 0,
          level: s[2] ?? 1,
          quality: s[3] ?? 0,
          nature: s[4] ?? 0,
          skillIds: [s[5] ?? 0, s[6] ?? 0],
          slot: s[7] ?? 0,
        },
      ];
    }
    // The two branch commands carry their targets as record numbers of their own group; `compile`
    // turns them into program indices once every record has been placed.
    if (opcode === 38)
      return [{ type: "waitForActor", ids: ints(text(record, 0)), next: ints(text(record, 1)) }];
    if (opcode === 35)
      return [
        {
          type: "choice",
          options: (text(record, 0) ? text(record, 0).split(",") : []).map((option) =>
            option.trim(),
          ),
          next: ints(text(record, 1)),
        },
      ];
    // op43 declares the offer, actor trigger and task id. The actual accept/reject UI is op49;
    // its own short args are objective/item metadata and must not be mistaken for the task id.
    if (opcode === 43) {
      state.branchTask = s[0] ?? -1;
      return [];
    }
    // op44 is only dispatched while the named branch is active and its objective is ready. The
    // branch closes with the group's op14 — a branch that ends on op42 instead (a wrong quiz answer,
    // a declined or lost fight: `Task23Quiz`, `Task22Completion`) leaves it open to try again.
    if (opcode === 44) {
      state.completesBranch = s[0] ?? -1;
      return [];
    }
    // Source branch-task option: strings 2/3 hold record targets/options; op43 owns the task id.
    if (opcode === 49) {
      const task = state.branchTask ?? -1;
      state.branchTask = undefined;
      return [
        {
          type: "branchChoice",
          task,
          options: (text(record, 3) ? text(record, 3).split(",") : []).map((option) =>
            option.trim(),
          ),
          next: ints(text(record, 2)),
        },
      ];
    }
    if (opcode === 84)
      return [
        {
          type: "countText",
          speaker: text(record, 0),
          template: text(record, 1),
          counter: s[2] ?? 0,
        },
      ];
    if (opcode === 83)
      return [
        {
          type: "eggExchange",
          next: [s[0] ?? 0, s[1] ?? 0],
          cost: 0,
          pay: 0,
          leave: 0,
        },
      ];
    if (opcode === 88) return [{ type: "petsFull", next: s[0] ?? 0 }];
    // op34 `[image, x, y, _, _]`, `ScreenEffect.startStoryBackdrop("ikon_<image + 1>", x, y, 10)`:
    // a black screen with the picture (top-left at x, y) fading in by 10 alpha a tick.
    if (opcode === 34)
      return [
        {
          type: "effect",
          name: `backdrop:ikon-${(s[0] ?? 0) + 1}:${s[1] ?? 0}:${s[2] ?? 0}`,
          ticks: 26,
        },
      ];
    // Records JavaSE reads elsewhere or drops on purpose, listed so none is skipped by accident:
    // - op13, op16, op59, op61, op78, op79: triggers and gates, read by `WorldEventCatalog`;
    // - op54: a fight's roster, which the battle descriptor (`sequentialOp54Descriptor`) carries;
    // - op25: `game.c.f`, a flag JavaSE saves but nothing reads (`op25SetGameFlag`);
    // - op33: a map/sprite redraw the renderer already does every frame;
    // - op65: the legacy SMS activation, already satisfied on PC (`BichThuyHubRuntime` 9:0:g5);
    // - op82: `game.h.t()/u()`, committing actor positions the save snapshot already holds;
    // - op80, op85: the Lục Hành Điểu race (3:7), run by its own runtime (`NguyenMocC4Race`).
    if ([13, 16, 25, 33, 54, 59, 61, 65, 78, 79, 80, 82, 85].includes(opcode)) return [];
    if (opcode === 41) {
      if (!s.length) throw new Error(`op41 without a record target`);
      return [{ type: "jump", next: s[0] }];
    }
    if (opcode === 40)
      return [
        {
          type: "text",
          text: text(record, 0),
          wait: true,
          kind: "openbox",
          box: { x: 47, y: 154, width: 146, height: 26 },
        },
      ];
    // `taskNoticeOp45` writes the task flag first, then opens the tip and waits in the same tick.
    if (opcode === 45)
      return [
        {
          type: "atomic",
          events: [
            { type: "taskProgress", flag: s[0] ?? 0 },
            {
              type: "text",
              text: text(record, 0),
              wait: true,
              kind: "tasktip",
              box: { x: 16, y: 154, width: 208, height: 26 },
            },
          ],
        },
      ];
    if (opcode === 9) return this.effect(s);
    if (opcode === 29)
      return [
        {
          type: "move",
          ids: ints(text(record, 0)),
          dx: ints(text(record, 1)),
          dy: ints(text(record, 2)),
          tx: ints(text(record, 3)),
          ty: ints(text(record, 4)),
        },
      ];
    if (opcode === 8) return [{ type: "place", x: s[0] ?? 0, y: s[1] ?? 0 }];
    if (opcode === 30)
      return [
        {
          type: "path",
          ids: ints(text(record, 2)),
          xs: matrices(text(record, 0)),
          ys: matrices(text(record, 1)),
        },
      ];
    if (opcode === 21) {
      state.transition = { x: s[3], y: s[4], updateWorld: false };
      return [];
    }
    if (opcode === 22) {
      state.transition = { x: s[2], y: s[3], updateWorld: true, direction: s[1] };
      return [];
    }
    if (opcode === 6) {
      const transition = state.transition ?? { x: 0, y: 0, updateWorld: true };
      state.transition = undefined;
      const result: RuntimeStoryEvent[] = [
        {
          type: "load",
          scene: s[0],
          room: s[1],
          x: transition.x,
          y: transition.y,
          updateWorld: transition.updateWorld,
        },
      ];
      if (transition.updateWorld) result.push({ type: "effect", name: "fade-in", ticks: 16 });
      return result;
    }
    // op76 is the free-world counterpart of op6. The preceding op22 owns the arrival position;
    // op76 carries the destination scene/room and commits the world transition atomically.
    if (opcode === 76) {
      const transition = state.transition ?? { x: 0, y: 0, updateWorld: true };
      state.transition = undefined;
      return [
        {
          type: "load",
          scene: s[0] ?? 0,
          room: s[1] ?? 0,
          x: transition.x,
          y: transition.y,
          updateWorld: true,
          direction: transition.direction,
        },
        { type: "effect", name: "fade-in", ticks: 16 },
      ];
    }
    if (opcode === 47 && state.battleContext) {
      state.battleContext.branchTargets = [s[0] ?? -1, s[1] ?? -1, s[2] ?? -1];
      const branchTargets = [...state.battleContext.branchTargets];
      state.battleContext = undefined;
      return [{ type: "consumeBattle", branchTargets, next: [] }];
    }
    if (opcode === 23) {
      const [scene, room, group] = s;
      return [
        { type: "markComplete", ref: { scene: scene ?? 0, room: room ?? 0, group: group ?? 0 } },
      ];
    }
    if (opcode === 42) return [{ type: "retire" }];
    // op72 anchors the listed temporary effects to actors (including -1, the player).
    if (opcode === 72) {
      const ids = ints(text(record, 0)),
        states = ints(text(record, 1));
      return ids.map((actor, index) => ({
        type: "actorEffect" as const,
        actor,
        state: states[index] ?? states.at(-1) ?? 0,
      }));
    }
    // op77 retires another event group, unlike op42 which retires the current group.
    if (opcode === 77) {
      const [scene, room, group] = s;
      return [
        { type: "markRetired", ref: { scene: scene ?? 0, room: room ?? 0, group: group ?? 0 } },
      ];
    }
    if (opcode === 46) return [{ type: "savePrompt" }];
    if (opcode === 14)
      return state.completesBranch !== undefined
        ? [{ type: "completeBranch", task: state.completesBranch }, { type: "groupEnd" }]
        : [{ type: "groupEnd" }];
    return [];
  }
  private effect(s: number[]): RuntimeStoryEvent[] {
    const id = s[0];
    if (id === 1) return [{ type: "effect", name: "fade-in", ticks: 16 }];
    if (id === 2) return [{ type: "effect", name: "fade-out", ticks: 16 }];
    if (id === 10) return [{ type: "effect", name: "flash", ticks: 2 }];
    if (id === 12 || id === 13) return [{ type: "effect", name: `bars-${id}`, ticks: 2 }];
    if (id === 15) return [{ type: "effect", name: "icon", ticks: 26 }];
    if (id === 16) {
      if (s[1] === 0) return [{ type: "effect", name: `star-particles-${s[2]}`, ticks: 0 }];
      if (s[1] === 1) return [{ type: "effect", name: `fire-particles-${s[2]}`, ticks: 0 }];
      return [{ type: "effect", name: "stop-particles", ticks: 0 }];
    }
    if (id === 17)
      return [
        {
          type: "effect",
          name: s[2] === 0 ? "circle-open" : "circle-close",
          ticks: s[2] === 0 ? 19 : 16,
        },
      ];
    return [{ type: "effect", name: `source-effect-${id}`, ticks: 0 }];
  }
}

function subsetMatches(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return actual === expected;
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, i) => subsetMatches(actual[i], value))
    );
  if (actual === null || typeof actual !== "object") return false;
  return Object.entries(expected).every(([key, value]) =>
    subsetMatches((actual as Record<string, unknown>)[key], value),
  );
}

/** Apply route patches from the last position backwards so earlier `at` values stay valid. */
function applyPatches(events: RuntimeStoryEvent[], options: SourceRouteOptions): void {
  const patches = [...(options.patches ?? [])].sort((a, b) => b.at - a.at);
  for (const patch of patches) {
    const current = events.slice(patch.at, patch.at + patch.expect.length);
    if (
      current.length !== patch.expect.length ||
      !patch.expect.every((expected, i) => subsetMatches(current[i], expected))
    )
      throw new Error(
        `Route ${options.id}: patch at ${patch.at} (${patch.why}) no longer matches the source program`,
      );
    const replacement: RuntimeStoryEvent[] =
      "with" in patch
        ? patch.with
        : [
            {
              type: "atomic",
              events: [
                ...current.map(
                  (event, i) => ({ ...event, ...patch.merge?.[i] }) as RuntimeStoryEvent,
                ),
                ...(patch.append ?? []),
              ],
            },
          ];
    events.splice(patch.at, patch.expect.length, ...replacement);
  }
}
