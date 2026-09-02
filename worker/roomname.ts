/**
 * A room's settings ride in its own name.
 *
 * The lobby mints the name and MatchRoom reads it back, and only the lobby ever
 * routes a guest to a room, so a modified client can put whatever it likes in a
 * name and only reach a room nobody else is sent to. Minting and reading live
 * together because they are one format: a segment added to one and forgotten in
 * the other is a room that seats the wrong number of players or silently drops
 * its draft.
 *
 * The order is fixed: seats, then timers, then draft. Every reader below anchors
 * at the front of the name, so a new segment goes on the end of this list rather
 * than into the middle of it.
 */

export interface RoomSettings {
  /** 3 or 4 for a party room. Undefined is the head-to-head default of 2. */
  size?: 3 | 4;
  noTimers?: boolean;
  draft?: boolean;
}

export function roomName(settings: RoomSettings, unique: string): string {
  const { size, noTimers = false, draft = false } = settings;
  return `${size ? `prv${size}` : 'prv'}-${noTimers ? 'nt-' : ''}${draft ? 'dr-' : ''}${unique}`;
}

/**
 * How many players this room seats. The lobby mints `prv3-`/`prv4-` names for
 * party rooms and plain `prv-`/`pub-` for the rest.
 */
export function seatCountFor(name: string | undefined): number {
  if (name?.startsWith('prv3-')) return 3;
  if (name?.startsWith('prv4-')) return 4;
  return 2;
}

/** Whether this room runs without clocks. Only a hosted room can turn them off. */
export function timersOffFor(name: string | undefined): boolean {
  return /^prv[34]?-nt-/.test(name ?? '');
}

/**
 * Whether this room opens packs and drafts a deck before it deals. The draft
 * clock runs whatever the timers setting says, because the boot and the fill
 * both hang off it and a draft with no deadline never starts a match.
 */
export function draftFor(name: string | undefined): boolean {
  return /^prv[34]?-(nt-)?dr-/.test(name ?? '');
}

/** Whether a private code seats several guests rather than being spent on one. */
export function isPartyName(name: string): boolean {
  return /^prv[34]-/.test(name);
}
