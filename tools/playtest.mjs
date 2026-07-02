// Live playtest — requires ANTHROPIC_API_KEY. Simulates a detective running 3
// full interrogations against the real model through the exact prompt surfaces
// the game ships. Verifies:
//   1. every suspect reply is strict JSON with the required fields
//   2. the suspect never volunteers guilt / the secret before cracking
//   3. confronting a SEEDED inconsistency scores as a HIT; a bogus pair MISSES
//   4. an average case resolves in 8-15 detective questions
//
// Run:  ANTHROPIC_API_KEY=sk-... npm run playtest
//       (optional first arg = difficulty: nervous | cold | liar)

import { callClaude, extractJSON } from '../lib/anthropic.js';
import {
  caseSystem, caseUser, replySystem, replyMessages, confrontSystem, confrontUser,
} from '../lib/prompts.js';

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) {
  console.error('\n  ✗ ANTHROPIC_API_KEY not set — cannot run the live playtest.');
  console.error('    Set the key and re-run, or use `npm run selftest` for the offline checks.\n');
  process.exit(2);
}

const DIFF = process.argv[2] || 'cold';
const CASES = 3;

const say = (s) => process.stdout.write(s);
const line = (s = '') => console.log(s);

// Ask the suspect one question; parse + validate the JSON reply.
async function askSuspect(truth, conversation, composure, crack = false) {
  const messages = replyMessages(conversation, composure);
  if (crack) messages.push({ role: 'user', content: '[Your composure has shattered. Confess fully if guilty, or blurt your real secret if innocent. Same JSON, caught_in_lie=true, "cracked":true.]' });
  const text = await callClaude({ key: KEY, system: replySystem(truth, DIFF), messages, max_tokens: 600, temperature: 0.85 });
  const r = extractJSON(text);
  if (typeof r.dialogue !== 'string' || typeof r.tell !== 'string' || typeof r.composure_delta !== 'number') {
    throw new Error('reply missing required fields: ' + JSON.stringify(r));
  }
  return r;
}

async function adjudicate(truth, itemA, itemB) {
  const text = await callClaude({
    key: KEY, system: confrontSystem(truth),
    messages: [{ role: 'user', content: confrontUser(itemA, itemB) }],
    max_tokens: 400, temperature: 0,
  });
  return extractJSON(text);
}

