/**
 * Sound effects. Every clip is fetched and decoded once on first use and then
 * kept, so the first play of a sound is the only one that waits on the network.
 *
 * Nothing here throws. A clip that will not load, a browser that refuses to
 * decode it, and a page that has not been clicked yet all end up in the same
 * place: the game carries on silently rather than breaking.
 */

import { effectsBus } from './audio';

/**
 * Every sound the game can make, and the file it comes from. The key is what
 * the rest of the code names, so a clip can be replaced without touching the
 * call sites.
 */
const CLIPS = {
  // --- cards changing zones -------------------------------------------------
  play: 'Sounds/placecard.wav',
  supporter: 'Sounds/gainsupporter.wav',
  hold: 'Sounds/holdingcardbeforeplaying.wav',
  draw: 'Sounds/drawcard.wav',
  mill: 'Sounds/mill.wav',
  reshuffle: 'Sounds/discardtomaindeck.wav',

  // --- combat and damage ----------------------------------------------------
  clash: 'Sounds/clash.mp3',
  die: 'Sounds/summondie.wav',
  wound1: 'Sounds/wound1.mp3',
  wound2: 'Sounds/wound2.mp3',
  shield: 'Sounds/powershield.wav',
  heal: 'Sounds/HPHeal.wav',
  buff: 'Sounds/buff.wav',
  debuff: 'Sounds/debuff.wav',
  sap: 'Sounds/sap.wav',
  annihilate: 'Sounds/annihilate.mp3',
  eat: 'Sounds/eat.wav',

  // --- debt -----------------------------------------------------------------
  debt: 'Sounds/sendtodebt.mp3',
  debtUp: 'Sounds/debtdamage.wav',
  debtDown: 'Sounds/debtheal.mp3',

  // --- spells and powers, by colour ----------------------------------------
  spellF: 'Sounds/genericfishspell.wav',
  spellO: 'Sounds/genericoilspell.wav',
  spellP: 'Sounds/genericpepperspell.wav',
  spellR: 'Sounds/genericrobotspell.wav',
  spellS: 'Sounds/genericsolarspellorpower.wav',
  solarBig: 'Sounds/strongsolarspellorpower.wav',
  pepperBolt: 'Sounds/pepperdirectdamage.wav',

  // --- cards with a voice of their own --------------------------------------
  kapigras: 'Sounds/kapigras.wav',
  graft: 'Sounds/graft.wav',
  joke: 'Sounds/joke.wav',
  recompile: 'Sounds/recompile.wav',
  fishcatch: 'Sounds/fishcatch.wav',

  // --- the frame around the match ------------------------------------------
  lobby: 'Sounds/connecttolobby.mp3',
  last10: 'Sounds/last10seconds.mp3',
  win: 'Sounds/winner.mp3',
  lose: 'Sounds/loser.mp3',
} as const;

export type Sfx = keyof typeof CLIPS;

/**
 * Per-clip level trim. The clips were recorded at wildly different levels: the
 * quietest sits around 0.003 RMS and the loudest around 0.32, so playing them
 * all at face value buries half of them. Each number here brings its clip
 * towards a common loudness without pushing its peak into clipping. Anything
 * not listed is already about right.
 */
const TRIM: Partial<Record<Sfx, number>> = {
  play: 0.71,
  supporter: 1.22,
  hold: 3.5,
  draw: 2.68,
  mill: 0.7,
  reshuffle: 2.21,
  clash: 0.8,
  die: 1.07,
  wound1: 1.36,
  wound2: 0.9,
  shield: 3.5,
  heal: 0.5,
  buff: 1.38,
  debuff: 1.17,
  sap: 3.15,
  annihilate: 1.4,
  eat: 0.76,
  debt: 0.67,
  debtDown: 0.84,
  spellF: 2.3,
  spellO: 3.44,
  spellP: 0.54,
  spellR: 1.96,
  spellS: 1.07,
  solarBig: 2.74,
  pepperBolt: 0.81,
  kapigras: 0.84,
  graft: 2.68,
  recompile: 0.72,
  fishcatch: 1.4,
  lobby: 0.84,
  win: 1.81,
  lose: 0.56,
};

let base = '';
const buffers = new Map<Sfx, AudioBuffer>();
const loading = new Set<Sfx>();
/** Names that failed once. Retrying every time would hammer a missing file. */
const dead = new Set<Sfx>();

/** Told where the assets live, since the site is served from a subpath. */
export function setSfxBase(path: string): void {
  base = path;
}

async function load(name: Sfx, ctx: AudioContext): Promise<void> {
  if (loading.has(name) || dead.has(name)) return;
  loading.add(name);
  try {
    const res = await fetch(`${base}${CLIPS[name]}`);
    if (!res.ok) throw new Error(String(res.status));
    buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
  } catch {
    dead.add(name);
  } finally {
    loading.delete(name);
  }
}

/**
 * Play one clip. The first call for a name starts the fetch and returns without
 * a sound, which is the right trade: waiting would put the noise after the
 * animation it belongs to.
 */
