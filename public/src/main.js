// Primordial — entry point. Wires the world, emergence tracker, renderer,
// charts, and narrator together and drives the animation loop. The simulation
// advances in fixed steps; the speed control runs 1–10 sim steps per frame.

import { World } from './world.js';
import { Emergence } from './emergence.js';
import { Renderer } from './render.js';
import { Charts } from './charts.js';
import { Narrator } from './narrator.js';
import { renderInspector, showToast, showBanner } from './ui.js';
import { CONFIG } from './config.js';

const world = new World();
const emergence = new Emergence(2.5);
const renderer = new Renderer(document.getElementById('world'), world);
const charts = new Charts(
  document.getElementById('chart-pop'),
  document.getElementById('chart-traits'),
  document.getElementById('trait-legend')
);
const narrator = new Narrator({
  panelEl: document.getElementById('field-notes'),
  badgeEl: document.getElementById('narrator-badge'),
  world,
  emergence,
  getSimTime: () => world.time,
});

const state = { paused: false, speed: 2, selectedId: 0, maxGen: 0 };

// ---------------- controls ----------------
const $ = (id) => document.getElementById(id);

$('btn-play').addEventListener('click', togglePlay);
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') { e.preventDefault(); togglePlay(); }
});
function togglePlay() {
  state.paused = !state.paused;
  document.body.classList.toggle('paused', state.paused);
}

$('speed').addEventListener('input', (e) => {
  state.speed = +e.target.value;
  $('speed-val').textContent = state.speed + '×';
});
$('speed-val').textContent = state.speed + '×';

$('btn-meteor').addEventListener('click', () => {
  world.meteor();
  showBanner('☄  Meteor impact');
  showToast('A meteor scorches the world — most life is gone in an instant.', 3, timeLabel());
});
$('btn-famine').addEventListener('click', () => {
  world.famine();
  showBanner('✷  Famine');
  showToast('Famine — half the food withers away.', 2, timeLabel());
});
$('btn-abundance').addEventListener('click', () => {
  world.abundance();
  showBanner('✿  Abundance');
  showToast('Abundance — food blooms across the world.', 1, timeLabel());
});
$('btn-reset').addEventListener('click', () => {
  world.reset();
  emergence.reset();
  state.selectedId = 0;
  renderInspector($('inspector'), null, world);
  showBanner('↻  New world seeded');
});

// ---------------- click to inspect ----------------
renderer.canvas.addEventListener('click', (e) => {
  const rect = renderer.canvas.getBoundingClientRect();
  const c = renderer.pick(e.clientX - rect.left, e.clientY - rect.top);
  state.selectedId = c ? c.id : 0;
  renderInspector($('inspector'), c, world);
});

// ---------------- event → toast ----------------
function onEvents(events) {
  for (const ev of events) showToast(ev.text, ev.severity || 1, timeLabel(ev.t));
}

function timeLabel(sec = world.time) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------------- main loop ----------------
let lastChart = 0;
let fpsT = performance.now(), fpsN = 0, fps = 0;

function frame(now) {
  // simulation
  if (!state.paused) {
    for (let i = 0; i < state.speed; i++) {
      world.update();
      const fresh = emergence.update(world, CONFIG.dt);
      if (fresh.length) onEvents(fresh);
    }
  }

  // render
  renderer.draw(state.selectedId);

  // selected creature may have died
  if (state.selectedId) {
    const alive = world.creatures.find((c) => c.id === state.selectedId);
    if (!alive) { state.selectedId = 0; renderInspector($('inspector'), null, world); }
    else if (world.tick % 12 === 0) renderInspector($('inspector'), alive, world);
  }

  // charts (a few times per second)
  if (now - lastChart > 350) {
    lastChart = now;
    charts.render(emergence.samples);
  }

  // narrator (wall-clock cadence)
  narrator.tick(now / 1000);

  // header stats
  for (const c of world.creatures) if (c.generation > state.maxGen) state.maxGen = c.generation;
  $('stat-time').textContent = timeLabel();
  $('stat-pop').textContent = world.creatures.length;
  $('stat-gen').textContent = state.maxGen;

  // fps
  fpsN++;
  if (now - fpsT > 500) { fps = Math.round((fpsN * 1000) / (now - fpsT)); fpsN = 0; fpsT = now; $('stat-fps').textContent = fps; }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// expose for debugging / headless inspection
window.__primordial = { world, emergence, state, renderer };
