// engine.js — heads-up no-limit Texas Hold'em, implemented to tournament rules.
//
//   Hand   — one hand's betting state machine (blinds, streets, min-raise,
//            all-ins, side pots, showdown, kicker-correct awarding).
//   Match  — the tournament: 100bb stacks, alternating button, blinds that
//            escalate every 8 hands, play until one player is felted.
//
// The engine is a pure state machine driven from outside: the caller asks
// `legalActions()`, gets a decision from an agent, and calls `apply()`.  It
// never calls the network and never touches the DOM, so it runs identically in
// the browser and in the headless test harness.

import { evaluate } from './evaluator.js';
import { cardCode } from './cards.js';

export const STREETS = ['preflop', 'flop', 'turn', 'river'];

// -------------------------------------------------------------------------
// One hand
// -------------------------------------------------------------------------
export class Hand {
  // stacks: [s0, s1]  (chips each player brings to the hand)
  // button: index posting the small blind (button acts first preflop, HU rule)
  // blinds: { sb, bb }
  // deck:   pre-shuffled array of card ints (we deal off the front)
  constructor({ stacks, button, blinds, deck, names = ['P0', 'P1'] }) {
    this.blinds = blinds;
    this.button = button;
    this.deck = deck.slice();
    this.names = names;
    this.board = [];
    this.street = 'preflop';
    this.log = []; // ordered action records for replay / history
    this.complete = false;
    this.result = null;

    const bbIndex = 1 - button;
    this.players = [0, 1].map((i) => ({
      index: i,
      name: names[i],
      startStack: stacks[i],
      stack: stacks[i],
      hole: [],
      committedStreet: 0, // chips in this street's pot
      committedTotal: 0, // chips in the whole hand
      folded: false,
      allIn: false,
      hasActed: false,
      isButton: i === button,
    }));

    // Deal two hole cards each, alternating starting with the small blind.
    for (let round = 0; round < 2; round++) {
      for (const idx of [button, bbIndex]) {
        this.players[idx].hole.push(this.deck.shift());
      }
    }

    // Post blinds.
    this._commit(this.players[button], Math.min(blinds.sb, this.players[button].stack), 'sb');
    this._commit(this.players[bbIndex], Math.min(blinds.bb, this.players[bbIndex].stack), 'bb');

    // Preflop betting state.
    this.betToMatch = Math.max(...this.players.map((p) => p.committedStreet));
    this.lastRaiseSize = blinds.bb; // a full raise must add at least a big blind
    this.lastAggressionWasFull = true; // the big blind counts as a full "bet"
    // Blinds are forced, not voluntary — nobody has "acted" yet.
    this.players.forEach((p) => { p.hasActed = false; });

    this.toAct = button; // small blind acts first preflop (heads-up)
    this._progress(true);
  }

  _commit(p, amount, _tag) {
    const a = Math.min(amount, p.stack);
    p.stack -= a;
    p.committedStreet += a;
    p.committedTotal += a;
    if (p.stack === 0) p.allIn = true;
    return a;
  }

  get pot() {
    return this.players.reduce((s, p) => s + p.committedTotal, 0);
  }

  activePlayers() { return this.players.filter((p) => !p.folded); }

  // What the player to act may legally do right now.
  legalActions() {
    if (this.complete || this.toAct == null) return null;
    const p = this.players[this.toAct];
    const callAmount = Math.min(this.betToMatch - p.committedStreet, p.stack);
    const canCheck = this.betToMatch - p.committedStreet <= 0;
    const maxRaiseTo = p.committedStreet + p.stack; // shove target (total this street)
    // A raise is available if the player has chips beyond the call AND either the
    // action is open (no bet to them) or the last aggression was a full raise.
    const facingBet = this.betToMatch - p.committedStreet > 0;
    const raiseAllowed =
      maxRaiseTo > this.betToMatch && (!facingBet || this.lastAggressionWasFull);
    const minRaiseTo = Math.min(this.betToMatch + this.lastRaiseSize, maxRaiseTo);
    return {
      toAct: this.toAct,
      canFold: facingBet, // folding when you could check is legal but pointless; we allow only when facing a bet
      canCheck,
      canCall: facingBet,
      callAmount,
      canBet: raiseAllowed && !facingBet,
      canRaise: raiseAllowed && facingBet,
      minRaiseTo,
      maxRaiseTo,
      minBet: Math.min(this.betToMatch + this.lastRaiseSize, maxRaiseTo),
    };
  }

