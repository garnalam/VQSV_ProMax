type Point = { x: number; y: number };
const GOLD = "#ffdb86";
const AMBER = "#ff9c42";

function polygon(g: CanvasRenderingContext2D, points: number[][], color: string): void {
  g.fillStyle = color;
  g.beginPath();
  for (const [x, y] of points) g.lineTo(x, y);
  g.closePath();
  g.fill();
}

function ring(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
): void {
  g.strokeStyle = color;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.stroke();
}

function diamond(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  polygon(
    g,
    [
      [x, y - size],
      [x + size, y],
      [x, y + size],
      [x - size, y],
    ],
    color,
  );
}

export function drawKimDiemLanding(
  g: CanvasRenderingContext2D,
  tick: number,
  { x, y }: Point,
): void {
  if (tick < 6 || tick >= 32) return;
  g.save();
  if (tick < 21) {
    const radius = 14 + 2 * Math.max(0, tick - 9);
    g.fillStyle = "rgba(37,19,34,.5)";
    g.beginPath();
    g.ellipse(x, y + 1, radius, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 148 / 255;
    ring(g, x, y + 1, radius, 4, AMBER);
  } else {
    const age = tick - 21;
    g.globalAlpha = (235 - 18 * age) / 255;
    ring(g, x, y + 2, 14 + age * 6, 4 + age, GOLD);
    ring(g, x, y + 3, 8 + age * 4, 3 + age, AMBER);
    for (let i = 0; i < 20; i++) {
      const dx = (i % 2 ? 1 : -1) * (5 + ((i % 7) + 2) * age);
      const dy = 3 - age * Math.max(1, 7 - (i % 6) - Math.trunc(age / 2));
      diamond(g, x + dx, y + dy, 1 + (i % 3), i % 4 ? "#bf8158" : GOLD);
    }
  }
  g.restore();
}

function sigil(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  tick: number,
  opacity: number,
): void {
  g.globalAlpha = opacity / 255;
  ring(g, x, y, rx, ry, GOLD);
  ring(g, x, y, rx - 4, ry - 3, AMBER);
  for (let i = 0; i < 8; i++) {
    const angle = ((i + tick * 0.08) * Math.PI) / 4;
    diamond(g, x + Math.trunc(Math.cos(angle) * rx), y + Math.trunc(Math.sin(angle) * ry), 2, GOLD);
  }
}

export function drawKimDiemOverlay(
  g: CanvasRenderingContext2D,
  tick: number,
  boss: Point,
  player: Point,
  screen: { width: number; height: number },
  drawLabel: (x: number, y: number, width: number, color: string) => void,
): void {
  g.save();
  const center = screen.width / 2;
  const middle = screen.height / 2;
  if (tick >= 26 && tick < 51) {
    const age = tick - 26;
    g.globalAlpha = Math.min(age * 80, (51 - tick) * 72, 255) / 255;
    g.fillStyle = "#000";
    g.fillRect(0, 0, screen.width, screen.height);
    const opening = Math.min(12, age - 4);
    if (opening > 0 && age < 23) {
      g.globalAlpha = age <= 18 ? 1 : ((23 - age) * 48) / 255;
      const y = middle - 12;
      const third = Math.trunc(opening / 3),
        half = Math.trunc(opening / 2),
        quarter = Math.trunc(opening / 4);
      for (const dir of [1, -1]) {
        const x = center - 33 * dir;
        polygon(
          g,
          [
            [x - 24 * dir, y - third],
            [x - 14 * dir, y - opening],
            [x + 5 * dir, y - half],
            [x + 20 * dir, y + quarter],
            [x + 5 * dir, y + half],
            [x - 11 * dir, y + half],
          ],
          "#760917",
        );
        polygon(
          g,
          [
            [x - 18 * dir, y - quarter],
            [x - 11 * dir, y - Math.trunc((2 * opening) / 3)],
            [x + 6 * dir, y - third],
            [x + 15 * dir, y],
            [x + 3 * dir, y + third],
            [x - 9 * dir, y + third],
          ],
          "#ff3939",
        );
        if (opening >= 5)
          polygon(
            g,
            [
              [x - 2, y],
              [x, y - half],
              [x + 2, y],
              [x, y + third],
            ],
            "#300008",
          );
      }
    }
  }
  if (tick >= 61 && tick < 77) {
    for (let i = 2; i >= 0; i--) {
      const age = tick - 61 - i * 2;
      if (age < 0 || age >= 14) continue;
      const progress = Math.min(10, age);
      const x = boss.x - 19 + Math.trunc(((player.x - boss.x + 19) * progress) / 10);
      const y = boss.y - 55 + Math.trunc(((player.y - boss.y + 43) * progress) / 10);
      sigil(g, x, y, 8 + 3 * progress, 4 + progress, tick + i, 230 - i * 65);
    }
  }
  if (tick >= 71) {
    const age = tick - 71;
    sigil(g, player.x, player.y - 8, 35 + (age % 4), 10, tick, Math.max(50, 230 - age * 9));
    const lockX = player.x - 20,
      lockY = player.y - 45;
    g.globalAlpha = 230 / 255;
    g.fillStyle = "#292534";
    g.fillRect(lockX - 7, lockY - 7, 15, 16);
    g.globalAlpha = 1;
    g.strokeStyle = GOLD;
    g.strokeRect(lockX - 7, lockY - 7, 14, 15);
    ring(g, lockX, lockY - 1.5, 3, 3.5, GOLD);
    g.fillStyle = GOLD;
    g.fillRect(lockX - 4, lockY - 1, 9, 6);
    g.fillStyle = "#513022";
    g.fillRect(lockX, lockY + 1, 1, 3);
    const panelX = center - 108,
      panelY = middle - 13;
    g.fillStyle = "rgba(16,52,69,.98)";
    g.fillRect(panelX, panelY, 216, 24);
    g.strokeStyle = "#88ddef";
    g.strokeRect(panelX, panelY, 215, 23);
    g.strokeStyle = "#296af5";
    g.strokeRect(panelX + 1, panelY + 1, 213, 21);
    drawLabel(panelX, panelY + 7, 216, GOLD);
  }
  g.restore();
}