export function playSfx(name: Sfx, opts: { gain?: number; rate?: number } = {}): void {
  const bus = effectsBus();
  if (!bus) return;
  const buffer = buffers.get(name);
  if (!buffer) {
    void load(name, bus.ctx);
    return;
  }
  try {
    const src = bus.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = opts.rate ?? 1;
    const level = (opts.gain ?? 1) * (TRIM[name] ?? 1);
    if (level !== 1) {
      const g = bus.ctx.createGain();
      g.gain.value = level;
      src.connect(g).connect(bus.out);
    } else {
      src.connect(bus.out);
    }
    src.start();
  } catch {
    /* a source that will not start is not worth taking the game down for */
  }
}

/**
 * The card-holding bed. A six second loop rather than a one-shot: it fades up
 * while a card is off the table and is cut the moment it lands, so the sound
 * lasts exactly as long as the hold does.
 */
let holdSrc: AudioBufferSourceNode | null = null;
let holdGain: GainNode | null = null;
/** Time constants, not durations: setTargetAtTime approaches rather than arrives. */
const HOLD_IN = 0.12;
const HOLD_OUT = 0.13;

export function startHold(): void {
  const bus = effectsBus();
  if (!bus || holdSrc) return;
  const buffer = buffers.get('hold');
  if (!buffer) {
    // Not decoded yet, so this hold is silent and the next one will not be.
    void load('hold', bus.ctx);
    return;
  }
  try {
    const g = bus.ctx.createGain();
    g.gain.value = 0;
    const src = bus.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(g).connect(bus.out);
    src.start();
    g.gain.setTargetAtTime(TRIM.hold ?? 1, bus.ctx.currentTime, HOLD_IN);
    holdSrc = src;
    holdGain = g;
  } catch {
    holdSrc = null;
    holdGain = null;
  }
}

export function stopHold(): void {
  const src = holdSrc;
  const g = holdGain;
  holdSrc = null;
  holdGain = null;
  if (!src || !g) return;
  const bus = effectsBus();
  try {
    if (bus) {
      const now = bus.ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.setTargetAtTime(0, now, HOLD_OUT);
      // Stopped once the ramp has effectively finished, so the tail is not cut.
      src.stop(now + HOLD_OUT * 6);
    } else {
      src.stop();
    }
  } catch {
    /* a source already stopped is not a problem worth reporting */
  }
}

/**
 * The last ten seconds of a clock. A one-shot rather than a loop, but held on a
 * gain node like the hold bed is, so ending the turn early fades it instead of
 * cutting it dead mid-tick.
 */
let ropeSrc: AudioBufferSourceNode | null = null;
let ropeGain: GainNode | null = null;
const ROPE_OUT = 0.18;

/** Whether a ring is now sounding, so a caller can retry once it has decoded. */
export function startLast10(): boolean {
  const bus = effectsBus();
  if (!bus) return false;
  if (ropeSrc) return true;
  const buffer = buffers.get('last10');
  if (!buffer) {
    // Not decoded yet, so this clock is silent and the next one will not be.
    void load('last10', bus.ctx);
    return false;
  }
  try {
    const g = bus.ctx.createGain();
    g.gain.value = TRIM.last10 ?? 1;
    const src = bus.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(g).connect(bus.out);
    // A clock left to run out ends on its own, and must not look still-playing.
    src.onended = () => {
      if (ropeSrc !== src) return;
      ropeSrc = null;
      ropeGain = null;
    };
    src.start();
    ropeSrc = src;
    ropeGain = g;
    return true;
  } catch {
    ropeSrc = null;
    ropeGain = null;
    return false;
  }
}

export function stopLast10(): void {
  const src = ropeSrc;
  const g = ropeGain;
  ropeSrc = null;
  ropeGain = null;
  if (!src || !g) return;
  const bus = effectsBus();
  try {
    if (bus) {
      const now = bus.ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.setTargetAtTime(0, now, ROPE_OUT);
      // Stopped once the ramp has effectively finished, so the tail is not cut.
      src.stop(now + ROPE_OUT * 6);
    } else {
      src.stop();
    }
  } catch {
    /* a source already stopped is not a problem worth reporting */
  }
}

/**
 * Pull every clip in as soon as the page has been clicked. The whole set is
 * under four megabytes, and loading on demand meant the first use of any sound
 * was swallowed while it fetched, which is exactly the moment worth hearing.
 * The common ones go first so a fast opening is covered before the rest land.
 */
export function warmSfx(): void {
  const bus = effectsBus();
  if (!bus) return;
  const first: Sfx[] = ['play', 'supporter', 'draw', 'clash', 'die', 'debtUp', 'hold'];
  const rest = (Object.keys(CLIPS) as Sfx[]).filter((n) => !first.includes(n));
  for (const name of [...first, ...rest]) {
    if (!buffers.has(name)) void load(name, bus.ctx);
  }
}