  // Apply an action. Throws Error(with a human message) on an illegal action so
  // the caller can retry the agent with the explanation. Never mutates on error.
  apply(action, amount) {
    if (this.complete) throw new Error('hand is already complete');
    const legal = this.legalActions();
    if (!legal) throw new Error('no player to act');
    const p = this.players[this.toAct];
    const a = String(action || '').toLowerCase();

    if (a === 'fold') {
      // Folding when you could check for free is legal but we treat a "fold"
      // with no bet as a check to avoid gifting the pot on a parse quirk.
      if (!legal.canFold) return this.apply('check');
      p.folded = true;
      p.hasActed = true;
      this._record(p, 'fold', 0);
      this._advanceTurn();
      return this.log[this.log.length - 1];
    }

    if (a === 'check') {
      if (!legal.canCheck) throw new Error(`cannot check facing a bet of ${legal.callAmount}; must call, raise, or fold`);
      p.hasActed = true;
      this._record(p, 'check', 0);
      this._advanceTurn();
      return this.log[this.log.length - 1];
    }

    if (a === 'call') {
      if (!legal.canCall) return this.apply('check'); // nothing to call -> check
      const paid = this._commit(p, legal.callAmount, 'call');
      p.hasActed = true;
      this._record(p, 'call', paid);
      this._advanceTurn();
      return this.log[this.log.length - 1];
    }

    if (a === 'bet' || a === 'raise' || a === 'allin' || a === 'all-in' || a === 'all_in') {
      let target;
      if (a === 'allin' || a === 'all-in' || a === 'all_in') {
        target = legal.maxRaiseTo;
      } else {
        target = Math.round(Number(amount));
        if (!Number.isFinite(target)) throw new Error('bet/raise requires a numeric amount (total chips to make it this street)');
      }
      // Clamp a too-big target down to a shove.
      if (target > legal.maxRaiseTo) target = legal.maxRaiseTo;

      // If the "raise" cannot even beat the current bet, it is really a call
      // (a short all-in call), unless the player can actually check.
      if (target <= this.betToMatch) {
        if (legal.canCall) return this.apply('call');
        return this.apply('check');
      }

      if (!(legal.canBet || legal.canRaise)) {
        throw new Error('you may not raise here (facing a sub-minimum all-in you may only call or fold)');
      }

      const isShove = target >= legal.maxRaiseTo;
      // Enforce the minimum legal raise unless the player is moving all-in.
      if (!isShove && target < legal.minRaiseTo) {
        throw new Error(`raise too small: must make it at least ${legal.minRaiseTo} (or move all-in for ${legal.maxRaiseTo})`);
      }

      const increment = target - this.betToMatch;
      const add = target - p.committedStreet;
      this._commit(p, add, 'raise');
      p.hasActed = true;

      const fullRaise = increment >= this.lastRaiseSize;
      this.betToMatch = target;
      if (fullRaise) {
        this.lastRaiseSize = increment;
        this.lastAggressionWasFull = true;
      } else {
        // sub-minimum all-in: does not reopen betting for a player who has acted.
        this.lastAggressionWasFull = false;
      }
      // Any aggression forces the opponent to act again.
      this.players.forEach((q) => { if (q !== p && !q.folded && !q.allIn) q.hasActed = false; });

      this._record(p, a === 'bet' ? 'bet' : 'raise', add, target);
      this._advanceTurn();
      return this.log[this.log.length - 1];
    }

    throw new Error(`unknown action "${action}"`);
  }

  _record(p, action, amount, raiseTo) {
    this.log.push({
      street: this.street,
      player: p.index,
      name: p.name,
      action,
      amount,
      raiseTo: raiseTo ?? null,
      potAfter: this.pot,
      stackAfter: p.stack,
      board: this.board.slice(),
    });
  }

  _advanceTurn() {
    // Tentatively pass the turn to the opponent, then let _progress decide
    // whether the street/hand is actually over.
    this.toAct = 1 - this.toAct;
    this._progress(false);
  }

  _roundComplete() {
    const canAct = this.players.filter((p) => !p.folded && !p.allIn);
    // With fewer than two players able to act, no further betting is possible.
    // The street closes as soon as the lone remaining player (if any) is not
    // still facing an unmatched bet.
    if (canAct.length <= 1) {
      if (canAct.length === 0) return true;
      return canAct[0].committedStreet >= this.betToMatch;
    }
    return canAct.every((p) => p.hasActed && p.committedStreet === this.betToMatch);
  }

