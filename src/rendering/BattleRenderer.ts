import { romanTier } from "../game/charm/RainbowCharms";
import { midpMatrix, type SkillFxDraw } from "../game/battle/SkillFx";
import type { BootAssets } from "../pack/boot";
import type {
  BattleRuntime,
  SignatureFxPlacement,
  StatusStripSlot,
} from "../game/battle/BattleRuntime";
import type { BattleSide } from "../game/battle/BattleDefinition";
import type { DoubleBattleRuntime, DoubleDeathView } from "../game/battle/DoubleBattleRuntime";
import type { DoubleSlot } from "../game/battle/engine/DoubleBattleTypes";
import type { SourceSpecialPlacement } from "../game/battle/SourceSkillAnimation";
import type { GameAssets } from "../game/story/GameAssets";
import type { SourceUiWidget } from "./SourceUiLayout";
import { BattleUiRenderer } from "./BattleUiRenderer";
import { StateOneLEffectPainter } from "./StateOneLEffectPainter";
import { npcEnemyEntryAt, npcEnemyEntryView } from "../game/battle/NpcEnemyEntry";
import {
  shieldTrackRects,
  shieldTrackText,
  shieldTrackUnit,
  type ShieldTrackUnit,
} from "../game/battle/ShieldTrack";

/**
 * `battlePetOrientation`: Cầu Vồng (1000..) and V4 (2000..) art faces the other way on the player's
 * side; the custom bosses' art (Tàn Nguyệt Long Ma 3004, Kim Diễm Long Vương 3006) faces right, so
 * it is mirrored on either side to face the fight.
 */
export function mirroredPetArt(spriteId: number, playerSide: boolean): boolean {
  if (spriteId === 3004 || spriteId === 3006) return true;
  return (
    playerSide && ((spriteId >= 1000 && spriteId < 1102) || (spriteId >= 2000 && spriteId < 2072))
  );
}

/**
 * `VqsvBattleRenderer.sourceHorizontalScrollOffset`: a HUD text wider than its widget starts half a
 * widget in, walks 2 px a tick until it has run past its own width, then re-enters from the right.
 */
export function sourceHorizontalScrollOffset(
  textWidth: number,
  width: number,
  tick: number,
): number {
  let offset = -Math.trunc(width / 2);
  for (let step = Math.max(0, tick) + 1; step > 0; step--)
    offset = textWidth > offset ? offset + 2 : -width;
  return offset;
}

