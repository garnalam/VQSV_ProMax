/**
 * `NguyenMocC4RaceRuntime` (with `NguyenMocC4RaceStoryData` and the race half of
 * `RepeatableEconomyService`): Jill's Lục Hành Điểu race in 3:7. JavaSE owns the room outright — its
 * three source groups never run — and rewrites the race: five starts per rolling 24 hours for 500
 * kim each, a 4-3-2-1 countdown, 120 seconds of wall clock, eight obstacles (actors 2–9) that fall
 * when run into, the finish strip (208, 96, 64, 16) and a prize by time.
 *
 * The rules are pure functions here; `WorldRuntime` keeps the attempt state and runs the dialogue
 * as a short script (`raceStartScript`), whose `worldHook` steps call back into it.
 */
import type { RuntimeStoryEvent } from "../story/SourceOpcodeInterpreter";

export const RACE_SCENE = 3;
export const RACE_ROOM = 7;
export const RACE_JILL = 40;
export const RACE_FIRST_OBSTACLE = 2;
export const RACE_LAST_OBSTACLE = 9;
export const RACE_FINISH = { x: 208, y: 96, width: 64, height: 16 } as const;
export const RACE_ATTEMPT_LIMIT = 5;
export const RACE_ENTRY_FEE = 500;
export const RACE_TIME_LIMIT_MILLIS = 120_000;
export const RACE_WINDOW_MILLIS = 24 * 60 * 60 * 1000;
export const COUNTDOWN_START = 4;
export const COUNTDOWN_STEP_TICKS = 10;
export const COUNTDOWN_START_TICK = 41;
/** `op36PetReward(54, 5, stars, 2, 30, 45)`: the unique prize, once. */
export const RACE_PET = {
  speciesId: 54,
  level: 5,
  nature: 2,
  skillIds: [30, 45] as [number, number],
};

export const RACE_TEXT = {
  jill: "Jill",
  firstIntro:
    "Ổn chứ, nơi này là đấu trường Lục Hành Điểu, luật của trò chơi chính là tính thời gian thi chạy ~ nếu trong thời gian quy định đến được đích, sẽ nhận được phần thưởng ~ Bắt đầu chứ?",
  repeatStatus: "Ngươi đã chạy %s lần, thời gian còn lại %s.",
  repeatIntro: "Tốt, nơi này là đấu trường thi Lục Hành Điểu. Muốn bắt đầu chơi chứ?",
  fee: "Phí tham gia 500 kim tiền, muốn bắt đầu trận đấu chứ?",
  firstRules:
    "Luật chơi nằm trọn trong một vòng tròn, người chơi phải về đích trong thời gian quy định và thoát khỏi những chướng ngại vật ngẫu nhiên gặp phải. Một khi đã chơi không thể dừng, cũng không chạy được.",
  firstRewards:
    "Chiến thắng trong vòng 120 giây có thể đạt được Tam đẳng thưởng 750 kim tiền. 65 giây đạt Nhất đẳng, 1000 kim tiền. Dưới 60 giây sẽ đạt được giải thưởng thần bí!",
  repeatRules:
    "Luật chơi nằm gọn trong một vòng tròn. Kẻ về đích trước trong thời gian quy định là thắng cuộc. Cần vượt qua các trở ngại ngẫu nhiên. Một khi đã bắt đầu thì không thể tạm dừng, cũng không thể chạy trốn được.",
  repeatRewards:
    "Chiến thắng trong 120 giây đạt được Tam đẳng thưởng 750 kim tiền. 65 giây đạt Nhất đẳng, 1000 kim tiền. Dưới 60 giây có thể nhận giải thưởng thần bí!",
  limit: "Đã đạt mức giới hạn trong hôm nay, không thể tiếp tục tham gia!",
  poor: "Không đủ 500 kim tiền để tham gia.",
  timeout: "Hết giờ, bạn chưa về đích. Không nhận được phần thưởng.",
  firstMain: ["Bắt đầu trò chơi", "Xem các quy tắc", "Chuyển đi"],
  repeatMain: ["Bắt đầu trò chơi", "xem xét quy tắc", "rời đi"],
  accept: ["Tiếp nhận", "từ chối"],
  firstRuleMenu: ["Quy tắc trận đấu", "Phần thưởng", "Quay trở lại"],
  repeatRuleMenu: ["Quy tắc trận đấu", "Phần thưởng", "Quay trở về"],
  // JavaSE colours the name (`#2` … `#0`); the web's open box draws one ink, so the tags go.
  petRoster: "Đạt được Lục hành điểu",
  petBank: "Đạt được Lục hành điểu ba lô đã đủ, đã để vào ngân hàng",
} as const;

