import type { Pack } from "../pack/Pack";

/** `audio/music.json`: each track's loop length and level, and `media.mid`'s room music table. */
export type MusicTable = {
  battleMusic: number;
  menuMusic: number;
  tracks: Record<string, { loopMicros: number; gainDb: number }>;
  rooms: Record<
    string,
    { music: number; overrides: { group: number; event: number; battle: number }[] }
  >;
};

/** What is on screen, as far as the music cares (`NewGameScreen.musicContext`). */
export type MusicContext = {
  scene: number;
  room: number;
  battle: boolean;
  group: { scene: number; room: number; group: number } | null;
};

/** Short synthesized cues for the menus and the fight (the source game has no sound effects). */
export type SoundCue =
  | "cursor"
  | "confirm"
  | "back"
  | "hit"
  | "crit"
  | "miss"
  | "heal"
  | "faint"
  | "throw"
  | "catch"
  | "escape"
  | "switch"
  | "levelUp";

/**
 * `game.l`'s music choice, from `media.mid`: a fight plays its group's battle track (or track 4), a
 * running event group may play its own track, and otherwise the room's track plays.
 */
export function musicTrackFor(table: MusicTable, context: MusicContext): number {
  const room = table.rooms[`${context.scene}:${context.room}`];
  const override =
    context.group && room
      ? room.overrides.find(
          (entry) =>
            entry.group === context.group!.group &&
            context.group!.scene === context.scene &&
            context.group!.room === context.room,
        )
      : undefined;
  if (context.battle) return override && override.battle >= 0 ? override.battle : table.battleMusic;
  if (override && override.event >= 0) return override.event;
  return room ? room.music : table.menuMusic;
}

const FADE_IN = 0.45;
const FADE_OUT = 0.6;
const SETTINGS_KEY = "vqsv.audio";

/**
 * The game's sound, on Web Audio. Music is the seven source MIDI tracks (rendered by the JDK
 * synthesizer the Java build plays them through, loudness-matched and compressed): decoded once,
 * looped sample-exactly at the MIDI's own length, and crossfaded when the room, an event or a fight
 * changes the track. It pauses with the tab and starts on the first key or tap the browser allows.
 */
export class AudioManager {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private table: MusicTable | null = null;
  private enabled = false;
  private wanted = -1;
  private playing: { track: number; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private readonly buffers = new Map<number, Promise<AudioBuffer | null>>();
  /** Opus in Ogg first; a browser that cannot decode it (older Safari) gets the AAC file. */
  private oggUnsupported = false;
  private settings = { music: 0.8, sfx: 0.55, muted: false };

  constructor(private readonly pack: Pack) {
    this.loadSettings();
    void pack
      .json<MusicTable>("audio.music")
      .then((table) => {
        this.table = table;
        if (this.enabled && this.wanted >= 0) void this.start(this.wanted);
      })
      .catch((error: unknown) => console.error("VQSV_AUDIO_TABLE", error));
    const unlock = () => {
      if (!this.enabled) return;
      this.ensureContext();
      void this.context?.resume();
    };
    for (const type of ["pointerdown", "keydown", "touchend"])
      window.addEventListener(type, unlock, { capture: true });
    document.addEventListener("visibilitychange", () => {
      if (!this.context) return;
      if (document.visibilityState === "hidden") void this.context.suspend();
      else if (this.enabled) void this.context.resume();
    });
  }

  /** `MUSIC_PROMPT`'s answer: music on (the menu track starts) or silence for the session. */
  chooseMusic(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopMusic();
      return;
    }
    this.ensureContext();
    void this.context?.resume();
    this.wanted = -1;
    this.requestTrack(this.table?.menuMusic ?? 0);
  }
  isEnabled(): boolean {
    return this.enabled;
  }

  /** The title and menus play the menu track. */
  playMenu(): void {
    this.requestTrack(this.table?.menuMusic ?? 0);
  }
  /** Follow the gameplay screen: the room, event or fight decides the track. */
  follow(context: MusicContext): void {
    if (!this.table) return;
    this.requestTrack(musicTrackFor(this.table, context));
    // The fight track is short and starts on the encounter: keep it decoded ahead of time.
    if (!context.battle) void this.load(this.table.battleMusic);
  }

