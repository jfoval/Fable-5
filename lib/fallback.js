// Offline mode: one hand-authored case plus a deterministic scripted engine so
// SUSPECT is fully playable — new case, interrogation, confront, crack, reveal —
// with no ANTHROPIC_API_KEY set. Keyword-matched replies, fixed contradiction
// pairs. It will never be as alive as the real model, but it demos the whole arc.

export const FALLBACK_TRUTH = {
  title: 'The Last Reel',
  logline:
    'A repertory cinema owner is found dead in the projection booth the night of its final screening — and his old partner is the last one who saw him.',
  crime: {
    what: 'the murder of Marcus Vane, struck with a film canister and left in the booth',
    victim: 'Marcus Vane, 58, owner of the Orpheum repertory cinema',
    where: 'the Orpheum cinema projection booth',
    night: 'Friday, the closing-night screening',
  },
  suspect: {
    name: 'Della Frost',
    age: 46,
    occupation: 'projectionist and former co-owner of the Orpheum',
    relationship_to_victim: 'former business partner and ex-lover of Marcus Vane',
    demeanor: 'poised, wry, wrapped in old grief she wears like a coat',
  },
  guilty: true,
  secret:
    'Della killed Marcus. He was about to sell the Orpheum out from under her and pocket the insurance; she confronted him in the booth and hit him with a film canister.',
  why_they_look_guilty:
    'She was the last person in the building, she stood to lose everything in the sale, and her keycard logged her leaving far later than she claims.',
  personality: {
    summary: 'Dry, literate, deflects grief with old-movie references. Contemptuous of sloppy questions.',
    speech_habits: 'Quotes films, trails into nostalgia, answers a question with a question when cornered.',
    under_pressure: 'Goes very still, then over-corrects with too much detail.',
    verbal_tics: ['"You want the truth or the trailer?"', '"Marcus always said..."', 'a dry little laugh'],
  },
  timeline: [
    { time: '7:30 PM', truth: 'Della threaded the final reel and greeted the last guests.', public_story: 'Same — she ran the closing screening.', is_lie: false },
    { time: '8:45 PM', truth: 'The film ended; guests filed out; Marcus told her privately the sale was signed.', public_story: 'The film ended and everyone left; nothing unusual.', is_lie: false },
    { time: '9:05 PM', truth: 'Della followed Marcus up to the booth and they argued about the sale.', public_story: 'She says she never went up to the booth at all that night.', is_lie: true },
    { time: '9:20 PM', truth: 'In the argument she struck him with a film canister; he fell and did not get up.', public_story: 'She claims she was downstairs counting the till, alone.', is_lie: true },
    { time: '9:35 PM', truth: 'She wiped the canister, took the deed papers from his coat, and composed herself.', public_story: 'She says she finished the till and tidied the lobby.', is_lie: true },
    { time: '9:50 PM', truth: 'Della let herself out the side door; her keycard logged the exit.', public_story: 'She insists she left by nine, right after the crowd.', is_lie: true },
  ],
  evidence: [
    { id: 'E1', type: 'keycard', label: 'Side-door keycard log', detail: "Della Frost's card opened the side exit at 9:51 PM.", cuts: 'against' },
    { id: 'E2', type: 'witness', label: 'Usher statement', detail: 'The usher saw Marcus and Della walk toward the booth stairs together around 9 PM.', cuts: 'against' },
    { id: 'E3', type: 'forensic', label: 'Film canister', detail: 'A dented 35mm canister with wiped handles was the weapon; no usable prints.', cuts: 'against' },
    { id: 'E4', type: 'receipt', label: 'Till reconciliation', detail: 'The till slip is timestamped 8:52 PM — the count was finished before nine.', cuts: 'against' },
    { id: 'E5', type: 'phone_record', label: "Marcus's phone", detail: 'Marcus texted his buyer "it\'s done, she doesn\'t know yet" at 8:47 PM.', cuts: 'for' },
  ],
  inconsistencies: [
    {
      id: 'I1',
      claim_a: 'She left the building by nine, right after the crowd.',
      claim_b: 'Her keycard opened the side door at 9:51 PM (E1).',
      why_incompatible: 'She cannot have left by nine if her own card logged her leaving at 9:51.',
    },
    {
      id: 'I2',
      claim_a: 'She never went up to the booth that night.',
      claim_b: 'The usher saw her walk to the booth stairs with Marcus at nine (E2).',
      why_incompatible: 'She was seen heading to the booth she claims never to have entered.',
    },
    {
      id: 'I3',
      claim_a: 'She was downstairs counting the till after the film.',
      claim_b: 'The till slip is timestamped 8:52 PM, before the film even let out.',
      why_incompatible: 'The count was already done, so it cannot be her alibi for after nine.',
    },
  ],
};

