/**
 * Test kit: play Liệt Hỏa the way the landscape game does — APK actors and event spots applied —
 * and get around on foot. The hero path-finds with the world's own step rules (terrain + actors),
 * walks through doors with held keys, walks into a group's rect or talks to its actor, and every
 * event, fight and panel on the way is played as `StoryPlaythrough.playGroup` plays them. Nothing
 * is teleported, so a spot the hero cannot reach, a door that does not open or a story beat that
 * does not start fails the test where a player would be stuck. Story tests import it; the game
 * never does.
 */
import { GameplayHost, type GameplaySources } from "./GameplayHost";
import type { GameAssets } from "../story/GameAssets";
import type { StoryDataRegistry } from "../story/StoryDataRegistry";
import type { GameSave } from "../../persistence/save/GameSave";
import { MemorySaveStore } from "../../persistence/save/SaveStore";
import { SaveRepository } from "../../persistence/SaveRepository";
import { SaveService } from "../../persistence/SaveService";
import {
  DIRECTION_DOWN,
  DIRECTION_LEFT,
  DIRECTION_RIGHT,
  DIRECTION_UP,
  stepWithTerrain,
  terrainAtWorld,
} from "../world/MapCollision";
import { ownedObstacle, ROCK_BEHAVIOR } from "../world/ActorCollision";
import { sourceDoors, doorOverlaps, transitionArrivalForTarget } from "../world/WorldTransition";
import { worldEventTriggers, type WorldEventTrigger } from "../world/WorldEventCatalog";
import { playerIntersectsSourceRect } from "../world/WorldInteractionEngine";
import { safeRoomArrival } from "../world/RoomArrivalSafety";
import { doubleBattleCommands, type PlayOptions } from "./StoryPlaythrough";
import type { InputCommand } from "../../core/input/GameCommand";

type Internals = {
  actorBlocksMove(x: number, y: number, direction: number, speed: number): boolean;
  playerFaces(actor: unknown): boolean;
  currentMap(): Parameters<typeof stepWithTerrain>[0];
  movementTerrain: (terrain: number) => number;
  startPlatformRide(direction: number): boolean;
  platformRide: { actorId: number; direction: number } | null;
  vortex: unknown;
  iceDirection: number | null;
  hasHaiAuFlight(): boolean;
  clearedObstacles: Set<number>;
  obstacleCut: unknown;
  haiAuFlightStep(direction: number): { x: number; y: number; direction: number; moved: boolean };
};

const DIRS = [DIRECTION_DOWN, DIRECTION_RIGHT, DIRECTION_UP, DIRECTION_LEFT] as const;
const HOLD: Record<number, InputCommand> = {
  [DIRECTION_DOWN]: "holdDown",
  [DIRECTION_RIGHT]: "holdRight",
  [DIRECTION_UP]: "holdUp",
  [DIRECTION_LEFT]: "holdLeft",
};

export class WalkStuck extends Error {}

export type WalkLog = {
  lines: string[];
  battles: number;
  /** Every group that started on the way, as "s:r:g". */
  groups: string[];
  rooms: string[];
  /** Every platform ride: "id dir (from) → (to)". */
  rides: string[];
};

/** A goal on the BFS: a spot, or a step from a spot (its direction pressed there). */
type Goal = (
  x: number,
  y: number,
  direction: number,
  moved: boolean,
  fromX: number,
  fromY: number,
) => boolean;