/** The saved half (`progression.nguyenMocRace*`). */
export type RaceProgress = { windowStart: number; attempts: number; petClaimed: boolean };
export type RaceWindow = {
  windowStart: number;
  used: number;
  available: boolean;
  remaining: number;
};

/** `RepeatableEconomyService.windowStatus`: one rolling 24-hour window of starts. */
export function raceWindow(progress: RaceProgress, now: number): RaceWindow {
  const at = Math.max(1, now),
    used = Math.max(0, Math.min(RACE_ATTEMPT_LIMIT, progress.attempts));
  if (progress.windowStart <= 0 || at - progress.windowStart >= RACE_WINDOW_MILLIS)
    return { windowStart: at, used: 0, available: true, remaining: RACE_ATTEMPT_LIMIT };
  return {
    windowStart: progress.windowStart,
    used,
    available: used < RACE_ATTEMPT_LIMIT,
    remaining: RACE_ATTEMPT_LIMIT - used,
  };
}

/** `rewardTierForElapsed`: 0 within a minute, 1 within 65 s, 2 within the limit. */
export function raceRewardTier(elapsedMillis: number): number {
  const seconds = Math.floor(Math.max(0, elapsedMillis) / 1000);
  if (seconds <= 60) return 0;
  if (seconds <= 65) return 1;
  if (seconds <= 120) return 2;
  return 5;
}

/** `RepeatableEconomyService.raceReward`: the unique pet once, then money. */
export function raceReward(
  tier: number,
  petClaimed: boolean,
): { kind: "pet" } | { kind: "money"; money: number } | { kind: "none" } {
  if (tier === 0 && !petClaimed) return { kind: "pet" };
  if (tier === 0 || tier === 1) return { kind: "money", money: 1000 };
  if (tier === 2) return { kind: "money", money: 750 };
  if (tier === 3) return { kind: "money", money: 600 };
  return { kind: "none" };
}

/** `formatElapsed`: m'ss"mmm. */
export function formatRaceTime(elapsedMillis: number): string {
  const value = Math.max(0, Math.floor(elapsedMillis)),
    millis = value % 1000,
    totalSeconds = Math.floor(value / 1000),
    seconds = totalSeconds % 60,
    minutes = Math.floor(totalSeconds / 60);
  return `${minutes}'${String(seconds).padStart(2, "0")}"${String(millis).padStart(3, "0")}`;
}

/** Assembles a script with named targets, resolved to program indices at the end. */
class Script {
  private readonly events: (
    RuntimeStoryEvent | { pending: RuntimeStoryEvent; targets: string[] }
  )[] = [];
  private readonly labels = new Map<string, number>();
  label(name: string): this {
    this.labels.set(name, this.events.length);
    return this;
  }
  push(...events: RuntimeStoryEvent[]): this {
    this.events.push(...events);
    return this;
  }
  /** A choice, a jump or a hook whose targets are labels. */
  branch(event: RuntimeStoryEvent, targets: string[]): this {
    this.events.push({ pending: event, targets });
    return this;
  }
  build(): RuntimeStoryEvent[] {
    this.labels.set("end", this.events.length);
    const at = (name: string) => {
      const index = this.labels.get(name);
      if (index === undefined) throw new Error(`race script: no label ${name}`);
      return index;
    };
    return this.events.map((event) => {
      if (!("pending" in event)) return event;
      const next = event.targets.map(at);
      return event.pending.type === "jump"
        ? { type: "jump", next: next[0] }
        : ({ ...event.pending, next } as RuntimeStoryEvent);
    });
  }
}

