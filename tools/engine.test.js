// engine.test.js — verifies the heads-up NLHE betting state machine and pots.
// Run: node tools/engine.test.js

import { Hand, buildSidePots } from '../public/src/engine.js';
import { parseCard } from '../public/src/cards.js';

let passed = 0, failed = 0;
const fails = [];
function ok(c, m) { if (c) passed++; else { failed++; fails.push(m); } }
function eq(a, b, m) { ok(a === b, `${m} (expected ${b}, got ${a})`); }

// Build a deck where we control every dealt card.
// HU deal order: SB(button) c1, BB c1, SB c2, BB c2, then board.
function deckFrom(sbHole, bbHole, board) {
  const cards = [sbHole[0], bbHole[0], sbHole[1], bbHole[1], ...board];
  // pad with throwaway cards so shift() never returns undefined
  const used = new Set(cards);
  for (let i = 0; i < 52 && cards.length < 52; i++) if (!used.has(i)) cards.push(i);
  return cards;
}
const C = (s) => parseCard(s);
const hole = (a, b) => [C(a), C(b)];
const board = (...xs) => xs.map(C);

// ---------------------------------------------------------------------------
// 1. Blinds posted, small blind acts first preflop.
// ---------------------------------------------------------------------------
{
  const h = new Hand({
    stacks: [10000, 10000], button: 0, blinds: { sb: 50, bb: 100 },
    deck: deckFrom(hole('As', 'Ks'), hole('2c', '2d'), board('7h', '8h', '9h', 'Td', 'Jc')),
  });
  eq(h.toAct, 0, 'SB (button) acts first preflop');
  eq(h.players[0].committedStreet, 50, 'SB posted 50');
  eq(h.players[1].committedStreet, 100, 'BB posted 100');
  eq(h.pot, 150, 'pot is 150 after blinds');
  const la = h.legalActions();
  eq(la.callAmount, 50, 'SB must call 50 more');
  eq(la.minRaiseTo, 200, 'min raise is to 200');
}

// ---------------------------------------------------------------------------
// 2. Limp / check to see a flop; postflop the BB (non-button) acts first.
// ---------------------------------------------------------------------------
{
  const h = new Hand({
    stacks: [10000, 10000], button: 0, blinds: { sb: 50, bb: 100 },
    deck: deckFrom(hole('As', 'Kd'), hole('2c', '2d'), board('7h', '8s', '9c', 'Td', 'Jc')),
  });
  h.apply('call');       // SB limps to 100
  eq(h.toAct, 1, 'BB has the option');
  h.apply('check');      // BB checks -> see flop
  eq(h.street, 'flop', 'advanced to flop');
  eq(h.toAct, 1, 'non-button acts first on the flop');
  eq(h.board.length, 3, 'flop dealt');
}

// ---------------------------------------------------------------------------
// 3. Min-raise enforcement.
// ---------------------------------------------------------------------------
{
  const h = new Hand({
    stacks: [10000, 10000], button: 0, blinds: { sb: 50, bb: 100 },
    deck: deckFrom(hole('As', 'Kd'), hole('2c', '2d'), board('7h', '8s', '9c', 'Td', 'Jc')),
  });
  let threw = false;
  try { h.apply('raise', 150); } catch { threw = true; } // raise to 150 < min 200
  ok(threw, 'raise below minimum is rejected');
  eq(h.toAct, 0, 'still SB to act after rejected raise');
  h.apply('raise', 300); // legal raise to 300
  eq(h.betToMatch, 300, 'bet is now 300');
  eq(h.lastRaiseSize, 200, 'last raise size is 200 (300-100)');
  const la = h.legalActions();
  eq(la.minRaiseTo, 500, 'BB min re-raise is to 500');
}

