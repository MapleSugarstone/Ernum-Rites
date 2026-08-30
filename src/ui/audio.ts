/**
 * Two stems that both play from the moment the page is woken, one of them
 * silent. Switching moods crossfades between them rather than cutting, so the
 * danger stem is already in the same bar by the time it is heard, and the pair
 * is the same length so they never drift apart.
 *
 * A browser will not make a sound until the page has been clicked, so nothing
 * is created or started until it has been.
 */

export type Mood = 'normal' | 'danger';

const STEMS: Record<Mood, string> = {
  normal: 'Music/normal.mp3',
  danger: 'Music/danger.mp3',
};

/** Seconds to cross from one stem to the other. Long enough to be a fade. */
const FADE = 1.6;
/** Where the two levels are kept between visits. */
const STORE = 'ernumrites.audio';

export interface Levels {
  music: number;
  sfx: number;
}

let level: Levels = load();

let ctx: AudioContext | null = null;
let musicBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
const stems = new Map<Mood, GainNode>();
/**
 * The elements behind the stems. A phone can refuse to start a media element on
 * the tap that built it, and a refusal leaves it paused for good, so they are
 * kept to be started again on the next tap.
 */
const stemEls: HTMLAudioElement[] = [];
let mood: Mood = 'normal';

function load(): Levels {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const kept = JSON.parse(raw) as Partial<Levels>;
      return {
        music: clamp(kept.music ?? 0.55),
        sfx: clamp(kept.sfx ?? 0.8),
      };
    }
  } catch {
    /* a browser with storage switched off still gets to hear the game */
  }
  return { music: 0.55, sfx: 0.8 };
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function save(): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(level));
  } catch {
    /* nothing to do about it, and nothing that needs doing */
  }
}

export function levels(): Levels {
  return { ...level };
}

/**
 * The bus every sound effect should hang off, once there are any. Null until
 * the page has been clicked, which is the same thing as saying there is no
 * audio yet.
 */
export function effectsBus(): { ctx: AudioContext; out: GainNode } | null {
  return ctx && sfxBus ? { ctx, out: sfxBus } : null;
}

export function setLevel(bus: keyof Levels, value: number): void {
  level = { ...level, [bus]: clamp(value) };
  save();
  const node = bus === 'music' ? musicBus : sfxBus;
  if (node && ctx) node.gain.setTargetAtTime(level[bus], ctx.currentTime, 0.02);
}

/**
 * Wake the audio. Safe to call on every click: the second call onwards only
 * resumes a context the browser may have suspended again.
 */
export function startAudio(base: string): void {
  if (ctx) {
    void ctx.resume();
    // Resuming the context is enough for the effects, which are pure Web Audio,
    // but a stem the phone refused earlier is still sitting paused and only a
    // tap can start it. Every tap gets to try again.
    playStems();
    return;
  }
  const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
  musicBus = ctx.createGain();
  musicBus.gain.value = level.music;
  musicBus.connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = level.sfx;
  sfxBus.connect(ctx.destination);

  for (const name of Object.keys(STEMS) as Mood[]) {
    const el = new Audio(`${base}${STEMS[name]}`);
    el.loop = true;
    el.preload = 'auto';
    // The element is muted by its own gain node rather than by volume, so the
    // silent stem still runs and stays in step with the one being heard.
    const gain = ctx.createGain();
    gain.gain.value = name === mood ? 1 : 0;
    ctx.createMediaElementSource(el).connect(gain).connect(musicBus);
    stems.set(name, gain);
    stemEls.push(el);
  }
  void ctx.resume();
  playStems();
}

/** Start any stem that is not running. Safe to call on every tap. */
function playStems(): void {
  for (const el of stemEls) {
    if (!el.paused) continue;
    void el.play().catch(() => {
      /* still refused, so it stays silent and the next tap tries again */
    });
  }
}

/** Crossfade to a mood. A mood that is already playing is left alone. */
export function setMood(next: Mood): void {
  if (next === mood) return;
  mood = next;
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const [name, gain] of stems) {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(name === next ? 1 : 0, now + FADE);
  }
}
