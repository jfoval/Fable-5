// evaluator.test.js — exhaustive edge-case tests for the hand evaluator.
// Run:  npm test   (or: node tools/evaluator.test.js)
//
// Zero-dependency test harness. Exits non-zero on any failure.

import { parseCard } from '../public/src/cards.js';
import { evaluate, compareHands, CATEGORY } from '../public/src/evaluator.js';

let passed = 0, failed = 0;
const fails = [];

function ok(cond, msg) {
  if (cond) { passed++; } else { failed++; fails.push(msg); }
}
function h(str) { return str.trim().split(/\s+/).map(parseCard); }
function evalStr(str) { return evaluate(h(str)); }

function eqCat(str, cat, label) {
  const e = evalStr(str);
  ok(e.category === cat, `${label}: expected cat ${cat} got ${e.category} (${e.name}) [${str}]`);
  return e;
}

// A beats B ?
function beats(a, b, label) {
  const r = compareHands(h(a), h(b));
  ok(r > 0, `${label}: expected [${a}] > [${b}] but got cmp=${r}`);
}
function chops(a, b, label) {
  const r = compareHands(h(a), h(b));
  ok(r === 0, `${label}: expected chop [${a}] == [${b}] but got cmp=${r}`);
}

// ---------------------------------------------------------------------------
// Category detection
// ---------------------------------------------------------------------------
eqCat('As Ks Qs Js Ts', CATEGORY.STRAIGHT_FLUSH, 'royal flush');
eqCat('9h 8h 7h 6h 5h', CATEGORY.STRAIGHT_FLUSH, 'straight flush');
eqCat('Ah 2h 3h 4h 5h', CATEGORY.STRAIGHT_FLUSH, 'wheel straight flush (steel wheel)');
eqCat('Ac Ad Ah As Kd', CATEGORY.QUADS, 'quads');
eqCat('Kc Kd Kh 2s 2d', CATEGORY.FULL_HOUSE, 'full house');
eqCat('Ah Kh 9h 4h 2h', CATEGORY.FLUSH, 'flush');
eqCat('9c 8d 7h 6s 5c', CATEGORY.STRAIGHT, 'straight');
eqCat('Ah 2c 3d 4s 5h', CATEGORY.STRAIGHT, 'wheel straight');
eqCat('Tc Jd Qh Ks Ah', CATEGORY.STRAIGHT, 'broadway straight');
eqCat('7c 7d 7h 2s 9d', CATEGORY.TRIPS, 'trips');
eqCat('Ac Ad Kh Ks 3d', CATEGORY.TWO_PAIR, 'two pair');
eqCat('9c 9d 4h 7s 2d', CATEGORY.PAIR, 'one pair');
eqCat('Ac Kd 9h 7s 2d', CATEGORY.HIGH_CARD, 'high card');

// ---------------------------------------------------------------------------
// Wheel is the LOWEST straight (5-high), not ace-high
// ---------------------------------------------------------------------------
{
  const wheel = evalStr('Ah 2c 3d 4s 5h');
  ok(wheel.ranks[0] === 5, `wheel high card should be 5, got ${wheel.ranks[0]}`);
  beats('2c 3d 4s 5h 6c', 'Ah 2c 3d 4s 5h', 'six-high straight beats the wheel');
  beats('Tc Jd Qh Ks Ah', 'Ah 2c 3d 4s 5h', 'broadway beats wheel');
}

// ---------------------------------------------------------------------------
// Flush over flush decided by kicker
// ---------------------------------------------------------------------------
beats('Ah Qh 9h 4h 2h', 'Kh Qh 9h 4h 2h', 'ace-high flush beats king-high flush');
beats('Ah Kh 9h 4h 3h', 'Ah Kh 9h 4h 2h', 'flush 5th-card kicker decides');
chops('Ah Kh 9h 4h 2h Xx'.replace(' Xx', ''), 'Ah Kh 9h 4h 2h', 'identical flush chops');

// ---------------------------------------------------------------------------
// Full house vs quads, and full house ranking
// ---------------------------------------------------------------------------
beats('2c 2d 2h 2s 3d', 'Ac Ad Ah Kc Kd', 'quad twos beat aces full');
beats('Ac Ad Ah 2c 2d', 'Kc Kd Kh Qc Qd', 'aces full beats kings full');
beats('Ac Ad Ah 3c 3d', 'Ac Ad As 2c 2d', 'aces full of threes beats aces full of twos');

// ---------------------------------------------------------------------------
// Identical-kicker chops
// ---------------------------------------------------------------------------
chops('Ac Ad Kh Qs Jd', 'As Ah Kc Qd Jc', 'same pair + kickers chops');
chops('9c 8d 7h 6s 5c', '9h 8s 7d 6c 5h', 'same straight chops');
chops('Ah Kd Qh Js 9c', 'Ac Kh Qs Jd 9h', 'same high card chops');

