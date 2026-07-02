// agent.js — turns a game situation into one Claude Fable 5 decision.
//
// INFORMATION HYGIENE (the integrity of the whole demo):
//   The payload built here contains the acting player's OWN hole cards, the
//   public board, pots, stacks, the public betting history, and the opponent's
//   spoken table talk — and nothing else about the opponent. The opponent's
//   hole cards and inner monologue/read are NEVER placed in the payload, not
//   even from past hands. Every payload is handed to the audit log, which
//   independently proves those secrets never appear.

import { cardCode } from './cards.js';

export const DECISION_KEYS = ['inner_monologue', 'read_on_opponent', 'action', 'amount', 'table_talk'];

// ---- Build the redacted view the agent is allowed to see -------------------
export function buildView({ hand, match, seat, persona, opponentTalk = [], recentResults = [] }) {
  const me = hand.players[seat];
  const opp = hand.players[1 - seat];
  const legal = hand.legalActions();

  // Public betting history of THIS hand (actions + amounts only — no cards).
  const handActions = hand.log.map((r) => ({
    street: r.street,
    who: r.player === seat ? 'you' : 'opponent',
    action: r.action,
    amount: r.amount,
    to: r.raiseTo,
  }));

  // Public history of the match so far: results and how each prior hand ended,
  // never the opponent's cards.
  const matchHistory = match.history.map((hRec) => ({
    hand: hRec.handNumber,
    board: hRec.board,
    endedBy: hRec.result?.type,
    youWon: hRec.result?.winners?.includes(seat) ?? false,
    yourNet: hRec.result?.netByPlayer?.[seat] ?? 0,
    // Only YOUR cards from past hands are echoed back; the opponent's stay hidden.
    yourCards: hRec.holeCards?.[seat] ?? null,
  }));

  return {
    persona: { name: persona.name, style: persona.tag },
    seat,
    blinds: hand.blinds,
    street: hand.street,
    board: hand.board.map(cardCode),
    your_hole_cards: me.hole.map(cardCode),
    pot: hand.pot,
    your_stack: me.stack,
    opponent_stack: opp.stack,
    your_chips_in_pot_this_street: me.committedStreet,
    to_call: legal ? legal.callAmount : 0,
    you_are_button: me.isButton,
    legal_actions: describeLegal(legal),
    hand_action_history: handActions,
    opponent_table_talk: opponentTalk.slice(-6),
    match_history: matchHistory,
    your_recent_results: recentResults.slice(-4),
  };
}

function describeLegal(legal) {
  if (!legal) return [];
  const out = [];
  if (legal.canFold) out.push('fold');
  if (legal.canCheck) out.push('check');
  if (legal.canCall) out.push(`call (${legal.callAmount})`);
  if (legal.canBet) out.push(`bet (min ${legal.minBet}, max/all-in ${legal.maxRaiseTo})`);
  if (legal.canRaise) out.push(`raise (min to ${legal.minRaiseTo}, max/all-in ${legal.maxRaiseTo})`);
  return out;
}

// ---- Build the system + user messages --------------------------------------
export function buildMessages({ view, persona, tilt }) {
  const system =
    `You are "${persona.name}", ${persona.tag}, playing heads-up no-limit Texas Hold'em on a televised final. ` +
    `${persona.system} ${persona.voice}\n\n` +
    'You will be given the current situation as JSON. It contains ONLY what a real player at the table can ' +
    'know: your own hole cards, the community board, the pot and stacks, the public betting history, and ' +
    "your opponent's spoken table talk. You are NEVER told your opponent's hole cards or thoughts — read them " +
    'from their betting and their talk, like a real player.\n\n' +
    'Respond with STRICT JSON and nothing else — no markdown, no code fences, no prose outside the object:\n' +
    '{\n' +
    '  "inner_monologue": "2-4 sentences of genuine strategic thinking in your own voice",\n' +
    '  "read_on_opponent": "one short line on what you think they have and why",\n' +
    '  "action": "fold | check | call | bet | raise | all-in",\n' +
    '  "amount": <integer total chips to make it THIS street for bet/raise; 0 otherwise>,\n' +
    '  "table_talk": "optional short line you say out loud, or empty string"\n' +
    '}\n\n' +
    'Rules: choose only from the legal actions provided. For a bet or raise, "amount" is the TOTAL number of ' +
    'chips your wager reaches on this street (a raise-to), between the stated minimum and your all-in maximum. ' +
    'Your inner_monologue must reference the ACTUAL cards, board, and betting in the data — a made hand should ' +
    'read completely differently from a bluff. Stay in character.' +
    (tilt ? `\n\nEMOTIONAL STATE: ${tilt}` : '');

  const user =
    'Here is the current situation. Make your decision and return only the JSON object.\n\n' +
    JSON.stringify(view, null, 2);

  return {
    system,
    messages: [{ role: 'user', content: user }],
  };
}

