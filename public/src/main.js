// main.js — the show runner. Setup screen, playback clock, the match loop, the
// controls, the dramatic beats, and the modals (audit / replay / end).

import { PERSONAS, personaById, randomPair } from './personas.js';
import { Match } from './engine.js';
import { MatchRunner } from './orchestrator.js';
import { AuditLog } from './audit.js';
import { BroadcastUI } from './ui.js';
import { serverCall, commentate, health } from './net.js';
import { renderAudit } from './audit-view.js';
import { renderReplay } from './replay-view.js';
import { renderEnd } from './end-view.js';

// -------------------- playback clock --------------------
class Clock {
  constructor() { this.speed = 1; this.paused = true; this._waiters = []; }
  setPaused(p) {
    this.paused = p;
    if (!p) { const w = this._waiters; this._waiters = []; w.forEach((r) => r()); }
  }
  gate() { return this.paused ? new Promise((res) => this._waiters.push(res)) : Promise.resolve(); }
  async delay(ms) { await this.gate(); return new Promise((res) => setTimeout(res, ms / this.speed)); }
}

// -------------------- heartbeat (WebAudio, no asset needed) --------------------
class Heartbeat {
  constructor() { this.ctx = null; this.timer = null; this.muted = false; }
  _thump(t, freq, gainv) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gainv, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + 0.24);
  }
  start() {
    if (this.muted) return;
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.timer) return;
    const beat = () => { const t = this.ctx.currentTime; this._thump(t, 62, 0.5); this._thump(t + 0.28, 55, 0.32); };
    beat(); this.timer = setInterval(beat, 1050);
  }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
  setMuted(m) { this.muted = m; if (m) this.stop(); }
}

// -------------------- state --------------------
const clock = new Clock();
const ui = new BroadcastUI(clock);
const heart = new Heartbeat();
const $ = (s) => document.querySelector(s);

const state = {
  selected: [null, null],
  runner: null, match: null, audit: null, personas: null,
  live: false, auto: true, commentator: false,
  awaitingDeal: false, dealResolve: null,
  lastSummary: null, running: false, allInEngaged: false,
};

// ==================== SETUP SCREEN ====================
function buildSetup() {
  for (const seat of [0, 1]) {
    const grid = $(`#grid${seat}`);
    grid.innerHTML = '';
    PERSONAS.forEach((p) => {
      const el = document.createElement('button');
      el.className = 'persona';
      el.style.setProperty('--accent', p.color);
      el.dataset.id = p.id;
      el.innerHTML = `<span class="pchip"></span><div><span class="pname">${p.name}</span>` +
        `<span class="ptag">${p.tag}</span></div><div class="pblurb">${p.blurb}</div>`;
      el.onclick = () => selectPersona(seat, p.id);
      grid.appendChild(el);
    });
  }
  // default pairing: Doyle vs Zoe
  selectPersona(0, 'doyle'); selectPersona(1, 'zoe');
  $('#randomize').onclick = () => {
    const [a, b] = randomPair();
    selectPersona(0, a.id); selectPersona(1, b.id);
  };
  $('#start').onclick = startMatch;
}

function selectPersona(seat, id) {
  state.selected[seat] = id;
  document.querySelectorAll(`#grid${seat} .persona`).forEach((el) =>
    el.classList.toggle('sel', el.dataset.id === id));
  const note = $('#setupNote');
  if (state.selected[0] && state.selected[1]) {
    const same = state.selected[0] === state.selected[1];
    note.textContent = same ? 'Mirror match — same persona on both seats. Allowed, but their voices will echo.' : '';
  }
}

// ==================== START ====================
async function startMatch() {
  const h = await health();
  state.live = !!h.live;

  const personas = [personaById(state.selected[0]), personaById(state.selected[1])];
  state.personas = personas;
  // Optional ?stack=N shortens the match (handy for demos / capturing the end screen).
  const q = new URLSearchParams(location.search);
  const startingStack = Math.max(500, Number(q.get('stack')) || 10000);
  state.match = new Match({ names: personas.map((p) => p.name), startingStack });
  state.audit = new AuditLog();
  state.runner = new MatchRunner({
    match: state.match, personas, audit: state.audit,
    call: (system, messages) => serverCall(system, messages, { kind: 'agent' }),
    hooks: makeHooks(),
  });
  if (!state.live) state.runner.enableScriptedOpening();

  ui.setPersonas(personas);
  $('#setup').classList.add('hidden');
  $('#stage').classList.remove('hidden');

  ui.setCommentary(state.live
    ? 'Live from the booth — two Fable 5 minds, cards on the table, thoughts on the glass.'
    : 'No API key set — running the offline demo brain (and a scripted classic opening hand).');

  setSpeed(1);
  setAuto(true);
  clock.setPaused(false);
  $('#btnPlay').textContent = '❚❚';
  runLoop();
}

