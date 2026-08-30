/**
 * The little guy who lives at the bottom of the main menu.
 *
 * He is a physical object rather than a keyframe animation: gravity, a hop
 * impulse on every landing, and a costume change on every landing too, so the
 * pose reads as a consequence of the bounce instead of a loop running beside
 * it. Six drawings and a random hop are enough that the sequence never quite
 * repeats, which is most of what makes something feel alive.
 *
 * The rattle on top is the rest of it: a couple of pixels of jitter at
 * frequencies that never line up, a lean into whichever way he is travelling,
 * and squash on impact. None of it is large enough to notice on its own.
 *
 * The menu scrolling is a force on him rather than a thing he ignores: the
 * scroll goes into his vertical speed, so flicking the page sends him up and
 * gravity brings him back. Clicking calls him, and he leaps for the pointer.
 */

/** Costume files, served out of the public assets root. */
const COSTUMES = ['1.png', '2.png', '3.png', '4.png', '5.png', '6.png'];
const DIR = 'ErnumRitesGuy/';

/** How tall the sprite box is drawn. The drawing inside it is roughly a third of that. */
const BOX = 300;
/**
 * How far down the 240x230 canvas each costume's lowest pixel sits, measured off
 * the art. Every pose stands at a slightly different height in its own frame and
 * the empty space below them runs to a third of the canvas, so one shared figure
 * leaves whichever pose is drawn highest reversing a hand's width off the floor.
 */
const FEET = [153 / 230, 150 / 230, 158 / 230, 146 / 230, 153 / 230, 147 / 230];
/**
 * A landing drives him this far past the floor. He squashes about his middle
 * rather than his feet, which is the livelier read of the two and takes his feet
 * up off the ground with it, so the floor gives under him by more than the
 * squash lifts him and the impact ends up below the line instead of above it.
 */
const DIP = 14;
/** Roughly how far the drawing reaches above his feet, for keeping his head in view. */
const HEAD = 135;
/** The floor, measured up from the bottom of the window. */
const GROUND = 18;
/** Kept this far from either edge, so he never bounces half off the screen. */
const EDGE = 90;

const GRAVITY = 1200;
const HOP_MIN = 430;
const HOP_MAX = 760;
/** A hop this weak is a stumble rather than a jump. */
const STUMBLE = 210;
const WANDER = 150;
/** However he was launched, he never carries more speed up than this. */
const VY_CAP = 1250;
/** A hop aimed at the pointer will not travel sideways faster than this. */
const CHASE_MAX = 420;
/** Odds that a landing turns into a hop towards wherever the pointer is. */
const CHASE_ODDS = 0.26;
/** Once he is chasing, the odds he keeps chasing on the landing after that. */
const CHASE_AGAIN = 0.55;
/** The pointer stops being interesting once it has been still this long. */
const POINTER_LIFE = 5000;

/** Speed handed to him per pixel the menu scrolls under him. */
const SCROLL_KICK = 4.2;
/** A called leap is at least this tall, however close to the floor the pointer is. */
const CALL_MIN = 380;

interface Guy {
  x: number;
  vx: number;
  /** Height above the floor. Zero is standing on it. */
  y: number;
  vy: number;
  costume: number;
  facing: 1 | -1;
  chasing: boolean;
  /** Runs 1 to 0 over the moments after a landing, and drives the squash. */
  squash: number;
}

let layer: HTMLDivElement | null = null;
let shape: HTMLDivElement | null = null;
let sprites: HTMLImageElement[] = [];
let raf = 0;
let last = 0;
let showing = false;
/** Where the costume he has on touches the floor, as a share of the sprite box. */
let foot = FEET[0];
/** The menu's scroller and where it was last frame, for reading the scroll as a force. */
let scroller: Element | null = null;
let scrollAt = 0;

const pointer = { x: -1, y: -1, at: -Infinity };

const guy: Guy = {
  x: 0,
  vx: 0,
  y: 0,
  vy: 0,
  costume: 0,
  facing: 1,
  chasing: false,
  squash: 0,
};

const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Builds the layer once and leaves it parked. Safe to call more than once. */
export function mountGuy(base: string): void {
  if (layer) return;
  layer = document.createElement('div');
  layer.className = 'guylayer';
  layer.setAttribute('aria-hidden', 'true');
  shape = document.createElement('div');
  shape.className = 'guy';
  shape.style.setProperty('--guy-h', `${BOX}px`);
  // All six are in the document from the start and only their opacity changes:
  // swapping one src every bounce hands the browser a decode mid-hop.
  sprites = COSTUMES.map((file) => {
    const img = document.createElement('img');
    img.src = `${base}${DIR}${file}`;
    img.alt = '';
    img.draggable = false;
    shape!.append(img);
    return img;
  });
  layer.append(shape);
  document.body.prepend(layer);

  guy.x = window.innerWidth / 2;
  guy.costume = Math.floor(Math.random() * COSTUMES.length);
  wear(guy.costume);

  window.addEventListener(
    'pointermove',
    (ev) => {
      pointer.x = ev.clientX;
      pointer.y = ev.clientY;
      pointer.at = performance.now();
    },
    { passive: true },
  );
  window.addEventListener(
    'pointerdown',
    (ev) => {
      if (showing) leapAt(ev.clientX, ev.clientY);
    },
    { passive: true },
  );
}

/** Whether the menu is the screen being drawn. On any other screen he sleeps. */
export function showGuy(on: boolean): void {
  if (!layer || on === showing) return;
  showing = on;
  layer.classList.toggle('on', on);
  if (!on) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    scroller = null;
    return;
  }
  last = performance.now();
  if (reducedMotion()) draw(last);
  else raf = requestAnimationFrame(step);
}

