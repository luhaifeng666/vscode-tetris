import type { Settings } from "../game/types";

/**
 * Web Audio 芯片音源。
 *
 * 背景旋律是俄罗斯民谣《Korobeiniki》——公版旋律，这里做的是自己的方波改编，
 * 不复刻任何商业录音/编曲。音效全部由振荡器现场合成，不加载任何音频文件。
 */

const BEAT_SECONDS = 0.4; // 150 BPM
const MUSIC_LEVEL = 0.06;
const SFX_LEVEL = 0.16;

/** [音名, 拍数]；null 表示休止。 */
type NoteSpec = readonly [string | null, number];

const MELODY: readonly NoteSpec[] = [
  ["E5", 1], ["B4", 0.5], ["C5", 0.5], ["D5", 1], ["C5", 0.5], ["B4", 0.5],
  ["A4", 1], ["A4", 0.5], ["C5", 0.5], ["E5", 1], ["D5", 0.5], ["C5", 0.5],
  ["B4", 1.5], ["C5", 0.5], ["D5", 1], ["E5", 1],
  ["C5", 1], ["A4", 1], ["A4", 2],
  ["D5", 1.5], ["F5", 0.5], ["A5", 1], ["G5", 0.5], ["F5", 0.5],
  ["E5", 1.5], ["C5", 0.5], ["E5", 1], ["D5", 0.5], ["C5", 0.5],
  ["B4", 1], ["B4", 0.5], ["C5", 0.5], ["D5", 1], ["E5", 1],
  ["C5", 1], ["A4", 3],
];

/** 每 4 拍换一个低音根音，垫一层三角波。 */
const BASS_ROOTS: readonly string[] = ["A2", "A2", "E2", "E2", "A2", "A2", "E2", "E2"];

