// CV0' Thiên Không: `CauVongMinigameView` (rebuild_game/src/main/java/vqsv/game), the 240x320 board
// `VqsvSceneView.render` draws instead of the room while a summon-room game is open
// (`CauVongSummoningMinigame.render`). Native layouts, composition origins and unscaled source art:
// the bird (13302), the finish line (bank 13300) and arena (bank 13301), the paddle (npc2 group 38's
// compositions 3/4, sprite 11400), `RainbowMinigameArt`'s cloud, brow/m0, m2, m3, ui and item.

import { CauVongMinigame, type CauVongMinigameState, type MinigameTables } from "./CauVongMinigame";

/** `RainbowMinigameArt` and the sprite banks the board draws from. */
export type MinigameArt = {
  font: {
    width(raw: string): number;
    drawTagged(g: CanvasRenderingContext2D, raw: string, x: number, y: number, color: string): void;
  };
  /** `RainbowMinigameArt.image(name)`: cloud, brow/m0, brow/m2, brow/m3. */
  image(name: string): HTMLImageElement | undefined;
  /** `RainbowMinigameArt.icon(g, item, id, x, y, centered)`. */
  icon(
    g: CanvasRenderingContext2D,
    item: boolean,
    id: number,
    x: number,
    y: number,
    centered: boolean,
  ): void;
  /** `drawCell` of a composition bank. */
  bankCell(g: CanvasRenderingContext2D, bank: number, cell: number, x: number, y: number): void;
  /** `drawSourceRegion` of a composition bank. */
  bankRegion(
    g: CanvasRenderingContext2D,
    bank: number,
    region: number,
    x: number,
    y: number,
    mirrored: boolean,
  ): void;
  /** A looping sprite at `tick`. */
  sprite(
    g: CanvasRenderingContext2D,
    sprite: number,
    state: number,
    tick: number,
    x: number,
    y: number,
  ): void;
  /** A sprite played once and held on its last frame. */
  held(
    g: CanvasRenderingContext2D,
    sprite: number,
    state: number,
    elapsed: number,
    x: number,
    y: number,
  ): void;
  money: number;
  /** `eventDone(64, 650250)`: the gold room's streak pet was handed. */
  streakPaid: boolean;
};

export const MINIGAME_BIRD = 13302,
  MINIGAME_FINISH = 13300,
  MINIGAME_ARENA = 13301,
  MINIGAME_PADDLE = 11400;

const PANELS = [15400191, 12352252, 12313343, 5228543, 30975, 11121884];
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

export function renderCauVongMinigame(
  g: CanvasRenderingContext2D,
  m: CauVongMinigameState,
  t: MinigameTables,
  art: MinigameArt,
): void {
  g.save();
  g.beginPath();
  g.rect(0, 0, 240, 320);
  g.clip();
  const v = new View(g, m, t, art);
  try {
    v.render();
  } finally {
    g.restore();
  }
}

