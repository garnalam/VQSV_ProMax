// CV0' Thiên Không: `CauVongSummoningRuntime` (rebuild_game/src/main/java/vqsv/game).
//
// The hub 50 (its two portals, once Miro is met; Miro once 63's trial is passed), the four trial rooms
// 66 → 65 → 64 → 63 (each opens its first scene, four game hosts and a summoner who fights only once
// the room's four games are won), the summoners' hall 51 (its first scene, five summoners in order,
// the services and the alliance) and Kim Diễm Long Vương in Thiên Không Chi Thành (49).
//
// Order in `CauVongChapterRuntime.tick`: `missingBranches.tick` → `summoning.tick` → the North Sea's
// owners. In a room it owns `tick` checks, in turn: an open minigame, a fight, a playing sequence, a
// menu (the world's), then a held fight (651400+e), a won fight's award (651300+e, 653000+e), a
// started stage (652000+e*10+st), an open menu (651500+e), 51's alliance and service markers, 64's
// streak pet, the rooms' first scenes, 50's portals, the game hosts, the summoners (49's floor
// trigger), Miro, 51's services, the summon rooms' residents, then the summon rooms' walk and doors.
//
// The sequences, the replies, the requests, the rewards and the runtime's own lines are baked by
// rebuild_game/tools/WebCauVongSummoning.java (`cau-vong-world/summoning.json`).
import type { AcademyBattle } from "./CauVongAcademy";
import type { BranchWorld } from "./CauVongBranches";
import type { CauVongAward, CauVongCue, CauVongPart, CauVongPetCue } from "./CauVongCutscene";
import type { FourGatesAction } from "./CauVongFourGates";
import type { MinigameTables } from "./CauVongMinigame";
import { isSummonRoom } from "./CauVongNorthSea";

type Say = Extract<CauVongCue, { k: "say" }>;
type Mark = { k: "mark"; room: number; event: number };
type Money = { k: "money"; amount: number };
export type SummonReward = CauVongPetCue | CauVongAward | Mark | Money;

export type SummonGame = {
  room: number;
  event: number;
  actor: number;
  kind: number;
  difficulty: number;
  /** `start(e, 0..2)`: the question, the information, the farewell ("room:event:from:to"). */
  stages: [string, string, string];
};
export type SummonBoss = {
  room: number;
  event: number;
  actor: number;
  prerequisite: [number, number] | null;
  /** `requiredGames(room)`: by game kind, the difficulty (room 66 - d) whose win it needs. */
  required: number[] | null;
  /** `source(post, decline)` and `source(decline, end)` (null: no choice, nothing to decline). */
  won: string;
  decline: string | null;
  battle: AcademyBattle;
  rewards: SummonReward[];
};

export type CauVongSummoningDocument = {
  /** BOSS_r_e, WIN_r_e, FIRST_r_e, PORTAL_e. */
  parts: Record<string, CauVongPart>;
  /** WIN_r_e: `steps(r, e, post, decline, true)` (`applyCast` once completed). */
  cast: Record<string, CauVongCue[]>;
  replies: Record<string, Say[]>;
  games: SummonGame[];
  bosses: SummonBoss[];
  services: { actor: number; reply: string; action: number }[];
  alliance: { info: string; tip: string };
  menus: { game: string[]; boss: string[]; alliance: string[] };
  text: Record<"capacity" | "lost" | "prerequisite" | "games" | "streak" | "medals", string>;
  streak: { room: number; receipt: number; species: number; level: number };
  longVuong: {
    actor: number;
    sprite: number;
    species: number;
    mechanic: {
      kind: number;
      behavior: number;
      dx: number;
      dy: number;
      mask: [number, number, number, number] | null;
      talk: string;
    };
  };
  flags: Record<"complete" | "won" | "battle" | "menu" | "task", number>;
  minigame: MinigameTables;
};