  _pickActor(preferred) {
    const order = preferred != null ? [preferred, 1 - preferred] : [this.toAct, 1 - this.toAct];
    for (const idx of order) {
      const p = this.players[idx];
      if (p.folded || p.allIn) continue;
      if (!p.hasActed || p.committedStreet !== this.betToMatch) return idx;
    }
    return null;
  }

  _progress(initial) {
    // Drive the hand forward until it needs a decision or it is complete.
    for (;;) {
      const live = this.activePlayers();
      if (live.length === 1) {
        this._finishByFold(live[0]);
        return;
      }
      if (this._roundComplete()) {
        if (this.street === 'river') { this._showdown(); return; }
        this._dealNextStreet();
        continue; // the new street may also have no one able to act (all-in)
      }
      // Someone still owes action.
      const preferred = initial ? this.toAct : this._streetFirstActor();
      const next = this._pickActor(initial ? this.toAct : null) ?? this._pickActor(preferred);
      if (next == null) {
        // No actor but round not "complete" — safety net, treat as complete.
        if (this.street === 'river') { this._showdown(); return; }
        this._dealNextStreet();
        continue;
      }
      this.toAct = next;
      return;
    }
  }

  _streetFirstActor() {
    // Postflop, the non-button (out of position) acts first.
    return 1 - this.button;
  }

  _dealNextStreet() {
    const nextIdx = STREETS.indexOf(this.street) + 1;
    this.street = STREETS[nextIdx];
    if (this.street === 'flop') this.board.push(this.deck.shift(), this.deck.shift(), this.deck.shift());
    else this.board.push(this.deck.shift());

    this.players.forEach((p) => { p.committedStreet = 0; p.hasActed = false; });
    this.betToMatch = 0;
    this.lastRaiseSize = this.blinds.bb; // minimum bet is one big blind
    this.lastAggressionWasFull = true;
    this.toAct = this._streetFirstActor();
  }

  _finishByFold(winner) {
    const total = this.pot;
    winner.stack += total;
    this.complete = true;
    this.toAct = null;
    this.result = {
      type: 'fold',
      board: this.board.slice(),
      pots: [{ amount: total, winners: [winner.index], eligible: this.players.filter((p) => !p.folded).map((p) => p.index) }],
      payouts: this.players.map((p) => p.stack - p.startStack + p.committedTotal),
      netByPlayer: this.players.map((p) => p.stack - p.startStack),
      showdown: false,
      hands: this.players.map(() => null),
      winners: [winner.index],
    };
  }

  _showdown() {
    // Build (possibly layered) side pots from total contributions.
    const contrib = this.players.map((p) => p.committedTotal);
    const foldedByIdx = this.players.map((p) => p.folded);
    const pots = buildSidePots(contrib, foldedByIdx);

    // Evaluate each live player's best hand.
    const scores = this.players.map((p) =>
      p.folded ? null : evaluate([...p.hole, ...this.board]));

    for (const pot of pots) {
      const contenders = pot.eligible.filter((i) => !this.players[i].folded);
      let bestVal = -1;
      let winners = [];
      for (const i of contenders) {
        const v = scores[i].value;
        if (v > bestVal) { bestVal = v; winners = [i]; }
        else if (v === bestVal) winners.push(i);
      }
      pot.winners = winners;
      // Split, giving any odd chip to the player out of position (acts first).
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      const oddFirst = winners.slice().sort((x, y) => oddChipOrder(x, this.button) - oddChipOrder(y, this.button));
      for (const w of winners) this.players[w].stack += share;
      for (const w of oddFirst) { if (remainder > 0) { this.players[w].stack += 1; remainder--; } }
    }

    this.complete = true;
    this.toAct = null;
    this.result = {
      type: 'showdown',
      board: this.board.slice(),
      pots,
      showdown: true,
      hands: this.players.map((p, i) => (p.folded ? null : { eval: scores[i], cards: p.hole.slice() })),
      netByPlayer: this.players.map((p) => p.stack - p.startStack),
      winners: [...new Set(pots.flatMap((pt) => pt.winners))],
    };
  }

