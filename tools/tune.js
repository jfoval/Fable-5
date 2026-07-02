// Headless tuning harness: run the pure simulation for N sim-minutes with no
// browser, print population trajectory, trait drift, and detected events.
// Used to tune config.js until evolution visibly happens.

import { World } from '../public/src/world.js';
import { Emergence } from '../public/src/emergence.js';

const MINUTES = Number(process.argv[2] || 5);
const world = new World();
const emg = new Emergence(2.5);

const DT = 1 / 30;
const steps = Math.round((MINUTES * 60) / DT);

const start = snapshotTraits(world);
const popSeries = [];
const eventLog = [];
let peak = 0, trough = Infinity;
let extinctAt = null;

for (let i = 0; i < steps; i++) {
  world.update();
  const fresh = emg.update(world, DT);
  for (const e of fresh) eventLog.push(`  [${String(Math.round(e.t)).padStart(3)}s] ${e.type}: ${e.text}`);
  if (i % 30 === 0) {
    const pop = world.creatures.length;
    popSeries.push({ t: Math.round(world.time), pop, food: world.liveFood });
    peak = Math.max(peak, pop);
    trough = Math.min(trough, pop);
    if (pop === 0 && extinctAt === null) extinctAt = world.time;
  }
  if (world.creatures.length === 0) { if (extinctAt === null) extinctAt = world.time; break; }
}

const end = snapshotTraits(world);

console.log(`\n=== Primordial headless run: ${MINUTES} sim-minutes ===`);
console.log(`Final population: ${world.creatures.length}   peak: ${peak}   trough: ${trough}`);
console.log(`Cumulative:`, world.births_deaths);
if (extinctAt !== null) console.log(`!! Total extinction at ${Math.round(extinctAt)}s`);

console.log('\nPopulation trajectory (every 10s):');
let line = '';
for (const p of popSeries) {
  line += `${p.t}:${p.pop} `;
  if (line.length > 90) { console.log('  ' + line); line = ''; }
}
if (line) console.log('  ' + line);

console.log('\nCluster counts over time (grazer/omni/hunter):');
let cl = '';
for (const s of emg.samples.filter((_, i) => i % 4 === 0)) {
  cl += `${Math.round(s.t)}s[${s.counts.grazer}/${s.counts.omnivore}/${s.counts.hunter}] `;
  if (cl.length > 100) { console.log('  ' + cl); cl = ''; }
}
if (cl) console.log('  ' + cl);

console.log('\nTrait drift (start → end):');
for (const k of Object.keys(start)) {
  const d = end[k] - start[k];
  const arrow = Math.abs(d) < 0.02 ? '·' : d > 0 ? '↑' : '↓';
  console.log(`  ${k.padEnd(11)} ${start[k].toFixed(3)} → ${end[k].toFixed(3)}  ${arrow} ${d >= 0 ? '+' : ''}${d.toFixed(3)}`);
}

console.log(`\nEvents detected: ${eventLog.length}`);
console.log(eventLog.join('\n'));

// crude verdict
const drifted = Object.keys(start).some((k) => Math.abs(end[k] - start[k]) > 0.05);
const boomBust = eventLog.some((l) => l.includes('boom')) && eventLog.some((l) => l.includes('crash'));
const survived = world.creatures.length > 0;
console.log('\n=== VERDICT ===');
console.log(`  survived:        ${survived ? 'YES' : 'NO'}`);
console.log(`  trait drift:     ${drifted ? 'YES' : 'no'}`);
console.log(`  boom & bust:     ${boomBust ? 'YES' : 'no'}`);
console.log(`  predators arose: ${end.diet > start.diet + 0.03 || eventLog.some(l => l.includes('predator')) ? 'YES' : 'unclear'}`);

function snapshotTraits(w) {
  const keys = ['speed', 'size', 'vision', 'metabolism', 'aggression', 'diet'];
  const sums = {}; keys.forEach((k) => (sums[k] = 0));
  for (const c of w.creatures) keys.forEach((k) => (sums[k] += c.g[k]));
  const n = w.creatures.length || 1;
  const o = {}; keys.forEach((k) => (o[k] = sums[k] / n));
  return o;
}
