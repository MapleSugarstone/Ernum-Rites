import type { ArtTint } from '../engine/types';
import { FRAME_HUE, loadImage, type FrameKey } from './frames';

/**
 * A card rebuilt in another colour keeps its drawing and gets recoloured to the
 * colour it came out as, so a stolen Fish never sits on the board still painted
 * blue. The whole piece takes a Color layer in the target hue: each pixel keeps
 * its own lightness and trades its hue for the new one, which leaves the
 * shading and the black outline intact where a flat fill would erase both.
 *
 * Malicious Code and Virus go one step further and pick accents out of the
 * result. The pack is indexed pixel art carrying a handful of colours each, so
 * "the least common color" is a real feature of a drawing rather than a stray
 * antialiased pixel, and swapping one out flat reads as corruption showing
 * through.
 */

interface Recipe {
  /** The colour laid over the whole piece. */
  layer: FrameKey;
  /**
   * Colours handed to the least common shades in the piece, rarest first. The
   * layer keeps first claim on the drawing: accents only take shades beyond the
   * most common one, so a piece drawn in a single colour comes out wholly in the
   * layer's hue rather than losing the one colour it had.
   */
  accents: FrameKey[];
}

const RECIPE: Record<ArtTint, Recipe> = {
  oil: { layer: 'O', accents: [] },
  robot: { layer: 'R', accents: [] },
  malware: { layer: 'P', accents: ['R', 'O'] },
  // Virus is Pepper and Robot, with no Oil in it to justify a purple accent, so
  // both of its accents go to Robot.
  virus: { layer: 'P', accents: ['R', 'R'] },
};

/** At or below this a shade is black, at or above it white: neither is an accent. */
const BLACK_MAX = 32;
const WHITE_MIN = 224;

const cache = new Map<string, string>();
const started = new Set<string>();
let repaint: (() => void) | null = null;
let queued = false;

/** Told when a recolour lands, so cards already on screen redraw with it. */
export function onTintReady(fn: () => void): void {
  repaint = fn;
}

/**
 * The recoloured art, or the piece as drawn while the recolour is still being
 * built. Nothing waits on it: a minted card shows up in the colours it was taken
 * from for a frame or two and repaints itself when the canvas work lands.
 */
export function tintedArt(art: string, tint: ArtTint, base: string): string {
  const key = `${tint}:${art}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!started.has(key)) {
    started.add(key);
    void loadImage(`${base}${art}`)
      .then((img) => {
        cache.set(key, paint(img, RECIPE[tint]));
        // One action can mint several cards, so the redraw is batched rather
        // than run once per image.
        if (queued || !repaint) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          repaint?.();
        });
      })
      .catch(() => undefined);
  }
  return `${base}${art}`;
}

function paint(img: HTMLImageElement, recipe: Recipe): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = data.data;

  const counts = new Map<number, number>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const swaps = accentSwaps(counts, recipe.accents);
  const layer = hueSat(FRAME_HUE[recipe.layer]);
  // Worked out once per shade rather than once per pixel: the drawings are
  // indexed and carry at most a handful between them.
  const out = new Map<number, number>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let to = out.get(key);
    if (to === undefined) {
      to = swaps.get(key) ?? fromHsl(layer, lightnessOf(d[i], d[i + 1], d[i + 2]));
      out.set(key, to);
    }
    d[i] = (to >> 16) & 255;
    d[i + 1] = (to >> 8) & 255;
    d[i + 2] = to & 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Which shades the accents take: the least common first, and never the last one
 * standing. A drawing with one colour in it keeps none of the accents, one with
 * two gives up only its rarer shade, and only from three does the second accent
 * get a shade of its own.
 */
function accentSwaps(counts: Map<number, number>, accents: FrameKey[]): Map<number, number> {
  const swaps = new Map<number, number>();
  if (accents.length === 0) return swaps;
  const eligible = [...counts]
    .filter(([key]) => accentable(key))
    // Ties break on the colour itself, so the same drawing always recolours the
    // same way in both directions of a rematch.
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const take = Math.min(accents.length, eligible.length - 1);
  for (let i = 0; i < take; i++) {
    const [r, g, b] = FRAME_HUE[accents[i]];
    swaps.set(eligible[i][0], (r << 16) | (g << 8) | b);
  }
  return swaps;
}

function accentable(key: number): boolean {
  const r = (key >> 16) & 255;
  const g = (key >> 8) & 255;
  const b = key & 255;
  return Math.max(r, g, b) > BLACK_MAX && Math.min(r, g, b) < WHITE_MIN;
}

interface HueSat {
  /** Degrees. */
  h: number;
  s: number;
}

/** HSL lightness, on 0-255 channels, as a 0-1 fraction. */
function lightnessOf(r: number, g: number, b: number): number {
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

function hueSat([r, g, b]: [number, number, number]): HueSat {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const c = max - min;
  if (c === 0) return { h: 0, s: 0 };
  let h: number;
  if (max === r / 255) h = ((g - b) / 255 / c) % 6;
  else if (max === g / 255) h = (b - r) / 255 / c + 2;
  else h = (r - g) / 255 / c + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: c / (1 - Math.abs(max + min - 1)) };
}

/**
 * The Color blend: the layer's hue and saturation carried at the pixel's own
 * lightness. Lightness is the (max + min) / 2 kind rather than a weighted
 * luminosity, and that choice is what gives a bright saturated pixel a bright
 * saturated result. Pure yellow sits at the same lightness as pure red and so
 * comes out pure red, where weighting the channels by how bright the eye finds
 * them would read yellow as nearly white and wash it out to pink. Black and
 * white sit at the ends of the range and come through untouched either way.
 */
function fromHsl(hs: HueSat, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * hs.s;
  const x = c * (1 - Math.abs(((hs.h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  switch (Math.floor(hs.h / 60) % 6) {
    case 0: r = c; g = x; break;
    case 1: r = x; g = c; break;
    case 2: g = c; b = x; break;
    case 3: g = x; b = c; break;
    case 4: r = x; b = c; break;
    default: r = c; b = x; break;
  }
  return (byte((r + m) * 255) << 16) | (byte((g + m) * 255) << 8) | byte((b + m) * 255);
}

function byte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
