// CV0' Thiên Không: `CauVongSummoningMinigame` and `vqsv.progression.CauVongMinigameState`
// (rebuild_game/src/main/java/vqsv): the four games of the summon rooms (vqsv5 au/ab/aa/t).
//
// 0 Cược pet (a bird race: bet, pick a bird, buy boosts), 1 Bắn bóng (bounce balls into the goal),
// 2 Trí nhớ: lật bài (pairs), 3 Đoán thùng (the shell game; three wins in a row on difficulty 2 give
// 64's pet). A win writes 650200+kind in the room (`won`), which the room's summoner checks. Motion and
// random choices belong to `tick`; the state is saved with the campaign, so a reload resumes the board.
//
// The tables (fees, returns, sizes, trajectories, speeds) are baked by WebCauVongSummoning.java.

export type MinigameTables = {
  names: string[];
  BETS: number[];
  RETURNS: number[];
  BALL_FEES: number[];
  BALL_TIME: number[];
  BALL_INTERVAL: number[];
  CARD_ROWS: number[];
  CARD_COLS: number[];
  SHELL_ROUNDS: number[];
  SHELL_PETS: number[];
  BALL_POINTS: number[];
  BALL_ICONS: number[];
  SHELL_X: number[];
  TRAJECTORIES: number[][];
  SPEEDS: number[][];
  /** `drawPet` / `shells`: each pool pet's visual and catalogue name. */
  shellPets: Record<string, { visual: number; name: string }>;
};

/** `CauVongMinigameState`: the open board (room -1 when closed) and the gold room's streak. */
export type CauVongMinigameState = {
  room: number;
  kind: number;
  difficulty: number;
  phase: number;
  selected: number;
  bet: number;
  feed: number;
  ticks: number;
  score: number;
  mistakes: number;
  first: number;
  second: number;
  delay: number;
  rounds: number;
  answer: number;
  shuffle: number;
  streak: number;
  seed: number;
  payout: number;
  cells: number[];
  visible: number[];
  race: number[];
  balls: number[];
  countdown: number;
  camera: number;
  stage: number;
  remaining: number;
  spawnWait: number;
  burstWait: number;
  burstLeft: number;
  paddleHit: number;
  swapRemaining: number;
  swapStep: number;
  swapDuration: number;
  swapRadius: number;
  roundResult: number;
  revealTicks: number;
  speeds: number[];
  clouds: number[];
  shellXY: number[];
  flips: number[];
};

export function closedMinigame(streak = 0): CauVongMinigameState {
  const m = {} as CauVongMinigameState;
  m.seed = 1;
  m.streak = streak;
  close(m);
  return m;
}
function resetMotion(m: CauVongMinigameState): void {
  m.countdown = m.camera = m.stage = m.remaining = m.spawnWait = m.burstWait = m.burstLeft = 0;
  m.paddleHit = m.swapRemaining = m.swapStep = m.swapDuration = m.swapRadius = 0;
  m.roundResult = m.revealTicks = 0;
  m.speeds = [0, 0, 0, 0];
  m.clouds = new Array(30).fill(0);
  m.shellXY = new Array(6).fill(0);
  m.flips = [];
}
/** `close`: the board is disposed; the streak belongs to the gold room's reward. */
function close(m: CauVongMinigameState): void {
  m.room = -1;
  m.kind = -1;
  m.phase = 0;
  m.difficulty = m.difficulty ?? 0;
  m.selected = m.bet = m.feed = m.ticks = m.score = m.mistakes = m.delay = m.rounds = 0;
  m.answer = m.shuffle = m.payout = 0;
  m.first = m.second = -1;
  m.cells = [];
  m.visible = [];
  m.race = [0, 0, 0, 0];
  m.balls = [];
  resetMotion(m);
}
/** `random(bound)`: the board's xorshift. */
function random(m: CauVongMinigameState, bound: number): number {
  let seed = m.seed | 0;
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  m.seed = seed | 0;
  return ((m.seed % bound) + bound) % bound;
}

