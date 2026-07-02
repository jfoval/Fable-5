// SUSPECT — orchestration. Wires the cinematic layers to a small state machine:
// title → brief → interrogation → reveal. Talks to the server proxy for case
// generation, suspect replies, and contradiction adjudication.

import { startRain } from './rain.js';
import { startStage } from './silhouette.js';
import { createAudio } from './audio.js';
import { typewrite } from './typewriter.js';
import { api } from './api.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ---- cinematic layers ------------------------------------------------------
startRain($('#rain'));
const stage = startStage($('#stage'));
const audio = createAudio();

// ---- state -----------------------------------------------------------------
const S = {
  difficulty: 'cold',
  truth: null,
  offline: false,
  composure: 100,
  conversation: [],   // {role:'detective'|'suspect'|'system', text, tell?, payload?}
  statements: [],     // {id, kind:'statement', text}
  pins: [],           // array of item ids (max 2)
  busy: false,
  accuseUsed: false,
  cracked: false,
  over: false,
};
let stmtSeq = 0;

// ---- screen switching ------------------------------------------------------
function show(id) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  $('#' + id).classList.add('active');
  stage.setActive(id === 'room');
}

// ---- first gesture unlocks audio ------------------------------------------
function unlockAudio() { audio.start(); window.removeEventListener('pointerdown', unlockAudio); window.removeEventListener('keydown', unlockAudio); }
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// ============================ TITLE ========================================
$$('.diff').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.diff').forEach((b) => { b.classList.remove('selected'); b.setAttribute('aria-checked', 'false'); });
    btn.classList.add('selected'); btn.setAttribute('aria-checked', 'true');
    S.difficulty = btn.dataset.diff;
  });
});

$('#new-case').addEventListener('click', () => generateCase());
$('#again').addEventListener('click', () => show('title'));

async function generateCase() {
  const status = $('#title-status');
  const btn = $('#new-case');
  btn.disabled = true;
  status.textContent = 'Pulling the file…';
  const beats = ['Pulling the file…', 'Reading the statements…', 'She\'s waiting in the room…'];
  let bi = 0;
  const tick = setInterval(() => { status.textContent = beats[bi = (bi + 1) % beats.length]; }, 1400);
  try {
    const res = await api.newCase(S.difficulty);
    clearInterval(tick);
    S.truth = res.truth;
    S.offline = !!res.offline;
    resetGame();
    fillBrief();
    show('brief');
    status.textContent = '';
  } catch (err) {
    clearInterval(tick);
    status.textContent = 'The line went dead. Try again.';
    console.error(err);
  } finally {
    btn.disabled = false;
  }
}

function resetGame() {
  S.composure = 100;
  S.conversation = [];
  S.statements = [];
  S.pins = [];
  S.accuseUsed = false;
  S.cracked = false;
  S.over = false;
  stmtSeq = 0;
  $('#transcript').innerHTML = '';
  stage.setComposure(100);
  audio.setComposure(100);
  updateComposureUI();
}

// ============================ BRIEF ========================================
function fillBrief() {
  const t = S.truth;
  $('#brief-title').textContent = t.title || 'Untitled Case';
  $('#brief-logline').textContent = t.logline || '';
  $('#brief-suspect').textContent = `${t.suspect?.name || '—'}, ${t.suspect?.occupation || ''}`.trim();
  $('#brief-relation').textContent = t.suspect?.relationship_to_victim || '—';
  $('#brief-night').textContent = t.crime?.night || '—';
  $('#brief-cloud').textContent = t.why_they_look_guilty || '';
  $('#hud-case').textContent = t.title || 'CASE';
}

$('#enter-room').addEventListener('click', () => {
  show('room');
  buildEvidence();
  renderStatements();
  // opening beat
  addSystemLine(`${S.truth.suspect?.name || 'She'} sits across from you. The lamp hums. Rain on the glass.`);
  if (S.offline) addSystemLine('— offline mode: bundled case (set ANTHROPIC_API_KEY for freshly generated suspects) —');
  $('#ask-input').focus();
});

// ============================ INTERROGATION ================================
$('#ask-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#ask-input');
  const q = input.value.trim();
  if (!q || S.busy || S.over || S.cracked) return;
  input.value = '';
  await ask(q);
});