class View {
  constructor(
    private readonly g: CanvasRenderingContext2D,
    private readonly m: CauVongMinigameState,
    private readonly t: MinigameTables,
    private readonly art: MinigameArt,
  ) {}
  render(): void {
    const { g, m } = this;
    this.fill(5422575);
    if (m.phase === 0) {
      this.rules();
      this.footer("Bắt đầu");
      return;
    }
    if (m.phase === 1) {
      this.selection();
      this.footer("Đua");
      return;
    }
    if (m.kind === 0) this.race();
    else if (m.kind === 1) this.balls();
    else if (m.kind === 2) this.memory();
    else this.shells();
    if (m.phase === 3) {
      this.panel(14, 196, 212, 93, 4);
      this.center(m.score > 0 ? "Thắng!" : "Chưa vượt qua", 208, 0xffe92d);
      this.center(m.payout < 0 ? `Trừ: ${-m.payout} kim` : `Nhận: ${m.payout} kim`, 233, 0xffffff);
      if (m.kind === 3 && m.difficulty === 2 && m.streak === 3 && !this.art.streakPaid)
        this.text("Pet thưởng đang chờ chỗ trống.", 22, 258, 0xffffff);
    }
    if (m.kind !== 1 || m.phase === 3)
      this.footer(
        m.phase === 3
          ? "Tiếp tục"
          : m.kind === 0
            ? "Đang đua"
            : m.kind === 3 && m.stage === 3
              ? "Tiếp tục"
              : "Chọn / 5",
      );
    else {
      this.panel(0, 303, 240, 17, 4);
      this.text("← / →: đỡ bóng", 7, 303, 0xffffff);
      this.text("Thoát", 185, 303, 0xffffff);
    }
    void g;
  }
  private rules(): void {
    const { m, t } = this;
    this.center(t.names[m.kind], 6, 0xffffff);
    this.panel(9, 32, 222, 200, 4);
    this.panel(10, 237, 220, 51, 4);
    const rules =
      m.kind === 0
        ? "Chọn một trong 4 pet đua.#nPet về đích đầu tiên thắng.#nCược 100 → nhận 120 kim.#nCược 300 → nhận 350 kim.#nCược 1000 → nhận 1200 kim.#nĐạo cụ: 10 kim mỗi lần."
        : m.kind === 1
          ? "Dùng ← / → di chuyển pet đỡ bóng để bóng nảy vào khung bên phải.#nBóng vào khung mới có điểm.#nMỗi điểm đổi được 1,5 kim.#nBóng xấu trừ 10 điểm.#nĐiểm âm sẽ bị trừ thêm kim."
          : m.kind === 2
            ? "Ghi nhớ hình trên các lá bài.#nXem trước khi hết đếm ngược.#nChọn 2 lá có hình giống nhau.#nGhép hết các cặp để thắng.#nLật sai bị mất một lượt.#nDùng phím hướng và phím 5 hoặc bấm trực tiếp vào lá bài."
            : `Ghi nhớ pet trong các thùng.#nTheo dõi khi thùng đổi chỗ.#nChọn thùng chứa pet được hỏi.#nCần thắng ${t.SHELL_ROUNDS[m.difficulty]} lượt liên tiếp.#nBấm thùng hoặc dùng ← / → và phím 5 để chọn.`;
    let lineY = 39;
    for (const paragraph of rules.split("#n")) {
      let line = "";
      for (const word of paragraph.split(" ")) {
        const next = line ? `${line} ${word}` : word;
        if (this.art.font.width(next) > 204 && line) {
          this.text(line, 18, lineY, 0xffffff);
          lineY += 17;
          line = word;
        } else line = next;
      }
      this.text(line, 18, lineY, 0xffffff);
      lineY += 20;
    }
    if (m.kind === 1)
      for (let i = 0; i < 5; i++) {
        const x = 20 + i * 44;
        this.art.icon(this.g, true, t.BALL_ICONS[i], x + 12, 192, true);
        this.text(`${t.BALL_POINTS[i] > 0 ? "+" : ""}${t.BALL_POINTS[i]}`, x, 211, 0xffffff);
      }
    if (m.kind === 0) {
      this.text("Chọn mức cược:", 19, 240, 0xffffff);
      for (let i = 0; i < 3; i++) {
        this.panel(33 + i * 67, 264, 38, 21, 1);
        this.text(String(t.BETS[i]), 35 + i * 67, 265, 0x1d1e35);
        if (m.bet === i) this.outline(33 + i * 67, 264, 38, 21);
      }
    } else
      this.text(
        `Phí tham gia: ${CauVongMinigame.fee(t, m.kind, m.difficulty, 0)} kim`,
        19,
        250,
        0xffffff,
      );
    this.entryHint();
  }
  private selection(): void {
    const { m, t } = this;
    this.panel(10, 15, 220, 270, 4);
    this.text("Chọn pet đặt cược:", 19, 21, 0xffffff);
    for (let i = 0; i < 4; i++) {
      const x = 19 + i * 52;
      this.panel(x, 45, 44, 76, 1);
      if (i === m.selected) this.art.sprite(this.g, MINIGAME_BIRD, 0, m.ticks, 41 + i * 52, 119);
      else this.art.held(this.g, MINIGAME_BIRD, 0, m.ticks, 41 + i * 52, 119);
      this.text(String(i + 1), x + 20, 50, 0x1d1e35);
      if (m.selected === i) this.outline(x, 45, 44, 76);
    }
    this.text("Đạo cụ: 10 kim mỗi lần", 19, 145, 0xffffff);
    this.text("↑ / ↓ để chọn số lần", 19, 171, 0xffffff);
    for (let i = 0; i < 4; i++) {
      const x = 19 + i * 52;
      this.panel(x, 226, 44, 40, 1);
      this.art.icon(this.g, true, 12, x + 4, 238, false);
      this.text(`x${i}`, x + 22, 239, 0x1d1e35);
      if (m.feed === i) this.outline(x, 226, 44, 40);
    }
    this.text(`Tổng phí: ${t.BETS[m.bet] + m.feed * 10} kim`, 19, 270, 0xffffff);
    this.entryHint();
  }
  private entryHint(): void {
    const m = this.m;
    const hint =
      m.roundResult < 0
        ? "Không đủ kim tiền"
        : m.roundResult > 0
          ? "Cần chỗ trống để nhận pet thưởng"
          : `Kim: ${this.art.money}`;
    this.text(hint, 18, 286, m.roundResult === 0 ? 0x1d1e35 : 0x8e1425);
  }
  private race(): void {
    const { g, m, art } = this;
    this.fill(5423359);
    const cloud = art.image("cloud");
    if (cloud?.complete)
      for (let i = 0; i < 10; i++)
        g.drawImage(cloud, m.clouds[i * 3], m.clouds[i * 3 + 1] - m.camera);
    art.bankRegion(g, MINIGAME_FINISH, 0, 0, 40 - m.camera, false);
    for (let i = 0; i < 5; i++)
      art.bankRegion(g, MINIGAME_FINISH, 1, 35 + i * 35, 44 - m.camera, false);
    art.bankRegion(g, MINIGAME_FINISH, 0, 240, 40 - m.camera, true);
    for (let i = 0; i < 4; i++) {
      art.sprite(g, MINIGAME_BIRD, 1, m.ticks, 41 + i * 52, m.race[i] - m.camera);
      this.text(
        String(i + 1),
        38 + i * 52,
        m.race[i] - m.camera - 55,
        i === m.selected ? 0xffe92d : 0x1d1e35,
      );
    }
    if (m.countdown > 0)
      this.center(String(Math.max(1, Math.trunc(m.countdown / 20))), 151, 0xffe92d);
    this.text(`Cược pet ${m.selected + 1}`, 12, 10, 0x1d1e35);
  }
  private balls(): void {
    const { g, m, t, art } = this;
    this.fill(5423359);
    art.bankCell(g, MINIGAME_ARENA, 0, 120, 160);
    const goal = art.image("brow/m0");
    if (goal?.complete) g.drawImage(goal, 240 - goal.width, 305 - goal.height);
    for (let i = 0; i < m.balls.length; i += 7)
      art.icon(g, true, t.BALL_ICONS[m.balls[i + 6]], m.balls[i], m.balls[i + 1], false);
    // ab draws composition 3/4, not animation state 3/4 (another pet variant).
    for (let i = 0; i < 2; i++)
      art.sprite(g, MINIGAME_PADDLE, m.paddleHit === 0 ? 3 : 4, 0, m.selected + i * 30 + 20, 300);
    this.panel(0, 0, 240, 25, 4);
    this.text(`Điểm: ${m.score}`, 5, 4, 0xffffff);
    this.text(`Bóng: ${m.remaining}`, 140, 4, 0xffffff);
  }
  private memory(): void {
    const { g, m, t, art } = this;
    this.panel(10, 27, 220, 240, 4);
    this.panel(10, 272, 220, 25, 4);
    for (let i = 0; i < m.cells.length; i++) {
      const x = CauVongMinigame.cardX(t, m, i),
        y = CauVongMinigame.cardY(t, m, i);
      if (m.flips[i] > 0) {
        this.panel(x + 13, y - 3, 5, 46, 1);
        continue;
      }
      const face = m.countdown > 0 || m.visible[i] > 0;
      this.panel(x, y, 30, 40, face ? 5 : 1);
      art.icon(g, face, face ? m.cells[i] : 25, x + 15, y + 20, true);
      if (face) {
        const n = String(m.cells[i]);
        this.text(n, x + 28 - art.font.width(n), y + 29, 0x1d1e35);
      }
    }
    this.outline(
      CauVongMinigame.cardX(t, m, m.selected),
      CauVongMinigame.cardY(t, m, m.selected),
      30,
      40,
    );
    this.center(
      m.countdown > 0 ? `Ghi nhớ: ${Math.trunc((m.countdown + 9) / 10)}` : "Lật hai lá giống nhau",
      5,
      0xffffff,
    );
    this.text(`Lượt sai còn: ${m.mistakes}`, 22, 276, 0xffffff);
  }
  private shells(): void {
    const { g, m, t, art } = this;
    this.panel(2, 27, 236, 270, 4);
    this.panel(4, 51, 232, 235, 4);
    this.center(`Số lần thắng: ${m.rounds}/${t.SHELL_ROUNDS[m.difficulty]}`, 5, 0xffffff);
    const chest = art.image("brow/m3"),
      drawChest = (x: number, y: number) => {
        if (chest?.complete) g.drawImage(chest, x - Math.trunc(chest.width / 2), y);
      };
    if (m.stage === 0) {
      g.save();
      g.beginPath();
      g.rect(0, 65, 240, 100);
      g.clip();
      const sink = m.revealTicks >= 40 ? Math.min(40, (m.revealTicks - 40) * 5) : 0;
      for (let i = 0; i < 3; i++)
        if (m.cells[i] > 0) this.pet(m.cells[i], m.shellXY[i * 2], 165 + sink);
      g.restore();
      if (m.revealTicks >= 20)
        for (let i = 0; i < 3; i++) drawChest(m.shellXY[i * 2], m.shellXY[i * 2 + 1]);
      this.center("Ghi nhớ pet trong thùng", 249, 0xffffff);
      return;
    }
    if (m.stage !== 3)
      for (let i = 0; i < 3; i++) drawChest(m.shellXY[i * 2], m.shellXY[i * 2 + 1]);
    if (m.stage === 1) {
      this.center("Theo dõi thùng đổi chỗ", 249, 0xffffff);
      return;
    }
    this.pet(m.answer, 117, 135);
    if (m.stage === 2) {
      const arrow = art.image("brow/m2");
      if (arrow?.complete)
        g.drawImage(
          arrow,
          t.SHELL_X[m.selected] - Math.trunc(arrow.width / 2),
          125 - (m.ticks % 4 <= 2 ? 5 : 0),
        );
      const pet = t.shellPets[String(m.answer)];
      this.center(pet ? pet.name : "Pet ở thùng nào?", 229, 0xffe92d);
      this.center("Ở trong thùng nào?", 250, 0xffffff);
    } else {
      const x = m.shellXY[m.selected * 2],
        y = m.shellXY[m.selected * 2 + 1];
      drawChest(x, y);
      if (m.cells[m.selected] > 0) this.pet(m.cells[m.selected], x, y + 35);
      this.center(m.roundResult > 0 ? "Chọn đúng!" : "Chưa đúng", 250, 0xffe92d);
    }
  }
  /** `drawPet`: state 0 of the pool pet's visual, at its first frame. */
  private pet(id: number, x: number, y: number): void {
    const visual = this.t.shellPets[String(id)]?.visual;
    if (id > 0 && visual !== undefined) this.art.sprite(this.g, visual, 0, 0, x, y);
  }
  private fill(color: number): void {
    this.g.fillStyle = hex(color);
    this.g.fillRect(0, 0, 240, 320);
  }
  private panel(x: number, y: number, w: number, h: number, type: number): void {
    const g = this.g;
    g.fillStyle = hex(PANELS[type]);
    g.fillRect(x + 1, y, w - 2, h);
    g.fillRect(x, y + 1, w, h - 2);
  }
  /** Java's two `drawRect`s: 1 px frames at (x-1, y-1, w+2, h+2) and (x-2, y-2, w+4, h+4). */
  private outline(x: number, y: number, w: number, h: number): void {
    const g = this.g;
    g.strokeStyle = hex(0xffe92d);
    g.lineWidth = 1;
    g.strokeRect(x - 1 + 0.5, y - 1 + 0.5, w + 1, h + 1);
    g.strokeRect(x - 2 + 0.5, y - 2 + 0.5, w + 3, h + 3);
  }
  private footer(action: string): void {
    this.panel(0, 300, 240, 20, 4);
    this.text(action, 10, 303, 0xffffff);
    this.text("Quay lại", 177, 303, 0xffffff);
  }
  private center(value: string, y: number, color: number): void {
    this.text(value, Math.max(4, Math.trunc((240 - this.art.font.width(value)) / 2)), y, color);
  }
  private text(value: string, x: number, y: number, color: number): void {
    this.art.font.drawTagged(this.g, value, x, y, hex(color));
  }
}