// ---------------------------------------------------------------------------
// 4. Fold ends the hand, winner takes the pot.
// ---------------------------------------------------------------------------
{
  const h = new Hand({
    stacks: [10000, 10000], button: 0, blinds: { sb: 50, bb: 100 },
    deck: deckFrom(hole('As', 'Kd'), hole('2c', '2d'), board('7h', '8s', '9c', 'Td', 'Jc')),
  });
  h.apply('raise', 300); // SB to 300
  h.apply('fold');       // BB folds
  ok(h.complete, 'hand complete after fold');
  eq(h.result.type, 'fold', 'result is a fold');
  eq(h.players[0].stack, 10100, 'SB wins BB blind: 10000 -100(committed) +200 pot... check net');
  eq(h.result.winners[0], 0, 'SB is the winner');
  // Net: SB committed 300, gets pot 400 -> +100. Stack 10000-300+400 = 10100.
  eq(h.pot, 400, 'pot was 400');
}

// ---------------------------------------------------------------------------
// 5. Full hand to showdown, better hand wins the whole pot.
// ---------------------------------------------------------------------------
{
  const h = new Hand({
    stacks: [10000, 10000], button: 0, blinds: { sb: 50, bb: 100 },
    // SB: As Ks  BB: 2c 2d   board: 7h 8s Ah Td Jc -> SB pair of aces beats pair of 2s
    deck: deckFrom(hole('As', 'Ks'), hole('2c', '2d'), board('7h', '8s', 'Ah', 'Td', 'Jc')),
  });
  h.apply('call'); h.apply('check');      // preflop
  h.apply('check'); h.apply('check');     // flop
  h.apply('check'); h.apply('check');     // turn
  h.apply('check'); h.apply('check');     // river
  ok(h.complete, 'hand reached showdown');
  eq(h.result.type, 'showdown', 'showdown result');
  eq(h.result.winners[0], 0, 'SB (aces) wins showdown');
  eq(h.players[0].stack, 10100, 'winner up 100');
  eq(h.players[1].stack, 9900, 'loser down 100');
}

// ---------------------------------------------------------------------------
// 6. Split pot (both make the same straight on board).
// ---------------------------------------------------------------------------
{
  const h = new Hand({
    stacks: [10000, 10000], button: 0, blinds: { sb: 50, bb: 100 },
    // board is a broadway straight both play
    deck: deckFrom(hole('2c', '3d'), hole('4h', '5s'), board('Tc', 'Jd', 'Qh', 'Ks', 'Ac')),
  });
  h.apply('call'); h.apply('check');
  h.apply('check'); h.apply('check');
  h.apply('check'); h.apply('check');
  h.apply('check'); h.apply('check');
  eq(h.result.winners.length, 2, 'both players win (chop)');
  eq(h.players[0].stack, 10000, 'P0 back to even after chop');
  eq(h.players[1].stack, 10000, 'P1 back to even after chop');
}

// ---------------------------------------------------------------------------
// 7. All-in preflop runs the board out to showdown with no further action.
// ---------------------------------------------------------------------------
{
  const h = new Hand({
    stacks: [10000, 10000], button: 0, blinds: { sb: 50, bb: 100 },
    deck: deckFrom(hole('As', 'Ad'), hole('Kc', 'Kd'), board('2h', '7s', '9c', 'Td', '3c')),
  });
  h.apply('allin');   // SB shoves 10000
  h.apply('call');    // BB calls all-in
  ok(h.complete, 'both all-in -> hand auto-completes to showdown');
  eq(h.board.length, 5, 'full board dealt');
  eq(h.result.winners[0], 0, 'aces beat kings');
  eq(h.players[0].stack, 20000, 'winner scoops 20000');
  eq(h.players[1].stack, 0, 'loser felted');
}

