import type { NetBundle } from './bundle';

/**
 * The forward pass of the trainer's network, one position at a time.
 *
 * Three towers over one observation: a convolution along the card axis, a
 * convolution over the eight bodies, and a dense layer over the scalars, fused
 * into a value in [-1, 1]. The layer order, the weight layouts and the pooling
 * rules mirror `csharp/Selatza.Learn/Nn` exactly, and the parity test holds
 * both sides to the same numbers on the same positions.
 *
 * The card stem's static half, the printed facts about each column, is folded
 * into a per-column bias by the trainer and shipped folded, so the client never
 * needs the static plane.
 */

function relu(x: Float32Array): void {
  for (let i = 0; i < x.length; i++) if (x[i] < 0) x[i] = 0;
}

/** y[oc][l] = bias(oc, l) + sum over ic of w[oc*inC+ic] * x[ic][l]. */
function pointwise(
  w: Float32Array,
  x: Float32Array,
  inC: number,
  outC: number,
  L: number,
  biasPlane: Float32Array | null,
  biasPerChannel: Float32Array | null,
): Float32Array {
  const y = new Float32Array(outC * L);
  for (let oc = 0; oc < outC; oc++) {
    const yo = oc * L;
    if (biasPlane) {
      for (let l = 0; l < L; l++) y[yo + l] = biasPlane[yo + l];
    } else if (biasPerChannel) {
      y.fill(biasPerChannel[oc], yo, yo + L);
    }
    for (let ic = 0; ic < inC; ic++) {
      const wv = w[oc * inC + ic];
      if (wv === 0) continue;
      const xo = ic * L;
      for (let l = 0; l < L; l++) y[yo + l] += wv * x[xo + l];
    }
  }
  return y;
}

/**
 * Convolution along the length with SAME zero padding, grouped so the same
 * routine covers the depthwise pass (groups equal to channels) and the full one.
 * Weight layout is `w[(oc * inPer + ic) * k + kk]`.
 */
function conv(
  w: Float32Array,
  b: Float32Array,
  x: Float32Array,
  inC: number,
  outC: number,
  k: number,
  groups: number,
  L: number,
): Float32Array {
  const y = new Float32Array(outC * L);
  const pad = (k - 1) >> 1;
  const inPer = inC / groups;
  const outPer = outC / groups;
  for (let oc = 0; oc < outC; oc++) {
    const yo = oc * L;
    y.fill(b[oc], yo, yo + L);
    const icBase = Math.floor(oc / outPer) * inPer;
    for (let ic = 0; ic < inPer; ic++) {
      const xo = (icBase + ic) * L;
      const wbase = (oc * inPer + ic) * k;
      for (let kk = 0; kk < k; kk++) {
        const wv = w[wbase + kk];
        if (wv === 0) continue;
        const shift = kk - pad;
        const from = Math.max(0, -shift);
        const to = Math.min(L, L - shift);
        for (let l = from; l < to; l++) y[yo + l] += wv * x[xo + l + shift];
      }
    }
  }
  return y;
}

/** Pairs along the length, the last one alone when the length is odd. */
function maxPool(x: Float32Array, C: number, L: number): { y: Float32Array; L: number } {
  const outLen = (L + 1) >> 1;
  const y = new Float32Array(C * outLen);
  for (let c = 0; c < C; c++) {
    const xo = c * L;
    const yo = c * outLen;
    for (let l = 0; l < outLen; l++) {
      const i0 = l * 2;
      const i1 = Math.min(i0 + 1, L - 1);
      const a = x[xo + i0];
      const bb = x[xo + i1];
      y[yo + l] = bb > a ? bb : a;
    }
  }
  return { y, L: outLen };
}

/** Mean of each channel, then the max of each channel. */
function globalPool(x: Float32Array, C: number, L: number): Float32Array {
  const y = new Float32Array(C * 2);
  for (let c = 0; c < C; c++) {
    let sum = 0;
    let max = Number.NEGATIVE_INFINITY;
    for (let l = 0; l < L; l++) {
      const v = x[c * L + l];
      sum += v;
      if (v > max) max = v;
    }
    y[c] = sum / L;
    y[C + c] = max;
  }
  return y;
}

function dense(w: Float32Array, b: Float32Array, x: Float32Array, inF: number, outF: number): Float32Array {
  const y = new Float32Array(outF);
  for (let o = 0; o < outF; o++) {
    let acc = b[o];
    const wo = o * inF;
    for (let i = 0; i < inF; i++) acc += w[wo + i] * x[i];
    y[o] = acc;
  }
  return y;
}

/** The value head's opinion of one packed observation, in [-1, 1]. */
export function valueOf(net: NetBundle, obs: Float32Array): number {
  const p = net.params;
  const sh = net.shape;
  const cards = net.cards.length;
  const cardPlane = net.cardChannels * cards;
  const entPlane = net.entityChannels * net.entities;

  // Card tower.
  let L = cards;
  let x = obs.subarray(0, cardPlane);
  let c = pointwise(p['stem.wd'], x, net.cardChannels, sh.cardStem, L, p['stem.bias'], null);
  relu(c);
  ({ y: c, L } = maxPool(c, sh.cardStem, L));
  c = conv(p['c1.dw.w'], p['c1.dw.b'], c, sh.cardStem, sh.cardStem, 3, sh.cardStem, L);
  relu(c);
  c = pointwise(p['c1.pw.w'], c, sh.cardStem, sh.cardMid, L, null, p['c1.pw.b']);
  relu(c);
  ({ y: c, L } = maxPool(c, sh.cardMid, L));
  c = conv(p['c2.dw.w'], p['c2.dw.b'], c, sh.cardMid, sh.cardMid, 3, sh.cardMid, L);
  relu(c);
  c = pointwise(p['c2.pw.w'], c, sh.cardMid, sh.cardMid, L, null, p['c2.pw.b']);
  relu(c);
  const cardOut = globalPool(c, sh.cardMid, L);

  // Entity tower.
  const E = net.entities;
  x = obs.subarray(cardPlane, cardPlane + entPlane);
  let e = pointwise(p['e0.w'], x, net.entityChannels, sh.entityWidth, E, null, p['e0.b']);
  relu(e);
  e = conv(p['e1.w'], p['e1.b'], e, sh.entityWidth, sh.entityWidth, 3, 1, E);
  relu(e);
  const entOut = dense(p['e2.w'], p['e2.b'], e, sh.entityWidth * E, sh.entityHead);
  relu(entOut);

  // Scalar tower.
  x = obs.subarray(cardPlane + entPlane, cardPlane + entPlane + net.scalarCount);
  const scaOut = dense(p['s0.w'], p['s0.b'], x, net.scalarCount, sh.scalarWidth);
  relu(scaOut);

  // Trunk.
  const fused = new Float32Array(cardOut.length + entOut.length + scaOut.length);
  fused.set(cardOut, 0);
  fused.set(entOut, cardOut.length);
  fused.set(scaOut, cardOut.length + entOut.length);
  let t = dense(p['t0.w'], p['t0.b'], fused, fused.length, sh.trunkWidth);
  relu(t);
  t = dense(p['t1.w'], p['t1.b'], t, sh.trunkWidth, sh.headWidth);
  relu(t);
  const v = dense(p['h.value.w'], p['h.value.b'], t, sh.headWidth, 1);
  return Math.tanh(v[0]);
}