async function ask(question) {
  S.busy = true;
  setAsking(true);
  S.conversation.push({ role: 'detective', text: question });
  addLine('detective', 'YOU', question);
  const thinking = addThinking();

  try {
    const reply = await api.reply({
      truth: S.truth, difficulty: S.difficulty, offline: S.offline,
      conversation: S.conversation, composure: S.composure,
    });
    thinking.remove();
    await renderSuspectReply(reply);
  } catch (err) {
    thinking.remove();
    addSystemLine('(The line dropped. Ask again.)');
    console.error(err);
  } finally {
    S.busy = false;
    setAsking(false);
    if (!S.over && !S.cracked) $('#ask-input').focus();
  }
}

async function renderSuspectReply(reply) {
  const name = (S.truth.suspect?.name || 'SUSPECT').toUpperCase();
  S.conversation.push({ role: 'suspect', text: reply.dialogue, tell: reply.tell, payload: reply });

  const el = addLine('suspect', name, '', reply.tell);
  const say = el.querySelector('.say');
  await typewrite(say, reply.dialogue || '…', { cps: 46 });

  applyComposure(reply.composure_delta || 0);
  harvestStatements(reply.dialogue || '');
  renderStatements();

  if (reply.cracked) return handleCrack();
  maybeCrackFromComposure();
}