/** A saved board, checked loosely: anything malformed is a closed board (the streak kept). */
export function restoreMinigame(raw: unknown): CauVongMinigameState {
  if (!raw || typeof raw !== "object") return closedMinigame();
  const m = raw as Partial<CauVongMinigameState>;
  const streak = Number.isInteger(m.streak) && m.streak! >= 0 && m.streak! <= 3 ? m.streak! : 0;
  const fresh = closedMinigame(streak);
  const open = m.room !== undefined && m.room >= 63 && m.room <= 66;
  if (!open) return fresh;
  for (const key of Object.keys(fresh) as (keyof CauVongMinigameState)[]) {
    const value = m[key];
    if (Array.isArray(fresh[key]) ? !Array.isArray(value) : !Number.isInteger(value)) return fresh;
  }
  return { ...fresh, ...m } as CauVongMinigameState;
}

/** What a tick reads: the edges of the arrows, the held left/right, 5 and back. */
export type MinigameInput = {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  holdLeft: boolean;
  holdRight: boolean;
  confirm: boolean;
  back: boolean;
};
/** What the games write: the kim, the room's win flags, the gold room's pet. */
export interface MinigameWorld {
  money(): number;
  setMoney(value: number): void;
  done(room: number, event: number): boolean;
  mark(room: number, event: number): void;
  /** `CauVongDormPetQuest.hasSpace(s, 1)`. */
  petSpace(): boolean;
  /** `acquire(83, 25)`: 64's streak pet (receipt 650250 written by the caller). */
  streakPet(): boolean;
}

const GOLD = 64,
  STREAK_RECEIPT = 650250;

/** `CauVongSummoningMinigame`: the rules over one saved board. */
export class CauVongMinigame {
  constructor(private readonly t: MinigameTables) {}

  static fee(t: MinigameTables, kind: number, difficulty: number, bet: number): number {
    return kind === 0 ? t.BETS[bet] : kind === 1 ? t.BALL_FEES[difficulty] : 200 + 200 * difficulty;
  }
  /** `open(kind, difficulty)`: a fresh board in this room; the streak carries over. */
  open(
    m: CauVongMinigameState,
    room: number,
    kind: number,
    difficulty: number,
    seed: number,
  ): void {
    if (kind < 0 || kind > 3 || difficulty < 0 || difficulty > 3) throw new Error("Minigame");
    const streak = m.streak;
    close(m);
    m.room = room;
    m.kind = kind;
    m.difficulty = difficulty;
    m.streak = streak;
    m.seed = seed | 1;
  }