  // ---- views ----------------------------------------------------------------
  // Full spectator view: sees everything.
  spectatorView() {
    return {
      street: this.street,
      board: this.board.map(cardCode),
      pot: this.pot,
      button: this.button,
      blinds: this.blinds,
      toAct: this.toAct,
      players: this.players.map((p) => ({
        index: p.index, name: p.name, stack: p.stack,
        hole: p.hole.map(cardCode), committedStreet: p.committedStreet,
        committedTotal: p.committedTotal, folded: p.folded, allIn: p.allIn,
      })),
    };
  }
}

// Odd-chip goes to the earliest-to-act (out of position) seat: the non-button.
function oddChipOrder(idx, button) {
  return idx === button ? 1 : 0;
}

// Standard layered side-pot construction from each player's total contribution.
// Returns [{ amount, eligible: [indices contributing to this layer & not folded] }].
export function buildSidePots(contribInput, folded) {
  const contrib = contribInput.slice();
  const n = contrib.length;
  const pots = [];
  for (;;) {
    // smallest positive remaining contribution
    let min = Infinity;
    for (let i = 0; i < n; i++) if (contrib[i] > 0 && contrib[i] < min) min = contrib[i];
    if (!Number.isFinite(min)) break;
    let amount = 0;
    const eligible = [];
    for (let i = 0; i < n; i++) {
      if (contrib[i] > 0) {
        amount += min;
        contrib[i] -= min;
        if (!folded[i]) eligible.push(i);
      }
    }
    if (amount > 0) {
      // merge into previous pot if the eligibility set is identical (keeps the
      // pot list tidy for display).
      const prev = pots[pots.length - 1];
      if (prev && sameSet(prev.eligible, eligible)) prev.amount += amount;
      else pots.push({ amount, eligible });
    }
  }
  return pots;
}

function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

// -------------------------------------------------------------------------
// The tournament
// -------------------------------------------------------------------------
export const DEFAULT_BLIND_SCHEDULE = [
  { sb: 50, bb: 100 },
  { sb: 75, bb: 150 },
  { sb: 100, bb: 200 },
  { sb: 150, bb: 300 },
  { sb: 200, bb: 400 },
  { sb: 300, bb: 600 },
  { sb: 400, bb: 800 },
  { sb: 600, bb: 1200 },
  { sb: 1000, bb: 2000 },
  { sb: 1500, bb: 3000 },
  { sb: 2500, bb: 5000 },
  { sb: 4000, bb: 8000 },
];

export class Match {
  constructor({ names, startingStack = 10000, handsPerLevel = 8, schedule = DEFAULT_BLIND_SCHEDULE }) {
    this.names = names;
    this.startingStack = startingStack;
    this.handsPerLevel = handsPerLevel;
    this.schedule = schedule;
    this.stacks = [startingStack, startingStack];
    this.handNumber = 0; // increments as each hand starts
    this.button = 0;
    this.history = []; // completed-hand summaries
    this.over = false;
    this.winner = null;
  }

  currentBlinds() {
    const level = Math.min(Math.floor(this.handNumber / this.handsPerLevel), this.schedule.length - 1);
    return { ...this.schedule[level], level };
  }

  levelForHand(handNumber) {
    return Math.min(Math.floor((handNumber - 1) / this.handsPerLevel), this.schedule.length - 1);
  }

  // Create the next Hand. Caller drives it, then calls finishHand().
  startHand(deck) {
    if (this.over) throw new Error('match is over');
    this.handNumber += 1;
    const blinds = this.currentBlinds();
    return new Hand({
      stacks: [this.stacks[0], this.stacks[1]],
      button: this.button,
      blinds,
      deck,
      names: this.names,
    });
  }

  // Commit a completed hand's result back into the tournament.
  finishHand(hand) {
    this.stacks = hand.players.map((p) => p.stack);
    const summary = {
      handNumber: this.handNumber,
      button: this.button,
      blinds: hand.blinds,
      board: hand.board.map(cardCode),
      holeCards: hand.players.map((p) => p.hole.map(cardCode)),
      log: hand.log,
      result: hand.result,
      stacksAfter: this.stacks.slice(),
    };
    this.history.push(summary);
    // Alternate the button.
    this.button = 1 - this.button;
    // Bust check.
    if (this.stacks[0] <= 0 || this.stacks[1] <= 0) {
      this.over = true;
      this.winner = this.stacks[0] > 0 ? 0 : 1;
    }
    return summary;
  }
}
