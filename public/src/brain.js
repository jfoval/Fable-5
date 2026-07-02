// Tiny feed-forward neural network: 11 → 8(tanh) → 4(sigmoid).
// Weights live in the genome and evolve. Given a creature's perception it
// outputs four behavioural gains: [seekFood, pursuePrey, flee, wander].

import { BRAIN } from './genome.js';

const { nIn, nHid, nOut } = BRAIN;
const W1 = nHid * nIn;
const B1 = nHid;
const W2 = nOut * nHid;

const hid = new Float32Array(nHid);
const out = new Float32Array(nOut);

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

// `inputs` is a Float array of length nIn. Returns a shared length-4 array
// (do not retain it across calls). Kept allocation-free for the hot loop.
export function think(brain, inputs) {
  for (let h = 0; h < nHid; h++) {
    let s = brain[W1 + h]; // bias1
    const row = h * nIn;
    for (let i = 0; i < nIn; i++) s += brain[row + i] * inputs[i];
    hid[h] = Math.tanh(s);
  }
  const w2 = W1 + B1;
  const b2 = w2 + W2;
  for (let o = 0; o < nOut; o++) {
    let s = brain[b2 + o]; // bias2
    const row = w2 + o * nHid;
    for (let h = 0; h < nHid; h++) s += brain[row + h] * hid[h];
    out[o] = sigmoid(s);
  }
  return out;
}
