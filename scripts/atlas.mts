/**
 * Packs the card art into one sheet per colour and writes the lookup the UI
 * reads. Run it after adding or redrawing a card:
 *
 *   npm run atlas
 *
 * The point is not file size, it is decoded bitmaps. Three hundred separate
 * faces are three hundred things the browser may drop when it wants memory
 * back, and it does drop them, mid-game, leaving cards to rasterise again as
 * you hover. A sheet is one texture that every card on the table is painting
 * from, so it stays resident for as long as it is on screen.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..');
const PACK = path.join(ROOT, 'assets', 'Cardgame');
const SHEETS = path.join(PACK, 'Sheets');
const MAP = path.join(ROOT, 'src', 'ui', 'atlas-map.ts');

/** Card art is drawn at exactly this size; anything else is frame or chrome. */
const CELL_W = 219;
const CELL_H = 157;

interface Raster {
  w: number;
  h: number;
  rgba: Uint8Array;
}

// --- png --------------------------------------------------------------------

function chunksOf(buf: Buffer) {
  let off = 8;
  const out: { type: string; data: Buffer }[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    out.push({
      type: buf.toString('ascii', off + 4, off + 8),
      data: buf.subarray(off + 8, off + 8 + len),
    });
    off += 12 + len;
  }
  return out;
}

function unfilter(raw: Buffer, rowBytes: number, bpp: number, h: number): Buffer[] {
  const lines: Buffer[] = [];
  let prev = Buffer.alloc(rowBytes);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + rowBytes));
    p += rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 255;
      else if (filter === 2) line[i] = (line[i] + b) & 255;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    prev = line;
    lines.push(line);
  }
  return lines;
}