  /** One tick of the open board; false when none is open. */
  tick(m: CauVongMinigameState, room: number, input: MinigameInput, w: MinigameWorld): boolean {
    if (m.room < 0) return false;
    if (m.room !== room) throw new Error("Saved minigame in wrong map");
    const t = this.t;
    let confirm = input.confirm;
    const consume = () => {
      const c = confirm;
      confirm = false;
      return c;
    };
    const { left: l, right: r, up: u, down: d } = input;
    if (input.back) {
      if (m.phase === 0 || m.phase === 1 || m.phase === 3) close(m);
      else this.finish(m, w, false, 0);
      return true;
    }
    if (m.phase === 0) {
      if (m.kind === 0) {
        if (l || u) m.bet = Math.max(0, m.bet - 1);
        if (r || d) m.bet = Math.min(2, m.bet + 1);
      }
      if (consume()) {
        if (m.kind === 0) m.phase = 1;
        else this.startPaid(m, w);
      }
      return true;
    }
    if (m.phase === 1) {
      ++m.ticks;
      if (l) m.selected = Math.max(0, m.selected - 1);
      if (r) m.selected = Math.min(3, m.selected + 1);
      if (u) m.feed = Math.min(3, m.feed + 1);
      if (d) m.feed = Math.max(0, m.feed - 1);
      if (consume()) this.startPaid(m, w);
      return true;
    }
    if (m.phase === 3) {
      if (m.kind === 3 && m.difficulty === 2 && m.streak === 3 && !w.done(GOLD, STREAK_RECEIPT)) {
        if (!w.petSpace()) {
          if (consume()) close(m);
          return true;
        }
        if (!w.streakPet()) return true;
        w.mark(GOLD, STREAK_RECEIPT);
      }
      if (consume()) close(m);
      return true;
    }
    ++m.ticks;
    switch (m.kind) {
      case 0:
        consume();
        this.tickRace(m, w);
        break;
      case 1:
        consume();
        if (input.holdLeft) m.selected = Math.max(0, m.selected - 10);
        if (input.holdRight) m.selected = Math.min(153, m.selected + 10);
        this.tickBalls(m, w);
        break;
      case 2: {
        const cols = t.CARD_COLS[m.difficulty];
        if (l) m.selected = Math.max(0, m.selected - 1);
        if (r) m.selected = Math.min(m.cells.length - 1, m.selected + 1);
        if (u) m.selected = Math.max(0, m.selected - cols);
        if (d) m.selected = Math.min(m.cells.length - 1, m.selected + cols);
        for (let i = 0; i < m.flips.length; i++) if (m.flips[i] > 0) --m.flips[i];
        if (m.countdown > 0) {
          if (--m.countdown === 0) m.flips.fill(2);
          consume();
          return true;
        }
        if (m.delay > 0) {
          consume();
          if (--m.delay === 0) {
            if (m.cells[m.first] === m.cells[m.second]) {
              m.visible[m.first] = m.visible[m.second] = 2;
              if (m.visible.every((v) => v === 2)) this.finish(m, w, true, m.mistakes * 125 + 100);
            } else {
              m.visible[m.first] = m.visible[m.second] = 0;
              m.flips[m.first] = m.flips[m.second] = 2;
              if (--m.mistakes <= 0) this.finish(m, w, false, 0);
            }
            m.first = m.second = -1;
          }
          return true;
        }
        if (consume()) this.flip(m, m.selected);
        break;
      }
      case 3:
        if (m.stage < 2) {
          this.tickShell(m);
          consume();
        } else if (m.stage === 3) {
          const p = m.selected * 2,
            delta = m.selected === 0 ? 11 : -10;
          if (m.shellXY[p] !== 117)
            m.shellXY[p] =
              delta > 0 ? Math.min(117, m.shellXY[p] + delta) : Math.max(117, m.shellXY[p] + delta);
          if (consume()) {
            if (m.roundResult < 0) this.finish(m, w, false, 0);
            else if (m.rounds >= t.SHELL_ROUNDS[m.difficulty]) {
              if (m.difficulty === 2) m.streak = Math.min(3, m.streak + 1);
              this.finish(
                m,
                w,
                true,
                CauVongMinigame.fee(t, 3, m.difficulty, 0) +
                  m.difficulty * m.difficulty * 150 +
                  (2 - m.difficulty) * 25,
              );
            } else this.nextShell(m);
          }
        } else {
          if (l) m.selected = Math.max(0, m.selected - 1);
          if (r) m.selected = Math.min(2, m.selected + 1);
          if (consume()) this.pickShell(m, m.selected);
        }
        break;
    }
    return true;
  }

