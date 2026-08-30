import { COLORS, type CardColour, type CardType, type Rarity } from '../engine/types';

/**
 * The art pack ships one drawing per card shape, in blue. Every other colour is
 * generated from it at runtime rather than redrawn, so a change to the frame art
 * only has to be made once.
 *
 * The blue frame is a single hue at varying brightness: every tone is
 * (0, 187, 204) scaled down. So the recolour is just "read how bright this pixel
 * is, apply that brightness to the target hue", which keeps antialiased edges
 * smooth instead of banding the way a palette swap would.
 */
const SOURCE_HUE = { g: 187, b: 204 };

/**
 * Frames exist for the five colours and for neutral, which is not a colour but
 * needs a frame all the same.
 */
/**
 * A card's colour, plus 'X' for the one card that carries every colour and so
 * belongs to none of them. It is a frame key rather than a colour because the
 * rules never see it: deck legality reads the card's identity.
 */
export type FrameKey = CardColour | 'X';

const FRAME_KEYS: FrameKey[] = [...COLORS, 'N', 'X'];

/**
 * Bright hue per frame, sampled from the drawn per-colour frames. Neutral takes
 * the warm brown of neutralc.png rather than a grey, which matters: a grey frame
 * reads as a disabled card sitting next to the coloured ones. Its darker tones
 * come out below the drawn art, because every tone here is a straight scale of
 * the blue master's brightness, and that deeper contrast is wanted.
 */
export const FRAME_HUE: Record<FrameKey, [number, number, number]> = {
  P: [204, 0, 20],
  O: [133, 0, 204],
  R: [0, 204, 0],
  F: [0, 187, 204],
  S: [204, 204, 0],
  N: [153, 113, 91],
  // Sampled off ernumc.png, which is the master frame drawn in blue-violet.
  // Kept at the brightness it was drawn at rather than scaled up to the 204
  // the others sit at, so the frame renders as dark as the art.
  X: [34, 15, 155],
};

/** The warm grey on the rounded corners is not part of the hue ramp. */
const CORNER: [number, number, number] = [204, 200, 183];
const CORNER_TINT: Record<FrameKey, [number, number, number]> = {
  P: [183, 191, 204],
  O: [183, 204, 191],
  R: [204, 183, 189],
  F: [204, 200, 183],
  S: [198, 183, 204],
  // The neutral frame keeps the master's corner unchanged, as drawn.
  N: [204, 200, 183],
  // ernumc.png's corner is the master's byte for byte, so it stays put too.
  X: [204, 200, 183],
};

export type FrameShape = 'summon' | 'spell' | 'flipbarSummon' | 'flipbarSpell';

const MASTER: Record<FrameShape, string> = {
  summon: 'Cardgame/bluec.png',
  spell: 'Cardgame/bluespell.png',
  // The rule under a flip effect is drawn in the same blue, so it recolours
  // with the frame rather than sitting there as a stray cyan line. Summon and
  // spell frames each ship their own bar.
  flipbarSummon: 'Cardgame/flipborderForSummons.png',
  flipbarSpell: 'Cardgame/flipborderForSpells.png',
};

/**
 * The rarity gem, drawn on a full card canvas so it needs no placing: overlay it
 * and the stone lands where it was drawn. One file per rarity, each carrying its
 * own fill and all four sharing the blue card's outline.
 */
const GEM_MASTER: Record<Rarity, string> = {
  C: 'Cardgame/Extras/Common.png',
  R: 'Cardgame/Extras/Rare.png',
  E: 'Cardgame/Extras/Epic.png',
  L: 'Cardgame/Extras/Legendary.png',
  P: 'Cardgame/Extras/Prismatic.png',
};

const RARITIES: Rarity[] = ['C', 'R', 'E', 'L', 'P'];

/** Brightness at the stone's top and bottom edge, the frames' own light. */
const LIT_TOP = 1.12;
const LIT_BOTTOM = 0.74;

const cache = new Map<string, string>();
let ready: Promise<void> | null = null;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