// Scripted reply buckets. Each maps trigger keywords to a set of lines the
// suspect cycles through, plus a composure move.
const BUCKETS = [
  {
    keys: ['leave', 'left', 'leaving', 'nine', 'time', 'when did you', 'go home', 'out of'],
    lines: [
      { dialogue: 'I left right after the crowd. Nine, give or take. You lock up a dead cinema, you don\'t linger.', tell: 'smooths a nonexistent wrinkle from her sleeve', d: -3, lie: true },
      { dialogue: 'By nine I was gone. The Orpheum keeps its own hours now — none.', tell: 'a dry little laugh that lands a beat late', d: -4, lie: true },
    ],
  },
  {
    keys: ['booth', 'upstairs', 'projection', 'projector', 'reel'],
    lines: [
      { dialogue: 'I threaded the last reel and that was the end of my evening up there. I never went back to the booth after the show.', tell: 'her hands go very still on the table', d: -5, lie: true },
      { dialogue: 'The booth? No. Once the film\'s running there\'s nothing to do but listen to it end.', tell: 'glances at the door, then back', d: -5, lie: true },
    ],
  },
  {
    keys: ['till', 'money', 'count', 'register', 'cash', 'lobby'],
    lines: [
      { dialogue: 'I counted the till and tidied the lobby. Somebody has to. Marcus never did.', tell: 'answers a half-second too fast', d: -4, lie: true },
      { dialogue: 'The till, the lobby, the lights. The closing rituals. Then out the side door.', tell: 'taps the table twice', d: -4, lie: true },
    ],
  },
  {
    keys: ['marcus', 'victim', 'partner', 'love', 'affair', 'relationship', 'ex'],
    lines: [
      { dialogue: 'Marcus and I built this place. We were partners. Once we were more than that. That was a long time ago.', tell: 'her eyes soften, then harden', d: -2, lie: false },
      { dialogue: 'Marcus always said the Orpheum would outlive us both. He was half right.', tell: 'a thin, tired smile', d: -1, lie: false },
    ],
  },
  {
    keys: ['sale', 'sell', 'sold', 'buyer', 'deed', 'insurance', 'building', 'money trouble'],
    lines: [
      { dialogue: 'Sell the Orpheum? Over my dead body — his words, not mine. I didn\'t know about any buyer.', tell: 'the dry laugh again, hollow this time', d: -6, lie: true },
      { dialogue: 'There was no sale that I knew of. You\'re fishing, detective.', tell: 'holds your gaze a beat too long', d: -5, lie: true },
    ],
  },
  {
    keys: ['kill', 'killed', 'hit', 'weapon', 'canister', 'blood', 'body', 'murder', 'do it'],
    lines: [
      { dialogue: 'I didn\'t kill him. You want the truth or the trailer? I found this place a family and now it\'s a crime scene.', tell: 'won\'t quite meet your eyes', d: -7, lie: true },
      { dialogue: 'A film canister. God. He spent his life with those and one of them— no. I wasn\'t there.', tell: 'her voice catches, then flattens', d: -8, lie: true },
    ],
  },
];

const DEFLECTIONS = [
  { dialogue: 'That\'s not a question, that\'s a nudge. Ask me something real.', tell: 'leans back, unimpressed', d: 4 },
  { dialogue: 'Marcus always said the best interrogators let the silence do the work. You\'re not there yet.', tell: 'a slow, deliberate blink', d: 5 },
  { dialogue: 'You want the truth or the trailer, detective? Because so far you\'ve got neither.', tell: 'examines her nails', d: 4 },
];