  private startPaid(m: CauVongMinigameState, w: MinigameWorld): void {
    const t = this.t;
    const cost =
      CauVongMinigame.fee(t, m.kind, m.difficulty, m.bet) + (m.kind === 0 ? m.feed * 10 : 0);
    if (
      m.kind === 3 &&
      m.difficulty === 2 &&
      m.streak === 2 &&
      !w.done(GOLD, STREAK_RECEIPT) &&
      !w.petSpace()
    ) {
      m.roundResult = 1;
      return;
    }
    if (w.money() < cost) {
      m.roundResult = -1;
      return;
    }
    w.setMoney(w.money() - cost);
    resetMotion(m);
    m.phase = 2;
    m.ticks = 0;
    m.roundResult = 0;
    if (m.kind === 0) {
      m.race.fill(450);
      m.countdown = 70;
      m.camera = 130;
      for (let i = 0; i < 10; i++) this.newCloud(m, i);
    } else if (m.kind === 1) {
      m.selected = 0;
      m.remaining = t.BALL_TIME[m.difficulty];
      this.ballBurst(m, true);
    } else if (m.kind === 2) {
      const n = t.CARD_ROWS[m.difficulty] * t.CARD_COLS[m.difficulty];
      m.cells = new Array(n).fill(0);
      m.visible = new Array(n).fill(0);
      m.flips = new Array(n).fill(0);
      const used = new Array(36).fill(false);
      for (let i = 0; i < n; i += 2) {
        let icon: number;
        do icon = 1 + random(m, 35);
        while (used[icon]);
        used[icon] = true;
        m.cells[i] = m.cells[i + 1] = icon;
      }
      for (let i = n - 1; i > 0; i--) {
        const j = random(m, i + 1),
          x = m.cells[i];
        m.cells[i] = m.cells[j];
        m.cells[j] = x;
      }
      m.selected = 0;
      m.mistakes = 4 + 2 * m.difficulty;
      m.countdown = 100;
    } else this.nextShell(m);
  }
  private newCloud(m: CauVongMinigameState, i: number): void {
    const p = i * 3;
    m.clouds[p] = 240 + random(m, 120);
    m.clouds[p + 1] = m.camera - 80 + i * (55 + random(m, 25));
    m.clouds[p + 2] = 2 + random(m, 5);
  }
  private tickRace(m: CauVongMinigameState, w: MinigameWorld): void {
    const t = this.t;
    for (let i = 0; i < 10; i++) {
      const p = i * 3;
      if (m.clouds[p] < -40 || m.clouds[p + 1] - m.camera > 340) this.newCloud(m, i);
      else m.clouds[p] -= m.clouds[p + 2];
    }
    if (m.countdown > 0) {
      --m.countdown;
      return;
    }
    if (m.stage < 4 && m.race.some((y) => y <= t.SPEEDS[m.stage][0])) {
      for (let i = 0; i < 4; i++)
        m.speeds[i] = t.SPEEDS[m.stage][1] + random(m, t.SPEEDS[m.stage][1]);
      ++m.stage;
    }
    let winner = -1,
      tracking = -1;
    for (let i = 0; i < 4; i++) {
      m.race[i] -= m.speeds[i];
      if (m.race[i] - m.camera < 160) tracking = i;
      if (m.race[i] < 70 && winner < 0) winner = i;
    }
    if (tracking >= 0) m.camera = Math.max(0, m.camera - m.speeds[tracking]);
    if (winner >= 0) {
      m.answer = winner;
      this.finish(m, w, winner === m.selected, winner === m.selected ? t.RETURNS[m.bet] : 0);
    }
  }
  private ballBurst(m: CauVongMinigameState, first: boolean): void {
    const t = this.t;
    m.spawnWait = first ? 10 : [60, 40, 30, 10][m.difficulty];
    m.burstWait = t.BALL_INTERVAL[m.difficulty];
    m.burstLeft = random(m, [8, 13, 20, 30][m.difficulty]) + [6, 3, 5, 10][m.difficulty];
  }
  private tickBalls(m: CauVongMinigameState, w: MinigameWorld): void {
    const t = this.t;
    if (m.remaining > 0) {
      if (m.spawnWait > 0) --m.spawnWait;
      else if (m.burstWait > 0) --m.burstWait;
      else if (m.burstLeft > 0) {
        const type = random(m, 3),
          kind = random(m, 5);
        const row = t.TRAJECTORIES[type];
        if (m.balls.length >= 280) m.balls = m.balls.slice(7);
        m.balls.push(-20, row[4], Math.trunc(row[1] / row[0]), row[3], row[0], type, kind);
        --m.remaining;
        --m.burstLeft;
        m.burstWait = t.BALL_INTERVAL[m.difficulty];
      } else this.ballBurst(m, false);
    }
    if (m.paddleHit > 0) --m.paddleHit;
    const emptyAtStart = m.balls.length === 0,
      kept: number[] = [];
    for (let i = 0; i < m.balls.length; i += 7) {
      const b = m.balls.slice(i, i + 7),
        row = t.TRAJECTORIES[b[5]];
      b[0] += b[2];
      b[1] -= b[3];
      if (b[4] > 0 && b[3] > 1) --b[3];
      else if (b[4] === 0) b[3] = 0;
      else if (b[4] < 0 && b[3] > -row[3]) --b[3];
      --b[4];
      if (overlap(230, 280, 20, 10, b[0], b[1], 16, 16) || (b[0] > 240 && b[1] < 275)) {
        m.score += t.BALL_POINTS[b[6]];
        continue;
      }
      if (b[1] > 330) continue;
      if (overlap(m.selected, 275, 67, 10, b[0], b[1], 16, 16)) {
        b[4] = row[0];
        b[3] = row[3];
        m.paddleHit = 1;
      }
      kept.push(...b);
    }
    m.balls = kept;
    // ab.c() settles signed points, including debt after the entry fee.
    if (m.remaining === 0 && emptyAtStart)
      this.finish(m, w, m.score > 0, toShort(Math.trunc((m.score * 15) / 10)));
  }
  /** `flip(cell)`: the first card, or the second (judged after 8 ticks). */
  flip(m: CauVongMinigameState, cell: number): void {
    if (
      m.phase !== 2 ||
      m.kind !== 2 ||
      m.countdown > 0 ||
      m.delay !== 0 ||
      cell < 0 ||
      cell >= m.cells.length ||
      m.visible[cell] !== 0 ||
      m.flips[cell] > 0
    )
      return;
    m.visible[cell] = 1;
    m.flips[cell] = 1;
    if (m.first < 0) {
      m.first = cell;
      return;
    }
    m.second = cell;
    m.delay = 8;
  }
  private nextShell(m: CauVongMinigameState): void {
    const t = this.t;
    m.cells = [0, 0, 0];
    m.visible = [0, 0, 0];
    const pool = [83, 30, 55];
    for (let i = 2; i > 0; i--) {
      const j = random(m, i + 1),
        x = pool[i];
      pool[i] = pool[j];
      pool[j] = x;
    }
    for (let i = 0; i < t.SHELL_PETS[m.difficulty]; i++) m.cells[i] = pool[i];
    const j = random(m, 2),
      last = m.cells[2];
    m.cells[2] = m.cells[j];
    m.cells[j] = last;
    for (let i = 0; i < 3; i++) {
      m.shellXY[i * 2] = t.SHELL_X[i];
      m.shellXY[i * 2 + 1] = 0;
    }
    m.swapRemaining = random(m, 2 + m.difficulty) + 2 + m.difficulty;
    m.shuffle = 1;
    m.stage = 0;
    m.revealTicks = 0;
    m.answer = 0;
    m.selected = 0;
    m.delay = 0;
    m.first = m.second = -1;
    m.swapStep = m.swapDuration = m.swapRadius = m.roundResult = 0;
  }
  private tickShell(m: CauVongMinigameState): void {
    const t = this.t;
    if (m.stage === 0) {
      ++m.revealTicks;
      if (m.revealTicks > 20 && m.revealTicks <= 26)
        for (let i = 0; i < 3; i++) m.shellXY[i * 2 + 1] += 25;
      if (m.revealTicks >= 55) {
        m.stage = 1;
        m.revealTicks = 55;
      }
      return;
    }
    if (m.swapStep === 0) {
      if (m.swapRemaining === 0) {
        m.stage = 2;
        m.shuffle = 0;
        do m.answer = m.cells[random(m, 3)];
        while (m.answer === 0);
        return;
      }
      --m.swapRemaining;
      m.first = random(m, 3);
      do m.second = random(m, 3);
      while (m.first === m.second);
      if (m.first > m.second) {
        const x = m.first;
        m.first = m.second;
        m.second = x;
      }
      m.swapRadius = Math.trunc((t.SHELL_X[m.second] - t.SHELL_X[m.first]) / 2);
      m.swapDuration = Math.trunc((m.swapRadius * 2) / [8, 13, 20, 30][m.difficulty]);
      m.swapStep = 1;
      m.delay = m.swapDuration;
      return;
    }
    if (m.swapStep > m.swapDuration) {
      const x = m.cells[m.first];
      m.cells[m.first] = m.cells[m.second];
      m.cells[m.second] = x;
      for (let i = 0; i < 3; i++) {
        m.shellXY[i * 2] = t.SHELL_X[i];
        m.shellXY[i * 2 + 1] = 150;
      }
      m.first = m.second = -1;
      m.swapStep = m.delay = 0;
      return;
    }
    // Start at step one, not two: the native highest-speed two-tick swap otherwise jumps past its
    // only curved frame before it can be painted.
    const step = Math.trunc((2 * m.swapRadius) / m.swapDuration),
      travel = step * m.swapStep;
    const height = Math.trunc(
      Math.sqrt(
        Math.max(
          0,
          m.swapRadius * m.swapRadius - (travel - m.swapRadius) * (travel - m.swapRadius),
        ),
      ),
    );
    m.shellXY[m.first * 2] += step;
    m.shellXY[m.second * 2] -= step;
    m.shellXY[m.first * 2 + 1] = 150 - height;
    m.shellXY[m.second * 2 + 1] = 150 + height;
    ++m.swapStep;
    m.delay = Math.max(0, m.swapDuration - m.swapStep + 1);
  }
  /** `pickShell(choice)`: right or wrong, the chosen shell lifts. */
  pickShell(m: CauVongMinigameState, choice: number): void {
    if (m.phase !== 2 || m.kind !== 3 || m.stage !== 2 || m.shuffle > 0 || choice < 0 || choice > 2)
      return;
    m.selected = choice;
    m.roundResult = m.cells[choice] === m.answer ? 1 : -1;
    m.stage = 3;
    m.revealTicks = 0;
    if (m.roundResult > 0) ++m.rounds;
  }
  private finish(m: CauVongMinigameState, w: MinigameWorld, won: boolean, payout: number): void {
    if (m.phase === 3) return;
    m.phase = 3;
    m.payout = payout;
    if (!won && m.kind === 3 && m.difficulty === 2) m.streak = 0;
    w.setMoney(Math.min(99999999, w.money() + payout));
    if (won) w.mark(m.room, 650200 + m.kind);
    if (m.kind !== 1) m.score = won ? Math.max(1, m.score) : 0;
  }