/** The owner's part and battle names carry this prefix, so the hooks find it. */
export const SUMMON_PREFIX = "summon:";
/** Menus: the hosts' and summoners' 300 + event, 51's alliance 400. */
export const SUMMON_MENU_BASE = 300;
const ALLIANCE_MENU = 400;
/** `651450 + e`: a lost fight waits for the summoner again (no floor retrigger in 49). */
const RETRY = 651450;
const REWARD = 653000;
export const KIM_DIEM_ROOM = 49;
export const KIM_DIEM_EVENT = 2;
export const KIM_DIEM_BATTLE_KEY = `${SUMMON_PREFIX}${KIM_DIEM_ROOM}:${KIM_DIEM_EVENT}`;
export const KIM_DIEM_REWARD_RECEIPT = 653102;
export const KIM_DIEM_AMULET_ID = 6000;
export const KIM_DIEM_BANK_CAPACITY = 1000;
const KIM_DIEM_REWARD_TEXT =
  "Kho Pet đã mở rộng lên 1.000 ô. Nhận Long Vương Hộ Phù, Kim Diễm Long Vương cấp 5 và Tàn Nguyệt Long Ma cấp 5.";
const KIM_DIEM_NEEDS_SPACE = "Hãy chừa hai chỗ trống trong đội hoặc kho Pet để nhận thưởng.";
const kimDiemBoss = (boss: SummonBoss) =>
  boss.room === KIM_DIEM_ROOM && boss.event === KIM_DIEM_EVENT;
const SERVICE = 651900;
const ALLIANCE_OPEN = 651890;
const STREAK_ROOM = 64;

/** What the summoning owner reads and writes beyond the branches' world. */
export interface SummonWorld extends BranchWorld {
  /** The award, pet or mark cues `award(b)` grants (each once per receipt). */
  grant(cue: CauVongAward | CauVongPetCue | Mark): void;
  /** `minigame.open(kind, difficulty)`. */
  openMinigame(kind: number, difficulty: number): void;
  /** `progression.cauVongMinigame.streak`. */
  streak(): number;
  kimDiemRewardFits(): boolean;
  grantKimDiemReward(): void;
}

const say = (text: string): FourGatesAction => ({
  kind: "text",
  steps: [{ k: "say", speaker: "", text, portrait: -1 }],
});

/** `CauVongSummoningRuntime.room` with 49 and 50: the rooms its `tick` runs in. */
export const summoningRoom = (room: number) => room === 49 || room === 50 || isSummonRoom(room);

/** `CauVongSummoningRuntime` and its state between ticks. */
export class SummoningOwner {
  private capacityWarned = -1;
  /** The text a finished `start(e, st)` (a game stage) or a service's reply hands on. */
  private pending:
    { kind: "stage"; event: number; stage: number } | { kind: "service"; action: number } | null =
    null;

  constructor(
    private readonly doc: CauVongSummoningDocument,
    /** `CauVongNorthSeaNpcRuntime.passives` of the summon rooms (north-sea.json). */
    private readonly passives: Record<string, { actorId: number; say: Say }[]>,
  ) {}

  owns(name: string): boolean {
    return name.startsWith(SUMMON_PREFIX);
  }
  private completed(w: SummonWorld, room: number, event: number): boolean {
    return w.done(room, this.doc.flags.complete + event);
  }
  private task(event: number, stage: number): number {
    return this.doc.flags.task + event * 10 + stage;
  }
  private boss(room: number, event: number): SummonBoss | undefined {
    return this.doc.bosses.find((b) => b.room === room && b.event === event);
  }
  private game(room: number, event: number): SummonGame | undefined {
    return this.doc.games.find((g) => g.room === room && g.event === event);
  }
  private replay(key: string): FourGatesAction {
    const steps = this.doc.replies[key];
    if (!steps) throw new Error(`Summoning reply ${key} is not baked`);
    return { kind: "text", steps };
  }
  private part(name: string): FourGatesAction {
    const part = this.doc.parts[name];
    if (!part) throw new Error(`Summoning part ${name} is not baked`);
    return { kind: "part", name: SUMMON_PREFIX + name, part };
  }
  /** `message`: a line, nothing handed on. */
  private message(text: string): FourGatesAction {
    this.pending = null;
    return say(text);
  }

