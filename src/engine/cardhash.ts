import { allCards } from './registry';

/**
 * A short fingerprint of the card set as this build sees it: every printed
 * id, level, statline, cost and text. Two clients on different card updates
 * hash differently, so a logged game says which set it was played on.
 */
export function cardSetHash(): string {
  const lines = allCards()
    .map((c) =>
      [c.id, c.type, c.level ?? '', c.strength ?? '', c.hp ?? '', JSON.stringify(c.cost ?? null), c.text ?? ''].join('|'),
    )
    .sort();
  let h = 0x811c9dc5;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      h ^= line.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 10;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
