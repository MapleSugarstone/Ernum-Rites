import { ATLAS, ATLAS_GRID } from './atlas-map';

/**
 * Card faces are painted out of one sheet per colour rather than one file per
 * card. Three hundred separate images are three hundred decoded bitmaps the
 * browser is free to drop the moment it wants memory back, and it does drop
 * them: cards on the table go blank and rasterise again as you hover. A sheet is
 * a single texture that every card of that colour is painting from, so it stays
 * resident while any of them is on screen.
 *
 * The grid is gapless and every cell is the same size, which is what lets the
 * crop be written as two percentages. Neither depends on how large the card is
 * drawn, so the same rule serves a card in the hand, a mini under a summon and
 * the zoomed face.
 */

const DIR = 'Cardgame/Sheets/';

/** The sheet a drawing sits on, for warming it before a match starts. */
export function sheetFor(art: string): string | null {
  const cell = ATLAS[art];
  return cell ? `${DIR}${cell.group}.png` : null;
}

/**
 * Every sheet the given drawings are spread across, each named once. A drawing
 * on no sheet stands for itself, since that is the file it paints from.
 */
export function sheetsFor(arts: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const art of arts) {
    out.add(sheetFor(art) ?? art);
  }
  return [...out];
}

/**
 * Background rules that paint one card's cell, for a box drawn at the cell's own
 * proportions. Art that never made it onto a sheet falls back to its own file,
 * so a drawing added without rebuilding the sheets still shows up.
 */
export function spriteCss(art: string, base: string): string {
  const cell = ATLAS[art];
  if (!cell) return `background-image:url('${base}${art}');background-size:100% 100%`;
  const grid = ATLAS_GRID[cell.group];
  const x = grid.cols > 1 ? (cell.col / (grid.cols - 1)) * 100 : 0;
  const y = grid.rows > 1 ? (cell.row / (grid.rows - 1)) * 100 : 0;
  return (
    `background-image:url('${base}${DIR}${cell.group}.png');` +
    `background-size:${grid.cols * 100}% ${grid.rows * 100}%;` +
    `background-position:${+x.toFixed(4)}% ${+y.toFixed(4)}%`
  );
}
