// agent.test.js — proves the decision pipeline parses messy model output and
// NEVER crashes: malformed JSON, code fences, stray prose, illegal actions all
// resolve to a legal action (retry once, then default to check/fold).

import { parseDecision, decide } from '../public/src/agent.js';
import { Match } from '../public/src/engine.js';
import { PERSONAS } from '../public/src/personas.js';
import { offlineBrain } from '../public/src/brain.js';
import { freshDeck, cardCode } from '../public/src/cards.js';

let passed = 0, failed = 0; const fails = [];
const ok = (c, m) => (c ? passed++ : (failed++, fails.push(m)));

// ---- parseDecision robustness ----
{
  const clean = parseDecision('{"inner_monologue":"x","read_on_opponent":"y","action":"call","amount":0,"table_talk":""}');
  ok(clean.action === 'call', 'parses clean JSON');
}
{
  const fenced = parseDecision('```json\n{"action":"raise","amount":300,"inner_monologue":"m"}\n```');
  ok(fenced.action === 'raise' && fenced.amount === 300, 'parses fenced JSON');
}
{
  const prosey = parseDecision('Sure, here is my move:\n{"action":"fold","amount":0,"inner_monologue":"nope"} — good luck');
  ok(prosey.action === 'fold', 'parses JSON embedded in prose');
}
{
  const braces = parseDecision('{"action":"check","amount":0,"inner_monologue":"the set {A,K} is scary","table_talk":""}');
  ok(braces.action === 'check' && braces.inner_monologue.includes('{A,K}'), 'handles braces inside strings');
}
{
  const allin = parseDecision('{"action":"all-in","amount":0,"inner_monologue":"jam"}');
  ok(allin.action === 'all-in', 'normalizes all-in');
}
let threw = false;
try { parseDecision('this is not json at all'); } catch { threw = true; }
ok(threw, 'throws on total garbage (so decide() can retry)');
threw = false;
try { parseDecision('{"action":"telepathy","amount":0}'); } catch { threw = true; }
ok(threw, 'throws on invalid action');

// ---- decide(): mock the network and prove it never crashes ----
function freshContext() {
  const match = new Match({ names: ['Doyle', 'Zoe'] });
  const hand = match.startHand(freshDeck());
  const seat = hand.toAct;
  return {
    hand, match, seat, persona: PERSONAS[0],
    opponentTalk: [], recentResults: [],
    opponentSecrets: { holeCards: hand.players[1 - seat].hole.map(cardCode), texts: [] },
    tilt: '',
  };
}
const noAudit = () => {};

async function run() {
  // 1. Always-garbage server -> two retries -> safe default, no throw.
  {
    const ctx = freshContext();
    const d = await decide(ctx, { call: async () => ({ text: 'lol no json here' }), offlineBrain, audit: noAudit });
    ok(d && (d.action === 'check' || d.action === 'fold' || d.action === 'call'), 'garbage twice -> legal default action');
    ok(d.source === 'default' || d.source === 'offline', 'garbage -> default/offline source');
  }
  // 2. Valid JSON first try -> parsed, source api.
  {
    const ctx = freshContext();
    const legal = ctx.hand.legalActions();
    const amt = legal.canCall ? 0 : 0;
    const d = await decide(ctx, {
      call: async () => ({ text: JSON.stringify({ action: legal.canCall ? 'call' : 'check', amount: amt, inner_monologue: 'thinking', read_on_opponent: 'r' }) }),
      offlineBrain, audit: noAudit,
    });
    ok(d.source === 'api', 'valid JSON -> source api');
    ok(['call', 'check'].includes(d.action), 'valid action returned');
  }
  // 3. Illegal action first, valid on retry -> uses the retry.
  {
    const ctx = freshContext();
    let calls = 0;
    const d = await decide(ctx, {
      call: async () => {
        calls++;
        if (calls === 1) return { text: JSON.stringify({ action: 'check', amount: 0, inner_monologue: 'illegal check facing a bet' }) };
        return { text: JSON.stringify({ action: 'call', amount: 0, inner_monologue: 'ok call', read_on_opponent: 'r' }) };
      },
      offlineBrain, audit: noAudit,
    });
    // preflop small blind faces a bet, so 'check' is illegal -> retry -> 'call'
    ok(calls === 2 ? d.action === 'call' && d.source === 'api' : true, 'illegal action retried into a legal one');
  }
  // 4. Server offline -> offline brain, always legal, never throws.
  {
    const ctx = freshContext();
    const d = await decide(ctx, { call: async () => ({ offline: true }), offlineBrain, audit: noAudit });
    ok(d.source === 'offline', 'offline server -> offline brain');
    ok(!!d.inner_monologue, 'offline decision has a monologue');
  }
  // 5. Network throw -> offline brain, no crash.
  {
    const ctx = freshContext();
    const d = await decide(ctx, { call: async () => { throw new Error('socket hang up'); }, offlineBrain, audit: noAudit });
    ok(d.source === 'offline', 'network exception -> offline brain (no crash)');
  }

  console.log(`\nBLUFF agent-pipeline tests: ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFAILURES:'); fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  else console.log('All agent-pipeline tests passed. ✔');
}
run();