  // --- the pointer (`pointer(x, y)`), in the 240x320 view ---

  static cardX(t: MinigameTables, m: CauVongMinigameState, i: number): number {
    const cols = t.CARD_COLS[m.difficulty];
    return 120 - Math.trunc((cols * 34) / 2) + (i % cols) * 34;
  }
  static cardY(t: MinigameTables, m: CauVongMinigameState, i: number): number {
    const cols = t.CARD_COLS[m.difficulty];
    return 145 - Math.trunc((t.CARD_ROWS[m.difficulty] * 44) / 2) + Math.trunc(i / cols) * 44;
  }
  /** `pointer`: a press on the board; returns what it stands for (5, back or nothing more). */
  pointer(m: CauVongMinigameState, x: number, y: number): "confirm" | "back" | null {
    if (m.room < 0) return null;
    const t = this.t;
    if (y >= 296) {
      if (x >= 160) return "back";
      return m.phase !== 2 || m.kind >= 2 ? "confirm" : null;
    }
    let press: "confirm" | null = null;
    if (m.phase === 2 && m.kind === 2) {
      for (let i = 0; i < m.cells.length; i++) {
        const cx = CauVongMinigame.cardX(t, m, i),
          cy = CauVongMinigame.cardY(t, m, i);
        if (x >= cx && x < cx + 30 && y >= cy && y < cy + 40) {
          m.selected = i;
          press = "confirm";
          break;
        }
      }
    } else if (m.phase === 2 && m.kind === 1) m.selected = Math.max(0, Math.min(153, x - 33));
    else if (m.phase === 2 && m.kind === 3 && m.stage === 2 && y >= 140 && y < 205) {
      for (let i = 0; i < 3; i++)
        if (Math.abs(x - t.SHELL_X[i]) <= 24) {
          m.selected = i;
          press = "confirm";
        }
    } else if (m.phase === 0 && m.kind === 0 && y >= 260 && y < 288) {
      for (let i = 0; i < 3; i++) if (x >= 33 + i * 67 && x < 71 + i * 67) m.bet = i;
    } else if (m.phase === 1) {
      for (let i = 0; i < 4; i++)
        if (x >= 19 + i * 52 && x < 63 + i * 52) {
          if (y >= 45 && y < 121) m.selected = i;
          if (y >= 226 && y < 266) m.feed = i;
        }
    }
    return press;
  }
}

function overlap(
  x: number,
  y: number,
  w: number,
  h: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return x < bx + bw && x + w > bx && y < by + bh && y + h > by;
}
/** Java's `(short)` cast. */
function toShort(value: number): number {
  return ((value + 32768) & 0xffff) - 32768;
}