function recolor(img: HTMLImageElement, color: FrameKey): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = data.data;
  const [hr, hg, hb] = FRAME_HUE[color];
  const [cr, cg, cb] = CORNER_TINT[color];

  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 8) continue;
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];

    // Neutral pixels (the label text and the page behind the rounded corners)
    // carry no hue, so they stay exactly as drawn.
    if (r > 200 && near(r, g, 14) && near(g, b, 14)) continue;

    if (near(r, CORNER[0], 20) && near(g, CORNER[1], 20) && near(b, CORNER[2], 20)) {
      d[i] = cr;
      d[i + 1] = cg;
      d[i + 2] = cb;
      continue;
    }

    const k = Math.min(1, Math.max(g / SOURCE_HUE.g, b / SOURCE_HUE.b));
    d[i] = Math.round(hr * k);
    d[i + 1] = Math.round(hg * k);
    d[i + 2] = Math.round(hb * k);
  }

  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * The gem takes the frame's outline and keeps its own stone. Only the one
 * outline colour moves, which is why this is an exact swap rather than the
 * frame's brightness ramp: Rare's fill sits a few points off the outline it
 * would otherwise be mistaken for, and Legendary's gold would be lost entirely.
 * The art is hard-edged, so an exact match catches every outline pixel.
 */
function recolorGem(img: HTMLImageElement, color: FrameKey): string {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = data.data;
  const [hr, hg, hb] = FRAME_HUE[color];

  // The stone is a few pixels of a much larger canvas, so its own top and
  // bottom have to be found before it can be lit.
  let top = canvas.height;
  let bottom = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (d[(y * canvas.width + x) * 4 + 3] < 8) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      break;
    }
  }
  const span = Math.max(1, bottom - top);

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    if (d[i] === 0 && d[i + 1] === SOURCE_HUE.g && d[i + 2] === SOURCE_HUE.b) {
      d[i] = hr;
      d[i + 1] = hg;
      d[i + 2] = hb;
    }
    // Lit the way the frames are: a sheen along the top, deepening toward the
    // bottom, so the stone sits under the same light as the card around it.
    const t = (Math.floor(i / 4 / canvas.width) - top) / span;
    const k = LIT_TOP + (LIT_BOTTOM - LIT_TOP) * t;
    d[i] = Math.min(255, Math.round(d[i] * k));
    d[i + 1] = Math.min(255, Math.round(d[i + 1] * k));
    d[i + 2] = Math.min(255, Math.round(d[i + 2] * k));
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Builds all ten frames once. Call it before the first render; the URLs are data
 * URLs so nothing else has to wait on the network afterwards.
 */
export function prepareFrames(base: string): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    for (const shape of Object.keys(MASTER) as FrameShape[]) {
      let img: HTMLImageElement;
      try {
        img = await loadImage(`${base}${MASTER[shape]}`);
      } catch {
        continue;
      }
      for (const key of FRAME_KEYS) {
        // Fish is the master, so it is the one frame that needs no work.
        cache.set(`${shape}:${key}`, key === 'F' ? img.src : recolor(img, key));
      }
    }
    for (const rarity of RARITIES) {
      let img: HTMLImageElement;
      try {
        img = await loadImage(`${base}${GEM_MASTER[rarity]}`);
      } catch {
        continue;
      }
      // Fish takes no new outline but still needs lighting, so unlike the
      // frames there is no master to pass through untouched.
      for (const key of FRAME_KEYS) {
        cache.set(`gem:${rarity}:${key}`, recolorGem(img, key));
      }
    }
  })();
  return ready;
}

/** The frame a card draws with: its colour, unless it is neutral. */
export function frameKeyOf(def: {
  color: CardColour;
  neutral?: boolean;
  rarity?: Rarity;
}): FrameKey {
  // Keyed on the rarity, not on carrying every colour: the placeholder cards
  // spell out every colour too, to be legal anywhere, and they are not this.
  if (def.rarity === 'P') return 'X';
  return def.neutral ? 'N' : def.color;
}

export function frameFor(type: CardType, key: FrameKey, base: string): string {
  const shape: FrameShape = type === 'summon' ? 'summon' : 'spell';
  return cache.get(`${shape}:${key}`) ?? `${base}${MASTER[shape]}`;
}

export function gemFor(rarity: Rarity, key: FrameKey, base: string): string {
  return cache.get(`gem:${rarity}:${key}`) ?? `${base}${GEM_MASTER[rarity]}`;
}

export function flipBarFor(key: FrameKey, base: string, isBody: boolean): string {
  const shape: FrameShape = isBody ? 'flipbarSummon' : 'flipbarSpell';
  return cache.get(`${shape}:${key}`) ?? `${base}${MASTER[shape]}`;
}
