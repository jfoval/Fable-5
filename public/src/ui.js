// UI helpers: the specimen inspector, floating event toasts, and the god-mode
// banner. Pure DOM rendering; simulation state is passed in.

import { dietColor } from './render.js';
import { band } from './emergence.js';

const TR = {
  speed: [0.55, 3.2], size: [0.5, 2.6], vision: [45, 210],
  metabolism: [0.55, 2.0], aggression: [0, 1], diet: [0, 1],
};
const TRAIT_ORDER = ['size', 'speed', 'vision', 'metabolism', 'aggression', 'diet'];
const TRAIT_LABEL = {
  size: 'Size', speed: 'Speed', vision: 'Vision',
  metabolism: 'Metabolism', aggression: 'Aggression', diet: 'Diet',
};
const BAND_NAME = { grazer: 'Grazer', omnivore: 'Omnivore', hunter: 'Hunter' };

export function renderInspector(el, c, world) {
  if (!c || c.dead) {
    el.classList.add('empty');
    el.innerHTML = '<p class="hint">Click any creature to read its genome and lineage.</p>';
    return;
  }
  el.classList.remove('empty');
  const [r, g, b] = dietColor(c.g.diet);
  const swatch = `rgb(${r},${g},${b})`;
  const kind = BAND_NAME[band(c.g.diet)];

  const genes = TRAIT_ORDER.map((k) => {
    const [lo, hi] = TR[k];
    const norm = Math.max(0, Math.min(1, (c.g[k] - lo) / (hi - lo)));
    const val = k === 'vision' ? Math.round(c.g[k]) : c.g[k].toFixed(2);
    return `<div class="gene">
      <div class="gene-row"><span class="gname">${TRAIT_LABEL[k]}</span><span class="gval">${val}</span></div>
      <div class="gene-bar"><i style="width:${(norm * 100).toFixed(0)}%"></i></div>
    </div>`;
  }).join('');

  const parentAlive = world.creatures.some((o) => o.id === c.parentId);
  const lineage = c.generation === 0
    ? 'A founder — one of the first cells seeded into the world.'
    : `Generation <b>${c.generation}</b>, descended from specimen <b>#${c.parentId}</b>` +
      (parentAlive ? ' <span style="color:var(--grazer)">(parent still alive)</span>' : ' (parent has since died).');

  el.innerHTML = `
    <div class="spec-head">
      <div class="spec-swatch" style="background:${swatch};color:${swatch}"></div>
      <div class="spec-id">#${c.id}<small>specimen</small></div>
      <div class="spec-tag" style="border-color:${swatch};color:${swatch}">${kind}</div>
    </div>
    <div class="spec-vitals">
      <div class="vital"><div class="vk">Energy</div><div class="vv">${c.energy.toFixed(0)}</div></div>
      <div class="vital"><div class="vk">Age</div><div class="vv">${c.age.toFixed(0)}s</div></div>
      <div class="vital"><div class="vk">Gen</div><div class="vv">${c.generation}</div></div>
    </div>
    ${genes}
    <div class="lineage">${lineage}</div>
  `;
}

const toastLayer = () => document.getElementById('toasts');

export function showToast(text, severity = 1, simTimeLabel = '') {
  const layer = toastLayer();
  const t = document.createElement('div');
  t.className = 'toast sev-' + severity;
  t.innerHTML = `<span class="tt">${simTimeLabel}</span><span>${text}</span>`;
  layer.appendChild(t);
  while (layer.children.length > 4) layer.firstChild.remove();
  setTimeout(() => {
    t.classList.add('fade');
    setTimeout(() => t.remove(), 700);
  }, 7000);
}

let bannerTimer = null;
export function showBanner(text) {
  const el = document.getElementById('banner');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.add('hidden'), 1800);
}
