// evaluator.js — best-5-of-7 Texas Hold'em hand evaluator.
//
// Pure and dependency-light so it runs identically in Node (unit tests) and the
// browser.  evaluate() takes 5..7 cards and returns:
//   { category, ranks, value, name }
// where `category` is 0 (high card) .. 8 (straight flush), `ranks` is the list
// of tiebreak ranks high-to-low, `value` is a single integer that totally
// orders every hand (bigger = better), and `name` is a human label.
//
// Comparison is just  a.value - b.value.  Equal value  =>  a chop.

import { rankOf, suitOf, RANK_NAMES } from './cards.js';

export const CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
};

const CATEGORY_LABEL = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

// Encode category + up to five tiebreak ranks (each 0..14) into one integer.
// Base 15 leaves head-room above rank 14 and keeps the ordering exact.
function encode(category, ranks) {
  let v = category;
  for (let i = 0; i < 5; i++) v = v * 15 + (ranks[i] || 0);
  return v;
}

// Given an array of ranks present (with multiplicity) return the top straight
// high-card, or 0 if none.  Handles the wheel (A-2-3-4-5, high card = 5).
function straightHigh(rankSet) {
  // rankSet: Set of distinct ranks present.
  // Ace plays low for the wheel: treat a present Ace as also rank 1.
  const present = new Set(rankSet);
  if (present.has(14)) present.add(1);
  let run = 0;
  let best = 0;
  for (let r = 14; r >= 1; r--) {
    if (present.has(r)) {
      run++;
      if (run >= 5) { best = r + 4; break; } // r is the low end of a 5-run
    } else {
      run = 0;
    }
  }
  return best;
}

export function evaluate(cards) {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`evaluate expects 5..7 cards, got ${cards.length}`);
  }

  // Tally ranks and suits.
  const rankCount = new Array(15).fill(0);
  const suitCards = [[], [], [], []];
  const rankSet = new Set();
  for (const c of cards) {
    const r = rankOf(c);
    const s = suitOf(c);
    rankCount[r]++;
    suitCards[s].push(r);
    rankSet.add(r);
  }

  // --- Flush / straight flush -------------------------------------------------
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCards[s].length >= 5) flushSuit = s;

  if (flushSuit >= 0) {
    const suited = new Set(suitCards[flushSuit]);
    const sfHigh = straightHigh(suited);
    if (sfHigh) return result(CATEGORY.STRAIGHT_FLUSH, [sfHigh]);
  }

  // --- Rank-multiplicity groups ----------------------------------------------
  // ranksByCount[n] = ranks (desc) appearing exactly n times.
  const quads = [], trips = [], pairs = [], singles = [];
  for (let r = 14; r >= 2; r--) {
    const n = rankCount[r];
    if (n === 4) quads.push(r);
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
    else if (n === 1) singles.push(r);
  }

  // Four of a kind
  if (quads.length) {
    const q = quads[0];
    const kicker = highestExcept([q]);
    return result(CATEGORY.QUADS, [q, kicker]);
  }

  // Full house: best trips + best remaining pair (a second set of trips can act
  // as the pair).
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0];
    const pairRank = trips.length > 1 ? trips[1] : pairs[0];
    return result(CATEGORY.FULL_HOUSE, [t, pairRank]);
  }

  // Flush (already ruled out straight flush above)
  if (flushSuit >= 0) {
    const top5 = suitCards[flushSuit].slice().sort((a, b) => b - a).slice(0, 5);
    return result(CATEGORY.FLUSH, top5);
  }

  // Straight
  const sHigh = straightHigh(rankSet);
  if (sHigh) return result(CATEGORY.STRAIGHT, [sHigh]);

  // Three of a kind
  if (trips.length) {
    const t = trips[0];
    const ks = highestN([t], 2);
    return result(CATEGORY.TRIPS, [t, ...ks]);
  }

  // Two pair
  if (pairs.length >= 2) {
    const [hi, lo] = pairs;
    const kicker = highestExcept([hi, lo]);
    return result(CATEGORY.TWO_PAIR, [hi, lo, kicker]);
  }

  // One pair
  if (pairs.length === 1) {
    const p = pairs[0];
    const ks = highestN([p], 3);
    return result(CATEGORY.PAIR, [p, ...ks]);
  }

  // High card
  return result(CATEGORY.HIGH_CARD, singles.slice(0, 5));

  // ---- helpers that close over rankCount ----
  function highestExcept(excl) {
    for (let r = 14; r >= 2; r--) {
      if (excl.includes(r)) continue;
      if (rankCount[r] > 0) return r;
    }
    return 0;
  }
  function highestN(excl, n) {
    const out = [];
    for (let r = 14; r >= 2 && out.length < n; r--) {
      if (excl.includes(r)) continue;
      // a rank used as the trips/pair is fully consumed; other ranks contribute
      // one kicker each (their extra copies never matter for kickers).
      if (rankCount[r] > 0) out.push(r);
    }
    return out;
  }
}

function result(category, ranks) {
  const padded = ranks.concat([0, 0, 0, 0, 0]).slice(0, 5);
  return {
    category,
    ranks: ranks.slice(),
    value: encode(category, padded),
    name: describe(category, ranks),
  };
}

function describe(category, ranks) {
  const nm = (r) => RANK_NAMES[r] || '?';
  const plural = (r) => (r === 6 ? 'Sixes' : `${nm(r)}s`);
  switch (category) {
    case CATEGORY.STRAIGHT_FLUSH:
      return ranks[0] === 14 ? 'Royal Flush' : `Straight Flush, ${nm(ranks[0])} high`;
    case CATEGORY.QUADS: return `Four of a Kind, ${plural(ranks[0])}`;
    case CATEGORY.FULL_HOUSE: return `Full House, ${plural(ranks[0])} over ${plural(ranks[1])}`;
    case CATEGORY.FLUSH: return `Flush, ${nm(ranks[0])} high`;
    case CATEGORY.STRAIGHT: return `Straight, ${nm(ranks[0])} high`;
    case CATEGORY.TRIPS: return `Three of a Kind, ${plural(ranks[0])}`;
    case CATEGORY.TWO_PAIR: return `Two Pair, ${plural(ranks[0])} and ${plural(ranks[1])}`;
    case CATEGORY.PAIR: return `Pair of ${plural(ranks[0])}`;
    default: return `${nm(ranks[0])} high`;
  }
}

export function categoryLabel(category) {
  return CATEGORY_LABEL[category];
}

// Compare two 7-card holdings. Returns >0 if a wins, <0 if b wins, 0 chop.
export function compareHands(a, b) {
  return evaluate(a).value - evaluate(b).value;
}
