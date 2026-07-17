// orchestrator.js — plays a whole match: drives the engine, asks each agent for
// one decision per turn, records the audit trail, accrues the stats that tell
// the story, and fires hooks so the UI can animate. Runs headless too (hooks
// default to no-ops), which is how the same code path is tested against the API.

import { Hand } from './engine.js';
import { decide } from './agent.js';
import { offlineBrain, scriptedClassicHand } from './brain.js';
import { evaluate } from './evaluator.js';
import { cardCode, freshDeck, shuffle, rankOf } from './cards.js';

const NOOP = async () => {};

export class MatchRunner {
  constructor({ match, personas, audit, call, hooks = {}, rng = Math.random }) {
    this.match = match;
    this.personas = personas; // [persona0, persona1]
    this.audit = audit;
    this.call = call; // async (system, messages) => {text}|{offline}|{error}
    this.rng = rng;
    this.hooks = {
      onHandStart: NOOP, onDecisionStart: NOOP, onDecision: NOOP,
      onStreet: NOOP, onShowdown: NOOP, onHandEnd: NOOP, onCommentary: NOOP, ...hooks,
    };

    this.talkLog = []; // { seat, name, text, handNumber }
    this.agentTexts = [[], []]; // every private monologue/read string, per seat (audit secrets)
    this.recentResults = [[], []]; // { handNumber, net } per seat
    this.transcript = []; // rich per-decision records across the whole match (for replay)
    this.stats = [freshStats(), freshStats()];
    this.useScriptedFirstHand = false;
    this._scripted = null;
  }

  enableScriptedOpening() {
    this.useScriptedFirstHand = true;
  }

  async playHand() {
    if (this.match.over) return null;
    const scripted = this.useScriptedFirstHand && this.match.handNumber === 0 ? scriptedClassicHand() : null;
    const deck = scripted ? scripted.deck.slice() : shuffle(freshDeck(), this.rng);
    const scriptQueue = scripted ? scripted.decisions.slice() : null;

    const hand = this.match.startHand(deck);
    const handNumber = this.match.handNumber;
    const blinds = hand.blinds;

    await this.hooks.onHandStart({
      handNumber, blinds, button: hand.button,
      personas: this.personas.map((p) => p.name),
      stacks: hand.players.map((p) => p.stack),
      holeCards: hand.players.map((p) => p.hole.map(cardCode)),
    });

    let lastStreet = hand.street;
    let potWinnableByBluffer = null; // { seat, atLog } for verdict detection

    while (!hand.complete && hand.toAct != null) {
      const seat = hand.toAct;
      const persona = this.personas[seat];
      const opp = hand.players[1 - seat];

      if (hand.street !== lastStreet) {
        lastStreet = hand.street;
        await this.hooks.onStreet({ street: hand.street, board: hand.board.map(cardCode), pot: hand.pot });
      }

      await this.hooks.onDecisionStart({ seat, persona: persona.name, street: hand.street });

      // Build the context. opponentSecrets is what the audit proves absent.
      const context = {
        hand, match: this.match, seat, persona,
        opponentTalk: this.talkLog.filter((t) => t.seat !== seat).map((t) => `${t.name}: "${t.text}"`),
        recentResults: this.recentResults[seat],
        opponentSecrets: {
          holeCards: opp.hole.map(cardCode),
          texts: this.agentTexts[1 - seat].slice(),
        },
        tilt: this._tiltNote(seat),
      };

      const legalSnapshot = hand.legalActions();
      const potBefore = hand.pot;

      // Get the decision: from the script (offline demo) or from an agent.
      let decision;
      if (scriptQueue && scriptQueue.length && scriptQueue[0].seat === seat) {
        decision = { ...scriptQueue.shift(), source: 'scripted' };
        // audit the scripted turn too, for a consistent ledger
        this.audit?.add?.({
          handNumber, seat, persona: persona.name, street: hand.street,
          system: '(scripted offline hand — no API payload)',
          view: { your_hole_cards: hand.players[seat].hole.map(cardCode), board: hand.board.map(cardCode) },
          messages: [], secrets: context.opponentSecrets,
        });
      } else {
        decision = await decide(context, {
          call: this.call,
          offlineBrain,
          audit: (rec) => this.audit?.add?.(rec),
        });
      }

      // Record the private texts as secrets the OPPONENT must never see.
      this.agentTexts[seat].push(decision.inner_monologue, decision.read_on_opponent);

      // Is this a bluff? (spectator vantage: we know the real cards)
      const isBluff = this._isBluff(hand, seat, decision);

      // Apply to the engine (already validated; guard anyway).
      let applied;
      try {
        applied = hand.apply(decision.action, decision.amount);
      } catch (e) {
        // Should not happen (decide() validated), but never crash a hand.
        applied = hand.legalActions()?.canCheck ? hand.apply('check') : hand.apply('fold');
        decision._engineError = String(e.message || e);
      }

      // Table talk.
      if (decision.table_talk) {
        this.talkLog.push({ seat, name: persona.name, text: decision.table_talk, handNumber });
      }

      // Stats.
      this._accrueDecisionStats(seat, decision, isBluff);
      if (isBluff && (decision.action === 'bet' || decision.action === 'raise' || decision.action === 'all-in')) {
        potWinnableByBluffer = { seat, pot: hand.pot };
      }

      const record = {
        handNumber, seat, persona: persona.name, street: applied?.street || hand.street,
        decision, applied, potBefore, potAfter: hand.pot, isBluff,
        board: hand.board.map(cardCode),
        holeCards: hand.players[seat].hole.map(cardCode),
        source: decision.source,
      };
      this.transcript.push(record);

      await this.hooks.onDecision({
        ...record,
        stacks: hand.players.map((p) => p.stack),
        committed: hand.players.map((p) => p.committedStreet),
        pot: hand.pot,
        toActNext: hand.toAct,
        allIn: hand.players.some((p) => p.allIn),
        bothAllIn: hand.players.filter((p) => !p.folded).every((p) => p.allIn),
      });
    }

    // Hand finished — resolve results, stats, verdict.
    const result = hand.result;
    if (result.showdown) {
      await this.hooks.onShowdown({
        board: hand.board.map(cardCode),
        hands: hand.players.map((p, i) => ({
          seat: i, name: this.personas[i].name, cards: p.hole.map(cardCode),
          eval: result.hands[i]?.eval || null, folded: p.folded,
        })),
        winners: result.winners,
        pots: result.pots,
      });
    }

    const summary = this.match.finishHand(hand);
    this._accrueHandStats(hand, result, potWinnableByBluffer);
    const verdict = this._verdict(hand, result, potWinnableByBluffer);

    for (let s = 0; s < 2; s++) {
      this.recentResults[s].push({ handNumber, net: result.netByPlayer[s] });
    }

    const handOutcome = {
      ...summary, verdict, potWinnableByBluffer,
      biggestPot: Math.max(...hand.players.map(() => hand.pot)),
    };
    await this.hooks.onHandEnd(handOutcome);
    return handOutcome;
  }