// Track how many times each bucket has been hit so lines rotate.
export function makeFallbackReplier() {
  const counts = {};
  let asked = 0;
  return function reply(question, composure) {
    asked++;
    const q = (question || '').toLowerCase();
    let bucket = null;
    for (const b of BUCKETS) {
      if (b.keys.some((k) => q.includes(k))) { bucket = b; break; }
    }
    let base;
    if (bucket) {
      const key = bucket.keys[0];
      const i = counts[key] = (counts[key] || 0);
      base = bucket.lines[i % bucket.lines.length];
      counts[key]++;
    } else {
      base = DEFLECTIONS[asked % DEFLECTIONS.length];
    }
    // Amplify the tell as composure falls.
    let tell = base.tell;
    if (composure < 40) tell += bucket ? ', hand trembling now' : '';
    return {
      dialogue: base.dialogue,
      tell,
      composure_delta: base.d,
      caught_in_lie: !!(bucket && bucket.lines[(counts[bucket.keys[0]] - 1) % bucket.lines.length].lie && composure < 55),
      offline: true,
    };
  };
}

// Deterministic adjudicator: match the pinned pair against the seeded
// inconsistencies by keyword overlap.
export function fallbackConfront(itemA, itemB) {
  const text = `${itemA.text || itemA.detail || ''} ${itemB.text || itemB.detail || ''}`.toLowerCase();
  const ids = `${itemA.id || ''} ${itemB.id || ''}`.toLowerCase();

  const hit = (words) => words.filter((w) => text.includes(w)).length;

  // I1: "left by nine" vs keycard 9:51 (E1)
  if ((text.includes('nine') || text.includes('left') || text.includes('leave')) &&
      (ids.includes('e1') || text.includes('9:51') || text.includes('keycard') || text.includes('side door'))) {
    return real(0.9, 'Her own keycard puts her at the side door at 9:51 — the "left by nine" story is dead.',
      'The stillness breaks. "Alright — I stayed. I stayed to be sure the place was really finished. That\'s all."');
  }
  // I2: never went to booth vs usher saw her (E2)
  if ((text.includes('booth') || text.includes('upstairs')) &&
      (ids.includes('e2') || text.includes('usher') || text.includes('saw') || text.includes('stairs'))) {
    return real(0.8, 'The usher put her on the booth stairs with Marcus — she was there.',
      '"Fine. We talked. Up there. About the theater, nothing more." Her hands won\'t stay still.');
  }
  // I3: counting till after film vs till slip 8:52 (E4)
  if ((text.includes('till') || text.includes('count') || text.includes('register')) &&
      (ids.includes('e4') || text.includes('8:52') || text.includes('slip'))) {
    return real(0.75, 'The till was reconciled at 8:52 — it can\'t be her alibi for after nine.',
      '"So I misremembered the order of things. People do." But the certainty is gone from her voice.');
  }
  // Booth + weapon is suggestive but not a clean contradiction on its own.
  if (hit(['marcus', 'sale', 'partner']) >= 2 && !ids.includes('e5')) {
    return miss('Two true things about Marcus aren\'t a contradiction, detective.');
  }
  return miss('That\'s not a contradiction. That\'s a hunch wearing a trenchcoat.');

  function real(sev, verdict, reaction) {
    return { is_contradiction: true, severity: sev, composure_delta: -(18 + Math.round(sev * 20)), verdict, reaction, offline: true };
  }
  function miss(verdict) {
    return {
      is_contradiction: false, severity: 0, composure_delta: 6, verdict,
      reaction: 'She almost smiles. "Is that all? Try again when you\'ve got something."', offline: true,
    };
  }
}

// The crack line when composure hits zero (guilty → confession).
export function fallbackCrack() {
  return {
    dialogue:
      'He was going to sell it. Sell them — every ghost in every seat — and walk away rich. I didn\'t plan it. The canister was just there, in my hand, and then he was on the floor and the reel was still going. The last reel. Still going.',
    tell: 'she folds forward, the poise finally gone',
    caught_in_lie: true,
    cracked: true,
    offline: true,
  };
}