  /** `M`: mute or unmute everything (remembered for the next visit). */
  toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.saveSettings();
    this.applyVolumes();
  }

  /** JavaSE settings.ui exposes one four-state meter for the whole mix. */
  volumeLevel(): number {
    if (this.settings.muted) return 0;
    return Math.max(0, Math.min(3, Math.round(this.settings.music * 3)));
  }

  setVolumeLevel(level: number): void {
    const next = Math.max(0, Math.min(3, Math.trunc(level))),
      gain = next / 3;
    this.settings.muted = next === 0;
    this.settings.music = gain;
    this.settings.sfx = gain;
    this.saveSettings();
    this.applyVolumes();
  }

  /** A short cue; silent while music is off (the player chose a quiet game). */
  play(cue: SoundCue): void {
    if (!this.enabled || this.settings.muted) return;
    const ctx = this.context,
      bus = this.sfxBus;
    if (!ctx || !bus || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const tone = (
      type: OscillatorType,
      from: number,
      to: number,
      start: number,
      length: number,
      level: number,
    ) => {
      const osc = ctx.createOscillator(),
        gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, now + start);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + start + length);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(level, now + start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length);
      osc.connect(gain).connect(bus);
      osc.start(now + start);
      osc.stop(now + start + length + 0.02);
    };
    const noise = (start: number, length: number, level: number, lowpass: number) => {
      const frames = Math.floor(ctx.sampleRate * length),
        buffer = ctx.createBuffer(1, frames, ctx.sampleRate),
        data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
      const source = ctx.createBufferSource(),
        filter = ctx.createBiquadFilter(),
        gain = ctx.createGain();
      source.buffer = buffer;
      filter.type = "lowpass";
      filter.frequency.value = lowpass;
      gain.gain.value = level;
      source.connect(filter).connect(gain).connect(bus);
      source.start(now + start);
    };
    switch (cue) {
      case "cursor":
        tone("square", 1320, 1320, 0, 0.035, 0.05);
        break;
      case "confirm":
        tone("square", 880, 880, 0, 0.05, 0.06);
        tone("square", 1320, 1320, 0.05, 0.07, 0.06);
        break;
      case "back":
        tone("square", 660, 440, 0, 0.08, 0.05);
        break;
      case "hit":
        noise(0, 0.12, 0.35, 1800);
        tone("triangle", 180, 70, 0, 0.12, 0.25);
        break;
      case "crit":
        noise(0, 0.18, 0.45, 3200);
        tone("sawtooth", 320, 60, 0, 0.18, 0.18);
        break;
      case "miss":
        tone("sine", 900, 300, 0, 0.14, 0.08);
        break;
      case "heal":
        [660, 880, 1100].forEach((f, i) => tone("sine", f, f, i * 0.06, 0.12, 0.08));
        break;
      case "faint":
        tone("triangle", 440, 90, 0, 0.45, 0.16);
        break;
      case "throw":
        tone("sine", 300, 1200, 0, 0.18, 0.07);
        break;
      case "catch":
        [523, 659, 784, 1047].forEach((f, i) => tone("square", f, f, i * 0.08, 0.1, 0.05));
        break;
      case "escape":
        tone("square", 523, 262, 0, 0.25, 0.06);
        break;
      case "switch":
        tone("sine", 400, 900, 0, 0.12, 0.07);
        tone("sine", 900, 600, 0.12, 0.1, 0.06);
        break;
      case "levelUp":
        [523, 659, 784, 1047, 1319].forEach((f, i) => tone("square", f, f, i * 0.07, 0.12, 0.05));
        break;
    }
  }

  // ------------------------------------------------------------------ music

  private requestTrack(track: number): void {
    if (track === this.wanted) return;
    this.wanted = track;
    if (this.enabled) void this.start(track);
  }

  private ensureContext(): void {
    if (this.context) return;
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    const ctx = new Context();
    this.context = ctx;
    this.master = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.master.connect(ctx.destination);
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.master || !this.musicBus || !this.sfxBus || !this.context) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 1, now, 0.05);
    this.musicBus.gain.value = this.settings.music;
    this.sfxBus.gain.value = this.settings.sfx;
  }

  private load(track: number): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(track);
    if (cached) return cached;
    this.ensureContext();
    const ctx = this.context;
    if (!ctx) return Promise.resolve(null);
    const decode = async (extension: "ogg" | "m4a") =>
      ctx.decodeAudioData(await this.pack.audioBytes(`audio.music-${track}-${extension}`));
    const loading = (async () => {
      if (!this.oggUnsupported)
        try {
          return await decode("ogg");
        } catch {
          this.oggUnsupported = true;
        }
      try {
        return await decode("m4a");
      } catch (error) {
        console.error(`VQSV_AUDIO_DECODE music-${track}`, error);
        return null;
      }
    })();
    this.buffers.set(track, loading);
    return loading;
  }

  private async start(track: number): Promise<void> {
    if (this.playing?.track === track) return;
    const buffer = await this.load(track);
    const ctx = this.context,
      bus = this.musicBus;
    // Another track was asked for while this one decoded, or music was switched off.
    if (!buffer || !ctx || !bus || !this.enabled || this.wanted !== track) return;
    if (this.playing?.track === track) return;
    this.fadeOutCurrent();
    const info = this.table?.tracks[String(track)],
      source = ctx.createBufferSource(),
      gain = ctx.createGain(),
      now = ctx.currentTime;
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    // The MIDI's own length, not the encoder's padded one: the loop seam is sample-exact.
    source.loopEnd = Math.min(buffer.duration, info ? info.loopMicros / 1e6 : buffer.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(1, now + FADE_IN);
    source.connect(gain).connect(bus);
    source.start(now);
    this.playing = { track, source, gain };
  }

  private fadeOutCurrent(): void {
    const current = this.playing,
      ctx = this.context;
    this.playing = null;
    if (!current || !ctx) return;
    const now = ctx.currentTime;
    current.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setValueAtTime(Math.max(0.0001, current.gain.gain.value), now);
    current.gain.gain.exponentialRampToValueAtTime(0.0001, now + FADE_OUT);
    current.source.stop(now + FADE_OUT + 0.05);
  }

  private stopMusic(): void {
    this.wanted = -1;
    this.fadeOutCurrent();
  }

  private loadSettings(): void {
    try {
      const stored = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null") as Partial<
        typeof this.settings
      > | null;
      if (stored) this.settings = { ...this.settings, ...stored };
    } catch {
      /* private mode or blocked storage: the defaults stand */
    }
  }
  private saveSettings(): void {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* not persisted this time */
    }
  }
}