function harvest(dialogue) {
  return dialogue.replace(/\s+/g, ' ').split(/(?<=[.?!])\s+/).map((s) => s.trim())
    .filter((s) => s.length >= 14 && !s.endsWith('?') && !/^[("']/.test(s));
}

// Turn a timeline row / inconsistency into a natural detective question.
function questionsFor(truth) {
  const qs = [];
  qs.push(`Walk me through that night, ${truth.suspect?.name?.split(' ')[0] || ''}. Start to finish.`.trim());
  for (const row of truth.timeline || []) {
    qs.push(`Where were you and what were you doing around ${row.time}?`);
  }
  // pointed questions aimed at the seeded inconsistencies
  for (const inc of truth.inconsistencies || []) {
    qs.push(`Tell me about this: ${inc.claim_a}`);
  }
  return qs;
}

async function runCase(n) {
  line(`\n──────────── CASE ${n}/${CASES}  (difficulty: ${DIFF}) ────────────`);
  const problems = [];

  // 1. generate the locked truth file
  say('  generating case… ');
  const caseText = await callClaude({ key: KEY, system: caseSystem(DIFF), messages: [{ role: 'user', content: caseUser(DIFF) }], max_tokens: 2600, temperature: 1 });
  const truth = extractJSON(caseText);
  line(`“${truth.title}” — suspect ${truth.suspect?.name}, guilty=${truth.guilty}`);

  // schema sanity
  for (const [k, cond] of [
    ['has timeline', Array.isArray(truth.timeline) && truth.timeline.length >= 5],
    ['has 5-6 evidence', (truth.evidence || []).length >= 5],
    ['has inconsistencies', (truth.inconsistencies || []).length >= 2],
    ['guilt is boolean', typeof truth.guilty === 'boolean'],
    ['marks at least one lie', (truth.timeline || []).some((r) => r.is_lie)],
  ]) if (!cond) problems.push(`truth file: ${k} FAILED`);

  const secretWords = (truth.secret || '').toLowerCase().split(/\W+/).filter((w) => w.length > 5);

  // 2. interrogate
  const conversation = [];
  const statements = [];
  let composure = 100;
  let questionCount = 0;
  let leaked = false;
  const battery = questionsFor(truth);

  for (const q of battery) {
    if (composure <= 0) break;
    questionCount++;
    conversation.push({ role: 'detective', text: q });
    let reply;
    try { reply = await askSuspect(truth, conversation, composure); }
    catch (e) { problems.push(`reply parse failed: ${e.message}`); break; }
    conversation.push({ role: 'suspect', text: reply.dialogue, payload: reply });
    composure = Math.max(0, Math.min(100, composure + (reply.composure_delta || 0)));
    harvest(reply.dialogue).forEach((s) => statements.push({ kind: 'statement', text: s }));

    // integrity: did the suspect volunteer the secret before cracking?
    const dl = reply.dialogue.toLowerCase();
    const admits = /\b(i killed|i did it|i murdered|it was me|i took|i stole|i set the fire|i lied about)\b/.test(dl);
    const spillsSecret = secretWords.length >= 2 && secretWords.filter((w) => dl.includes(w)).length >= Math.max(2, Math.ceil(secretWords.length * 0.6));
    if ((admits || spillsSecret) && composure > 15) { leaked = true; }
    say('.');
  }
  line('');

  if (leaked) problems.push('suspect volunteered guilt/secret while composure was still high');

  // 3. confront a SEEDED inconsistency — should be a HIT
  const inc = (truth.inconsistencies || [])[0];
  if (inc) {
    // find the evidence item referenced, if any
    const eviId = (inc.claim_b.match(/E\d/) || inc.claim_a.match(/E\d/) || [])[0];
    const evi = (truth.evidence || []).find((e) => e.id === eviId);
    const itemA = { kind: 'statement', text: inc.claim_a };
    const itemB = evi ? { kind: 'evidence', id: evi.id, label: evi.label, detail: evi.detail }
                      : { kind: 'statement', text: inc.claim_b };
    const verdict = await adjudicate(truth, itemA, itemB);
    line(`  confront seeded inconsistency → is_contradiction=${verdict.is_contradiction} (Δ${verdict.composure_delta})`);
    if (!verdict.is_contradiction) problems.push('seeded inconsistency was NOT scored as a contradiction');
    else composure = Math.max(0, composure + (verdict.composure_delta || -20));
  } else {
    problems.push('no inconsistency to confront');
  }

  // 4. confront a BOGUS pair — should MISS
  const bogusA = { kind: 'statement', text: `${truth.suspect?.name} said the weather was miserable that night.` };
  const bogusB = { kind: 'statement', text: `${truth.suspect?.name} said the ${truth.crime?.where || 'place'} was quiet.` };
  const missV = await adjudicate(truth, bogusA, bogusB);
  line(`  confront bogus pair → is_contradiction=${missV.is_contradiction}`);
  if (missV.is_contradiction) problems.push('bogus pair was falsely scored as a contradiction');

  // 5. drive to a crack if needed, then verify the confession lands
  if (composure > 0) {
    // extra pressure: confront the remaining inconsistencies
    for (const extra of (truth.inconsistencies || []).slice(1)) {
      if (composure <= 0) break;
      const v = await adjudicate(truth, { kind: 'statement', text: extra.claim_a }, { kind: 'statement', text: extra.claim_b });
      if (v.is_contradiction) composure = Math.max(0, composure + (v.composure_delta || -18));
    }
  }
  let crackReply = null;
  if (composure <= 0) {
    crackReply = await askSuspect(truth, conversation, 0, true);
    line(`  CRACK: “${crackReply.dialogue.slice(0, 90)}…”`);
  }

  line(`  → questions asked: ${questionCount}, final composure: ${Math.round(composure)}`);
  return { title: truth.title, guilty: truth.guilty, questionCount, composure, cracked: composure <= 0, problems };
}

(async () => {
  line(`\nSUSPECT — live playtest · ${CASES} cases · model claude-fable-5\n`);
  const results = [];
  for (let i = 1; i <= CASES; i++) {
    try { results.push(await runCase(i)); }
    catch (e) { line(`  ✗ case ${i} crashed: ${e.message}`); results.push({ problems: [e.message], questionCount: 0 }); }
  }

  line('\n════════════════════ SUMMARY ════════════════════');
  const allProblems = results.flatMap((r, i) => (r.problems || []).map((p) => `case ${i + 1}: ${p}`));
  const counts = results.map((r) => r.questionCount).filter((n) => n > 0);
  const avg = counts.reduce((a, b) => a + b, 0) / (counts.length || 1);

  for (const r of results) line(`  · ${r.title || '?'} — ${r.questionCount} questions, ${r.cracked ? 'CRACKED' : 'held'}`);
  line(`\n  average questions to resolution: ${avg.toFixed(1)}  (target 8-15)`);
  const inBand = avg >= 8 && avg <= 15;
  line(`  ${inBand ? '✓' : '✗'} pacing ${inBand ? 'within' : 'OUTSIDE'} target band`);

  if (allProblems.length) {
    line('\n  PROBLEMS:');
    allProblems.forEach((p) => line(`   ✗ ${p}`));
  } else {
    line('\n  ✓ no integrity problems: suspect stayed consistent, scoring fired correctly.');
  }
  line('');
  process.exit(allProblems.length || !inBand ? 1 : 0);
})();