function decode(file: string): Raster {
  const cs = chunksOf(fs.readFileSync(file));
  const ihdr = cs.find((c) => c.type === 'IHDR')!.data;
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  const depth = ihdr[8];
  const ctype = ihdr[9];
  const raw = zlib.inflateSync(Buffer.concat(cs.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const rgba = new Uint8Array(w * h * 4);
  if (ctype === 3) {
    const plte = cs.find((c) => c.type === 'PLTE')!.data;
    const trns = cs.find((c) => c.type === 'tRNS')?.data ?? Buffer.alloc(0);
    const rowBytes = Math.ceil((w * depth) / 8);
    const lines = unfilter(raw, rowBytes, 1, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bit = x * depth;
        const v = (lines[y][bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        const o = (y * w + x) * 4;
        rgba[o] = plte[v * 3];
        rgba[o + 1] = plte[v * 3 + 1];
        rgba[o + 2] = plte[v * 3 + 2];
        rgba[o + 3] = v < trns.length ? trns[v] : 255;
      }
    }
  } else if (ctype === 6) {
    const lines = unfilter(raw, w * 4, 4, h);
    for (let y = 0; y < h; y++) rgba.set(lines[y], y * w * 4);
  } else {
    throw new Error(`${path.basename(file)}: colour type ${ctype} not handled`);
  }
  return { w, h, rgba };
}

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let c = -1;
  for (let i = 0; i < body.length; i++) c = CRC[(c ^ body[i]) & 0xff] ^ (c >>> 8);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((c ^ -1) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function png(ihdr: Buffer, extra: Buffer[], raw: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...extra,
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Indexed when the sheet's colours fit a byte, straight RGBA when they do not.
 * Every drawing in the pack is already indexed, so a sheet of one colour's worth
 * of them almost always fits and stays about as small as the pieces it replaces.
 */
function encode(r: Raster): { buf: Buffer; indexed: boolean } {
  const seen = new Map<number, number>();
  for (let i = 0; i < r.rgba.length; i += 4) {
    const k = (r.rgba[i] << 24) | (r.rgba[i + 1] << 16) | (r.rgba[i + 2] << 8) | r.rgba[i + 3];
    if (!seen.has(k)) {
      seen.set(k, seen.size);
      if (seen.size > 256) break;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(r.w, 0);
  ihdr.writeUInt32BE(r.h, 4);

  if (seen.size <= 256) {
    const keys = [...seen.keys()];
    const plte = Buffer.alloc(keys.length * 3);
    const trns = Buffer.alloc(keys.length);
    let anyAlpha = false;
    keys.forEach((k, i) => {
      plte[i * 3] = (k >>> 24) & 255;
      plte[i * 3 + 1] = (k >>> 16) & 255;
      plte[i * 3 + 2] = (k >>> 8) & 255;
      trns[i] = k & 255;
      if (trns[i] !== 255) anyAlpha = true;
    });
    const raw = Buffer.alloc(r.h * (1 + r.w));
    for (let y = 0; y < r.h; y++) {
      const at = y * (1 + r.w);
      raw[at] = 0;
      for (let x = 0; x < r.w; x++) {
        const o = (y * r.w + x) * 4;
        const k = (r.rgba[o] << 24) | (r.rgba[o + 1] << 16) | (r.rgba[o + 2] << 8) | r.rgba[o + 3];
        raw[at + 1 + x] = seen.get(k)!;
      }
    }
    ihdr[8] = 8;
    ihdr[9] = 3;
    const extra = [chunk('PLTE', plte), ...(anyAlpha ? [chunk('tRNS', trns)] : [])];
    return { buf: png(ihdr, extra, raw), indexed: true };
  }

  const raw = Buffer.alloc(r.h * (1 + r.w * 4));
  for (let y = 0; y < r.h; y++) {
    const at = y * (1 + r.w * 4);
    raw[at] = 0;
    Buffer.from(r.rgba.buffer, r.rgba.byteOffset + y * r.w * 4, r.w * 4).copy(raw, at + 1);
  }
  ihdr[8] = 8;
  ihdr[9] = 6;
  return { buf: png(ihdr, [], raw), indexed: false };
}

// --- packing ----------------------------------------------------------------

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'Sheets' ? [] : walk(full);
    return e.name.toLowerCase().endsWith('.png') ? [full] : [];
  });
}

/** The pack path a CardDef carries, e.g. Cardgame/Blue/1/basicfish.png. */
function packPath(file: string): string {
  return `Cardgame/${path.relative(PACK, file).split(path.sep).join('/')}`;
}

const groups = new Map<string, string[]>();
for (const file of walk(PACK).sort()) {
  const head = Buffer.alloc(8);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 8, 16);
  fs.closeSync(fd);
  if (head.readUInt32BE(0) !== CELL_W || head.readUInt32BE(4) !== CELL_H) continue;
  const group = packPath(file).split('/')[1];
  const list = groups.get(group);
  if (list) list.push(file);
  else groups.set(group, [file]);
}

fs.mkdirSync(SHEETS, { recursive: true });
const cells: [string, string, number, number][] = [];
const grids: [string, number, number][] = [];
let total = 0;

for (const [group, files] of [...groups].sort()) {
  // A near-square grid keeps both sides well inside what mobile GPUs will take.
  const cols = Math.ceil(Math.sqrt(files.length));
  const rows = Math.ceil(files.length / cols);
  const sheet: Raster = {
    w: cols * CELL_W,
    h: rows * CELL_H,
    rgba: new Uint8Array(cols * CELL_W * rows * CELL_H * 4),
  };
  files.forEach((file, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const src = decode(file);
    for (let y = 0; y < CELL_H; y++) {
      const from = y * CELL_W * 4;
      const to = ((row * CELL_H + y) * sheet.w + col * CELL_W) * 4;
      sheet.rgba.set(src.rgba.subarray(from, from + CELL_W * 4), to);
    }
    cells.push([packPath(file), group, col, row]);
  });
  const { buf, indexed } = encode(sheet);
  fs.writeFileSync(path.join(SHEETS, `${group}.png`), buf);
  grids.push([group, cols, rows]);
  total += buf.length;
  console.log(
    `${group.padEnd(8)} ${String(files.length).padStart(3)} cards  ${cols}x${rows} grid  ` +
      `${sheet.w}x${sheet.h}  ${(buf.length / 1024).toFixed(0)}kb  ${indexed ? 'indexed' : 'rgba'}`,
  );
}

const lines = [
  '// Generated by scripts/atlas.mts. Run `npm run atlas` after changing card art.',
  '',
  '/** Which sheet a drawing sits on, and where on it. */',
  'export interface AtlasCell {',
  '  group: string;',
  '  col: number;',
  '  row: number;',
  '}',
  '',
  '/** Cell size of each sheet, in cells. */',
  'export const ATLAS_GRID: Record<string, { cols: number; rows: number }> = {',
  ...grids.map(([g, c, r]) => `  ${JSON.stringify(g)}: { cols: ${c}, rows: ${r} },`),
  '};',
  '',
  'export const ATLAS: Record<string, AtlasCell> = {',
  ...cells
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([p, g, c, r]) => `  ${JSON.stringify(p)}: { group: ${JSON.stringify(g)}, col: ${c}, row: ${r} },`),
  '};',
  '',
];
fs.writeFileSync(MAP, lines.join('\n'));
console.log(`\n${cells.length} cards on ${grids.length} sheets, ${(total / 1024).toFixed(0)}kb total`);
console.log(`wrote ${path.relative(ROOT, MAP)}`);