// ---------------------------------------------------------------------------
// Best 5 of 7 selection
// ---------------------------------------------------------------------------
{
  // Board gives a flush; hole cards irrelevant except one improves it.
  const e = evalStr('Ah Kh Qh 2h 3h 2c 2d'); // flush over a pair of twos
  ok(e.category === CATEGORY.FLUSH, `7-card: pick flush not pair (${e.name})`);
  ok(e.ranks[0] === 14, '7-card flush uses ace high');
}
{
  // Two pair on board + pocket pair -> full house from 7.
  const e = evalStr('Kc Kd 7h 7s 2d Kh 9c');
  ok(e.category === CATEGORY.FULL_HOUSE, `7-card kings full (${e.name})`);
  ok(e.ranks[0] === 13 && e.ranks[1] === 7, `kings full of sevens, got ${e.ranks}`);
}
{
  // Straight using board, ignore the pair.
  const e = evalStr('5c 6d 7h 8s 9c 9d 2h');
  ok(e.category === CATEGORY.STRAIGHT && e.ranks[0] === 9, `7-card straight nine-high (${e.name})`);
}
{
  // Wheel available in 7 cards alongside a pair — straight beats the pair.
  const e = evalStr('Ah 2c 3d 4s 5h Kd Kc');
  ok(e.category === CATEGORY.STRAIGHT && e.ranks[0] === 5, `7-card wheel (${e.name})`);
}
{
  // Straight flush hidden inside 7 cards where a higher flush card exists.
  // 5h6h7h8h9h is the SF; Ah would make ace-high flush but SF wins.
  const e = evalStr('5h 6h 7h 8h 9h Ah Kh');
  ok(e.category === CATEGORY.STRAIGHT_FLUSH, `7-card straight flush (${e.name})`);
  ok(e.ranks[0] === 9, `SF nine-high (best is 5-9, not counting A/K which break the run) got ${e.ranks[0]}`);
}

// ---------------------------------------------------------------------------
// Trips vs two pair vs straight ordering
// ---------------------------------------------------------------------------
beats('5c 6d 7h 8s 9c', '9d 9h 9s 2c 3d', 'straight beats trips');
beats('9d 9h 9s 2c 3d', 'Ac Ad Kh Ks 2d', 'trips beat two pair');
beats('Ac Ad Kh Ks 2d', 'Ac Ad 5h 7s 2d', 'two pair beats one pair');

// ---------------------------------------------------------------------------
// Two pair kicker
// ---------------------------------------------------------------------------
beats('Ac Ad Kh Ks Qd', 'Ac Ad Kh Ks 2d', 'two pair with better kicker wins');
beats('Ac Ad Kh Ks 2d', 'Ac Ad Qh Qs Kd', 'higher two pair beats lower two pair even with worse kicker');

// ---------------------------------------------------------------------------
// Pair kicker chain
// ---------------------------------------------------------------------------
beats('9c 9d Ah Ks Qd', '9c 9d Ah Ks Jd', 'pair third-kicker decides');
beats('9c 9d Ah Ks 3d', '9c 9d Ah Qs Jd', 'pair second-kicker decides');

// ---------------------------------------------------------------------------
// Straight cannot "wrap" (Q-K-A-2-3 is not a straight)
// ---------------------------------------------------------------------------
{
  const e = evalStr('Qc Kd Ah 2s 3c');
  ok(e.category === CATEGORY.HIGH_CARD, `Q-K-A-2-3 is not a straight (got ${e.name})`);
}

// ---------------------------------------------------------------------------
// Quad kicker
// ---------------------------------------------------------------------------
beats('7c 7d 7h 7s Ad', '7c 7d 7h 7s Kd', 'quads with ace kicker beats king kicker');
{
  // 7-card quads: best kicker chosen from remaining.
  const e = evalStr('7c 7d 7h 7s 2d 3c Ah');
  ok(e.category === CATEGORY.QUADS && e.ranks[1] === 14, `quads pick ace kicker, got ${e.ranks[1]}`);
}

// ---------------------------------------------------------------------------
// Randomised sanity: exhaustive brute-force best-of-7 vs our evaluator.
// For 200 random 7-card hands, our value must equal the max over all C(7,5).
// ---------------------------------------------------------------------------
{
  function best5BruteForce(cards) {
    let best = -1;
    for (let a = 0; a < 7; a++)
      for (let b = a + 1; b < 7; b++) {
        // choose the 5 that are NOT (a,b)
        const five = cards.filter((_, i) => i !== a && i !== b);
        const v = evaluate(five).value;
        if (v > best) best = v;
      }
    return best;
  }
  let rng = 123456789;
  const rand = () => {
    rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; rng >>>= 0;
    return rng / 4294967296;
  };
  let mismatch = 0;
  for (let t = 0; t < 400; t++) {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 51; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const seven = deck.slice(0, 7);
    const direct = evaluate(seven).value;
    const brute = best5BruteForce(seven);
    if (direct !== brute) { mismatch++; }
  }
  ok(mismatch === 0, `brute-force cross-check: ${mismatch}/400 mismatches`);
}

// ---------------------------------------------------------------------------
console.log(`\nBLUFF hand-evaluator tests: ${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
} else {
  console.log('All evaluator tests passed. ✔');
}