  /** `canEnter`-free walk check: Long Vương's world sprite and the won summoners' poses. */
  cast(room: number, done: (room: number, event: number) => boolean): CauVongCue[] {
    const cues: CauVongCue[] = [];
    for (const b of this.doc.bosses)
      if (b.room === room && done(room, this.doc.flags.complete + b.event))
        cues.push(...(this.doc.cast[`WIN_${b.room}_${b.event}`] ?? []));
    return cues;
  }

  // --- the tick ---

  tick(w: SummonWorld, room: number): FourGatesAction {
    if (!summoningRoom(room)) return null;
    const f = this.doc.flags,
      done = (r: number, e: number) => w.done(r, e);
    if (
      this.completed(w, KIM_DIEM_ROOM, KIM_DIEM_EVENT) &&
      !done(KIM_DIEM_ROOM, KIM_DIEM_REWARD_RECEIPT)
    ) {
      if (w.kimDiemRewardFits()) {
        w.grantKimDiemReward();
        return this.message(KIM_DIEM_REWARD_TEXT);
      }
      if (this.capacityWarned !== 4902) {
        this.capacityWarned = 4902;
        return this.message(KIM_DIEM_NEEDS_SPACE);
      }
    }
    for (const b of this.doc.bosses) {
      if (b.room !== room) continue;
      if (done(room, f.battle + b.event)) return this.startBattle(w, b);
      if (done(room, f.won + b.event) && !this.completed(w, room, b.event)) {
        if (!this.fits(w, b)) {
          const warning = room * 100 + b.event;
          if (this.capacityWarned === warning) break;
          this.capacityWarned = warning;
          return this.message(kimDiemBoss(b) ? KIM_DIEM_NEEDS_SPACE : this.doc.text.capacity);
        }
        this.capacityWarned = -1;
        this.award(w, b);
        return this.start(w, room, b.event, 4);
      }
    }
    for (let e = 0; e < 20; e++)
      for (let st = 0; st < 5; st++)
        if (done(room, this.task(e, st))) return this.start(w, room, e, st);
    for (let e = 0; e < 20; e++) if (done(room, f.menu + e)) return this.choose(w, room, e);
    if (room === 51) {
      if (done(51, ALLIANCE_OPEN)) return this.chooseAlliance(w);
      for (let action = 1; action <= 5; action++)
        if (done(51, SERVICE + action)) {
          w.clear(51, SERVICE + action);
          return this.openService(w, action);
        }
    }
    const streak = this.doc.streak;
    if (
      room === STREAK_ROOM &&
      w.streak() === 3 &&
      !done(streak.room, streak.receipt) &&
      w.petSpace()
    ) {
      w.grant({
        k: "pet",
        room: streak.room,
        receipt: streak.receipt,
        species: streak.species,
        level: streak.level,
        nature: 0,
        ride: -1,
      });
      return this.message(this.doc.text.streak);
    }
    // 50:0 (the hub's first scene) is CV2's HUB_ARRIVAL (`CauVongPrep.ts`).
    if (room === 66 && !this.completed(w, 66, 0)) return this.start(w, 66, 0, 0);
    if (room === 63 && !this.completed(w, 63, 7)) return this.start(w, 63, 7, 0);
    if (room === 51 && !this.completed(w, 51, 6)) return this.start(w, 51, 6, 0);
    if (room === 50 && this.completed(w, 50, 9)) {
      if (w.point(240, 120, 19, 19)) return this.start(w, 50, 10, 0);
      if (w.point(420, 360, 19, 19)) return this.start(w, 50, 13, 0);
    }
    for (const g of this.doc.games)
      if (g.room === room && w.requested(g.actor)) return this.start(w, room, g.event, 0);
    for (const b of this.doc.bosses) {
      if (b.room !== room) continue;
      const floor =
        room === 49 &&
        !this.completed(w, 49, 2) &&
        !done(49, RETRY + b.event) &&
        w.at(100, 80, 100, 40);
      if (!w.requested(b.actor) && !floor) continue;
      if (this.completed(w, room, b.event)) {
        if (!kimDiemBoss(b)) return this.message2(this.replay(b.won));
        if (done(room, KIM_DIEM_REWARD_RECEIPT))
          return this.message("Ngươi đã nhận phần thưởng chiến thắng.");
        if (!w.kimDiemRewardFits()) return this.message(KIM_DIEM_NEEDS_SPACE);
        w.grantKimDiemReward();
        return this.message(KIM_DIEM_REWARD_TEXT);
      }
      const [pr, pe] = b.prerequisite ?? [-1, -1];
      if (pr >= 0 && !this.completed(w, pr, pe)) return this.message(this.doc.text.prerequisite);
      if (b.required)
        for (let k = 0; k < 4; k++)
          if (!done(66 - b.required[k], 650200 + k)) return this.message(this.doc.text.games);
      if (!this.fits(w, b))
        return this.message(kimDiemBoss(b) ? KIM_DIEM_NEEDS_SPACE : this.doc.text.capacity);
      return this.start(w, room, b.event, 3);
    }
    if (
      room === 50 &&
      this.completed(w, 63, 8) &&
      !this.completed(w, 50, 9) &&
      w.at(120, 80, 80, 40)
    )
      return this.start(w, 50, 9, 0);
    if (room === 51) {
      for (const row of this.doc.services)
        if (w.requested(row.actor)) {
          this.pending = { kind: "service", action: row.action };
          w.mark(51, SERVICE + row.action);
          return this.replay(row.reply);
        }
    }
    if (isSummonRoom(room))
      for (const npc of this.passives[String(room)] ?? [])
        if (w.requested(npc.actorId)) return this.message2({ kind: "text", steps: [npc.say] });
    return null;
  }
  /** A text with nothing handed on (`event = stage = -1`). */
  private message2(action: FourGatesAction): FourGatesAction {
    this.pending = null;
    return action;
  }

