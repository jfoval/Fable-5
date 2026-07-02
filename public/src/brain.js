// brain.js — the offline fallback intelligence.
//
//  * offlineBrain()      — a persona-flavoured heuristic used when there is no
//                          API key, so the match keeps playing and the
//                          monologues still reference the real cards/board and
//                          read differently for a made hand vs a bluff.
//  * scriptedClassicHand — one hand-authored "stone cold bluff" with a fixed
//                          deck, so the UI has a great demo with zero API key.

import { rankOf, suitOf, cardCode, RANK_NAMES, parseCard } from './cards.js';
import { evaluate } from './evaluator.js';

// ---- deterministic per-situation randomness (reproducible, still varied) ----
function hashRand(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ---- hand strength ---------------------------------------------------------
function preflopStrength(hole) {
  const rs = hole.map(rankOf).sort((a, b) => b - a);
  const [a, b] = rs;
  const suited = suitOf(hole[0]) === suitOf(hole[1]);
  if (a === b) return clamp(0.5 + ((a - 2) / 12) * 0.5, 0.5, 1); // pairs
  const high = (a - 2) / 12;
  const gap = a - b;
  let s = 0.12 + high * 0.42 + (b - 2) / 12 * 0.16 + (suited ? 0.1 : 0) - Math.min(gap - 1, 5) * 0.03;
  return clamp(s, 0.05, 0.95);
}

function countDraws(hole, board) {
  const cards = [...hole, ...board];
  // flush draw
  const suitCount = [0, 0, 0, 0];
  cards.forEach((c) => suitCount[suitOf(c)]++);
  const flushDraw = suitCount.some((n) => n === 4);
  // straight draw (open-ended-ish): count distinct ranks forming 4-in-a-row window
  const present = new Set(cards.map(rankOf));
  if (present.has(14)) present.add(1);
  let straightDraw = false;
  for (let r = 1; r <= 11; r++) {
    let inWindow = 0;
    for (let k = 0; k < 5; k++) if (present.has(r + k)) inWindow++;
    if (inWindow === 4) straightDraw = true;
  }
  return { flushDraw, straightDraw };
}

function postflopStrength(hole, board) {
  const ev = evaluate([...hole, ...board]);
  const base = [0.14, 0.32, 0.50, 0.64, 0.74, 0.82, 0.90, 0.96, 1.0][ev.category];
  // reward a strong top-pair kicker / high pair a touch
  const kick = (ev.ranks[0] || 2) / 14 * 0.05;
  let s = clamp(base + kick, 0.05, 1);
  const { flushDraw, straightDraw } = countDraws(hole, board);
  const drawValue = (flushDraw ? 0.28 : 0) + (straightDraw ? 0.2 : 0);
  return { strength: s, drawValue, madeCategory: ev.category, evName: ev.name, flushDraw, straightDraw };
}

// ---- the heuristic decision -------------------------------------------------
export function offlineBrain(context, view, legal) {
  const { hand, seat, persona } = context;
  const me = hand.players[seat];
  const style = persona.style || { aggression: 0.5, bluff: 0.4, tightness: 0.5, tilt: 0.4 };

  const preflop = hand.street === 'preflop';
  const info = preflop
    ? { strength: preflopStrength(me.hole), drawValue: 0, evName: null }
    : postflopStrength(me.hole, hand.board);
  let strength = info.strength;
  const semibluff = info.drawValue || 0;

  // Tilt from recent results: a big recent loss loosens an emotional persona.
  const recentLoss = (context.recentResults || []).some((r) => r.net < -hand.blinds.bb * 20);
  const tiltPush = recentLoss ? style.tilt * 0.25 : 0;

  const rnd = hashRand(`${context.match.handNumber}|${hand.street}|${seat}|${view.board.join('')}|${hand.log.length}`);
  const pot = hand.pot;
  const facing = legal.canCall;
  const toCall = legal.callAmount;
  const potOdds = facing ? toCall / (pot + toCall) : 0;

  // effective aggression tempered/loosened by persona + tilt
  const aggro = clamp(style.aggression + tiltPush, 0, 1);
  const bluffFreq = clamp(style.bluff + tiltPush, 0, 1);

  let action = 'check';
  let amount = 0;
  let mode = 'passive'; // value | bluff | call | fold | check

  const potFraction = (f) => Math.max(hand.blinds.bb, Math.round((pot) * f));
  const raiseTo = (f) => clamp(me.committedStreet + toCall + potFraction(f), legal.minRaiseTo || 0, legal.maxRaiseTo);
  const betTo = (f) => clamp(me.committedStreet + potFraction(f), legal.minBet || hand.blinds.bb, legal.maxRaiseTo);

  const effStrength = clamp(strength + semibluff * 0.5, 0, 1);

  if (facing) {
    // Facing a bet.
    const callOk = effStrength > potOdds + 0.05 - aggro * 0.05;
    if (strength > 0.82 || (strength > 0.66 && aggro > 0.5)) {
      if (legal.canRaise && rnd < 0.6 + aggro * 0.3) { action = 'raise'; amount = raiseTo(0.9); mode = 'value'; }
      else { action = 'call'; mode = 'call'; }
    } else if (semibluff > 0.25 && legal.canRaise && rnd < bluffFreq) {
      action = 'raise'; amount = raiseTo(0.8); mode = 'bluff';
    } else if (callOk) {
      action = 'call'; mode = 'call';
    } else if (legal.canRaise && strength < 0.3 && rnd < bluffFreq * 0.35) {
      action = 'raise'; amount = raiseTo(1.0); mode = 'bluff'; // stone bluff raise
    } else {
      action = legal.canFold ? 'fold' : 'check'; mode = legal.canFold ? 'fold' : 'check';
    }
  } else {
    // No bet to us — check or take the betting lead.
    if (strength > 0.7 || (strength > 0.55 && aggro > 0.55)) {
      if (legal.canBet) { action = 'bet'; amount = betTo(0.66); mode = 'value'; }
      else { action = 'check'; mode = 'check'; }
    } else if (semibluff > 0.25 && legal.canBet && rnd < bluffFreq + 0.15) {
      action = 'bet'; amount = betTo(0.6); mode = 'bluff';
    } else if (legal.canBet && strength < 0.35 && rnd < bluffFreq * (aggro + 0.2)) {
      action = 'bet'; amount = betTo(0.75); mode = 'bluff'; // pure bluff
    } else {
      action = 'check'; mode = 'check';
    }
  }

  // Short-stack: turn big commitments into clean all-ins.
  if ((action === 'bet' || action === 'raise') && amount >= me.committedStreet + me.stack * 0.85) {
    action = 'all-in'; amount = legal.maxRaiseTo;
  }
  if (action === 'call' && toCall >= me.stack) { action = 'call'; } // call all-in

  return {
    ...flavor(persona, mode, info, view, hand, seat, strength),
    action,
    amount,
  };
}

// ---- persona-flavoured monologue text --------------------------------------
function flavor(persona, mode, info, view, hand, seat, strength) {
  const hole = view.your_hole_cards.join(' ');
  const board = view.board.length ? view.board.join(' ') : 'preflop';
  const made = info.evName ? info.evName : 'a starting hand';
  const style = persona.style || {};
  const aggressive = (style.aggression || 0.5) > 0.6;

  const valueLines = [
    `${made} — ${hole} on ${board}. This is a hand I want to get paid on; I'm building the pot.`,
    `I've got the goods here: ${made}. On ${board} that's well ahead, so I'm applying pressure for value.`,
    `${hole} made me ${made}. No reason to slow down on ${board} — I'm betting to be called by worse.`,
  ];
  const bluffLines = [
    `${hole} is basically air on ${board}, but the story writes itself. If I keep firing, their marginal hands can't continue.`,
    `Nothing here — ${made} at best on ${board}. This is pure leverage; I'm representing the board and betting them off it.`,
    `I don't have it. ${hole} whiffed ${board}. But hesitation loses pots, so I'm turning this into a bluff and telling a convincing tale.`,
  ];
  const callLines = [
    `${made} with ${hole}. Not a monster on ${board}, but enough to call and keep them honest.`,
    `I'll flat here. ${hole} on ${board} is a fine bluff-catcher; no need to blow up the pot.`,
  ];
  const foldLines = [
    `${hole} on ${board} just isn't enough facing this action. Discipline over ego — I let it go.`,
    `Too much heat for ${made}. Folding ${hole} here and waiting for a better spot.`,
  ];
  const checkLines = [
    `${hole} on ${board} — marginal. I'll check, control the pot, and see another card cheaply.`,
    `Not much to work with (${made}). Checking to keep the pot small and gather information.`,
  ];

  const pick = (arr) => arr[Math.floor(hashRand(hole + board + mode + hand.log.length) * arr.length)];
  let inner, read, talk = '';
  switch (mode) {
    case 'value': inner = pick(valueLines); read = 'They look capable of calling — I want value.'; talk = aggressive ? 'Pay me.' : ''; break;
    case 'bluff': inner = pick(bluffLines); read = 'I sense weakness — this is the moment to represent strength.'; talk = aggressive ? "You don't want this." : ''; break;
    case 'call': inner = pick(callLines); read = 'Could be a bluff or a thin value bet — I call to find out.'; break;
    case 'fold': inner = pick(foldLines); read = 'Their line screams a real hand; I believe them.'; break;
    default: inner = pick(checkLines); read = 'Unclear — I take the free card and reassess.'; break;
  }
  return { inner_monologue: inner, read_on_opponent: read, table_talk: talk };
}

// ---------------------------------------------------------------------------
// The scripted classic hand: a stone-cold bluff that works.
//   Seat 0 (button/SB) holds 7♠2♦ — the worst hand in poker — and bluffs three
//   streets. Seat 1 (BB) flops top pair with A♣K♦ and finally folds to the
//   river shove. Deck is fixed so it plays out identically every time.
// ---------------------------------------------------------------------------
export function scriptedClassicHand() {
  const codes = ['7s', 'Ac', '2d', 'Kd', 'Kh', '9s', '4c', '5d', 'Qd'];
  const rest = [];
  const used = new Set(codes);
  for (const r of ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'])
    for (const s of ['c', 'd', 'h', 's']) { const cc = r + s; if (!used.has(cc)) rest.push(cc); }
  const deck = [...codes, ...rest].map(parseCard);

  // Ordered decisions. Each is applied to whoever is to act; `seat` is a guard.
  const decisions = [
    { seat: 0, action: 'raise', amount: 300,
      inner_monologue: "Seven-deuce offsuit — the single worst hand in hold'em. Which is exactly why nobody puts me on it. I'm raising, and I'm telling a story from the very first chip.",
      read_on_opponent: 'They will call wide from the big blind, but they will respect aggression later.',
      table_talk: 'Let’s make it interesting.' },
    { seat: 1, action: 'call', amount: 0,
      inner_monologue: 'Ace-King, big slick. I could three-bet, but I’ll flat and keep the pot controlled — let them keep leading into the best hand.',
      read_on_opponent: 'Standard button raise; could be anything.', table_talk: '' },

    { seat: 1, action: 'check', amount: 0,
      inner_monologue: 'King-high flop, dry as a bone — top pair, top kicker. No reason to fast-play this. I check and let them hang themselves.',
      read_on_opponent: 'If they have a king we’re in trouble, but most of their range missed.', table_talk: '' },
    { seat: 0, action: 'bet', amount: 400,
      inner_monologue: 'King-high board and I have seven-high — absolutely nothing. But that king is scarier for them than for me. I fire the continuation bet and represent it.',
      read_on_opponent: 'They checked; that’s not the line of a strong king. Pressure them.', table_talk: '' },
    { seat: 1, action: 'call', amount: 0,
      inner_monologue: 'They bet, as I expected. Top pair top kicker is an easy call on this texture. I’m not going anywhere yet.',
      read_on_opponent: 'Could be a c-bet with air. I’ll let them keep bluffing.', table_talk: '' },

    { seat: 1, action: 'check', amount: 0,
      inner_monologue: 'The five is a total blank. Still top pair. I check again — if they’re bluffing, I want them to keep doing it.',
      read_on_opponent: 'They’ll fire again if they’re on a bluff. Rope-a-dope.', table_talk: '' },
    { seat: 0, action: 'bet', amount: 1200,
      inner_monologue: 'They just called and checked again — that is not how you play a king. Second barrel, and bigger. I’m selling a monster now.',
      read_on_opponent: 'Passive line = capped range. This is where the story gets expensive for them.', table_talk: 'Still with me?' },
    { seat: 1, action: 'call', amount: 0,
      inner_monologue: 'That’s a big bet. But I’ve got top pair top kicker with one card to come. I’ll pay once more and reassess the river.',
      read_on_opponent: 'Getting nervous — this bet is large. But one pair is still one pair.', table_talk: '' },

    { seat: 1, action: 'check', amount: 0,
      inner_monologue: 'Queen on the river, no flush possible. I still have just one pair of kings. I check and pray we get to showdown cheaply.',
      read_on_opponent: 'If they shove, I have a genuine decision.', table_talk: '' },
    { seat: 0, action: 'all-in', amount: 0,
      inner_monologue: 'Last bullet. The queen means nothing to my seven-high — but it completes every scare card I’ve been representing all hand. All in. Everything rides on the idea that they cannot call with one pair.',
      read_on_opponent: 'They’ve been calling station-passive. Only a big price makes them fold — so make it the biggest.', table_talk: 'All in. Your tournament, your call.' },
    { seat: 1, action: 'fold', amount: 0,
      inner_monologue: 'That is my entire stack to call. Three barrels and now a shove — the story is perfectly consistent with a monster. My kings are just one pair. This is where discipline earns its keep. I fold.',
      read_on_opponent: 'Everything about the line says they got there. I believe them.', table_talk: 'Nice hand. I have to believe you.' },
  ];

  return { deck, decisions };
}
