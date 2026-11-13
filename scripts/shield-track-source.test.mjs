// The shield bar's pixels are graded by `golden-shield-track.json`, but the text drawn beside it is
// not: its colours, its two clipped fields, its width formula and its fallback y are literals inlined
// inside `drawShieldHealthWidget`, and the three clamps that decide what the bar may show are inlined
// in `UnitState`'s constructor. Neither has a callable owner the probe could rasterize, so this guard
// re-reads the Java sources and refuses the build if one of them moves.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "..");
const java = (...parts) => resolve(repo, "rebuild_game", "src", "main", "java", ...parts);

/** The renderer that owns the bar, its text and the two colour constants. */
const RENDERER = readFileSync(java("vqsv", "game", "VqsvBattleRenderer.java"), "utf8");
/** The render state whose constructor clamps the three numbers the bar is drawn from. */
const RENDER_STATE = readFileSync(
  java("vqsv", "battle", "ui", "VqsvBattleRenderState.java"),
  "utf8",
);
/** The TypeScript port of both. */
const SHIELD_TRACK = readFileSync(resolve(root, "src", "game", "battle", "ShieldTrack.ts"), "utf8");
/** The TypeScript call sites, which must keep the widget ids Java passes. */
const BATTLE_RENDERER = readFileSync(
  resolve(root, "src", "rendering", "BattleRenderer.ts"),
  "utf8",
);