  /** `start(e, st)`: the stage's marker (652000+e*10+st), then its sequence or text. */
  private start(w: SummonWorld, room: number, event: number, stage: number): FourGatesAction {
    w.mark(room, this.task(event, stage));
    if (room === 50 && (event === 10 || event === 13)) return this.part(`PORTAL_${event}`);
    const game = this.game(room, event);
    if (game) {
      this.pending = { kind: "stage", event, stage };
      return this.replay(game.stages[stage === 1 ? 1 : stage === 2 ? 2 : 0]);
    }
    if (stage === 3) return this.part(`BOSS_${room}_${event}`);
    if (stage === 4) return this.part(`WIN_${room}_${event}`);
    return this.part(`FIRST_${room}_${event}`);
  }

  /** A sequence is over: the marker goes, then `after(r, e, st)`. */
  after(w: SummonWorld, name: string, room: number): FourGatesAction {
    const key = name.slice(SUMMON_PREFIX.length);
    const part = this.doc.parts[key];
    if (!part) return null;
    w.clear(part.room, part.started);
    const event = part.event,
      stage = (part.started - this.doc.flags.task - event * 10) | 0;
    if (key.startsWith("PORTAL_")) {
      // The portal plays again: its checkpoints go; the hero is shown.
      for (let i = 0; i < part.steps.length; i++) w.clear(part.room, part.cue + i);
      return null;
    }
    if (stage === 3) {
      const b = this.boss(part.room, event)!;
      return part.room === 49 ? this.startBattle(w, b) : this.choose(w, room, event);
    }
    if (stage === 4) w.clear(part.room, this.doc.flags.won + event);
    w.mark(part.room, this.doc.flags.complete + event);
    return null;
  }
  /** A game stage's or a service's text is over. */
  notice(w: SummonWorld, room: number): FourGatesAction {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return null;
    if (pending.kind === "service") {
      w.clear(51, SERVICE + pending.action);
      return this.openService(w, pending.action);
    }
    w.clear(room, this.task(pending.event, pending.stage));
    return pending.stage === 0 ? this.choose(w, room, pending.event) : null;
  }

  // --- menus ---

