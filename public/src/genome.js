// Genome: the heritable, mutable description of a creature — body traits plus
// the weights of its tiny neural network ("brain"). Everything here mutates on
// reproduction, so selection acts on all of it.

export const BRAIN = { nIn: 11, nHid: 8, nOut: 4 };
const W1 = BRAIN.nHid * BRAIN.nIn;
const B1 = BRAIN.nHid;
const W2 = BRAIN.nOut * BRAIN.nHid;
const B2 = BRAIN.nOut;
export const BRAIN_LEN = W1 + B1 + W2 + B2;

// Trait ranges. Mutation is clamped to these.
export const TRAITS = {
  speed:      { min: 0.55, max: 3.2 },   // world-units/sec multiplier
  size:       { min: 0.5,  max: 2.6 },   // body radius multiplier
  vision:     { min: 45,   max: 210 },   // perception radius (world units)
  metabolism: { min: 0.55, max: 2.0 },   // baseline energy burn multiplier
  aggression: { min: 0.0,  max: 1.0 },   // willingness to hunt
  diet:       { min: 0.0,  max: 1.0 },   // 0 = pure grazer, 1 = pure hunter
};

function gaussian() {
  // Box–Muller
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

function rand(lo, hi) {
  return lo + Math.random() * (hi - lo);
}

// Seed a brain with a sensible prior, then let evolution take over. The prior
// wires perception straight to instinct (food-proximity → seek food, threat →
// flee, prey → pursue) so gen-0 creatures aren't dead on arrival; mutation and
// selection reshape it from there. Behaviour is not scripted — these are just
// initial weights in an evolvable network.
function seedBrain() {
  const w = new Float32Array(BRAIN_LEN);
  for (let i = 0; i < BRAIN_LEN; i++) w[i] = gaussian() * 0.35;

  // Hidden units 0..3 act as loose feature detectors for food/prey/threat/energy.
  const set1 = (h, inp, val) => { w[h * BRAIN.nIn + inp] = val; };
  set1(0, 2, 2.4);   // food proximity  → hidden 0
  set1(1, 5, 2.4);   // prey proximity  → hidden 1
  set1(2, 8, 2.6);   // threat proximity→ hidden 2
  set1(3, 9, 2.0);   // energy level    → hidden 3

  // Output layer: gFood, gPrey, gFear, gWander.
  const w2 = W1 + B1;
  const set2 = (o, h, val) => { w[w2 + o * BRAIN.nHid + h] = val; };
  set2(0, 0, 2.2);   // food detector  → seek food
  set2(1, 1, 2.2);   // prey detector  → pursue prey
  set2(2, 2, 2.6);   // threat detector→ flee
  set2(3, 3, -1.4);  // high energy    → wander less (hunt/graze more deliberately)
  // small resting wander bias
  w[w2 + W2 + 3] = 0.4;
  return w;
}

export function randomGenome() {
  return {
    speed: rand(0.8, 1.8),
    size: rand(0.8, 1.5),
    vision: rand(70, 150),
    metabolism: rand(0.8, 1.3),
    aggression: rand(0.0, 0.35),
    diet: rand(0.0, 0.25), // world starts mostly herbivorous; predators must evolve
    brain: seedBrain(),
  };
}

const SCALAR_KEYS = ['speed', 'size', 'vision', 'metabolism', 'aggression', 'diet'];

export function mutate(g, rate = 1) {
  const child = { brain: new Float32Array(g.brain) };
  for (const k of SCALAR_KEYS) {
    const { min, max } = TRAITS[k];
    const span = max - min;
    const sigma = span * 0.06 * rate;
    child[k] = clamp(g[k] + gaussian() * sigma, min, max);
  }
  // Brain weights: mostly small drift, with rare larger jumps for innovation.
  for (let i = 0; i < child.brain.length; i++) {
    if (Math.random() < 0.12) child.brain[i] += gaussian() * 0.12 * rate;
    if (Math.random() < 0.012) child.brain[i] += gaussian() * 0.6 * rate;
    child.brain[i] = clamp(child.brain[i], -6, 6);
  }
  return child;
}

// Perceptual "distance" between two genomes — used to detect proto-speciation.
export function genomeDistance(a, b) {
  let d = 0;
  for (const k of SCALAR_KEYS) {
    const { min, max } = TRAITS[k];
    const n = (a[k] - b[k]) / (max - min);
    d += n * n;
  }
  return Math.sqrt(d);
}
