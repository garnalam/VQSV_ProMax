/**
 * Where a 1v1 fight seats its two pets. The JAR's 240x320 screen by default (every test and trace);
 * the landscape app switches to the APK's 320x240 battle screen (`useApkBattleSeats`), whose
 * `cpos.mid` slides the pets into other seats.
 *
 * `player` / `enemy` are the pets' origins (the last `x, y` of their `cpos` row), the markers the
 * ground rings under them (the last `x2, y2`).
 */
export const BATTLE_SEATS = {
  player: { x: 70, y: 223 },
  enemy: { x: 177, y: 103 },
  playerMarker: { x: 36, y: 206 },
  enemyMarker: { x: 144, y: 85 },
};

/** The APK's `cpos.mid` (VQSV-AowVN.org-m.apk), laid out like `CPOS_GROUPS`, in 320x240 pixels. */
export const APK_CPOS_GROUPS: readonly (readonly (readonly number[])[])[] = [
  [
    [400, 33, 240, 81, 291, 33, 250, 60, 249, 60, 208, 65, 225, 80, 198, 60, 227, 75, 194, 58],
    [-400, 175, -80, 200, 0, 115, -32, 140, 65, 140, 30, 140, 77, 155, 40, 145, 75, 160, 42, 140],
  ],
  [
    [400, 17, 240, 48, 260, 7, 218, 45, 218, 46, 183, 43, 205, 59, 170, 47, 208, 55, 173, 43],
    [400, 77, 240, 76, 334, 56, 293, 72, 294, 72, 248, 79, 284, 82, 244, 76, 280, 85, 248, 79],
    [-80, 123, -70, 196, 41, 83, 12, 130, 96, 133, 70, 138, 116, 158, 84, 131, 112, 155, 80, 138],
    [-80, 103, -70, 182, -11, 52, -46, 94, 25, 92, -4, 102, 38, 119, 9, 105, 35, 116, 6, 102],
  ],
  [
    [158, 120, 800, 0, 192, 98, 800, 81, 201, 89, 220, 60, 227, 75, 194, 58],
    [-400, 175, -80, 200, 0, 115, -32, 140, 65, 140, 30, 140, 77, 155, 40, 145, 75, 160, 42, 140],
  ],
];

/** Seats a 1v1 fight where the APK's landscape battle screen does (the landscape app only). */
export function applyApkBattleSeats(): void {
  BATTLE_SEATS.player = { x: 75, y: 160 };
  BATTLE_SEATS.enemy = { x: 227, y: 75 };
  BATTLE_SEATS.playerMarker = { x: 42, y: 140 };
  BATTLE_SEATS.enemyMarker = { x: 194, y: 58 };
  battleSeatTables.cpos = APK_CPOS_GROUPS;
}

/** The `cpos` groups a 1v1 slide reads (the JAR's until `applyApkBattleSeats`). */
export const battleSeatTables: {
  cpos: readonly (readonly (readonly number[])[])[] | null;
} = { cpos: null };