  // ---- helpers --------------------------------------------------------------
  _tiltNote(seat) {
    const recent = this.recentResults[seat];
    if (!recent.length) return '';
    const last = recent[recent.length - 1];
    const bb = this.match.currentBlinds().bb;
    if (last.net <= -bb * 25) {
      return `You just lost a big pot (${Math.abs(last.net)} chips). That one stings — you are allowed to let the frustration color your play if it fits who you are.`;
    }
    if (last.net >= bb * 25) {
      return `You just dragged a big pot (+${last.net} chips). You are running hot and feeling it.`;
    }
    return '';
  }

  _isBluff(hand, seat, decision) {
    const aggressive = ['bet', 'raise', 'all-in'].includes(decision.action);
    if (!aggressive) return false;
    if (hand.board.length < 3) return false; // keep preflop out of bluff stats
    const me = hand.players[seat];
    const holeRanks = me.hole.map(rankOf);
    const boardRanks = hand.board.map(rankOf);
    const pocketPair = holeRanks[0] === holeRanks[1];
    const pairsBoard = holeRanks.some((r) => boardRanks.includes(r));
    const ev = evaluate([...me.hole, ...hand.board]);
    const madeHand = ev.category >= 2; // two pair or better uses the hole cards
    // A bluff is firing aggression when the player's OWN cards make no real hand:
    // not a pocket pair, not paired with the board, nothing two-pair-or-better.
    // (This correctly ignores a high card that comes purely from the board.)
    return !(pocketPair || pairsBoard || madeHand);
  }

  _accrueDecisionStats(seat, decision, isBluff) {
    const s = this.stats[seat];
    s.decisions++;
    if (['bet', 'raise', 'all-in'].includes(decision.action)) s.aggressiveActions++;
    if (isBluff) s.bluffsAttempted++;
    if (decision.source === 'default') s.defaultedActions++;
  }

  _accrueHandStats(hand, result, bluffInfo) {
    const pot = hand.pot;
    for (const w of result.winners) {
      this.stats[w].handsWon++;
      if (pot > this.stats[w].biggestPot) this.stats[w].biggestPot = pot;
    }
    // A bluff "worked" if the aggressor won the hand without a showdown, or won
    // at showdown while behind on made-hand value having fired as a bluff.
    if (bluffInfo && result.winners.includes(bluffInfo.seat)) {
      if (!result.showdown) this.stats[bluffInfo.seat].bluffsWorked++;
      else {
        // won a showdown after bluffing (rare) — count it as worked too
        this.stats[bluffInfo.seat].bluffsWorked++;
      }
    }
    // Track worst call / biggest bluff for the end screen.
    if (bluffInfo && result.winners.includes(bluffInfo.seat) && !result.showdown) {
      if (pot > (this.biggestBluff?.pot || 0)) {
        this.biggestBluff = { seat: bluffInfo.seat, pot, handNumber: this.match.handNumber };
      }
    }
  }

  _verdict(hand, result, bluffInfo) {
    if (result.type === 'fold') {
      if (bluffInfo && result.winners.includes(bluffInfo.seat)) {
        return { title: 'STONE COLD BLUFF: IT WORKED', kind: 'bluff-won', seat: bluffInfo.seat };
      }
      const winner = result.winners[0];
      return { title: 'THEY FOLDED', kind: 'fold', seat: winner };
    }
    // showdown
    if (bluffInfo && !result.winners.includes(bluffInfo.seat)) {
      return { title: 'THE READ WAS RIGHT', kind: 'bluff-caught', seat: result.winners[0] };
    }
    if (result.winners.length > 1) return { title: 'SPLIT POT', kind: 'chop', seat: -1 };
    const w = result.winners[0];
    const name = result.hands[w]?.eval?.name || 'the best hand';
    return { title: `SHOWDOWN: ${name.toUpperCase()}`, kind: 'showdown', seat: w };
  }
}

function freshStats() {
  return {
    handsWon: 0, decisions: 0, aggressiveActions: 0,
    bluffsAttempted: 0, bluffsWorked: 0, biggestPot: 0, defaultedActions: 0,
  };
}