export class BattleRenderer {
  private readonly ui: BattleUiRenderer;
  private readonly motion = new WeakMap<
    BattleRuntime,
    {
      tick: number;
      previous: Record<BattleSide, { x: number; y: number }>;
      current: Record<BattleSide, { x: number; y: number }>;
    }
  >();
  private readonly opaqueBounds = new WeakMap<
    HTMLImageElement,
    { x: number; y: number; width: number; height: number }
  >();
  constructor(
    private readonly assets: GameAssets,
    private readonly boot: BootAssets,
  ) {
    this.ui = new BattleUiRenderer(assets, boot);
    this.lEffect = new StateOneLEffectPainter((visual) => assets.lEffectPicture(visual));
  }
  private readonly lEffect: StateOneLEffectPainter;
  render(g: CanvasRenderingContext2D, battle: BattleRuntime, alpha = 1): void {
    if (battle.phase.key === "NPC_VS_ENTRY") {
      this.drawEntry(g, battle);
      return;
    }
    g.fillStyle = "rgba(0,0,0,0.5490196078)";
    g.fillRect(0, 0, 240, 320);
    this.widget(g, 1, 92);
    this.widget(g, 2, 93);
    this.widget(g, 19, 101);
    g.fillStyle = "#00b5d8";
    g.fillRect(91, 248, 10, 10);
    this.element(g, 18, battle.combatant("enemy").element);
    this.element(g, 17, battle.combatant("player").element);
    this.sprite(g, 294, 0, battle.tickCount, 144, 85);
    this.sprite(g, 294, 0, battle.tickCount, 36, 206);
    if (battle.activeMarker) {
      const marker = battle.activeMarkerSide === "player" ? { x: 36, y: 206 } : { x: 144, y: 85 };
      this.sprite(g, 294, 1, battle.tickCount, marker.x, marker.y);
    }
    this.actorWithLEffect(g, battle, "enemy", alpha);
    this.actorWithLEffect(g, battle, "player", alpha);
    const summon = battle.summonVisual;
    if (summon) {
      this.sprite(g, 269, summon.recall ? 1 : 0, summon.tick, summon.x, summon.y);
      if (summon.recall) {
        g.fillStyle = "rgba(255,255,255,0.45)";
        g.beginPath();
        g.arc(summon.x, summon.y, 5 + (summon.tick % 3) * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    const capture = battle.captureVisual;
    if (capture) this.capture(g, battle, capture);
    const effect = battle.attackEffect;
    if (effect) {
      const target = battle.combatant(effect.target);
      if (effect.timed)
        this.sprite(
          g,
          effect.spriteId,
          effect.state,
          effect.cursor,
          target.origin.x,
          target.origin.y,
        );
      else
        this.spriteCursor(
          g,
          effect.spriteId,
          effect.state,
          effect.cursor,
          target.origin.x,
          target.origin.y,
        );
    }
    for (const placed of battle.sourceActorEffects) {
      const origin = battle.combatant(placed.side).origin;
      this.heldSprite(g, {
        sprite: placed.sprite,
        state: placed.state,
        elapsed: placed.elapsed,
        x: origin.x,
        y: origin.y,
        mirror: placed.side === "player",
      });
    }
    const sourceSpecial = battle.sourceSpecialEffect;
    if (sourceSpecial) this.sourceSpecial(g, battle, sourceSpecial);
    this.skillFx(g, battle.skillFxDraws);
    for (const placed of battle.signatureFxSprites) this.heldSprite(g, placed);
    const enemy = battle.combatant("enemy"),
      player = battle.combatant("player");
    this.marqueeText(g, 15, enemy.name, "#ffffff", battle.tickCount);
    this.text(g, 16, `lv${enemy.level}`, "#ffffff");
    this.marqueeText(g, 12, player.name, "#ffffff", battle.tickCount);
    this.text(g, 13, `lv${player.level}`, "#ffffff");
    this.health(
      g,
      14,
      39,
      shieldTrackUnit(battle.hp("enemy"), enemy.maxHp, battle.shield("enemy")),
      battle.tickCount,
    );
    this.health(
      g,
      11,
      38,
      shieldTrackUnit(battle.hp("player"), player.maxHp, battle.shield("player")),
      battle.tickCount,
    );
    const exp = battle.experienceBar;
    this.percent(g, 9, exp.max > 0 ? Math.floor((100 * exp.value) / exp.max) : 0);
    this.statusSlots(g, battle, "enemy");
    this.statusSlots(g, battle, "player");
    this.text(g, 40, `${exp.value}/${exp.max}`, "#fff7b1");
    this.charmHud(g, battle);
    this.ui.render(g, battle);
    const damage = battle.damage;
    if (damage) {
      const target = battle.combatant(damage.target),
        text = damage.critical ? `Chí mạng ${damage.text}` : damage.text,
        x = target.origin.x - 30,
        y = target.origin.y - 46;
      this.outlined(g, text, x, y, 60, damage.critical ? "#ff5a5b" : "#fff16a");
    }
    const post = battle.postEffect;
    if (post) {
      const target = battle.combatant(post.target);
      this.outlined(g, post.text, target.origin.x - 32, target.origin.y - 50, 68, "#ffffff");
    }
  }
  /**
   * `renderSourceLikeBattleUi` for a simultaneous 2v2: the HUD bands while their side stands, the four
   * ground markers and the active one, the formation actors in slot order, the command menus, the
   * main HUDs for slots 0 and 2, the compact HUDs for slots 1 (shifted 132 right) and 3 (235 down),
   * then the damage text.
   */
  renderDouble(
    g: CanvasRenderingContext2D,
    battle: DoubleBattleRuntime,
    /** `drawBattleBackground`'s picture under the dimming: the world the fight opened over. */
    background: (g: CanvasRenderingContext2D) => void = (context) => {
      context.fillStyle = "#000";
      context.fillRect(0, 0, 240, 320);
    },
  ): void {
    const tick = battle.tickCount,
      slots = ([0, 1, 2, 3] as const).map((slot) => battle.slot(slot));
    g.fillStyle = "rgba(0,0,0,0.5490196078)";
    g.fillRect(0, 0, 240, 320);
    if (battle.sideAlive(false)) this.widget(g, 1, 92);
    if (battle.sideAlive(true)) this.widget(g, 2, 93);
    g.fillStyle = "#00b5d8";
    g.fillRect(91, 248, 10, 10);
    for (const view of slots) this.spriteCursor(g, 294, 0, 0, view.markerX, view.markerY);
    if (battle.activeActorSlot >= 0) {
      const view = slots[battle.activeActorSlot];
      this.spriteCursor(g, 294, 1, Math.floor(tick / 2) % 2, view.markerX, view.markerY);
    }
    const fx = battle.fxView;
    if (fx.special) {
      const view = slots[fx.special.slot];
      this.sourceSpecialAt(
        g,
        {
          spriteId: view.spriteId,
          state: view.spriteState,
          elapsed: view.stateTick,
          x: view.actorX,
          y: view.actorY,
          looped: true,
          mirror: mirroredPetArt(view.spriteId, fx.special.slot >= 2),
        },
        {
          side: fx.special.slot >= 2 ? "player" : "enemy",
          type: fx.special.type,
          values: fx.special.values,
          elapsed: fx.special.ticks,
          duration: fx.special.duration,
        },
      );
    }
    // `drawSimultaneousFormationActors`: slot order, each pet then the actor effect it owns; the
    // state-1 L of the slot that lunges goes under its pet (over it for species 10).
    const l = battle.stateOneLEffect,
      drawL = (view: { actorX: number; actorY: number }, playerSide: boolean) =>
        this.lEffect.draw(
          g,
          l!.entry,
          l!.frame,
          view.actorX + (playerSide ? -52 : -45),
          view.actorY + (playerSide ? -83 : -33),
        );
    for (const [slot, view] of slots.entries()) {
      if (!view.visible || view.spriteId < 0) continue;
      const lHere = l?.slot === slot;
      if (lHere && !l!.entry.drawAfter) drawL(view, slot >= 2);
      // `setPaletteNature(nature)`: a nature 7..9 pet in its shiny palette.
      const petSprite = this.assets.shinySprite(view.spriteId, view.nature),
        frame = this.assets.frame(petSprite, view.spriteState, view.stateTick);
      if (frame) {
        const mirror = mirroredPetArt(view.spriteId, slot >= 2),
          image = this.assets.imageFor(frame, mirror);
        if (image.complete)
          g.drawImage(
            this.petImage(image, petSprite, view.nature),
            Math.floor(view.actorX + (mirror ? frame.mox : frame.ox)),
            Math.floor(view.actorY + (mirror ? frame.moy : frame.oy)),
          );
      }
      if (lHere && l!.entry.drawAfter) drawL(view, slot >= 2);
      const effect = fx.actorEffect;
      if (effect && effect.slot === slot) {
        const lift =
          (effect.sourceId === 20 && effect.state === 3) ||
          (effect.sourceId === 22 && effect.state === 4)
            ? (this.assets.animationBounds(view.spriteId, 0)?.height ?? 0)
            : 0;
        this.cursorSprite(
          g,
          effect.sprite,
          effect.state,
          effect.cursor,
          view.actorX,
          view.actorY - lift,
          slot >= 2,
        );
      }
    }
    // `drawRainbowSkillAnimation`: a Cầu Vồng effect or a signature's world sprites.
    this.skillFx(g, fx.skillFxDraws);
    for (const placed of fx.signatureSprites) this.heldSprite(g, placed);
    if (battle.death) this.deathFade(g, battle.death, slots[battle.death.slot]);
    // Cell 101 sits under the main enemy HUD, which wipes it while slot 0 stands (a 2v2 never
    // marks a species as owned), so it shows once that pet has fallen.
    const owned = this.boot.cell(257, 101);
    if (owned) g.drawImage(owned, 97, 14);
    const enemy = slots[0],
      player = slots[2];
    if (enemy.hp > 0) {
      // `clearBattleBackgroundRegion` over the owned-species box.
      g.save();
      g.beginPath();
      g.rect(96, 13, 15, 15);
      g.clip();
      background(g);
      g.fillStyle = "rgba(0,0,0,0.5490196078)";
      g.fillRect(0, 0, 240, 320);
      g.restore();
      this.marqueeText(g, 15, enemy.name, "#ffffff", tick);
      this.text(g, 16, `lv${enemy.level}`, "#ffffff");
      this.health(g, 14, 39, shieldTrackUnit(enemy.hp, enemy.maxHp, enemy.shield), tick);
      this.element(g, 18, enemy.element);
      this.doubleStatusSlots(g, battle, 0);
    }
    if (player.hp > 0) {
      const exp = battle.experienceBar;
      this.marqueeText(g, 12, player.name, "#ffffff", tick);
      this.text(g, 13, `lv${player.level}`, "#ffffff");
      this.health(g, 11, 38, shieldTrackUnit(player.hp, player.maxHp, player.shield), tick);
      this.percent(g, 9, exp.max > 0 ? Math.floor((100 * exp.value) / exp.max) : 0);
      this.text(g, 40, `${exp.value}/${exp.max}`, "#fff7b1");
      this.element(g, 17, player.element);
      this.doubleStatusSlots(g, battle, 2);
    }
    for (const [slot, dx, dy] of [
      [1, 132, 0],
      [3, 0, 235],
    ] as const) {
      const view = slots[slot];
      if (view.hp <= 0) continue;
      g.save();
      g.translate(dx, dy);
      const band = this.boot.cell(257, 92);
      if (band) g.drawImage(band, 0, 0);
      this.marqueeText(g, 15, view.name, "#ffffff", tick);
      this.text(g, 16, `lv${view.level}`, "#ffffff");
      this.health(g, 14, 39, shieldTrackUnit(view.hp, view.maxHp, view.shield), tick);
      this.element(g, 18, view.element);
      g.restore();
    }
    this.ui.render(g, battle);
    const damage = battle.damage;
    if (damage) {
      // `drawP7Damage`: the number floats along `bloodRow(0)`, the miss along `bloodRow(1)`.
      const view = slots[damage.slot],
        playerSide = damage.slot >= 2,
        ticks = tick - damage.tick;
      if (!damage.miss) {
        const row = battle.bloodRow(0),
          frames = Math.floor(row.length / 2),
          at = Math.max(0, Math.min(frames - 1, ticks)),
          dx = row[at * 2] ?? 0,
          dy = row[at * 2 + 1] ?? 0,
          x = playerSide ? view.actorX + dx + 30 : view.actorX - dx - 30;
        if (ticks < frames)
          this.tinyOutlined(
            g,
            damage.text,
            x - 14,
            view.actorY + dy - 30,
            44,
            damage.critical ? "#ff5d3b" : "#fff16a",
            "#3f0707",
          );
      } else {
        const row = battle.bloodRow(1),
          frames = Math.floor(row.length / 2),
          at = Math.max(0, Math.min(frames - 1, ticks)),
          dy = row[at * 2 + 1] ?? 0,
          x = playerSide ? view.actorX - 10 : view.actorX + 10;
        if (ticks < frames)
          this.tinyOutlined(
            g,
            damage.text,
            x - 22,
            view.actorY + dy - 30,
            62,
            "#ffffff",
            "#14344a",
          );
      }
    }
  }

  /** `drawOutlinedTinyBattleText`: four outline passes then the face, each clipped to its own box. */
  private tinyOutlined(
    g: CanvasRenderingContext2D,
    value: string,
    x: number,
    y: number,
    w: number,
    color: string,
    outline: string,
  ): void {
    for (const [dx, dy, ink] of [
      [-1, 0, outline],
      [1, 0, outline],
      [0, -1, outline],
      [0, 1, outline],
      [0, 0, color],
    ] as const) {
      g.save();
      g.beginPath();
      g.rect(x + dx, y + dy - 1, w, 18);
      g.clip();
      this.boot.panelFont.draw(g, value, x + dx, y + dy, ink);
      g.restore();
    }
  }

  /** An effect sprite at a held cursor, mirrored on the player's side (`drawBattleSpriteAtSource`). */
  private cursorSprite(
    g: CanvasRenderingContext2D,
    id: number,
    state: number,
    cursor: number,
    x: number,
    y: number,
    mirror: boolean,
  ): void {
    const frame = this.assets.frameAtCursor(id, state, cursor);
    if (!frame) return;
    const image = this.assets.imageFor(frame, mirror);
    if (image.complete)
      g.drawImage(
        image,
        Math.floor(x + (mirror ? frame.mox : frame.ox)),
        Math.floor(y + (mirror ? frame.moy : frame.oy)),
      );
  }

  /**
   * `drawP7DeathEffect`: a Cầu Vồng pet plays its state-2 fall once; any other pet's first idle cell
   * fades out in four horizontal bands, the top band first, each band starting a quarter of the
   * duration after the one above. The source draws that cell with orientation 1 on the enemy side
   * (mirrored, clipped to the unmirrored cell's box) and 0 on the player's.
   */
  private deathFade(
    g: CanvasRenderingContext2D,
    death: DoubleDeathView,
    view: { actorX: number; actorY: number },
  ): void {
    const playerSide = death.slot >= 2;
    if (death.spriteId >= 1000 && death.spriteId < 1102) {
      this.heldSprite(g, {
        sprite: death.spriteId,
        state: 2,
        elapsed: death.tick,
        x: view.actorX,
        y: view.actorY,
        mirror: playerSide,
      });
      return;
    }
    const frame = this.assets.frameAtCursor(death.spriteId, 0, 0);
    if (!frame || frame.w <= 0 || frame.h <= 0) return;
    const mirror = !playerSide,
      image = this.assets.imageFor(frame, mirror);
    if (!image.complete) return;
    const duration = Math.max(1, death.duration),
      elapsed = Math.max(0, Math.min(duration, death.tick)),
      band = Math.max(1, Math.floor(frame.h / 4)),
      boxX = Math.floor(view.actorX + frame.ox),
      boxY = Math.floor(view.actorY + frame.oy),
      drawX = Math.floor(view.actorX + (mirror ? frame.mox : frame.ox)),
      drawY = Math.floor(view.actorY + (mirror ? frame.moy : frame.oy));
    for (let index = 0; index < 4; index++) {
      const top = index * band,
        bottom = index === 3 ? frame.h : Math.min(frame.h, top + band);
      if (bottom <= top) continue;
      const start = Math.floor((index * duration) / 4),
        alpha =
          elapsed >= start
            ? Math.max(0, 255 - Math.floor(((elapsed - start) * 255) / duration))
            : 255;
      if (alpha <= 0) continue;
      g.save();
      g.beginPath();
      g.rect(boxX, boxY + top, frame.w, bottom - top);
      g.clip();
      g.globalAlpha = alpha / 255;
      g.drawImage(image, drawX, drawY);
      g.restore();
    }
  }

  private doubleStatusSlots(
    g: CanvasRenderingContext2D,
    battle: DoubleBattleRuntime,
    slot: DoubleSlot,
  ): void {
    const playerSide = slot >= 2,
      icons = this.boot.battleLayout.widget(playerSide ? 26 : 32),
      badges = this.boot.battleLayout.widget(playerSide ? 43 : 49);
    if (!icons || !badges) return;
    for (const [index, entry] of battle.statusStrip(slot).entries()) {
      const step = (playerSide ? -index : index) * 15,
        icon = this.statusIcon(entry);
      if (icon) g.drawImage(icon, icons.x + step, icons.y);
      const badge = this.boot.cell(257, entry.badgeCell);
      if (badge) g.drawImage(badge, badges.x + step, badges.y);
    }
  }

  /**
   * `drawBattleActorWithAttachedEffects`: the state-1 L under the pet (over it for species 10), at
   * `state1LEffectX/Y` — (18, 140) for the player, (132, 70) for the enemy, plus that side's offset.
   */
  private actorWithLEffect(
    g: CanvasRenderingContext2D,
    battle: BattleRuntime,
    side: BattleSide,
    alpha: number,
  ): void {
    const l = battle.stateOneLEffect?.side === side ? battle.stateOneLEffect : undefined,
      drawL = () => {
        const offset = this.smoothOffset(battle, side, alpha),
          player = side === "player";
        this.lEffect.draw(
          g,
          l!.entry,
          l!.frame,
          (player ? 18 : 132) + offset.x,
          (player ? 140 : 70) + offset.y,
        );
      };
    if (l && !l.entry.drawAfter) drawL();
    this.combatant(g, battle, side, alpha);
    if (l && l.entry.drawAfter) drawL();
  }

  private combatant(
    g: CanvasRenderingContext2D,
    battle: BattleRuntime,
    side: BattleSide,
    alpha: number,
  ): void {
    const combatant = battle.combatant(side),
      nature = "nature" in combatant ? combatant.nature : undefined,
      // `SpriteAnimator.setPaletteNature(unit.nature)`: a nature 7..9 pet in its shiny palette.
      actor = { ...combatant, spriteId: this.assets.shinySprite(combatant.spriteId, nature) },
      offset = this.smoothOffset(battle, side, alpha),
      x = actor.origin.x + offset.x,
      y = actor.origin.y + offset.y;
    if (side === "enemy" && battle.captureVisual?.hideEnemy) return;
    this.paletteNature = nature;
    if (battle.hidden(side)) {
      // The fall (state 3): the authored death window, or on the core the beat that knocked it out,
      // played once and only for a sprite that has a fall of its own.
      const fall = battle.faintTick(side);
      if (
        fall >= 0 &&
        (!battle.core ||
          (this.assets.hasState(actor.spriteId, 3) &&
            fall < this.assets.animationTicks(actor.spriteId, 3)))
      )
        this.sprite(g, actor.spriteId, 3, fall, actor.origin.x, actor.origin.y);
      this.paletteNature = undefined;
      return;
    }
    const cursor = battle.cursor(side),
      state = battle.state(side),
      sourceElapsed = battle.sourceBaseElapsed(side);
    if (sourceElapsed !== undefined) {
      const frame = this.assets.heldFrame(actor.spriteId, state, sourceElapsed);
      if (frame) {
        const image = this.assets.imageFor(frame);
        if (image.complete)
          g.drawImage(
            this.petImage(image, actor.spriteId),
            Math.floor(x + frame.ox),
            Math.floor(y + frame.oy),
          );
      }
    } else if (cursor >= 0) this.spriteCursor(g, actor.spriteId, state, cursor, x, y);
    else this.sprite(g, actor.spriteId, state, battle.tickCount, x, y);
    this.paletteNature = undefined;
  }
  /** The nature of the pet being drawn by `sprite` / `spriteCursor` (undefined: no palette). */
  private paletteNature: number | undefined;
  /** `PetShinyPalette.image` for the pet being drawn. */
  private petImage(
    image: HTMLImageElement,
    visual: number,
    nature = this.paletteNature,
  ): HTMLImageElement | HTMLCanvasElement {
    return this.assets.shinyImage(image, nature, visual);
  }

  /**
   * The Java simulation remains on its fixed 66 ms ticks; browser frames interpolate only the
   * actor's presentation offset. At alpha=1 the position is the exact same-tick cpos/skill value.
   */
  private smoothOffset(
    battle: BattleRuntime,
    side: BattleSide,
    alpha: number,
  ): { x: number; y: number } {
    const sampled = {
        player: battle.offset("player"),
        enemy: battle.offset("enemy"),
      },
      old = this.motion.get(battle);
    let state = old;
    if (!state) {
      state = { tick: battle.tickCount, previous: sampled, current: sampled };
      this.motion.set(battle, state);
    } else if (state.tick !== battle.tickCount) {
      const adjacent = battle.tickCount === state.tick + 1;
      state = {
        tick: battle.tickCount,
        previous: adjacent ? state.current : sampled,
        current: sampled,
      };
      this.motion.set(battle, state);
    } else state.current = sampled;
    const from = state.previous[side],
      to = state.current[side],
      t = Math.max(0, Math.min(1, alpha));
    return {
      x: Math.round(from.x + (to.x - from.x) * t),
      y: Math.round(from.y + (to.y - from.y) * t),
    };
  }
  /**
   * `drawNpcEnemyEntryOverlay`: the trainer fight's VS card over `npcEnemy.ui` — black until step 5,
   * then the battle background; the 296 band, the portraits sliding in (2/3 → 34/35 → 4/5), the
   * party slots, the V and S cells with the two names, the VS text and the white flash.
   */
  private drawEntry(g: CanvasRenderingContext2D, battle: BattleRuntime): void {
    const entry = battle.definition.entry,
      { step, frame } = npcEnemyEntryAt(battle.sequenceTick),
      view = npcEnemyEntryView(step, frame, entry.playerCount ?? 6, entry.enemyCount ?? 6),
      layout = this.boot.npcEnemyLayout;
    // `drawBattleBackground`: the captured world under its 140-alpha veil.
    g.fillStyle = step >= 5 ? "rgba(0,0,0,0.5490196078)" : "#000";
    g.fillRect(0, 0, 240, 320);
    this.cellTopLeft(g, view.mainCell, layout.x(1, 0), layout.y(1, 71));
    const enemyVisual = entry.rightActorSpriteId,
      playerVisual = entry.leftActorSpriteId;
    for (const [id, visual, player] of [
      [2, enemyVisual, false],
      [3, playerVisual, true],
      [34, enemyVisual, false],
      [35, playerVisual, true],
      [4, enemyVisual, false],
      [5, playerVisual, true],
    ] as const) {
      const widget = layout.widget(id);
      if (!view.visible[id] || !widget) continue;
      // `drawNpcEntryPortrait`: state 0 cursor 0, bottom-centred (player) or top-centred (enemy).
      this.alignedPortrait(
        g,
        visual,
        widget.x,
        widget.y,
        Math.max(1, widget.w),
        Math.max(48, widget.h > 0 ? widget.h : 10),
        player ? 7 : 1,
        mirroredPetArt(visual, player),
      );
    }
    for (let id = 6; id <= 29; id++) {
      const cell = view.cells[id],
        widget = layout.widget(id);
      if (cell < 0 || !widget) continue;
      let x = widget.x;
      if (view.exitSlotRows && id >= 7 && id < 19 && id % 2 === 1)
        x = 172 + Math.trunc((17 * (id - 7)) / 2);
      else if (view.exitSlotRows && id >= 19 && id < 31 && id % 2 === 1)
        x = -30 + Math.trunc((17 * (id - 19)) / 2);
      this.cellTopLeft(g, cell, x, widget.y);
    }
    for (const id of [30, 31, 32, 33]) {
      const widget = layout.widget(id);
      if (view.cells[id] >= 0 && widget) this.cellTopLeft(g, view.cells[id], widget.x, widget.y);
    }
    const tick = battle.tickCount;
    if (view.cells[30] >= 0) this.entryText(g, 30, battle.combatant("enemy").name, "#ffffff", tick);
    if (view.cells[31] >= 0)
      this.entryText(g, 31, battle.combatant("player").name, "#ffffff", tick);
    if (view.cells[32] >= 0) this.entryText(g, 32, "VS", "#fff06a", tick);
    const flash = layout.widget(36);
    if (view.overlay36 && flash) {
      g.fillStyle = "rgba(255,255,255,0.3607843137)";
      g.fillRect(flash.x, flash.y, Math.max(1, flash.w), flash.h > 0 ? flash.h : 10);
    }
  }
  /** `drawSpriteCellTopLeft(296, cell, x, y)`. */
  private cellTopLeft(g: CanvasRenderingContext2D, cell: number, x: number, y: number): void {
    const image = this.boot.cell(296, cell);
    if (image) g.drawImage(image, x, y);
  }
  /** `SpriteAnimator.drawAligned` (anchors 1 and 7) over state 0's first frame. */
  private alignedPortrait(
    g: CanvasRenderingContext2D,
    spriteId: number,
    x: number,
    y: number,
    w: number,
    h: number,
    anchor: 1 | 7,
    mirror: boolean,
  ): void {
    if (spriteId < 0) return;
    const frame = this.assets.frameAtCursor(spriteId, 0, 0),
      bounds = this.assets.animationBounds(spriteId, 0);
    if (!frame || !bounds) return;
    const image = this.assets.imageFor(frame, mirror);
    if (!image.complete || image.naturalWidth === 0) return;
    const originX = x + Math.trunc((w - bounds.width) / 2) - bounds.x,
      originY = anchor === 7 ? y + (h - bounds.height) - bounds.y : y - bounds.y;
    g.drawImage(
      image,
      originX + (mirror ? frame.mox : frame.ox),
      originY + (mirror ? frame.moy : frame.oy),
    );
  }
  /** `drawSourceWidgetText` on an `npcEnemy.ui` widget: aligned, or marqueed when too wide. */
  private entryText(
    g: CanvasRenderingContext2D,
    id: number,
    value: string,
    color: string,
    tick: number,
  ): void {
    const widget = this.boot.npcEnemyLayout.widget(id);
    if (!widget || !value) return;
    const font = this.boot.panelFont,
      width = font.width(value),
      h = widget.h > 0 ? widget.h : 10,
      x =
        width > widget.w
          ? widget.x - sourceHorizontalScrollOffset(width, widget.w, tick)
          : [1, 4, 7].includes(widget.b)
            ? widget.x + Math.max(0, Math.trunc((widget.w - width) / 2))
            : [2, 5, 8].includes(widget.b)
              ? widget.x + Math.max(0, widget.w - width)
              : widget.x,
      y = [3, 4, 5].includes(widget.b)
        ? widget.y + Math.max(0, Math.trunc((h - 10) / 2))
        : [6, 7, 8].includes(widget.b)
          ? widget.y + Math.max(0, h - 10)
          : widget.y;
    g.save();
    g.beginPath();
    g.rect(widget.x, widget.y, widget.w, Math.max(1, h));
    g.clip();
    font.draw(g, value, x, y, color);
    g.restore();
  }
  /** A Cầu Vồng skill effect: each piece is a region of a `skill-fx` image under its MIDP transform. */
  private skillFx(g: CanvasRenderingContext2D, draws: readonly SkillFxDraw[]): void {
    for (const piece of draws) {
      const image = this.boot.skillFx.get(piece.image);
      if (!image) continue;
      g.save();
      g.translate(piece.x, piece.y);
      g.transform(...midpMatrix(piece.transform, piece.width, piece.height));
      g.drawImage(
        image,
        piece.sx,
        piece.sy,
        piece.width,
        piece.height,
        0,
        0,
        piece.width,
        piece.height,
      );
      g.restore();
    }
  }
  /** A signature-effect sprite: played once and held, mirrored on the player's side. */
  private heldSprite(g: CanvasRenderingContext2D, placed: SignatureFxPlacement): void {
    const frame = this.assets.heldFrame(placed.sprite, placed.state, placed.elapsed);
    if (!frame) return;
    const image = this.assets.imageFor(frame, placed.mirror);
    if (!image.complete) return;
    const ox = placed.mirror ? frame.mox : frame.ox,
      oy = placed.mirror ? frame.moy : frame.oy;
    g.drawImage(image, Math.floor(placed.x + ox), Math.floor(placed.y + oy));
  }

  /** speffect.mid AH types 1/7/8/9/12, applied to the owning pet as in Java's P7 renderer. */
  private sourceSpecial(
    g: CanvasRenderingContext2D,
    battle: BattleRuntime,
    placed: SourceSpecialPlacement,
  ): void {
    const actor = battle.combatant(placed.side);
    this.sourceSpecialAt(
      g,
      {
        spriteId: actor.spriteId,
        state: battle.state(placed.side),
        elapsed: battle.sourceBaseElapsed(placed.side) ?? battle.cursor(placed.side),
        x: actor.origin.x,
        y: actor.origin.y,
        looped: false,
      },
      placed,
    );
  }

  /** The speffect transform over one pet: its base frame at `(x, y)`, `looped` (2v2) or held (1v1). */
  private sourceSpecialAt(
    g: CanvasRenderingContext2D,
    pet: {
      spriteId: number;
      state: number;
      elapsed: number;
      x: number;
      y: number;
      looped: boolean;
      /** `battlePetOrientation` 1: the pet is drawn mirrored (a custom boss in a 2v2). */
      mirror?: boolean;
    },
    placed: SourceSpecialPlacement,
  ): void {
    const actor = { origin: { x: pet.x, y: pet.y } },
      found = pet.looped
        ? this.assets.frame(pet.spriteId, pet.state, pet.elapsed)
        : this.assets.heldFrame(pet.spriteId, pet.state, pet.elapsed);
    if (!found) return;
    const mirror = pet.mirror === true,
      frame = mirror ? { ...found, ox: found.mox, oy: found.moy } : found,
      image = this.assets.imageFor(found, mirror),
      x = Math.floor(actor.origin.x + frame.ox),
      y = Math.floor(actor.origin.y + frame.oy),
      progress = placed.duration <= 1 ? 1 : placed.elapsed / (placed.duration - 1),
      pulse = Math.sin(progress * Math.PI);
    if (!image.complete) return;
    const draw = (alpha: number, scale: number, dx = 0, dy = 0) => {
      g.save();
      g.globalAlpha = Math.max(0, Math.min(1, alpha));
      g.translate(actor.origin.x + dx, actor.origin.y + dy);
      g.scale(scale, scale);
      g.drawImage(image, Math.floor(frame.ox), Math.floor(frame.oy));
      g.restore();
    };
    switch (placed.type) {
      case 9: {
        // `applyAhType9Transform`: every inked pixel of a copy becomes one flat colour, each channel
        // and the alpha 50 above the row's, laid over the pet on alternate intervals.
        const interval = Math.max(1, placed.values[7] ?? 1),
          visible = Math.floor(placed.elapsed / interval) % 2 === 0;
        g.drawImage(image, x, y);
        if (!visible) return;
        const channel = (index: number) =>
            Math.min(255, Math.max(0, Math.min(255, placed.values[index] ?? 0)) + 50),
          flat = this.flatSilhouette(image, `rgb(${channel(2)}, ${channel(3)}, ${channel(4)})`);
        g.save();
        g.globalAlpha = channel(1) / 255;
        g.drawImage(flat, x, y);
        g.restore();
        return;
      }
      case 7: {
        const interval = Math.max(1, placed.values[3] ?? 1);
        if (Math.floor(placed.elapsed / interval) % 2 !== 0) {
          draw(1, 1);
          return;
        }
        const sx = Math.max(0.1, (placed.values[4] ?? 1) / Math.max(1, placed.values[5] ?? 1)),
          sy = Math.max(0.1, (placed.values[6] ?? 1) / Math.max(1, placed.values[7] ?? 1)),
          width = Math.max(1, Math.floor(frame.w * sx)),
          height = Math.max(1, Math.floor(frame.h * sy));
        g.save();
        g.imageSmoothingEnabled = false;
        g.drawImage(
          image,
          Math.floor(x + (frame.w - width) / 2),
          Math.floor(y + frame.h - height),
          width,
          height,
        );
        g.restore();
        return;
      }
      case 8: {
        const stages = Math.max(1, Math.floor((placed.values.length - 6) / 3)),
          stageTicks = Math.max(
            1,
            Math.floor(Math.max(stages, placed.values[2] ?? stages) / stages),
          ),
          stage = Math.min(stages - 1, Math.floor(placed.elapsed / stageTicks)),
          at = 6 + stage * 3,
          scale = Math.max(0.1, (placed.values[at] ?? 10) / 10),
          dx = placed.values[at + 1] ?? 0,
          dy = placed.values[at + 2] ?? 0;
        const width = Math.max(1, Math.floor(frame.w * scale)),
          height = Math.max(1, Math.floor(frame.h * scale));
        g.save();
        g.imageSmoothingEnabled = false;
        g.filter = "brightness(1.2)";
        g.drawImage(
          image,
          Math.floor(x + dx + (frame.w - width) / 2),
          Math.floor(y + dy + (frame.h - height) / 2),
          width,
          height,
        );
        g.restore();
        return;
      }
      case 12: {
        const count = Math.max(1, placed.values[5] ?? 1),
          stepTicks = Math.max(1, (placed.values[7] ?? 0) + 1),
          step = Math.min(count - 1, Math.floor(placed.elapsed / stepTicks)),
          first = 8 + step * 2,
          second = 8 + count * 2 + step * 2,
          mirror = placed.side === "player" ? -1 : 1,
          x1 = (placed.values[first] ?? 0) * mirror,
          y1 = placed.values[first + 1] ?? 0,
          x2 = (placed.values[second] ?? 0) * mirror,
          y2 = placed.values[second + 1] ?? 0;
        draw((placed.values[3] ?? 160) / 255, 1, x1 + x2, y1 - y2);
        draw((placed.values[2] ?? 220) / 255, 1, x1, y1);
        return;
      }
      case 1:
        g.save();
        g.globalAlpha = 0.7 + pulse * 0.3;
        g.filter = `contrast(${1.2 + pulse}) hue-rotate(${(placed.values[3] ?? 0) * 17}deg)`;
        g.drawImage(image, x, y);
        g.restore();
        return;
      default:
        draw(1, 1);
    }
  }
  private silhouette: HTMLCanvasElement | null = null;
  /** The image's inked pixels filled with one colour, on a reused scratch canvas. */
  private flatSilhouette(image: HTMLImageElement, color: string): HTMLCanvasElement {
    const canvas = (this.silhouette ??= document.createElement("canvas"));
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const scratch = canvas.getContext("2d")!;
    scratch.globalCompositeOperation = "source-over";
    scratch.clearRect(0, 0, canvas.width, canvas.height);
    scratch.drawImage(image, 0, 0);
    scratch.globalCompositeOperation = "source-in";
    scratch.fillStyle = color;
    scratch.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }
  private sprite(
    g: CanvasRenderingContext2D,
    id: number,
    state: number,
    tick: number,
    x: number,
    y: number,
  ): void {
    const frame = this.assets.frame(id, state, tick);
    if (!frame) return;
    const image = this.assets.imageFor(frame);
    if (image.complete)
      g.drawImage(this.petImage(image, id), Math.floor(x + frame.ox), Math.floor(y + frame.oy));
  }
  private spriteCursor(
    g: CanvasRenderingContext2D,
    id: number,
    state: number,
    cursor: number,
    x: number,
    y: number,
  ): void {
    const frame = this.assets.frameAtCursor(id, state, cursor);
    if (!frame) return;
    const image = this.assets.imageFor(frame);
    if (image.complete)
      g.drawImage(this.petImage(image, id), Math.floor(x + frame.ox), Math.floor(y + frame.oy));
  }
  private capture(
    g: CanvasRenderingContext2D,
    battle: BattleRuntime,
    capture: NonNullable<BattleRuntime["captureVisual"]>,
  ): void {
    const frame = this.assets.frame(capture.spriteId, capture.state, capture.tick);
    if (!frame) return;
    const image = this.assets.imageFor(frame);
    if (!image.complete || !image.naturalWidth) return;
    const enemy = battle.combatant("enemy"),
      player = battle.combatant("player"),
      enemyBounds = this.assets.animationBounds(enemy.spriteId, 0),
      playerBounds = this.assets.animationBounds(player.spriteId, 0),
      markerBounds = this.assets.animationBounds(294, 0);
    if (!enemyBounds || !playerBounds || !markerBounds) return;
    if (capture.effect) this.catchEffect(g, battle, capture.effect);
    const playerCenter = {
        x: player.origin.x + playerBounds.x + playerBounds.width / 2,
        y: player.origin.y + playerBounds.y + playerBounds.height / 2,
      },
      markerCenter = {
        x: 144 + markerBounds.x + markerBounds.width / 2,
        y: 85 + markerBounds.y + markerBounds.height / 2,
      },
      opaque = this.imageOpaqueBounds(image);
    let center: { x: number; y: number };
    if (capture.phase === "ground") center = markerCenter;
    else {
      const enemyCapture = {
        x: markerCenter.x,
        y: enemy.origin.y + enemyBounds.y - Math.max(3, opaque.height / 2) + 1,
      };
      if (capture.phase === "throw") {
        const count = Math.max(
            1,
            this.assets.sprites[String(capture.spriteId)]?.states[String(capture.state)]?.length ??
              1,
          ),
          cursor = Math.max(0, Math.min(capture.tick, count - 1)),
          denominator = Math.max(1, count - 1);
        center = {
          x: playerCenter.x + ((enemyCapture.x - playerCenter.x) * cursor) / denominator,
          y: playerCenter.y + ((enemyCapture.y - playerCenter.y) * cursor) / denominator,
        };
      } else center = enemyCapture;
    }
    g.drawImage(
      image,
      Math.floor(center.x - opaque.x - opaque.width / 2),
      Math.floor(center.y - opaque.y - opaque.height / 2),
    );
  }
  private catchEffect(
    g: CanvasRenderingContext2D,
    battle: BattleRuntime,
    effect: { scale10: number; dx: number; dy: number },
  ): void {
    const enemy = battle.combatant("enemy"),
      frame = this.assets.frameAtCursor(enemy.spriteId, 0, 0);
    if (!frame) return;
    const image = this.assets.imageFor(frame);
    if (!image.complete || !image.naturalWidth) return;
    const scale = Math.max(0.1, effect.scale10 / 10);
    g.save();
    g.imageSmoothingEnabled = false;
    g.filter = "brightness(1.5)";
    g.drawImage(
      image,
      Math.floor(enemy.origin.x + frame.ox * scale + effect.dx),
      Math.floor(enemy.origin.y + frame.oy * scale + effect.dy),
      Math.max(1, Math.floor(frame.w * scale)),
      Math.max(1, Math.floor(frame.h * scale)),
    );
    g.restore();
  }
  private imageOpaqueBounds(image: HTMLImageElement): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const cached = this.opaqueBounds.get(image);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width,
      top = canvas.height,
      right = -1,
      bottom = -1;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (
          pixels[i + 3] === 0 ||
          (pixels[i] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 255)
        )
          continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    const result =
      right < left
        ? { x: 0, y: 0, width: canvas.width, height: canvas.height }
        : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
    this.opaqueBounds.set(image, result);
    return result;
  }
  /**
   * `VqsvBattleRenderer.drawRainbowCharmHud` and `drawEnemyCharm`: a dark 20x23 badge per charm
   * (green rim for survival, gold for tactical, coral for the NPC's) with its icon and tier, beside
   * the side's HP block (`charmHudBounds`, the 1v1 branch).
   */
  private charmHud(g: CanvasRenderingContext2D, battle: BattleRuntime): void {
    const core = battle.core;
    if (!core) return;
    const layout = this.boot.battleLayout,
      x = (id: number, fallback: number) => layout.widget(id)?.x ?? fallback,
      y = (id: number, fallback: number) => layout.widget(id)?.y ?? fallback,
      w = (id: number, fallback: number) => layout.widget(id)?.w ?? fallback,
      height = (id: number) => {
        const widget = layout.widget(id);
        return widget && widget.h > 0 ? widget.h : 10;
      },
      clampX = (value: number) => Math.max(0, Math.min(240 - 20, value)),
      clampY = (value: number) => Math.max(0, Math.min(320 - 23, value)),
      badge = (bx: number, by: number, rim: string, id: number, tier: number, textX: number) => {
        g.fillStyle = "rgba(0, 0, 0, 0.706)";
        g.beginPath();
        g.roundRect(bx, by, 20, 23, 2);
        g.fill();
        g.strokeStyle = rim;
        g.lineWidth = 1;
        g.beginPath();
        g.roundRect(bx + 0.5, by + 0.5, 19, 22, 2);
        g.stroke();
        const icon = this.assets.pack.imageElement(`charm-icons.${id}`);
        if (icon.complete && icon.naturalWidth > 0) {
          const scale = Math.min(14 / icon.width, 14 / icon.height),
            iw = Math.max(1, Math.round(icon.width * scale)),
            ih = Math.max(1, Math.round(icon.height * scale)),
            smoothing = g.imageSmoothingEnabled;
          g.imageSmoothingEnabled = false;
          g.drawImage(
            icon,
            bx + 2 + Math.trunc((14 - iw) / 2),
            by + 2 + Math.trunc((14 - ih) / 2),
            iw,
            ih,
          );
          g.imageSmoothingEnabled = smoothing;
        }
        this.boot.panelFont.drawTagged(g, romanTier(tier), textX, by + 15, "#ffffff");
      };
    // Player: bar 11's right end, 23 px per slot, above the name/HP rows.
    const px = x(11, 153) + Math.max(0, w(11, 82) - 43),
      py = Math.min(y(12, 238), y(26, 221)) - 23 - 3;
    core.charmHud("player").forEach((entry, slot) => {
      const bx = clampX(px + slot * 23),
        by = clampY(py);
      badge(bx, by, slot === 0 ? "#64d2a3" : "#f2c862", entry.charm.runtimeId, entry.tier, bx + 4);
    });
    // NPC: under the enemy's HP block.
    const enemy = core.charmHud("enemy")[0];
    if (enemy) {
      const bottom = Math.max(y(14, 16) + height(14), y(39, 13) + height(39), y(32, 25) + 16),
        bx = clampX(x(14, 5)),
        by = clampY(bottom + 3);
      badge(bx, by, "#ed8666", enemy.charm.runtimeId, enemy.tier, bx + 6);
    }
  }
  private widget(g: CanvasRenderingContext2D, id: number, fallback: number): void {
    const widget = this.boot.battleLayout.widget(id),
      cell = (widget?.altId ?? -1) >= 0 ? widget!.altId! : (widget?.alt_image_ref?.id ?? fallback),
      image = this.boot.cell(257, cell);
    if (image && widget) g.drawImage(image, widget.x, widget.y);
  }
  private text(g: CanvasRenderingContext2D, id: number, value: string, color: string): void {
    const widget = this.boot.battleLayout.widget(id);
    if (!widget) return;
    this.boot.panelFont.draw(
      g,
      value,
      this.alignedX(widget, this.boot.panelFont.width(value)),
      this.alignedY(widget),
      color,
    );
  }
  private marqueeText(
    g: CanvasRenderingContext2D,
    id: number,
    value: string,
    color: string,
    tick: number,
  ): void {
    const widget = this.boot.battleLayout.widget(id);
    if (!widget) return;
    const width = this.boot.panelFont.width(value),
      x =
        width > widget.w
          ? widget.x - sourceHorizontalScrollOffset(width, widget.w, tick)
          : this.alignedX(widget, width);
    g.save();
    g.beginPath();
    g.rect(widget.x, widget.y - 1, widget.w, 18);
    g.clip();
    this.boot.panelFont.draw(g, value, x, this.alignedY(widget), color);
    g.restore();
  }
  private outlined(
    g: CanvasRenderingContext2D,
    value: string,
    x: number,
    y: number,
    w: number,
    color: string,
  ): void {
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      g.save();
      g.beginPath();
      g.rect(x, y, w, 14);
      g.clip();
      this.boot.panelFont.draw(g, value, x + dx, y + dy, "#3f0847");
      g.restore();
    }
    g.save();
    g.beginPath();
    g.rect(x, y, w, 14);
    g.clip();
    this.boot.panelFont.draw(g, value, x, y, color);
    g.restore();
  }
  private alignedX(widget: SourceUiWidget, width: number): number {
    return [1, 4, 7].includes(widget.b)
      ? widget.x + Math.max(0, (widget.w - width) / 2)
      : [2, 5, 8].includes(widget.b)
        ? widget.x + Math.max(0, widget.w - width)
        : widget.x;
  }
  private alignedY(widget: SourceUiWidget): number {
    const h = widget.h > 0 ? widget.h : 10;
    return [3, 4, 5].includes(widget.b)
      ? widget.y + Math.max(0, (h - 10) / 2)
      : [6, 7, 8].includes(widget.b)
        ? widget.y + Math.max(0, h - 10)
        : widget.y;
  }
  /**
   * `VqsvBattleRenderer.drawShieldHealthWidget`: the track plus whichever text shape that track
   * calls for.
   *
   * The unit is already the clamped render state, so a fainted combatant loses its blue segment and
   * its `+pool` field in the same step, which is what the source does through its own constructor.
   */
  private health(
    g: CanvasRenderingContext2D,
    barId: number,
    textId: number,
    unit: ShieldTrackUnit,
    tick: number,
  ): void {
    const bar = this.boot.battleLayout.widget(barId);
    if (!bar) return;
    const height = bar.h > 0 ? bar.h : 10;
    for (const rect of shieldTrackRects(unit, bar.x, bar.y, bar.w, height)) {
      g.fillStyle = rect.color;
      g.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    const text = shieldTrackText(unit, bar.w);
    if (text.mode === "combined") {
      const widget = this.boot.battleLayout.widget(textId);
      if (!widget) return;
      this.fieldText(
        g,
        text.value,
        widget.x,
        widget.y,
        Math.max(1, widget.w),
        widget.h > 0 ? widget.h : 10,
        text.color,
        tick,
        widget.b,
      );
      return;
    }
    const widget = this.boot.battleLayout.widget(textId);
    const y = widget ? widget.y : bar.y - 3;
    this.fieldText(g, text.hp, bar.x + 1, y, text.fieldWidth, 10, text.hpColor, tick, 0);
    this.fieldText(
      g,
      text.shield,
      bar.x + 3 + text.fieldWidth,
      y,
      text.fieldWidth,
      10,
      text.shieldColor,
      tick,
      2,
    );
  }
  /**
   * `VqsvBattleRenderer.drawSourceWidgetText`: one clipped field, with the source's own overflow
   * scroll when the number is wider than the field it belongs to.
   */
  private fieldText(
    g: CanvasRenderingContext2D,
    value: string,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    tick: number,
    align: number,
  ): void {
    const textWidth = this.boot.panelFont.width(value);
    const at =
      textWidth > width
        ? x - sourceScrollOffset(textWidth, width, tick)
        : [1, 4, 7].includes(align)
          ? x + Math.max(0, Math.floor((width - textWidth) / 2))
          : [2, 5, 8].includes(align)
            ? x + Math.max(0, width - textWidth)
            : x;
    const baseline = [3, 4, 5].includes(align)
      ? y + Math.max(0, Math.floor((height - 10) / 2))
      : [6, 7, 8].includes(align)
        ? y + Math.max(0, height - 10)
        : y;
    g.save();
    g.beginPath();
    g.rect(x, y, width, Math.max(1, height));
    g.clip();
    this.boot.panelFont.draw(g, value, at, baseline, color);
    g.restore();
  }
  private percent(g: CanvasRenderingContext2D, id: number, percent: number): void {
    const w = this.boot.battleLayout.widget(id);
    if (!w) return;
    const h = w.bandHeight ?? (w.h > 0 ? w.h : 4);
    g.fillStyle = this.argb(w.jColor ?? w.j_color, "#646464");
    g.fillRect(w.x, w.y, w.w, h);
    g.strokeStyle = this.argb(w.kColor ?? w.k_color, "#000000");
    g.strokeRect(w.x, w.y, w.w, h);
    const fill = Math.floor((w.w * Math.max(0, Math.min(100, percent))) / 100);
    if (fill > 1) {
      g.fillStyle = this.argb(w.lColor ?? w.l_color, "#00ff3c");
      g.fillRect(w.x + 1, w.y + 1, fill - 1, h - 1);
    }
  }
  private element(g: CanvasRenderingContext2D, id: number, element: number): void {
    const widget = this.boot.battleLayout.widget(id),
      image = this.boot.cell(257, 94 + element);
    if (!widget || !image) return;
    const x = widget.x - 4,
      y = Math.max(0, widget.y - 3),
      colors = ["#ff5520", "#35bc5a", "#b98642", "#328ddd", "#f4da31", "#b65ade", "#44cbd3"];
    g.fillStyle = "rgba(0,23,36,.86)";
    g.fillRect(x, y, 17, 16);
    g.strokeStyle = colors[element] ?? "#ffffff";
    g.strokeRect(x, y, 16, 15);
    g.drawImage(image, x + 1, y + 2, 15, 13);
  }
  /**
   * `VqsvBattleRenderer.drawStatusSlots`: the buff/debuff strip beside a combatant and the numeral
   * badge nested over the corner of each slot.
   *
   * The two rows are the same strip shifted by the source's 15px step: the 12px icon row and the 6px
   * badge row start 8px apart, and the strip runs inward from the screen edge, so the enemy reads
   * left-to-right and the player right-to-left. A slot with no artwork draws nothing, which is what
   * the source does too: its blank slot is sprite 325's fully transparent cell 0 over UI cell 145,
   * also fully transparent, so a unit with no status shows an empty strip rather than six placeholders.
   */
  private statusSlots(g: CanvasRenderingContext2D, battle: BattleRuntime, side: BattleSide): void {
    const playerSide = side === "player",
      icons = this.boot.battleLayout.widget(playerSide ? 26 : 32),
      badges = this.boot.battleLayout.widget(playerSide ? 43 : 49);
    if (!icons || !badges) return;
    for (const [index, slot] of battle.statusStrip(side).entries()) {
      const step = (playerSide ? -index : index) * 15,
        icon = this.statusIcon(slot);
      if (icon) g.drawImage(icon, icons.x + step, icons.y);
      const badge = this.boot.cell(257, slot.badgeCell);
      if (badge) g.drawImage(badge, badges.x + step, badges.y);
    }
  }
  /**
   * The picture one slot uses. The Liệt Hỏa sheet supplies most identities; the Cầu Vồng ones name a
   * resource the Java classpath only sometimes has, and a missing resource is drawn as nothing.
   */
  private statusIcon(slot: StatusStripSlot): HTMLImageElement | undefined {
    if (slot.iconKind !== "RAINBOW_RESOURCE") return this.boot.cell(325, slot.lietHoaAtlasCell);
    const file = slot.resourcePath.slice(slot.resourcePath.lastIndexOf("/") + 1);
    return this.boot.statusIcon(file.replace(/\.png$/, ""));
  }
  private argb(value: number | undefined, fallback: string): string {
    if (value === undefined) return fallback;
    const unsigned = value >>> 0;
    return unsigned >>> 24 === 0
      ? fallback
      : `#${(unsigned & 0xffffff).toString(16).padStart(6, "0")}`;
  }
}

/**
 * `VqsvBattleRenderer.sourceHorizontalScrollOffset`: where an overflowing field has reached.
 *
 * The source recomputes the position by walking one 2px step per tick rather than by taking a
 * modulo, so the cycle length depends on the text width and a re-typed formula drifts.
 */
function sourceScrollOffset(textWidth: number, width: number, tick: number): number {
  let offset = -Math.trunc(width / 2);
  for (let step = 0; step < Math.max(0, tick) + 1; step++) {
    offset = textWidth > offset ? offset + 2 : -width;
  }
  return offset;
}