function wear(n: number): void {
  for (let i = 0; i < sprites.length; i++) sprites[i].classList.toggle('on', i === n);
  foot = FEET[n];
}

/** The next costume, which is any of them except the one he has on. */
function change(): void {
  guy.costume = (guy.costume + 1 + Math.floor(Math.random() * (COSTUMES.length - 1))) % COSTUMES.length;
  wear(guy.costume);
}

/**
 * Called by a click: he drops whatever he was doing and jumps, mid-air or not.
 * The arc is fitted to the cursor rather than pointed at it, so the top of the
 * jump is where the pointer is standing.
 */
function leapAt(cx: number, cy: number): void {
  const apex = Math.max(0, window.innerHeight - GROUND - cy);
  guy.vy = clamp(Math.sqrt(2 * GRAVITY * apex), CALL_MIN, VY_CAP);
  guy.vx = clamp((cx - guy.x) / (guy.vy / GRAVITY), -CHASE_MAX * 1.6, CHASE_MAX * 1.6);
  guy.chasing = true;
  guy.squash = 1;
  if (Math.abs(guy.vx) > 30) guy.facing = guy.vx < 0 ? -1 : 1;
  change();
}

/**
 * A landing: take the next costume, then decide where the next hop is going.
 * Near an edge the choice is made for him, and every so often the pointer makes
 * it instead, which is the only time he crosses the screen with any purpose.
 */
function land(): void {
  guy.y = 0;
  guy.squash = 1;
  change();

  guy.vy = Math.random() < 0.18 ? rand(STUMBLE, STUMBLE * 1.7) : rand(HOP_MIN, HOP_MAX);

  const live = pointer.x >= 0 && performance.now() - pointer.at < POINTER_LIFE;
  guy.chasing = live && Math.random() < (guy.chasing ? CHASE_AGAIN : CHASE_ODDS);
  if (guy.chasing) {
    // Land on the pointer rather than drift at it: the hop has already committed
    // to a flight time, so the speed that arrives there falls out of it.
    const flight = (2 * guy.vy) / GRAVITY;
    guy.vx = clamp((pointer.x - guy.x) / flight, -CHASE_MAX, CHASE_MAX);
  } else {
    guy.vx = rand(-WANDER, WANDER);
  }

  if (guy.x < EDGE) guy.vx = Math.abs(guy.vx);
  else if (guy.x > window.innerWidth - EDGE) guy.vx = -Math.abs(guy.vx);
  if (Math.abs(guy.vx) > 30) guy.facing = guy.vx < 0 ? -1 : 1;
}

/** How far the menu scrolled since the last frame, and nothing on the frame it appears. */
function scrollDelta(): number {
  const el = document.querySelector('.setup');
  const at = el?.scrollTop ?? 0;
  const moved = el && el === scroller ? at - scrollAt : 0;
  scroller = el;
  scrollAt = at;
  return moved;
}

function step(now: number): void {
  raf = requestAnimationFrame(step);
  // A backgrounded tab hands back one enormous frame, which would fire him off
  // the top of the window. Anything longer than a stutter is treated as a stutter.
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;

  // The floor is leaving under him, so the scroll goes straight into his speed.
  guy.vy = clamp(guy.vy + scrollDelta() * SCROLL_KICK, -VY_CAP, VY_CAP);

  guy.vy -= GRAVITY * dt;
  guy.y += guy.vy * dt;
  if (guy.y <= 0 && guy.vy <= 0) land();
  const ceiling = window.innerHeight - GROUND - HEAD;
  if (guy.y > ceiling) {
    guy.y = ceiling;
    guy.vy = -Math.abs(guy.vy) * 0.45;
  }

  guy.x += guy.vx * dt;
  if (guy.x < EDGE) {
    guy.x = EDGE;
    guy.vx = Math.abs(guy.vx) * 0.7;
    guy.facing = 1;
  } else if (guy.x > window.innerWidth - EDGE) {
    guy.x = window.innerWidth - EDGE;
    guy.vx = -Math.abs(guy.vx) * 0.7;
    guy.facing = -1;
  }

  guy.squash = Math.max(0, guy.squash - dt * 5);
  draw(now);
}

function draw(now: number): void {
  if (!shape) return;
  const t = now / 1000;
  // Frequencies with nothing in common, so the rattle never lands on a beat.
  // A pixel and a half is all of it.
  const jx = Math.sin(t * 8.3) * 1.4 + Math.sin(t * 3.5) * 0.9;
  const jy = Math.sin(t * 6.9) * 1.2 + Math.sin(t * 2.4) * 0.8;

  const squash = guy.squash * guy.squash;
  const stretch = clamp(guy.vy / 4200, -0.06, 0.12);
  const sx = 1 + squash * 0.26 - stretch;
  const sy = 1 - squash * 0.24 + stretch;
  const tilt = clamp(guy.vx * 0.026, -13, 13) + Math.sin(t * 1.7) * 2.2 + Math.sin(t * 5.8) * 1.1;

  // Each costume's own contact point is what gets put on the floor, and the dip
  // rides on the same curve as the squash that lifts it.
  const x = guy.x + jx;
  const y = window.innerHeight - GROUND - guy.y + DIP * squash + jy;
  shape.style.transform =
    `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) translate(-50%, -${(foot * 100).toFixed(3)}%) ` +
    `rotate(${tilt.toFixed(2)}deg) scale(${(sx * guy.facing).toFixed(3)}, ${sy.toFixed(3)})`;
}