// ---- Parse & validate the model's reply ------------------------------------
export function parseDecision(text) {
  if (typeof text !== 'string') throw new Error('no text');
  // Tolerate stray prose / code fences: grab the first balanced {...} object.
  const obj = extractJsonObject(text);
  if (!obj) throw new Error('no JSON object found in reply');
  const action = String(obj.action || '').toLowerCase().trim();
  const valid = ['fold', 'check', 'call', 'bet', 'raise', 'all-in', 'allin'];
  if (!valid.includes(action)) throw new Error(`invalid action "${obj.action}"`);
  let amount = Number(obj.amount);
  if (!Number.isFinite(amount)) amount = 0;
  return {
    inner_monologue: String(obj.inner_monologue || '').trim(),
    read_on_opponent: String(obj.read_on_opponent || '').trim(),
    action: action === 'allin' ? 'all-in' : action,
    amount: Math.max(0, Math.round(amount)),
    table_talk: String(obj.table_talk || '').trim(),
  };
}

function extractJsonObject(text) {
  // Strip common code fences first.
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

// ---- The full decision loop: call, parse, validate, retry, fall back -------
// deps: { call(system, messages) -> Promise<{text}|{offline}|{error}>,
//         offlineBrain(context) -> decision,
//         audit(record) }
export async function decide(context, deps) {
  const { hand, seat, persona, opponentSecrets, tilt } = context;
  const view = buildView(context);
  const { system, messages } = buildMessages({ view, persona, tilt });

  // Hand the exact outgoing payload to the audit log BEFORE anything else.
  deps.audit?.({
    handNumber: context.match.handNumber,
    seat,
    persona: persona.name,
    street: hand.street,
    system,
    view,
    messages,
    secrets: opponentSecrets, // { holeCards:[...], texts:[...] } for the auditor
  });

  const legal = hand.legalActions();

  // No key / server offline / transport error -> deterministic offline brain.
  const runOffline = () => {
    const d = deps.offlineBrain(context, view, legal);
    return { ...d, source: 'offline' };
  };

  let convo = messages;
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let resp;
    try {
      resp = await deps.call(system, convo);
    } catch (err) {
      lastErr = err;
      return runOffline();
    }
    if (!resp || resp.offline) return runOffline();
    if (resp.error) { lastErr = new Error(resp.error); return runOffline(); }

    try {
      const decision = parseDecision(resp.text);
      // Validate legality by dry-running against the engine rules.
      validateLegal(decision, legal);
      return { ...decision, source: 'api', raw: resp.text };
    } catch (err) {
      lastErr = err;
      // One retry with the error explained, per spec.
      if (attempt === 0) {
        convo = [
          ...messages,
          { role: 'assistant', content: resp.text || '' },
          {
            role: 'user',
            content:
              `That response was invalid: ${err.message}. ` +
              'Reply again with ONLY the strict JSON object and a legal action from the list.',
          },
        ];
        deps.audit?.({
          handNumber: context.match.handNumber, seat, persona: persona.name,
          street: hand.street, system, view, messages: convo, secrets: opponentSecrets, retry: true,
        });
      }
    }
  }

  // Two strikes -> never crash: default to check, else fold.
  const fallback = legal && legal.canCheck ? { action: 'check', amount: 0 } : { action: 'fold', amount: 0 };
  return {
    inner_monologue: `(No readable reply — defaulting to ${fallback.action}.)`,
    read_on_opponent: '',
    action: fallback.action,
    amount: 0,
    table_talk: '',
    source: 'default',
    error: lastErr ? String(lastErr.message || lastErr) : 'unparseable',
  };
}

function validateLegal(decision, legal) {
  if (!legal) throw new Error('no legal actions (not your turn)');
  const a = decision.action;
  if (a === 'fold') { if (!legal.canFold && !legal.canCheck) throw new Error('cannot fold'); return; }
  if (a === 'check') { if (!legal.canCheck) throw new Error('cannot check facing a bet'); return; }
  if (a === 'call') { if (!legal.canCall && !legal.canCheck) throw new Error('nothing to call'); return; }
  if (a === 'all-in') { if (!(legal.canBet || legal.canRaise || legal.canCall)) throw new Error('cannot move all-in'); return; }
  if (a === 'bet' || a === 'raise') {
    if (!(legal.canBet || legal.canRaise)) throw new Error('cannot bet/raise here');
    const target = decision.amount;
    const isShove = target >= legal.maxRaiseTo;
    if (!isShove && target < legal.minRaiseTo) {
      throw new Error(`amount ${target} is below the minimum ${legal.minRaiseTo} (or go all-in to ${legal.maxRaiseTo})`);
    }
    return;
  }
  throw new Error(`unknown action ${a}`);
}