// ---------------------------------------------------------------------------
// 8. Side pot when the short stack is all-in for less.
// ---------------------------------------------------------------------------
{
  // P0 has only 3000, P1 has 10000. P0 shoves, P1 calls. P1 wins.
  // Main pot capped at 2*3000=6000 to P1; P1 gets back the uncalled excess.
  const h = new Hand({
    stacks: [3000, 10000], button: 0, blinds: { sb: 50, bb: 100 },
    deck: deckFrom(hole('2c', '3d'), hole('As', 'Ad'), board('Ah', 'Ks', 'Qd', '7c', '8h')),
  });
  h.apply('allin');   // P0 (SB) all-in 3000
  h.apply('call');    // P1 calls 3000 (only needs to match), excess returned
  ok(h.complete, 'hand complete');
  // P1 wins 6000 total pot; P1 net +3000, P0 net -3000.
  eq(h.players[1].stack, 13000, 'P1 wins the 6000 pot (10000-3000 committed +6000)');
  eq(h.players[0].stack, 0, 'P0 busts');
}

// ---------------------------------------------------------------------------
// 9. buildSidePots layering with three notional contributors.
// ---------------------------------------------------------------------------
{
  // contributions 100/500/500, player0 folded.
  const pots = buildSidePots([100, 500, 500], [true, false, false]);
  // layer1: min 100 across all 3 = 300, eligible {1,2} (0 folded)
  // layer2: remaining 400/400 from players 1,2 = 800, eligible {1,2}
  // same eligibility -> merged into one pot of 1100.
  eq(pots.length, 1, 'merged into single pot (same eligibility)');
  eq(pots[0].amount, 1100, 'total pot 1100');
  ok(pots[0].eligible.includes(1) && pots[0].eligible.includes(2) && !pots[0].eligible.includes(0),
    'folded contributor is not eligible');
}
{
  // Distinct layers: 200/500/500, nobody folded -> main {0,1,2}=600, side {1,2}=600
  const pots = buildSidePots([200, 500, 500], [false, false, false]);
  eq(pots.length, 2, 'two layered pots');
  eq(pots[0].amount, 600, 'main pot 600');
  eq(pots[1].amount, 600, 'side pot 600');
  eq(pots[1].eligible.length, 2, 'side pot excludes the short stack');
}

// ---------------------------------------------------------------------------
// 10. Sub-minimum all-in does not reopen betting.
// ---------------------------------------------------------------------------
{
  // P0 bets, P1 shoves all-in for less than a full raise; P0 may only call/fold.
  const h = new Hand({
    stacks: [10000, 250], button: 1, blinds: { sb: 50, bb: 100 },
    // button = P1 so P1 is SB and acts first preflop
    deck: deckFrom(hole('2c', '3d'), hole('As', 'Ad'), board('Ah', 'Ks', 'Qd', '7c', '8h')),
  });
  // P1 (SB, 250 stack) posts 50, P0 (BB) posts 100.
  // P1 to act: shove all-in to 250 (raise of 150 over 100, min raise would be 200 -> to raise to needs >=200, 250>=200 so it's a FULL raise actually)
  // Let's instead craft a genuine sub-min: give P1 stack 150.
}
{
  const h = new Hand({
    stacks: [10000, 150], button: 1, blinds: { sb: 50, bb: 100 },
    deck: deckFrom(hole('2c', '3d'), hole('As', 'Ad'), board('Ah', 'Ks', 'Qd', '7c', '8h')),
  });
  // P1 (SB) stack 150, posts 50 -> 100 behind. betToMatch=100.
  // P1 shoves to 150: increment 50 < lastRaiseSize(100) => sub-min all-in.
  h.apply('allin'); // P1 all-in to 150
  eq(h.betToMatch, 150, 'bet is 150 after short shove');
  ok(h.lastAggressionWasFull === false, 'short all-in did not count as a full raise');
  const la = h.legalActions(); // P0 to act
  eq(la.toAct, 0, 'P0 to act');
  ok(!la.canRaise, 'P0 cannot re-raise a sub-minimum all-in');
  ok(la.canCall, 'P0 can call');
  eq(la.callAmount, 50, 'P0 owes 50 to call the 150');
}

// ---------------------------------------------------------------------------
console.log(`\nBLUFF engine tests: ${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFAILURES:'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
else console.log('All engine tests passed. ✔');
