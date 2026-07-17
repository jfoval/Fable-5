// cards.js — card representation shared by the engine, evaluator, and UI.
//
// A card is an integer 0..51.  rank = 2..14 (14 = Ace), suit = 0..3.
//   card = (rank - 2) * 4 + suit
// This keeps cards cheap to store, compare, and pass across module boundaries
// (Node tests and the browser both import this file unchanged).

export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
export const SUITS = [0, 1, 2, 3]; // clubs, diamonds, hearts, spades

export const RANK_CHARS = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};
export const RANK_NAMES = {
  2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven',
  8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace',
};
// Suit order chosen so display glyphs read clubs/diamonds/hearts/spades.
export const SUIT_CHARS = ['c', 'd', 'h', 's'];
export const SUIT_GLYPHS = ['♣', '♦', '♥', '♠'];
export const SUIT_IS_RED = [false, true, true, false];

export const rankOf = (card) => (card >> 2) + 2;
export const suitOf = (card) => card & 3;

export function makeCard(rank, suit) {
  return (rank - 2) * 4 + suit;
}

// "As", "Kh", "Td", "2c" -> card int
export function parseCard(str) {
  const s = str.trim();
  const rc = s.slice(0, s.length - 1).toUpperCase();
  const sc = s[s.length - 1].toLowerCase();
  const rank = Object.entries(RANK_CHARS).find(([, ch]) => ch === rc);
  const suit = SUIT_CHARS.indexOf(sc);
  if (!rank || suit < 0) throw new Error(`bad card: ${str}`);
  return makeCard(Number(rank[0]), suit);
}

// card int -> "As"
export function cardCode(card) {
  return RANK_CHARS[rankOf(card)] + SUIT_CHARS[suitOf(card)];
}

export function cardName(card) {
  return `${RANK_NAMES[rankOf(card)]} of ${['Clubs', 'Diamonds', 'Hearts', 'Spades'][suitOf(card)]}`;
}

// A fresh ordered 52-card deck.
export function freshDeck() {
  const deck = [];
  for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) deck.push(makeCard(r, s));
  return deck;
}

// Deterministic shuffle when given a seeded rng (mulberry32); else Math.random.
export function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Small seedable PRNG so tests / scripted hands are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