export function apkWalker(sources: GameplaySources, assets: GameAssets, registry: StoryDataRegistry) {
  let cutting = false;
  function open(save: GameSave) {
    const repository = new SaveRepository(new MemorySaveStore()),
      saves = new SaveService(repository),
      host = new GameplayHost(sources, saves, { onExit: () => {} }, { kind: "resume", save }),
      log: WalkLog = { lines: [], battles: 0, groups: [], rooms: [], rides: [] };
    const world = () => host.world!;
    const where = () => `${world().sceneId}:${world().roomIndex}`;

    /** Play whatever is running (events, fights, panels) until the hero is free to walk again. */
    function settle(options: PlayOptions = {}, budget = 30000): void {
      let lastChoice: unknown = null,
        choiceCount = 0,
        idle = 0;
      for (let i = 0; i < budget; i++) {
        const w = world();
        const group = w.activeEventGroup;
        if (group) {
          const key = `${group.scene}:${group.room}:${group.group}`;
          if (log.groups.at(-1) !== key) log.groups.push(key);
        }
        if (log.rooms.at(-1) !== where() && !host.mapLoadingActive) log.rooms.push(where());
        if (host.mapLoadingActive) {
          host.step([]);
          idle = 0;
          continue;
        }
        if (w.doubleBattle) {
          log.battles++;
          host.step(doubleBattleCommands(w.doubleBattle, !!options.lose));
          idle = 0;
          continue;
        }
        if (w.battle) {
          log.battles++;
          const battle = w.battle,
            foe = battle.core?.activeUnit("enemy"),
            mine = battle.core?.activeUnit("player");
          if (options.lose) {
            if (mine?.alive()) mine.setHp(1);
            if (foe?.alive()) foe.setHp(foe.maxHp());
          } else if (
            options.catchFoe &&
            battle.interactiveStage === "fight" &&
            foe?.alive() &&
            !battle.complete
          )
            (battle as unknown as { submitToCore(c: object): void }).submitToCore({
              kind: "catch",
              itemId: 0,
            });
          else {
            if (foe?.alive()) foe.setHp(battle.interactiveStage === "fight" ? 0 : 1);
            if (mine?.alive()) mine.setHp(mine.maxHp());
          }
          const view = battle as unknown as { ui: { selectedIndex: number } };
          if (
            battle.interactiveStage === "skillList" &&
            mine &&
            (mine.skillPp[view.ui.selectedIndex] ?? 0) <= 0 &&
            mine.skillPp.some((pp) => pp > 0)
          ) {
            host.step(["down"]);
            continue;
          }
          host.step(["confirm"]);
          idle = 0;
          continue;
        }
        if (host.panel.badgeAwardOpen || host.panel.taskOptionOpen) {
          host.step([host.panel.taskOptionOpen ? (options.answer ?? "confirm") : "confirm"]);
          idle = 0;
          continue;
        }
        if (host.panel.visible && !w.eventVisible) {
          // A shop or menu someone's line opened: leave it as a player would.
          host.step(["back"]);
          idle = 0;
          continue;
        }
        const event = w.eventScene;
        if (event?.choice && event.choice !== lastChoice) {
          lastChoice = event.choice;
          const picked = options.choices?.[choiceCount++] ?? 0;
          for (let k = 0; k < picked; k++) event.moveChoice(1);
          host.step(["confirm"]);
          idle = 0;
          continue;
        }
        if (event?.textReady && event.currentText && log.lines.at(-1) !== event.currentText)
          log.lines.push(event.currentText);
        const busy =
          w.eventVisible ||
          w.activeEventGroup !== null ||
          w.phase === "event" ||
          w.battleEntryVisible ||
          host.panel.visible;
        if (!busy) {
          // A few quiet ticks in a row: chained links and room loads get their chance first.
          if (++idle > 30) return;
          host.step([]);
          continue;
        }
        idle = 0;
        host.step(event?.textReady || !w.eventVisible ? ["confirm"] : []);
      }
      throw new WalkStuck(
        `${where()}: still busy after ${budget} ticks (group ${JSON.stringify(world().activeEventGroup)}, phase ${world().phase}, last line ${JSON.stringify(log.lines.at(-1))})`,
      );
    }

    /** BFS over the hero's own steps from where he stands; returns the keys to hold. */
    let planned: string[] = [];
    function plan(goal: Goal, limit = 60000): number[] | null {
      const w = world(),
        inner = w as unknown as Internals,
        map = inner.currentMap(),
        speed = w.playerMoveSpeed,
        badge = w.flags.terrainBadgeGatedOpen(),
        ice = w.sceneId === 10 && w.roomIndex === 0,
        // Hải âu (`haiAuFlightStep`): over anything inside the map's bounds.
        flying = inner.hasHaiAuFlight(),
        flyStep = (fx: number, fy: number, direction: number) => {
          const p = w.player,
            saved = [p.x, p.y] as const;
          [p.x, p.y] = [fx, fy];
          try {
            return inner.haiAuFlightStep(direction);
          } finally {
            [p.x, p.y] = saved;
          }
        },
        start = `${w.player.x},${w.player.y}`,
        prev = new Map<string, [string, number] | null>([[start, null]]),
        queue: [number, number][] = [[w.player.x, w.player.y]],
        // A door out of the room (not a vortex back into it) ends the walk there: a route only
        // steps onto one when that is its goal.
        exits = sourceDoors(registry, w.sceneId, w.roomIndex).filter(
          (d) => !(d.behavior === 4 && d.target.scene === w.sceneId && d.target.room === w.roomIndex),
        ),
        // `game.h` behavior 4: a vortex into its own room drops the hero on its partner.
        vortices = sourceDoors(registry, w.sceneId, w.roomIndex)
          .filter((d) => d.behavior === 4 && d.target.scene === w.sceneId && d.target.room === w.roomIndex)
          .map((d) => {
            const to = sourceDoors(registry, w.sceneId, w.roomIndex).find((t) => t.actorId === d.target.actor);
            if (!to) return undefined;
            // `tickVortex`: the 16 px snap, then `repairRoomPosition` steps him off a wall.
            const at = { x: to.x - (to.x % 16), y: to.y - (to.y % 16) },
              fixed = safeRoomArrival(
                map,
                at,
                speed,
                inner.movementTerrain,
                badge,
                false,
                true,
                (ax, ay, dir, sp) => inner.actorBlocksMove(ax, ay, dir, sp),
              );
            return { door: d, ...(fixed ? { x: fixed.x, y: fixed.y } : at) };
          })
          .filter((v) => !!v);
      const path = (key: string, last?: number) => {
        const dirs: number[] = last === undefined ? [] : [last],
          keys: string[] = [key];
        for (let at = prev.get(key); at; at = prev.get(at[0])) {
          dirs.push(at[1]);
          keys.push(at[0]);
        }
        // The spot each key is pressed from, for the debug trace.
        planned = keys.reverse();
        return dirs.reverse();
      };
      if (goal(w.player.x, w.player.y, w.player.direction, false, w.player.x, w.player.y)) return [];
      for (let head = 0; head < queue.length && head < limit; head++) {
        const [x, y] = queue[head],
          key = `${x},${y}`;
        for (const direction of DIRS) {
          const blocked = !flying && inner.actorBlocksMove(x, y, direction, speed),
            step = flying
              ? flyStep(x, y, direction)
              : blocked
              ? { x, y, moved: false }
              : stepWithTerrain(map, x, y, direction, badge, speed, inner.movementTerrain);
          // Pressing a key where the hero cannot go still turns him: a goal may be that turn.
          if (goal(step.x, step.y, direction, step.moved, x, y)) return path(key, direction);
          if (!step.moved) continue;
          // `XhtC3Runtime.tickIceWorld` (10:0): a step onto ice carries the hero on, 8 px a tick,
          // while 16 px ahead is open; one last 4 px step ends it. A goal passed over counts.
          if (ice && terrainAtWorld(map, step.x, step.y) === 3) {
            // The slide keeps the facing the step left him with (an edge slide turns him).
            const along = (step as { direction?: number }).direction ?? direction,
              dx = along === DIRECTION_RIGHT ? 1 : along === DIRECTION_LEFT ? -1 : 0,
              dy = along === DIRECTION_DOWN ? 1 : along === DIRECTION_UP ? -1 : 0;
            let sx = step.x,
              sy = step.y,
              hit = false;
            for (let guard = 0; guard < 200; guard++) {
              const ahead = terrainAtWorld(map, sx + dx * 16, sy + dy * 16),
                carry = terrainAtWorld(map, sx, sy) === 3 && ahead !== 1 && (ahead !== 2 || badge);
              sx += dx * (carry ? 8 : 4);
              sy += dy * (carry ? 8 : 4);
              if (goal(sx, sy, direction, true, x, y)) hit = true;
              if (!carry) break;
            }
            if (hit) return path(key, direction);
            const next = `${sx},${sy}`;
            if (prev.has(next)) continue;
            prev.set(next, [key, direction]);
            queue.push([sx, sy]);
            continue;
          }
          // The arrival latch: a vortex only spins once the hero has stepped off it.
          const spin = vortices.find((v) => doorOverlaps(step, v.door) && !doorOverlaps({ x, y }, v.door)),
            to = spin ? { x: spin.x, y: spin.y } : step,
            next = `${to.x},${to.y}`;
          if (!spin && exits.some((d) => doorOverlaps(to, d) && !doorOverlaps({ x, y }, d))) continue;
          if (prev.has(next)) continue;
          prev.set(next, [key, direction]);
          queue.push([to.x, to.y]);
        }
      }
      return null;
    }

    /** Whether pressing `direction` at (x, y) boards a platform (the world's own check, undone). */
    function boards(x: number, y: number, direction: number): number | null {
      const w = world(),
        inner = w as unknown as Internals,
        p = w.player,
        saved = [p.x, p.y, p.direction, p.state, p.animationTick] as const,
        actors = [...w.actors.values()].map((a) => [a, a.direction, a.state, a.animationTick] as const);
      p.x = x;
      p.y = y;
      try {
        if (!inner.startPlatformRide(direction)) return null;
        return inner.platformRide?.actorId ?? null;
      } finally {
        inner.platformRide = null;
        [p.x, p.y, p.direction, p.state, p.animationTick] = saved;
        for (const [a, d, st, t] of actors) [a.direction, a.state, a.animationTick] = [d, st, t];
      }
    }

    /** Ride the platform just boarded until it lands, then let the room settle. */
    function ride(options: PlayOptions): void {
      const inner = world() as unknown as Internals;
      // A wild fight can start on the landing step: it is fought, then the landing finishes.
      for (let i = 0; i < 4000 && inner.platformRide; i++) {
        const w = world();
        if (w.battle || w.doubleBattle || w.battleEntryVisible || w.eventVisible) settle(options);
        else host.step([]);
      }
      settle(options);
    }

    /** Walk with held keys until `goal` holds; events met on the way are played, then re-planned. */
    function walk(
      goal: Goal,
      label: string,
      options: PlayOptions = {},
      /** Done already (the beat this walk was for has played): stop walking. */
      stop: () => boolean = () => false,
    ): void {
      const startRoom = where(),
        rides = new Map<string, number>();
      let rideCount = 0;
      let last = '',
        boarding = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        settle(options);
        // An event or a door on the way took him elsewhere: the caller decides what next.
        if (where() !== startRoom || stop()) return;
        let route = plan(goal);
        // Out of reach on foot and the wings (Hải âu) are owned: mount them from the ride menu.
        const inner = world() as unknown as Internals & {
          rideUnlocked(i: number): boolean;
          selectRide(i: number): string;
        };
        if (!route && !inner.hasHaiAuFlight() && inner.rideUnlocked(2) && inner.selectRide(2) === "ready") {
          log.rides.push(`mounted Hải âu at (${world().player.x},${world().player.y})`);
          route = plan(goal);
        }
        if (!route && !cutting) {
          // A rock (Đại Địa Chương) or tree (Mộc Quỳ Chương) in the way: face one he has the badge
          // for, press 5 and let it fall, then look again.
          const w = world(),
            badges = w.flags.badges,
            obstacles = [...w.actors.entries()]
              .filter(([id, a]) => id >= 0 && !inner.clearedObstacles.has(id) && ownedObstacle(w.sceneId, w.roomIndex, a))
              .filter(([, a]) => (a.variant === ROCK_BEHAVIOR ? badges.canBreakRocks() : badges.canClearTrees()))
              .map(([, a]) => a);
          const facesObstacle = (x: number, y: number, direction: number) => {
            const p = w.player,
              saved = [p.x, p.y, p.direction];
            [p.x, p.y, p.direction] = [x, y, direction];
            try {
              return obstacles.some((a) => inner.playerFaces(a));
            } finally {
              [p.x, p.y, p.direction] = saved;
            }
          };
          if (obstacles.length && plan((x, y, d) => facesObstacle(x, y, d))) {
            const before = inner.clearedObstacles.size;
            cutting = true;
            try {
              walk((x, y, d) => facesObstacle(x, y, d), "an obstacle", options, stop);
            } finally {
              cutting = false;
            }
            if (where() !== startRoom || stop()) return;
            host.step(["confirm"]);
            for (let i = 0; i < 120 && (inner.obstacleCut || i < 2); i++) host.step([]);
            log.rides.push(`cleared ${inner.clearedObstacles.size - before} obstacle(s) at (${world().player.x},${world().player.y})`);
            if (inner.clearedObstacles.size > before) continue;
          }
        }
        if (!route) {
          // On foot it cannot be reached: board a platform (cloud, lotus leaf) not yet tried from
          // here, ride it across and look again.
          // Rides never taken first; then ones taken fewer than three times (back across, to try
          // another branch).
          const boardWith = (most: number) =>
            plan((_x, _y, direction, _m, fx, fy) => {
              const id = boards(fx, fy, direction);
              return id !== null && (rides.get(`${id}:${direction}`) ?? 0) < most;
            });
          const board = rideCount < 60 ? (boardWith(1) ?? boardWith(2) ?? boardWith(3) ?? boardWith(5)) : null;
          if (!board)
            throw new WalkStuck(
              `${where()} (${world().player.x},${world().player.y}): no path to ${label}${rideCount ? ` after ${rideCount} rides` : ""}`,
            );
          route = board;
          boarding = true;
        }
        if (route.length === 0) return;
        let diverged = false;
        for (const [index, direction] of route.entries()) {
          const w = world(),
            room = where(),
            before = [w.player.x, w.player.y];
          if (process.env.WALK_DEBUG)
            console.log(`walk: key ${index} dir ${direction} from (${before}) but planned (${planned[index]})`);
          if (boarding && index === route.length - 1) {
            const id = boards(w.player.x, w.player.y, direction);
            const rideKey = `${id}:${direction}`;
            rides.set(rideKey, (rides.get(rideKey) ?? 0) + 1);
            rideCount++;
            // Still walking, the hero's body mask is the stride's: stand still before the press, as
            // the boarding check (`boards`) read him.
            for (let i = 0; i < 2; i++) host.step([]);
          }
          host.step([HOLD[direction]]);
          // A press that only turns the hero boards on the next tick.
          if (boarding && index === route.length - 1)
            for (let i = 0; i < 3 && !(world() as unknown as Internals).platformRide; i++) {
              if (world().player.x !== before[0] || world().player.y !== before[1]) break;
              host.step([HOLD[direction]]);
            }
          // A slide on 10:0's ice runs to its end before the next key.
          for (let i = 0; i < 200 && (world() as unknown as Internals).iceDirection !== null; i++) {
            host.step([]);
            if (world().activeEventGroup || world().eventVisible || world().battle) break;
          }
          const after = world();
          if ((after as unknown as Internals).vortex) {
            for (let i = 0; i < 200 && (world() as unknown as Internals).vortex; i++) host.step([]);
            diverged = true;
            last = `spun by a vortex to (${world().player.x},${world().player.y})`;
            break;
          }
          if ((after as unknown as Internals).platformRide) {
            const id = (after as unknown as Internals).platformRide!.actorId;
            ride(options);
            log.rides.push(
              `${id} ${direction} (${before[0]},${before[1]}) → (${world().player.x},${world().player.y})`,
            );
            diverged = true;
            last = `rode a platform to (${world().player.x},${world().player.y})`;
            break;
          }
          if (
            where() !== room ||
            after.activeEventGroup ||
            after.eventVisible ||
            after.battle ||
            after.doubleBattle ||
            host.mapLoadingActive ||
            host.panel.visible
          ) {
            last = `interrupted at (${after.player.x},${after.player.y}) by ${JSON.stringify(after.activeEventGroup)} line ${JSON.stringify(log.lines.at(-1))}`;
            diverged = true;
            break;
          }
          // A turn on the spot is the last key of a route; anything else should have moved him.
          if (after.player.x === before[0] && after.player.y === before[1] && direction !== route.at(-1)) {
            last = `stopped at (${before[0]},${before[1]}) pressing ${direction}`;
            diverged = true;
            break;
          }
        }
        const wasBoarding = boarding;
        boarding = false;
        if (!diverged && !wasBoarding) {
          const p = world().player;
          // Where the plan said the keys would take him: if not, look again from where he is.
          // (A door or a rect goal has fired by now, which the attempt loop sees as done.)
          if (
            !world().activeEventGroup &&
            where() === startRoom &&
            !goal(p.x, p.y, p.direction, false, p.x, p.y)
          ) {
            last = `ended at (${p.x},${p.y}) short of the goal`;
            continue;
          }
          // Let a door or a rect at the end of the route fire.
          for (let i = 0; i < 3; i++) host.step([]);
          return;
        }
      }
      throw new WalkStuck(`${where()}: kept being turned away walking to ${label} (${last})`);
    }

    type Hop = { to: string; sail?: { captain: number; row: number } };

    /** The wharf captains (`npc-services.json`): each open route is one more way between rooms. */
    function sailings(at: string): Hop[] {
      const [s, r] = at.split(":").map(Number),
        doc = sources.world.npcServices,
        hops: Hop[] = [];
      for (const service of doc?.services ?? []) {
        if (service.continuation !== "WHARF" || service.scene !== s || service.room !== r) continue;
        const dock = doc?.wharfs?.find((row) => row.index === service.wharf);
        dock?.routes.forEach(([gs, gr, gg, ts, tr], row) => {
          if (world().eventState.sourceEventState(gs, gr, gg) >= 3)
            hops.push({ to: `${ts}:${tr}`, sail: { captain: service.actorId, row } });
        });
      }
      return hops;
    }

    /** Rooms from here to `scene:room`: BFS over every room's doors and the open sea routes. */
    function roomRoute(scene: number, room: number, avoid: Set<string>): Hop[] | null {
      const start = where(),
        goal = `${scene}:${room}`,
        prev = new Map<string, [string, Hop] | null>([[start, null]]),
        queue = [start];
      for (let head = 0; head < queue.length; head++) {
        const at = queue[head];
        if (at === goal) {
          const route: Hop[] = [];
          for (let k = prev.get(at); k; k = prev.get(k[0])) route.push(k[1]);
          return route.reverse();
        }
        const [s, r] = at.split(":").map(Number),
          hops: Hop[] = sourceDoors(registry, s, r)
            .filter((d) => d.target.scene >= 0 && d.target.scene !== 98)
            .map((d) => ({ to: `${d.target.scene}:${d.target.room}` }));
        for (const hop of [...hops, ...sailings(at)]) {
          const [ts, tr] = hop.to.split(":").map(Number);
          if (avoid.has(`${at}>${hop.to}`) || prev.has(hop.to) || !assets.getWorldRoom(ts, tr)) continue;
          prev.set(hop.to, [at, hop]);
          queue.push(hop.to);
        }
      }
      return null;
    }

    /** Talk to a wharf captain, pick the route's row and sail until the boat lands. */
    function sail(captain: number, row: number, options: PlayOptions): void {
      face(captain, options);
      for (let i = 0; i < 40 && !(host.panel.visible && host.panel.mode === "wharf"); i++)
        host.step(i % 2 ? [] : ["confirm"]);
      if (host.panel.mode !== "wharf")
        throw new WalkStuck(`${where()}: captain ${captain} opened no wharf menu`);
      for (let k = 0; k < row; k++) host.step(["down"]);
      host.step(["confirm"]);
      for (let i = 0; i < 3000 && (host.wharfTravel || host.mapLoadingActive); i++) host.step([]);
    }

    /** Walk room to room (doors, boats) until the hero stands in `scene:room`. */
    async function goToRoom(scene: number, room: number, options: PlayOptions = {}): Promise<void> {
      const avoid = new Set<string>(),
        tried: string[] = [];
      for (let hop = 0; hop < 80; hop++) {
        settle(options);
        if (world().sceneId === scene && world().roomIndex === room) return;
        const route = roomRoute(scene, room, avoid);
        if (!route)
          throw new WalkStuck(
            `${where()}: no route to ${scene}:${room} (closed: ${tried.join(", ") || "none"})`,
          );
        const next = route[0],
          [ns, nr] = next.to.split(":").map(Number),
          from = where(),
          why: string[] = [];
        await assets.prepareRoom(ns, nr);
        let through = false;
        if (next.sail) {
          try {
            sail(next.sail.captain, next.sail.row, options);
          } catch (error) {
            if (!(error instanceof WalkStuck)) throw error;
            why.push(error.message);
          }
          through = where() !== from;
          if (!through) why.push(`boat from captain ${next.sail.captain} did not sail`);
        }
        const candidates = next.sail
          ? []
          : sourceDoors(registry, world().sceneId, world().roomIndex).filter(
              (d) => d.target.scene === ns && d.target.room === nr,
            );
        for (const d of candidates) {
          try {
            walk(
              (x, y, direction) =>
                (d.directionAgnostic || direction === d.requiredDirection) &&
                doorOverlaps({ x, y }, d),
              `door ${d.actorId} → ${ns}:${nr}`,
              options,
            );
          } catch (error) {
            if (!(error instanceof WalkStuck)) throw error;
            why.push(error.message);
            continue;
          }
          if (where() !== from) {
            through = true;
            break;
          }
          // Keep pressing into the doorway until the next room loads.
          for (let i = 0; i < 12 && where() === from && !world().activeEventGroup; i++)
            host.step([HOLD[d.requiredDirection]]);
          settle(options);
          if (where() !== from) {
            through = true;
            break;
          }
          why.push(
            `door ${d.actorId} at (${d.x},${d.y}) reached from (${world().player.x},${world().player.y}) but did not open`,
          );
        }
        if (!through) {
          avoid.add(`${from}>${next.to}`);
          tried.push(`${from}>${next.to} [${why.join(" | ")}]`);
        }
      }
      throw new WalkStuck(`gave up walking to ${scene}:${room}`);
    }

    /** Walk to where `actor` is faced (as `tryInteract` reads it). */
    function face(actorId: number, options: PlayOptions = {}): void {
      const w = world(),
        inner = w as unknown as Internals,
        actor = w.actors.get(actorId);
      if (!actor) throw new WalkStuck(`${where()}: no actor ${actorId}`);
      if (!actor.visible) throw new WalkStuck(`${where()}: actor ${actorId} is hidden`);
      const faces = (x: number, y: number, direction: number) => {
        const p = w.player,
          saved = [p.x, p.y, p.direction];
        [p.x, p.y, p.direction] = [x, y, direction];
        try {
          return inner.playerFaces(actor);
        } finally {
          [p.x, p.y, p.direction] = saved;
        }
      };
      walk((x, y, direction) => faces(x, y, direction), `actor ${actorId}`, options);
    }

    /** Stand where `actor` is faced and press 5 (as `tryInteract` reads it). */
    function talkTo(actorId: number, options: PlayOptions = {}): void {
      face(actorId, options);
      host.step(["confirm"]);
      host.step([]);
      settle(options);
    }

    /** The trigger of `scene:room:group` as the world reads it. */
    function trigger(scene: number, room: number, group: number): WorldEventTrigger | undefined {
      return worldEventTriggers(registry, scene, room).find((t) => t.group.group === group);
    }

    /** Walk to a group's room and start it the way a player does (its rect, its actor or 5 on switches). */
    async function play(scene: number, room: number, group: number, options: PlayOptions = {}) {
      await goToRoom(scene, room, options);
      const t = trigger(scene, room, group),
        done = () => world().eventState.sourceEventState(scene, room, group) >= 3;
      if (done()) return;
      if (!t) throw new WalkStuck(`${scene}:${room}:${group} has no trigger`);
      if (t.kind === "rect")
        walk(
          (x, y) => playerIntersectsSourceRect(x, y, t.rect),
          `rect of ${scene}:${room}:${group}`,
          options,
          done,
        );
      else if (t.kind === "actor") talkTo(t.actorId, options);
      else if (t.kind === "switches" && t.touch)
        // op59 with JavaRoomRules touch (10:12's floor shapes): each breaks under the hero's feet.
        for (const id of t.actorIds) {
          const actor = world().actors.get(id);
          if (!actor?.visible) continue;
          walk(
            (x, y) => Math.abs(x - actor.x) <= 4 && Math.abs(y - actor.y) <= 6,
            `shape ${id}`,
            options,
          );
          for (let i = 0; i < 60; i++) host.step([]);
          settle(options);
        }
      else if (t.kind === "switches") for (const id of t.actorIds) talkTo(id, options);
      settle(options);
      if (!done())
        throw new WalkStuck(
          `${scene}:${room}:${group} did not finish (state ${world().eventState.sourceEventState(scene, room, group)}, groups ${log.groups.slice(-6).join(" ")}, last line ${JSON.stringify(log.lines.at(-1))})`,
        );
    }

    async function snapshot(): Promise<GameSave> {
      await saves.flush();
      return host.snapshot(world());
    }

    settle();
    return { host, world, log, settle, plan, walk, goToRoom, talkTo, play, trigger, snapshot, where };
  }

  return { open };
}

/**
 * Where the hero stands after walking into `scene:room` through one of its doors (the first door
 * of another room that leads there): a test's starting spot that a player can actually be on.
 */
export function doorArrival(
  registry: StoryDataRegistry,
  assets: GameAssets,
  scene: number,
  room: number,
  from?: { scene: number; room: number },
): { sceneId: number; roomIndex: number; x: number; y: number; direction: number } {
  for (const key of Object.keys(assets.rooms)) {
    if (key.includes("#")) continue;
    const [s, r] = key.split(":").map(Number);
    if (from && (from.scene !== s || from.room !== r)) continue;
    for (const d of sourceDoors(registry, s, r)) {
      if (d.target.scene !== scene || d.target.room !== room) continue;
      const asset = assets.getWorldRoom(scene, room)!,
        at = transitionArrivalForTarget(registry, asset, d.target);
      if (at) return { sceneId: scene, roomIndex: room, ...at };
    }
  }
  throw new Error(`no door leads into ${scene}:${room}`);
}