// ==================== HOOKS: game events -> broadcast ====================
function makeHooks() {
  return {
    onHandStart: async (info) => {
      state.allInEngaged = false;
      heart.stop();
      ui.setAllIn(false);
      ui.setDealHint(false);
      ui.newHand(info);
      await clock.delay(650);
    },
    onDecisionStart: async ({ seat }) => {
      ui.setActive(seat);
      await clock.delay(520);
    },
    onDecision: async (rec) => {
      // All-in dramatics.
      if (rec.decision.action === 'all-in' && !state.allInEngaged) {
        state.allInEngaged = true;
        ui.setAllIn(true, false);
        heart.start();
        await clock.delay(500);
      }
      await ui.streamThought(rec.seat, rec.decision);
      ui.showTalk(rec.seat, rec.decision.table_talk);
      ui.applyAction(rec.seat, { stacks: rec.stacks, pot: rec.pot, committedStreet: rec.committed[rec.seat] });
      // If the betting is now closed with an all-in live, lock the panels.
      if (state.allInEngaged && rec.toActNext == null) ui.setAllIn(true, true);
      await clock.delay(650);
      ui.clearActive();
    },
    onStreet: async ({ street, board }) => {
      const dramatic = street === 'river' || state.allInEngaged;
      await ui.revealStreet(street, board, { dramatic });
    },
    onShowdown: async ({ hands, winners }) => {
      if (state.allInEngaged) ui.setAllIn(true, true);
      await clock.delay(500);
      ui.markShowdown(hands, winners);
      await clock.delay(1100);
    },
    onHandEnd: async (outcome) => {
      heart.stop();
      ui.setAllIn(false);
      ui.clearActive();
      // Let the all-in dim fully clear before the verdict lands, so they don't overlap.
      if (state.allInEngaged) await clock.delay(450);
      ui.renderStats(state.runner.stats);
      outcome.result.winners.forEach((s) => ui.markWinnerStack(s));
      ui.showVerdict(outcome.verdict);
      state.lastSummary = outcome;
      await maybeCommentate(outcome);
      await clock.delay(1600);
    },
  };
}

// ==================== MATCH LOOP ====================
async function runLoop() {
  if (state.running) return;
  state.running = true;
  try {
    while (!state.match.over) {
      await clock.gate();
      if (!state.auto) {
        ui.setDealHint(true);
        await waitForDeal();
        ui.setDealHint(false);
      }
      await state.runner.playHand();
      if (state.match.over) { showEnd(); break; }
    }
  } finally {
    state.running = false;
  }
}

function waitForDeal() {
  state.awaitingDeal = true;
  return new Promise((res) => { state.dealResolve = () => { state.awaitingDeal = false; state.dealResolve = null; res(); }; });
}
function dealNext() { if (state.dealResolve) state.dealResolve(); }

// ==================== COMMENTATOR ====================
async function maybeCommentate(outcome) {
  const potTotal = outcome.result.pots.reduce((a, p) => a + p.amount, 0);
  const bb = outcome.blinds.bb;
  if (!state.commentator || potTotal < bb * 12) return;
  const summary = {
    verdict: outcome.verdict.title,
    winner: state.personas[outcome.result.winners[0]]?.name,
    pot: potTotal, board: outcome.board, blinds: outcome.blinds,
    bluff: outcome.verdict.kind === 'bluff-won',
  };
  let line = localCommentary(outcome);
  if (state.live) {
    const r = await commentate(summary);
    if (r && r.text) line = r.text;
  }
  ui.setCommentary(line);
}

function localCommentary(outcome) {
  const w = state.personas[outcome.result.winners[0]]?.name || 'The winner';
  const l = state.personas[1 - (outcome.result.winners[0] ?? 0)]?.name || 'the other';
  switch (outcome.verdict.kind) {
    case 'bluff-won': return `Larceny at the felt — ${w} fires with air and ${l} can't pull the trigger. Ice cold.`;
    case 'bluff-caught': return `${w} smelled it a mile away and made the call. The read was surgical.`;
    case 'chop': return `Split it down the middle — the board played, and nobody blinks.`;
    default: return `${w} scoops it. ${l} will want that one back.`;
  }
}

// ==================== CONTROLS ====================
function setSpeed(s) {
  clock.speed = s;
  document.querySelectorAll('.ctrl.sp').forEach((b) => b.classList.toggle('active', Number(b.dataset.speed) === s));
}
function setAuto(on) { state.auto = on; $('#btnAuto').classList.toggle('active', on); }

function wireControls() {
  $('#btnPlay').onclick = () => {
    clock.setPaused(!clock.paused);
    $('#btnPlay').textContent = clock.paused ? '▶' : '❚❚';
  };
  document.querySelectorAll('.ctrl.sp').forEach((b) => (b.onclick = () => setSpeed(Number(b.dataset.speed))));
  $('#btnAuto').onclick = () => { setAuto(!state.auto); if (state.auto && state.awaitingDeal) dealNext(); };
  $('#btnComm').onclick = () => { state.commentator = !state.commentator; $('#btnComm').classList.toggle('active', state.commentator); };
  $('#btnMute').onclick = () => {
    heart.muted = !heart.muted; heart.setMuted(heart.muted);
    $('#btnMute').textContent = heart.muted ? '🔇' : '🔊';
  };
  $('#btnAudit').onclick = openAudit;
  $('#btnReplay').onclick = openReplay;

  // modal close (delegated)
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target === m || e.target.hasAttribute('data-close')) m.classList.add('hidden');
      if (e.target.hasAttribute('data-rematch')) location.reload();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); $('#btnPlay').click(); }
    else if (e.key === 'n' || e.key === 'N') { dealNext(); }
    else if (e.key === 'a' || e.key === 'A') { openAudit(); }
    else if (e.key === 'r' || e.key === 'R') { openReplay(); }
    else if (e.key === 'Escape') document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
  });
}

function openAudit() {
  if (!state.audit) return;
  renderAudit($('#auditBody'), state.audit, state.personas);
  $('#auditModal').classList.remove('hidden');
}
function openReplay() {
  if (!state.lastSummary) return;
  const decisions = state.runner.transcript.filter((t) => t.handNumber === state.lastSummary.handNumber);
  renderReplay($('#replayBody'), state.lastSummary, decisions, state.personas);
  $('#replayModal').classList.remove('hidden');
}
function showEnd() {
  clock.setPaused(true);
  $('#btnPlay').textContent = '▶';
  renderEnd($('#endBody'), { match: state.match, runner: state.runner, personas: state.personas });
  $('#endModal').classList.remove('hidden');
}

// ==================== BOOT ====================
buildSetup();
wireControls();
