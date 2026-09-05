/**
 * A trained value network as the C# trainer exports it: the card ordering the
 * network was trained against, the constant facts about each card that the
 * observation reads, the tower widths, and every weight tensor as little-endian
 * float32 in base64. Nothing here is computed; the bundle is the contract
 * between the trainer and the client, and `conformance/net-parity.json` is the
 * test that both sides read it the same way.
 */

export interface NetBundleJson {
  format: number;
  cards: string[];
  masks: number[];
  limits: number[];
  tags: number[];
  channels: Record<string, number>;
  shape: Record<string, number>;
  params: Record<string, string>;
}

export interface NetShape {
  cardStem: number;
  cardMid: number;
  entityWidth: number;
  entityHead: number;
  scalarWidth: number;
  trunkWidth: number;
  headWidth: number;
}

export interface NetBundle {
  /** Card ids in column order. */
  cards: string[];
  /** Column of each card id, for the cards the network knows. */
  index: Map<string, number>;
  /** Colour identity of each column, one bit per colour in `COLORS` order. */
  masks: number[];
  /** Copies of each column a deck may run. */
  limits: number[];
  /** Rules-text tags of each column, bits of `Tag`. */
  tags: number[];
  cardChannels: number;
  entityChannels: number;
  scalarCount: number;
  entities: number;
  perSide: number;
  shape: NetShape;
  params: Record<string, Float32Array>;
}

/** The tags the trainer reads off rules text, as bits in `NetBundle.tags`. */
export const Tag = {
  Damage: 1 << 0,
  Wound: 1 << 1,
  Draw: 1 << 2,
  Debt: 1 << 3,
  Heal: 1 << 4,
  Buff: 1 << 5,
  Steal: 1 << 6,
  Mill: 1 << 7,
  Sap: 1 << 8,
  Revive: 1 << 9,
  Ramp: 1 << 10,
  Reach: 1 << 11,
  Store: 1 << 12,
  Love: 1 << 13,
} as const;

function decodeFloats(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer, 0, bytes.length >> 2);
}

export function loadBundle(json: NetBundleJson): NetBundle {
  if (json.format !== 1) throw new Error(`unknown network bundle format ${json.format}`);
  const params: Record<string, Float32Array> = {};
  for (const [name, b64] of Object.entries(json.params)) params[name] = decodeFloats(b64);
  const index = new Map<string, number>();
  json.cards.forEach((id, i) => index.set(id, i));
  const sh = json.shape;
  return {
    cards: json.cards,
    index,
    masks: json.masks,
    limits: json.limits,
    tags: json.tags,
    cardChannels: json.channels.card,
    entityChannels: json.channels.entity,
    scalarCount: json.channels.scalar,
    entities: json.channels.entities,
    perSide: json.channels.perSide,
    shape: {
      cardStem: sh.cardStem,
      cardMid: sh.cardMid,
      entityWidth: sh.entityWidth,
      entityHead: sh.entityHead,
      scalarWidth: sh.scalarWidth,
      trunkWidth: sh.trunkWidth,
      headWidth: sh.headWidth,
    },
    params,
  };
}