const SEMITONES: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function noteFrequency(note: string): number {
  const match = /^([A-G])(#?)(-?\d)$/.exec(note);
  if (!match) return 440;
  const letter = match[1] ?? "A";
  const sharp = match[2] === "#";
  const octave = Number(match[3]);
  const semitone = (SEMITONES[letter] ?? 0) + (sharp ? 1 : 0);
  // MIDI 69 = A4 = 440Hz
  const midi = (octave + 1) * 12 + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class AudioEngine {
  private context: AudioContext | undefined;
  private musicBus: GainNode | undefined;
  private sfxBus: GainNode | undefined;

  private timer: number | undefined;
  private nextNoteTime = 0;
  private step = 0;
  private beatsPlayed = 0;

  private running = false;
  private musicEnabled = true;
  private sfxEnabled = true;

  setSettings(settings: Settings): void {
    this.musicEnabled = settings.music;
    this.sfxEnabled = settings.soundEffects;
    if (!this.musicEnabled) this.stopMusic();
    else this.maybeStartMusic();
  }

  /**
   * 浏览器要求音频必须由用户手势解锁。键盘/点击事件里调用一次即可；
   * 之后即使是通过快捷键开始游戏，也能正常出声。
   */
  unlock(): void {
    const context = this.ensureContext();
    if (!context) return;
    if (context.state === "suspended") {
      void context
        .resume()
        .then(() => this.maybeStartMusic())
        .catch(() => {});
      return;
    }
    this.maybeStartMusic();
  }

  sync(running: boolean): void {
    this.running = running;
    if (running) this.maybeStartMusic();
    else this.stopMusic();
  }

  rotate(): void {
    this.blip(520, 0.045, "square", 0.09);
    this.blip(760, 0.045, "square", 0.09, 0.045);
  }

  hardDrop(): void {
    this.sweep(240, 70, 0.14, "square", 0.14);
  }

  lock(): void {
    this.blip(110, 0.07, "triangle", 0.16);
  }

  clear(count: number): void {
    if (!this.sfxEnabled) return;
    const context = this.ensureContext();
    const bus = this.sfxBus;
    if (!context || !bus) return;

    const notes = count >= 4 ? ["C5", "E5", "G5", "C6", "E6"] : ["C5", "E5", "G5"];
    const base = context.currentTime + 0.01;
    notes.forEach((note, index) => {
      this.playNote(note, base + index * 0.055, 0.1, "square", bus, 0.45);
    });
  }

  levelUp(): void {
    if (!this.sfxEnabled) return;
    const context = this.ensureContext();
    const bus = this.sfxBus;
    if (!context || !bus) return;

    const base = context.currentTime + 0.01;
    ["E5", "G5", "B5", "E6"].forEach((note, index) => {
      this.playNote(note, base + index * 0.07, 0.12, "square", bus, 0.45);
    });
  }

  gameOver(): void {
    this.stopMusic();
    if (!this.sfxEnabled) return;
    const context = this.ensureContext();
    const bus = this.sfxBus;
    if (!context || !bus) return;

    const base = context.currentTime + 0.02;
    ["A4", "F4", "D4", "A3"].forEach((note, index) => {
      this.playNote(note, base + index * 0.18, 0.24, "square", bus, 0.5);
    });
  }

  dispose(): void {
    this.stopMusic();
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context) return this.context;
    try {
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = 1;
      master.connect(context.destination);

      const music = context.createGain();
      music.gain.value = 0.0001;
      music.connect(master);

      const sfx = context.createGain();
      sfx.gain.value = SFX_LEVEL;
      sfx.connect(master);

      this.context = context;
      this.musicBus = music;
      this.sfxBus = sfx;
      return context;
    } catch {
      return undefined;
    }
  }

  private maybeStartMusic(): void {
    if (!this.running || !this.musicEnabled) return;
    const context = this.ensureContext();
    const bus = this.musicBus;
    if (!context || !bus || context.state !== "running" || this.timer !== undefined) {
      return;
    }

    const now = context.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), now);
    bus.gain.linearRampToValueAtTime(MUSIC_LEVEL, now + 0.08);

    this.nextNoteTime = now + 0.08;
    this.step = 0;
    this.beatsPlayed = 0;
    this.timer = window.setInterval(() => this.scheduleMusic(), 25);
    this.scheduleMusic();
  }

  private scheduleMusic(): void {
    const context = this.context;
    const bus = this.musicBus;
    if (!context || !bus) return;

    const horizon = context.currentTime + 0.25;
    for (let guard = 0; this.nextNoteTime < horizon && guard < 64; guard++) {
      const spec = MELODY[this.step % MELODY.length]!;
      const [note, beats] = spec;
      const duration = beats * BEAT_SECONDS;

      if (note) {
        this.playNote(note, this.nextNoteTime, duration * 0.92, "square", bus, 0.5);
      }

      // 每四拍垫一个低音，让循环不那么单薄。
      if (Math.abs(this.beatsPlayed % 4) < 1e-9) {
        const root = BASS_ROOTS[(Math.floor(this.beatsPlayed / 4)) % BASS_ROOTS.length]!;
        this.playNote(root, this.nextNoteTime, BEAT_SECONDS * 1.6, "triangle", bus, 0.35);
      }

      this.beatsPlayed += beats;
      this.nextNoteTime += duration;
      this.step++;
    }
  }

  private stopMusic(): void {
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }

    const context = this.context;
    const bus = this.musicBus;
    if (!context || !bus) return;

    const now = context.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), now);
    bus.gain.linearRampToValueAtTime(0.0001, now + 0.05);
  }

  private blip(
    frequency: number,
    duration: number,
    type: OscillatorType,
    level: number,
    delay = 0,
  ): void {
    if (!this.sfxEnabled) return;
    const context = this.ensureContext();
    const bus = this.sfxBus;
    if (!context || !bus) return;
    this.playFrequency(
      frequency,
      context.currentTime + delay,
      duration,
      type,
      bus,
      level,
    );
  }

  private sweep(
    from: number,
    to: number,
    duration: number,
    type: OscillatorType,
    level: number,
  ): void {
    if (!this.sfxEnabled) return;
    const context = this.ensureContext();
    const bus = this.sfxBus;
    if (!context || !bus) return;

    const when = context.currentTime;
    const osc = context.createOscillator();
    const env = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, when);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), when + duration);
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(level, when + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(env);
    env.connect(bus);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }

  private playNote(
    note: string,
    when: number,
    duration: number,
    type: OscillatorType,
    destination: AudioNode,
    level: number,
  ): void {
    this.playFrequency(noteFrequency(note), when, duration, type, destination, level);
  }

  private playFrequency(
    frequency: number,
    when: number,
    duration: number,
    type: OscillatorType,
    destination: AudioNode,
    level: number,
  ): void {
    const context = this.context;
    if (!context) return;

    const osc = context.createOscillator();
    const env = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, frequency), when);

    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), when + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(0.05, duration));

    osc.connect(env);
    env.connect(destination);
    osc.start(when);
    osc.stop(when + Math.max(0.06, duration) + 0.03);
  }
}