function harvestStatements(dialogue) {
  const parts = dialogue
    .replace(/\s+/g, ' ')
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 14 && !s.endsWith('?') && !/^[("']/.test(s) && !/^—/.test(s));
  for (const p of parts) {
    if (S.statements.some((x) => x.text === p)) continue;
    S.statements.push({ id: `S${++stmtSeq}`, kind: 'statement', text: p });
  }
  // keep the log from unbounded growth; oldest fall off the top of the panel view naturally
}

// ---- composure -------------------------------------------------------------
function applyComposure(delta) {
  S.composure = Math.max(0, Math.min(100, S.composure + delta));
  stage.setComposure(S.composure);
  audio.setComposure(S.composure);
  updateComposureUI();
}
function updateComposureUI() {
  const c = Math.round(S.composure);
  $('#composure-num').textContent = c;
  const fill = $('#composure-fill');
  fill.style.width = c + '%';
  fill.classList.toggle('low', c < 40);
}

// ---- crack -----------------------------------------------------------------
async function maybeCrackFromComposure() {
  if (S.composure > 0 || S.cracked || S.over) return;
  // one final call to force the confession / blurted secret
  const thinking = addThinking();
  try {
    const reply = await api.reply({
      truth: S.truth, difficulty: S.difficulty, offline: S.offline,
      conversation: S.conversation, composure: 0, crack: true,
    });
    thinking.remove();
    const name = (S.truth.suspect?.name || 'SUSPECT').toUpperCase();
    S.conversation.push({ role: 'suspect', text: reply.dialogue, tell: reply.tell, payload: reply });
    const el = addLine('suspect', name, '', reply.tell);
    await typewrite(el.querySelector('.say'), reply.dialogue || '…', { cps: 40 });
    handleCrack();
  } catch (err) {
    thinking.remove();
    handleCrack();
  }
}

function handleCrack() {
  if (S.cracked) return;
  S.cracked = true;
  audio.sting();
  stage.flinch();
  addSystemLine('She\'s cracked. The truth is on the table. Make the call.');
  setAsking(true);
  $('#ask-input').placeholder = 'She has nothing left — make your accusation.';
  $('#accuse').classList.add('pulse');
}

// ============================ STATEMENT / EVIDENCE CARDS ===================
function renderStatements() {
  const box = $('#statements');
  box.innerHTML = '';
  // newest first, cap displayed to keep it readable
  [...S.statements].reverse().slice(0, 40).forEach((s) => {
    box.appendChild(makeCard(s, s.text, 'CLAIM', false));
  });
}
function buildEvidence() {
  const box = $('#evidence');
  box.innerHTML = '';
  (S.truth.evidence || []).forEach((e) => {
    const item = { id: e.id, kind: 'evidence', label: e.label, detail: e.detail, type: e.type };
    box.appendChild(makeCard(item, `${e.label} — ${e.detail}`, e.type?.replace('_', ' ') || 'evidence', true));
  });
}
function makeCard(item, text, tag, isEvidence) {
  const card = document.createElement('div');
  card.className = 'card' + (isEvidence ? ' evi' : '');
  card.dataset.id = item.id;
  card.innerHTML = `<span class="tag">${tag}</span>${text}`;
  if (S.pins.includes(item.id)) card.classList.add('pinned');
  card.addEventListener('click', () => togglePin(item, card));
  return card;
}
function togglePin(item, card) {
  const i = S.pins.indexOf(item.id);
  if (i >= 0) { S.pins.splice(i, 1); card.classList.remove('pinned'); }
  else {
    if (S.pins.length >= 2) {
      // drop the oldest pin
      const dropped = S.pins.shift();
      $$(`.card[data-id="${cssEsc(dropped)}"]`).forEach((c) => c.classList.remove('pinned'));
    }
    S.pins.push(item.id); card.classList.add('pinned');
  }
  // remember the actual item objects for confront
  pinItems[item.id] = item;
  updateConfrontBtn();
}
const pinItems = {};
function cssEsc(s) { return String(s).replace(/"/g, '\\"'); }
function updateConfrontBtn() {
  const btn = $('#confront');
  btn.disabled = S.pins.length !== 2 || S.busy || S.over;
  btn.textContent = `CONFRONT ✕ ${S.pins.length}`;
}

$('#confront').addEventListener('click', doConfront);

async function doConfront() {
  if (S.pins.length !== 2 || S.busy || S.over) return;
  const [a, b] = S.pins.map((id) => pinItems[id]);
  S.busy = true; setAsking(true); updateConfrontBtn();
  addSystemLine('You lay two things side by side and press.');
  const thinking = addThinking();
  try {
    const res = await api.confront({ truth: S.truth, itemA: a, itemB: b, offline: S.offline });
    thinking.remove();
    const hit = res.is_contradiction;
    if (hit) audio.sting();
    if (hit) stage.flinch();
    addSystemLine(res.verdict || (hit ? 'It lands.' : 'It misses.'));
    if (res.reaction) {
      const name = (S.truth.suspect?.name || 'SUSPECT').toUpperCase();
      S.conversation.push({ role: 'suspect', text: res.reaction, tell: hit ? 'scrambling' : 'unmoved', payload: { dialogue: res.reaction } });
      const el = addLine('suspect', name, '', hit ? 'her story starts to come apart' : 'she barely blinks');
      await typewrite(el.querySelector('.say'), res.reaction, { cps: 46 });
    }
    applyComposure(res.composure_delta || (hit ? -20 : 6));
    // clear pins
    S.pins.forEach((id) => $$(`.card[data-id="${cssEsc(id)}"]`).forEach((c) => c.classList.remove('pinned')));
    S.pins = [];
    if (!S.over) maybeCrackFromComposure();
  } catch (err) {
    thinking.remove();
    addSystemLine('(The adjudicator went quiet. Try again.)');
    console.error(err);
  } finally {
    S.busy = false; setAsking(false); updateConfrontBtn();
  }
}

// ============================ ACCUSE =======================================
$('#accuse').addEventListener('click', () => {
  if (S.accuseUsed || S.over) return;
  $('#accuse-modal').classList.add('open');
});
$('#accuse-cancel').addEventListener('click', () => $('#accuse-modal').classList.remove('open'));
$('#accuse-guilty').addEventListener('click', () => resolveAccusation(true));
$('#accuse-innocent').addEventListener('click', () => resolveAccusation(false));

function resolveAccusation(accusedGuilty) {
  $('#accuse-modal').classList.remove('open');
  S.accuseUsed = true;
  S.over = true;
  const correct = accusedGuilty === !!S.truth.guilty;
  toReveal(correct, accusedGuilty);
}

// ============================ REVEAL =======================================
function toReveal(win, accusedGuilty) {
  const t = S.truth;
  const banner = $('#verdict-banner');
  const sub = $('#verdict-sub');
  banner.classList.remove('win', 'lose');
  if (win) {
    banner.textContent = 'CASE CLOSED';
    banner.classList.add('win');
    sub.textContent = t.guilty
      ? `You broke ${t.suspect?.name}. ${t.suspect?.name} did it — and now it's on the record.`
      : `You let ${t.suspect?.name} walk. They were innocent of this — you called it right.`;
  } else {
    banner.textContent = accusedGuilty ? 'THEY LAWYER UP' : 'THEY WALK FREE';
    banner.classList.add('lose');
    sub.textContent = t.guilty
      ? `${t.suspect?.name} was guilty — and you let them go. The file goes cold.`
      : `${t.suspect?.name} was innocent. You charged the wrong person, and the real one is still out there.`;
  }

  renderRevealTranscript();
  renderRevealTruth();
  show('reveal');
}

function renderRevealTranscript() {
  const box = $('#reveal-transcript');
  box.innerHTML = '';
  for (const turn of S.conversation) {
    if (turn.role === 'detective') {
      const d = document.createElement('div');
      d.className = 'rt-det'; d.innerHTML = `<b>YOU:</b> ${escapeHtml(turn.text)}`;
      box.appendChild(d);
    } else if (turn.role === 'suspect') {
      const s = document.createElement('div');
      s.className = 'rt-sus'; s.textContent = turn.text;
      box.appendChild(s);
      if (turn.tell) {
        const tl = document.createElement('div');
        tl.className = 'rt-tell'; tl.textContent = `— ${turn.tell}`;
        box.appendChild(tl);
      }
    } else {
      const sy = document.createElement('div');
      sy.className = 'rt-det'; sy.style.opacity = 0.6; sy.style.fontStyle = 'italic';
      sy.textContent = turn.text;
      box.appendChild(sy);
    }
  }
}

function renderRevealTruth() {
  const t = S.truth;
  const box = $('#reveal-truth');
  box.innerHTML = '';

  const guiltLine = document.createElement('div');
  guiltLine.className = 'secret';
  guiltLine.innerHTML = `<b>${t.guilty ? 'GUILTY.' : 'INNOCENT of the crime.'}</b> ${escapeHtml(t.secret || '')}`;
  box.appendChild(guiltLine);

  box.appendChild(sectionH('THE REAL TIMELINE'));
  (t.timeline || []).forEach((row) => {
    const tl = document.createElement('div');
    tl.className = 'tl ' + (row.is_lie ? 'lie' : 'truth');
    tl.innerHTML =
      `<span class="time">${escapeHtml(row.time || '')}</span>` +
      `<span class="rtruth">${escapeHtml(row.truth || '')}</span>` +
      (row.public_story
        ? `<span class="story">she told you: “${escapeHtml(row.public_story)}”${row.is_lie ? ' <b class="lie">[LIE]</b>' : ''}</span>`
        : '');
    box.appendChild(tl);
  });

  box.appendChild(sectionH('EVIDENCE'));
  (t.evidence || []).forEach((e) => {
    const d = document.createElement('div');
    d.className = 'evi-line';
    d.innerHTML = `<b>[${escapeHtml(e.id)}] ${escapeHtml(e.label)}</b> — ${escapeHtml(e.detail)} <i>(${e.cuts === 'for' ? 'backed her story' : 'cut against her'})</i>`;
    box.appendChild(d);
  });

  if ((t.inconsistencies || []).length) {
    box.appendChild(sectionH('THE CRACKS YOU COULD HAVE FOUND'));
    t.inconsistencies.forEach((inc) => {
      const d = document.createElement('div');
      d.className = 'evi-line';
      d.innerHTML = `<b>${escapeHtml(inc.claim_a)}</b> vs <b>${escapeHtml(inc.claim_b)}</b> — ${escapeHtml(inc.why_incompatible)}`;
      box.appendChild(d);
    });
  }
}
function sectionH(text) { const h = document.createElement('div'); h.className = 'reveal-section-h'; h.textContent = text; return h; }

// ============================ DOM helpers ==================================
function addLine(role, who, text, tell) {
  const box = $('#transcript');
  const line = document.createElement('div');
  line.className = `line ${role}`;
  line.innerHTML =
    `<span class="who">${escapeHtml(who)}</span>` +
    `<span class="say">${escapeHtml(text)}</span>` +
    (tell ? `<span class="tell">${escapeHtml(tell)}</span>` : '');
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  return line;
}
function addSystemLine(text) {
  const box = $('#transcript');
  const line = document.createElement('div');
  line.className = 'line system';
  line.innerHTML = `<span class="say">${escapeHtml(text)}</span>`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  S.conversation.push({ role: 'system', text });
  return line;
}
function addThinking() {
  const box = $('#transcript');
  const line = document.createElement('div');
  line.className = 'line suspect';
  line.innerHTML = `<span class="who">${escapeHtml((S.truth?.suspect?.name || 'SUSPECT').toUpperCase())}</span><span class="say caret"></span>`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  return line;
}
function setAsking(busy) {
  $('#ask-send').disabled = busy || S.cracked;
  $('#ask-input').disabled = busy || S.cracked;
  updateConfrontBtn();
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- mute ------------------------------------------------------------------
$('#mute').addEventListener('click', () => {
  const muted = audio.toggleMute();
  $('#mute').classList.toggle('muted', muted);
  $('#mute').textContent = muted ? '✕' : '♪';
});

// ---- boot ------------------------------------------------------------------
show('title');
api.health().then((h) => {
  if (!h.live) $('#title-status').textContent = 'offline mode — bundled case ready (set ANTHROPIC_API_KEY for generated cases)';
});
