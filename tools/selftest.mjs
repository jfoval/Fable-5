// Deterministic self-test — no API key required. Exercises the JSON plumbing,
// the locked-truth schema, and the full offline interrogation arc (ask →
// statements → confront hit/miss → crack). Run: npm run selftest.

import assert from 'node:assert';
import { extractJSON } from '../lib/anthropic.js';
import { caseSystem, replySystem, confrontSystem, replyMessages } from '../lib/prompts.js';
import {
  FALLBACK_TRUTH, makeFallbackReplier, fallbackConfront, fallbackCrack,
} from '../lib/fallback.js';

let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log(`  ✓ ${name}`); passed++; };

console.log('\nSUSPECT — self test\n');

// --- 1. JSON extraction is robust to fences and prose ---
console.log('JSON extraction');
ok('parses fenced json', extractJSON('```json\n{"a":1}\n```').a === 1);
ok('parses prose-wrapped json', extractJSON('Sure! {"dialogue":"hi","n":2} hope that helps').n === 2);
ok('parses nested braces + strings', extractJSON('{"t":"a } b","x":{"y":3}}').x.y === 3);
ok('parses arrays', Array.isArray(extractJSON('noise [1,2,3] tail')));
assert.throws(() => extractJSON('no json here'), 'throws on no json');
console.log('  ✓ throws on missing json'); passed++;

// --- 2. Truth file schema is complete and internally sane ---
console.log('\nLocked truth file');
const T = FALLBACK_TRUTH;
ok('has title + crime + suspect', T.title && T.crime?.victim && T.suspect?.name);
ok('guilt is boolean', typeof T.guilty === 'boolean');
ok('timeline 6-8 rows', T.timeline.length >= 6 && T.timeline.length <= 8);
ok('has lie rows and truth rows', T.timeline.some((r) => r.is_lie) && T.timeline.some((r) => !r.is_lie));
ok('5-6 evidence items', T.evidence.length >= 5 && T.evidence.length <= 6);
ok('evidence ids unique', new Set(T.evidence.map((e) => e.id)).size === T.evidence.length);
ok('2-3 inconsistencies', T.inconsistencies.length >= 2 && T.inconsistencies.length <= 3);

// --- 3. Prompt builders embed the truth and stay strict ---
console.log('\nPrompt builders');
ok('case system asks for strict JSON', /strict.*JSON/i.test(caseSystem('cold')));
ok('reply system embeds the locked truth', replySystem(T, 'cold').includes(T.secret));
ok('reply system forbids leaking secret', /Never volunteer your secret/i.test(replySystem(T, 'nervous')));
ok('confront system embeds truth + demands strict JSON', confrontSystem(T).includes('is_contradiction'));
const msgs = replyMessages([{ role: 'detective', text: 'where were you?' }], 100);
ok('replyMessages alternates from user', msgs[msgs.length - 1].role === 'user');

// --- 4. Offline interrogation: the suspect protects the secret ---
console.log('\nOffline interrogation arc');
const reply = makeFallbackReplier();
let composure = 100;
const step = (q) => { const r = reply(q, composure); composure = Math.max(0, Math.min(100, composure + r.composure_delta)); return r; };

const r1 = step('Where were you at nine?');
ok('answers alibi question', /nine|left/i.test(r1.dialogue));
ok('does not confess unprompted', !/i killed|i did it/i.test(r1.dialogue.toLowerCase()));
const r2 = step('Did you go up to the booth?');
ok('lies about the booth', /booth|never/i.test(r2.dialogue) && r2.composure_delta < 0);
const weak = step('Nice weather?');
ok('weak question lets her recover', weak.composure_delta > 0);

// suspect never blurts the crime across many probing turns
const probes = ['tell me about the sale', 'you needed the money', 'you were the last one there',
  'the usher saw you', 'why did you wipe the canister', 'you loved him once'];
let leaked = false;
for (const p of probes) { const r = step(p); if (/^i killed him\b/i.test(r.dialogue)) leaked = true; }
ok('never blurts the confession under pressure (pre-crack)', !leaked);

// --- 5. Confront adjudication fires correctly ---
console.log('\nConfront adjudication');
const hitReal = fallbackConfront(
  { kind: 'statement', text: 'I left the building by nine, right after the crowd.' },
  { kind: 'evidence', id: 'E1', detail: "Della Frost's card opened the side exit at 9:51 PM." },
);
ok('real contradiction is a HIT', hitReal.is_contradiction === true && hitReal.composure_delta < 0);
ok('hit carries severity', hitReal.severity > 0.5);

const missBogus = fallbackConfront(
  { kind: 'statement', text: 'Marcus and I were partners once.' },
  { kind: 'statement', text: 'The Orpheum was a beautiful theater.' },
);
ok('bogus pair is a MISS', missBogus.is_contradiction === false && missBogus.composure_delta > 0);

const hitBooth = fallbackConfront(
  { kind: 'statement', text: 'I never went up to the booth that night.' },
  { kind: 'evidence', id: 'E2', detail: 'The usher saw Marcus and Della walk toward the booth stairs.' },
);
ok('booth contradiction is a HIT', hitBooth.is_contradiction === true);

// --- 6. Crack yields a confession ---
console.log('\nCrack');
const crack = fallbackCrack();
ok('crack marks cracked + caught', crack.cracked === true && crack.caught_in_lie === true);
ok('confession references the weapon/act', /canister|floor|reel/i.test(crack.dialogue));

console.log(`\n${passed} checks passed.\n`);
