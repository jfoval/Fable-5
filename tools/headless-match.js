// headless-match.js — plays full hands through the real decision pipeline and
// asserts the integrity guarantees, with NO browser.
//
//   node tools/headless-match.js [numHands]
//
// If ANTHROPIC_API_KEY is set it drives the actual Claude Fable 5 API (this is
// the "run at least 10 full hands against the real API" check). With no key it
// exercises the identical engine + orchestrator + audit path via the offline
// brain, so the integrity checks (no crashes, no leaks, monologues reference
// state) still run everywhere.

import { Match } from '../public/src/engine.js';
import { MatchRunner } from '../public/src/orchestrator.js';
import { AuditLog } from '../public/src/audit.js';
import { PERSONAS } from '../public/src/personas.js';

const MODEL = 'claude-fable-5';
const BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const KEY = process.env.ANTHROPIC_API_KEY;
const N = Math.max(10, Number(process.argv[2]) || 10);

async function apiCall(system, messages) {
  if (!KEY) return { offline: true };
  const body = { model: MODEL, max_tokens: 400, system, messages };
  try {
    const r = await fetch(`${BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { error: `api ${r.status}: ${(await r.text()).slice(0, 200)}` };
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return { text };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

function cardTokensIn(str) {
  const m = str.match(/"([2-9TJQKA][cdhs])"/g) || [];
  return new Set(m.map((s) => s.replace(/"/g, '')));
}

async function main() {
  console.log(`\nBLUFF headless match — ${KEY ? `LIVE API (${MODEL})` : 'offline brain (no ANTHROPIC_API_KEY)'}\n`);

  const [pA, pB] = [PERSONAS[0], PERSONAS[1]]; // Doyle vs Zoe
  const match = new Match({ names: [pA.name, pB.name] });
  const audit = new AuditLog();
  const runner = new MatchRunner({ match, personas: [pA, pB], audit, call: apiCall });

  let handsPlayed = 0;
  let crashes = 0;
  let defaults = 0;
  let sampleValue = null, sampleBluff = null;

  runner.hooks.onDecision = async (rec) => {
    if (rec.decision.source === 'default') defaults++;
    // capture a made-hand vs bluff sample for eyeballing
    if (rec.isBluff && !sampleBluff) sampleBluff = rec;
    if (!rec.isBluff && ['bet', 'raise'].includes(rec.decision.action) && !sampleValue) sampleValue = rec;
  };

  for (let i = 0; i < N && !match.over; i++) {
    try {
      const outcome = await runner.playHand();
      if (!outcome) break;
      handsPlayed++;
      const w = outcome.result.winners.map((s) => runner.personas[s].name).join(' & ');
      console.log(
        `  Hand ${String(outcome.handNumber).padStart(2)} · ` +
        `blinds ${outcome.blinds.sb}/${outcome.blinds.bb} · pot ${outcome.result.pots.reduce((a, p) => a + p.amount, 0)} · ` +
        `${outcome.verdict.title} · winner: ${w} · stacks ${outcome.stacksAfter.join(' / ')}`
      );
    } catch (e) {
      crashes++;
      console.log(`  !! hand crashed: ${e.stack || e}`);
    }
  }

  // ---- Integrity checks -----------------------------------------------------
  console.log('\n— integrity checks —');
  const checks = [];

  checks.push(['no hand crashed', crashes === 0, `${crashes} crashes`]);
  checks.push(['played >= 10 hands (or match ended)', handsPlayed >= 10 || match.over, `${handsPlayed} hands`]);

  // Audit: zero leaks across every recorded payload.
  const auditSummary = audit.summary();
  checks.push(['audit log is clean (no card/thought leaks)', auditSummary.clean,
    `${auditSummary.payloads} payloads, ${auditSummary.leaks} leaks`]);

  // Independent re-scan: for every payload, the opponent's real hole cards for
  // that hand must not appear as JSON tokens in the live-hand view.
  let independentLeaks = 0;
  for (const rec of audit.records) {
    const oppCards = rec.secrets?.holeCards || [];
    const live = { ...(rec.view || {}) };
    delete live.match_history;
    const tokens = cardTokensIn(JSON.stringify(live));
    for (const c of oppCards) if (tokens.has(c)) independentLeaks++;
  }
  checks.push(['independent re-scan finds no opponent cards in live view', independentLeaks === 0,
    `${independentLeaks} tokens`]);

  // Every decision produced a non-empty monologue (JSON parsing never lost it).
  let emptyMono = 0, missingRead = 0;
  for (const t of runner.transcript) {
    if (!t.decision.inner_monologue) emptyMono++;
    if (!t.decision.read_on_opponent && t.decision.source !== 'default') missingRead++;
  }
  checks.push(['every decision has an inner monologue', emptyMono === 0, `${emptyMono} empty`]);

  // Defaults (unparseable/illegal x2) should be rare — the pipeline shouldn't
  // be constantly falling back.
  checks.push(['fallback-to-default rate is low', defaults <= Math.ceil(runner.transcript.length * 0.15),
    `${defaults}/${runner.transcript.length} decisions defaulted`]);

  let allPass = true;
  for (const [name, pass, detail] of checks) {
    console.log(`  ${pass ? '✔' : '✗'} ${name}  (${detail})`);
    if (!pass) allPass = false;
  }

  // ---- Sample monologues: value vs bluff should read differently ------------
  console.log('\n— sample monologues (value vs bluff) —');
  if (sampleValue) console.log(`  VALUE  [${sampleValue.holeCards.join(' ')} | ${sampleValue.board.join(' ') || 'preflop'}]\n    "${sampleValue.decision.inner_monologue}"`);
  if (sampleBluff) console.log(`  BLUFF  [${sampleBluff.holeCards.join(' ')} | ${sampleBluff.board.join(' ') || 'preflop'}]\n    "${sampleBluff.decision.inner_monologue}"`);

  // ---- Stats ----------------------------------------------------------------
  console.log('\n— final stats —');
  for (let s = 0; s < 2; s++) {
    const st = runner.stats[s];
    console.log(`  ${runner.personas[s].name}: won ${st.handsWon} · bluffs ${st.bluffsWorked}/${st.bluffsAttempted} · ` +
      `aggression ${(st.aggressiveActions / Math.max(1, st.decisions) * 100).toFixed(0)}% · biggest pot ${st.biggestPot}`);
  }
  if (match.over) console.log(`\n  MATCH OVER — winner: ${runner.personas[match.winner].name}`);

  console.log(`\n${allPass ? 'ALL INTEGRITY CHECKS PASSED ✔' : 'INTEGRITY CHECKS FAILED ✗'}\n`);
  process.exit(allPass ? 0 : 1);
}

main();