/** One Java method body, sliced from its signature to the closing brace at that file's indent. */
function method(source, signature, closing) {
  const start = source.indexOf(signature);
  expect(start, `${signature} no longer exists in the Java source`).toBeGreaterThan(-1);
  const end = source.indexOf(closing, start);
  expect(end, `${signature} no longer ends with ${JSON.stringify(closing)}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

/** The renderer keeps its methods at three spaces; the render state is a nested class at eight. */
const RENDERER_END = "\n   }";
const STATE_END = "\n        }";

/** The Java hex literal a colour line paints with, as the hash-prefixed digits TypeScript writes. */
function hex(javaHex) {
  return `#${javaHex.slice(2).toLowerCase()}`;
}

/** One `export const NAME = "#rrggbb"` in the port, read back as the hex digits. */
function portColor(name) {
  const match = SHIELD_TRACK.match(new RegExp(`export const ${name} = "#([0-9a-f]{6})";`));
  expect(match, `the port no longer declares ${name} as a six-digit hex`).toBeTruthy();
  return `#${match[1]}`;
}

const TRACK = method(RENDERER, "static void drawShieldHealthTrack", RENDERER_END);
const WIDGET = method(RENDERER, "private static void drawShieldHealthWidget", RENDERER_END);
/** The one `UnitState` constructor that takes a shield, which is also the one that clamps everything. */
const UNIT_STATE = method(RENDER_STATE, "int nature, int shieldHp) {", STATE_END);
/** The two pixel methods the track's segments come from. */
const PIXELS =
  method(RENDER_STATE, "public int redHpPixels(int width) {", STATE_END) +
  method(RENDER_STATE, "public int blueShieldPixels(int width) {", STATE_END);

it("keeps the bar's refusal, fill order and colours the renderer paints", () => {
  // A track too narrow to hold a frame plus two pixels paints nothing at all, frame included.
  expect(TRACK).toContain("if(width<3||height<3)return;");
  expect(TRACK).toContain(
    "int inner=width-2,red=unit.redHpPixels(inner),blue=unit.blueShieldPixels(inner);",
  );
  // The frame, then the depleted track, then each segment body with its highlight row over it.
  expect(TRACK).toContain("g.setColor(new Color(0x0A121C));g.fillRect(x,y,width,height);");
  expect(TRACK).toContain("g.setColor(new Color(0x263849));g.fillRect(x+1,y+1,inner,height-2);");
  expect(TRACK).toContain(
    "if(red>0){g.setColor(new Color(HEALTH_RED));g.fillRect(x+1,y+1,red,height-2);" +
      "g.setColor(new Color(0xFF8980));g.fillRect(x+1,y+1,red,1);}",
  );
  expect(TRACK).toContain(
    "if(blue>0){g.setColor(new Color(SHIELD_BLUE));g.fillRect(x+1+red,y+1,blue,height-2);" +
      "g.setColor(new Color(0x80CFFF));g.fillRect(x+1+red,y+1,blue,1);}",
  );
  // The two named constants the track reads, and the six colours the port therefore has to carry.
  expect(RENDERER).toContain("static final int HEALTH_RED = 0xE95151;");
  expect(RENDERER).toContain("static final int SHIELD_BLUE = 0x2B90F5;");
  expect(portColor("HEALTH_RED")).toBe(hex("0xe95151"));
  expect(portColor("HEALTH_HIGHLIGHT")).toBe(hex("0xff8980"));
  expect(portColor("SHIELD_BLUE")).toBe(hex("0x2b90f5"));
  expect(portColor("SHIELD_HIGHLIGHT")).toBe(hex("0x80cfff"));
  expect(portColor("FRAME")).toBe(hex("0x0a121c"));
  expect(portColor("DEPLETED")).toBe(hex("0x263849"));
});

it("keeps the widget's text branch, fields and colours the pixels cannot show", () => {
  // One `hp/maxHp` field while the clamped pool is zero; two clipped fields once it is not.
  expect(WIDGET).toContain("if(unit.shieldHp<=0){");
  expect(WIDGET).toContain(
    'drawBattleUiText(g,font,layout,textId,unit.hp+"/"+unit.maxHp,new Color(0xFFB9AD),tick);return;}',
  );
  // The split fields sit over the bar, half of it each, and fall back to three pixels above it when
  // the layout has no text widget.
  expect(WIDGET).toContain("var text=layout.widget(textId);int y=text==null?bar.y-3:text.y;");
  expect(WIDGET).toContain("int width=Math.max(1,(bar.w-4)/2);");
  expect(WIDGET).toContain(
    "drawSourceWidgetText(g,font,String.valueOf(unit.hp),bar.x+1,y,width,10,new Color(0xFFD0C5),tick,0);",
  );
  expect(WIDGET).toContain(
    'drawSourceWidgetText(g,font,"+"+unit.shieldHp,bar.x+3+width,y,width,10,new Color(0x80D0FF),tick,2);',
  );
  expect(portColor("COMBINED_TEXT")).toBe(hex("0xffb9ad"));
  expect(portColor("HP_FIELD_TEXT")).toBe(hex("0xffd0c5"));
  expect(portColor("SHIELD_FIELD_TEXT")).toBe(hex("0x80d0ff"));
  // The port restates the same branch, width and offsets rather than re-deriving them.
  expect(SHIELD_TRACK).toContain("if (unit.shieldHp <= 0) {");
  expect(SHIELD_TRACK).toContain("value: `${unit.hp}/${unit.maxHp}`,");
  expect(SHIELD_TRACK).toContain("fieldWidth: Math.max(1, Math.floor((barWidth - 4) / 2)),");
  expect(SHIELD_TRACK).toContain("shield: `+${unit.shieldHp}`,");
});

it("keeps the render-state clamps and the shared-capacity arithmetic under the bar", () => {
  // A fainted unit has no shield, and a negative pool is not a negative segment.
  expect(UNIT_STATE).toContain("this.hp = Math.max(0, hp);");
  expect(UNIT_STATE).toContain("this.maxHp = Math.max(0, maxHp);");
  expect(UNIT_STATE).toContain("this.shieldHp = this.hp > 0 ? Math.max(0,shieldHp) : 0;");
  // The whole bar is scaled by `maxHp + shieldHp`, in long so an overflow pool still divides.
  expect(PIXELS).toContain("long capacity=(long)maxHp+shieldHp;");
  expect(PIXELS).toContain("int red=(int)((long)Math.min(hp,maxHp)*width/capacity);");
  expect(PIXELS).toContain("return shieldHp>0&&width>1?Math.max(1,Math.min(width-1,red)):red;");
  expect(PIXELS).toContain("int filled=(int)(((long)Math.min(hp,maxHp)+shieldHp)*width/capacity);");
  expect(PIXELS).toContain(
    "return Math.max(1,Math.min(width-redHpPixels(width),filled-redHpPixels(width)));",
  );
  expect(SHIELD_TRACK).toContain("const capacity = unit.maxHp + unit.shieldHp;");
});

it("draws both bars on the widget ids the source draws them on", () => {
  // 14 is the enemy's track and 39 its text; 11 and 38 are the player's. The source calls the widget
  // twice, once per render pass, and every one of those calls uses the same pair.
  const enemy = RENDERER.match(/drawShieldHealthWidget\([^)]*?,\s*14,\s*39,\s*[^)]*\)/g) ?? [];
  const player = RENDERER.match(/drawShieldHealthWidget\([^)]*?,\s*11,\s*38,\s*[^)]*\)/g) ?? [];
  expect(enemy).toHaveLength(2);
  expect(player).toHaveLength(1);
  const calls = BATTLE_RENDERER.match(/this\.health\(\s*g,\s*(\d+),\s*(\d+),/g) ?? [];
  expect(calls.map((call) => call.replace(/\s+/g, " "))).toEqual([
    "this.health( g, 14, 39,",
    "this.health( g, 11, 38,",
  ]);
});