const jill = (text: string): RuntimeStoryEvent => ({
  type: "text",
  text,
  speaker: RACE_TEXT.jill,
  wait: true,
  kind: "dialog",
});
const box = (text: string): RuntimeStoryEvent => ({
  type: "text",
  text,
  wait: true,
  kind: "openbox",
  box: { x: 47, y: 154, width: 146, height: 26 },
});
const jump: RuntimeStoryEvent = { type: "jump", next: 0 };
const choice = (options: readonly string[]): RuntimeStoryEvent => ({
  type: "choice",
  options: [...options],
  next: [],
});
const FIRST_VISIT: RuntimeStoryEvent = {
  type: "markComplete",
  ref: { scene: RACE_SCENE, room: RACE_ROOM, group: 0 },
};

/**
 * `StartFlow`: Jill's greeting (the first-visit speech, or the runs used and left), the main menu,
 * the fee, then the start — fade out, the hero at (128, 72) facing left, obstacles back up, fade in
 * and the countdown. Leaving on a first visit (or starting) closes 3:7:g0 for good.
 */
export function raceStartScript(first: boolean, window: RaceWindow): RuntimeStoryEvent[] {
  const s = new Script(),
    exit = first ? [FIRST_VISIT] : [];
  if (first) s.push(jill(RACE_TEXT.firstIntro));
  else
    s.push(
      jill(
        RACE_TEXT.repeatStatus
          .replace("%s", String(window.used))
          .replace("%s", String(window.remaining)),
      ),
      jill(RACE_TEXT.repeatIntro),
    );
  s.label("main")
    .branch(choice(first ? RACE_TEXT.firstMain : RACE_TEXT.repeatMain), ["fee", "rules", "exit"])
    .label("fee")
    .push(jill(RACE_TEXT.fee))
    .branch(choice(RACE_TEXT.accept), ["accept", "exit"])
    .label("accept")
    .branch({ type: "worldHook", hook: "race.accept" }, ["limit", "poor"])
    .push(
      { type: "currency", mode: 1, kind: 0, amount: RACE_ENTRY_FEE },
      ...exit,
      { type: "effect", name: "fade-out", ticks: 16 },
      { type: "place", x: 128, y: 72 },
      { type: "active", ids: [-1], dirs: [3] },
      { type: "worldHook", hook: "race.resetObstacles" },
      { type: "effect", name: "fade-in", ticks: 16 },
      { type: "worldHook", hook: "race.countdown" },
    )
    .branch(jump, ["end"])
    .label("rules")
    .branch(choice(first ? RACE_TEXT.firstRuleMenu : RACE_TEXT.repeatRuleMenu), [
      "rule",
      "reward",
      "main",
    ])
    .label("rule")
    .push(jill(first ? RACE_TEXT.firstRules : RACE_TEXT.repeatRules))
    .branch(jump, ["rules"])
    .label("reward")
    .push(jill(first ? RACE_TEXT.firstRewards : RACE_TEXT.repeatRewards))
    .branch(jump, ["rules"])
    .label("exit")
    .push(...exit)
    .branch(jump, ["end"])
    .label("limit")
    .push(jill(RACE_TEXT.limit))
    .branch(jump, ["end"])
    .label("poor")
    .push(box(RACE_TEXT.poor));
  return s.build();
}

/** `LimitFlow`: five runs already today. */
export const raceLimitScript = (): RuntimeStoryEvent[] => [jill(RACE_TEXT.limit)];

/**
 * `FinishFlow` / `TimeoutFlow` after the prize is settled: its notice (if any), then fade out, the
 * hero back at (240, 48) facing down, fade in.
 */
export function raceEndScript(notice: string | null): RuntimeStoryEvent[] {
  return [
    ...(notice === null ? [] : [box(notice)]),
    { type: "effect", name: "fade-out", ticks: 16 },
    { type: "place", x: 240, y: 48 },
    { type: "active", ids: [-1], dirs: [0] },
    { type: "effect", name: "fade-in", ticks: 16 },
  ];
}