  private choose(w: SummonWorld, room: number, event: number): FourGatesAction {
    w.mark(room, this.doc.flags.menu + event);
    return {
      kind: "menu",
      owner: SUMMON_MENU_BASE + event,
      options: this.game(room, event) ? this.doc.menus.game : this.doc.menus.boss,
    };
  }
  private chooseAlliance(w: SummonWorld): FourGatesAction {
    w.mark(51, ALLIANCE_OPEN);
    return { kind: "menu", owner: ALLIANCE_MENU, options: this.doc.menus.alliance };
  }
  answer(w: SummonWorld, owner: number, selected: number, room: number): FourGatesAction {
    if (owner === ALLIANCE_MENU) {
      w.clear(51, ALLIANCE_OPEN);
      if (selected === 0) return this.message(w.allianceUpgrade());
      if (selected === 1)
        return this.message(this.doc.text.medals.replace("{n}", String(w.claimMedals())));
      if (selected === 2) return this.message2(this.replay(this.doc.alliance.info));
      if (selected === 3) return this.message2(this.replay(this.doc.alliance.tip));
      return null;
    }
    const event = owner - SUMMON_MENU_BASE;
    w.clear(room, this.doc.flags.menu + event);
    const game = this.game(room, event);
    if (game) {
      if (selected === 0) {
        w.openMinigame(game.kind, game.difficulty);
        return { kind: "hold" };
      }
      return this.start(w, room, event, selected === 1 ? 1 : 2);
    }
    const b = this.boss(room, event)!;
    if (selected === 0)
      return this.fits(w, b) ? this.startBattle(w, b) : this.message(this.doc.text.capacity);
    return b.decline ? this.message2(this.replay(b.decline)) : null;
  }

  // --- fights and rewards ---

  private startBattle(w: SummonWorld, b: SummonBoss): FourGatesAction {
    w.clear(b.room, RETRY + b.event);
    w.mark(b.room, this.doc.flags.battle + b.event);
    return { kind: "battle", key: `${SUMMON_PREFIX}${b.room}:${b.event}` };
  }
  battle(key: string): AcademyBattle | undefined {
    const [room, event] = key.slice(SUMMON_PREFIX.length).split(":").map(Number);
    return this.boss(room, event)?.battle;
  }
  /** `handleBattleResult`: a loss waits for the summoner again; a win is awarded on the next tick. */
  result(w: SummonWorld, key: string, won: boolean): FourGatesAction {
    const [room, event] = key.slice(SUMMON_PREFIX.length).split(":").map(Number);
    w.clear(room, this.doc.flags.battle + event);
    if (!won) {
      w.mark(room, RETRY + event);
      const part = this.doc.parts[`BOSS_${room}_${event}`];
      for (let i = 0; i < part.steps.length; i++) w.clear(room, part.cue + i);
      return this.message(this.doc.text.lost);
    }
    w.mark(room, this.doc.flags.won + event);
    return null;
  }
  /** `fits(b)`: the reward received, or room for its pets and gifts. */
  private fits(w: SummonWorld, b: SummonBoss): boolean {
    if (kimDiemBoss(b)) return w.kimDiemRewardFits();
    if (w.done(b.room, REWARD + b.event)) return true;
    for (const reward of b.rewards) {
      if (reward.k === "pet" && !w.petSpace()) return false;
      if (reward.k === "award" && !w.giftFits(reward)) return false;
    }
    return true;
  }
  /** `award(b)`: once (653000+e), the pets, gifts and money. */
  private award(w: SummonWorld, b: SummonBoss): void {
    if (kimDiemBoss(b)) {
      w.grantKimDiemReward();
      w.mark(b.room, REWARD + b.event);
      return;
    }
    if (w.done(b.room, REWARD + b.event)) return;
    for (const reward of b.rewards) {
      if (reward.k === "money") w.earn(reward.amount);
      else w.grant(reward);
    }
    w.mark(b.room, REWARD + b.event);
  }

  // --- 51's services ---

  private openService(w: SummonWorld, action: number): FourGatesAction {
    if (action === 5) return this.chooseAlliance(w);
    if (action === 2) return { kind: "bank" };
    return { kind: "shop", category: action === 1 ? 0 : action === 3 ? 2 : 1 };
  }
}
