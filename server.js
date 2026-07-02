// SUSPECT — zero-dependency static server + Anthropic interrogation proxy.
// One command to run:  npm start   (or:  node server.js)
//
// The API key stays server-side; the browser never sees it. With no key, every
// endpoint transparently falls back to the bundled scripted case so the game
// still plays and demos end to end.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { callClaude, extractJSON } from './lib/anthropic.js';
import {
  caseSystem, caseUser, replySystem, replyMessages, confrontSystem, confrontUser,
} from './lib/prompts.js';
import {
  FALLBACK_TRUTH, makeFallbackReplier, fallbackConfront, fallbackCrack,
} from './lib/fallback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 5173;
const KEY = process.env.ANTHROPIC_API_KEY;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}
const json = (res, status, obj) =>
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' });

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC, urlPath));
  if (!filePath.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    const data = await readFile(filePath);
    send(res, 200, data, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  } catch {
    send(res, 404, 'Not found');
  }
}

// ---- endpoints -------------------------------------------------------------

async function handleCase(req, res) {
  const { difficulty = 'cold' } = (await readBody(req)) || {};
  if (!KEY) {
    return json(res, 200, { offline: true, truth: FALLBACK_TRUTH });
  }
  try {
    const text = await callClaude({
      key: KEY,
      system: caseSystem(difficulty),
      messages: [{ role: 'user', content: caseUser(difficulty) }],
      max_tokens: 2600,
      temperature: 1,
    });
    const truth = extractJSON(text);
    return json(res, 200, { offline: false, truth });
  } catch (err) {
    // Never leave the player stranded: degrade to the bundled case.
    return json(res, 200, { offline: true, degraded: String(err.message || err), truth: FALLBACK_TRUTH });
  }
}

async function handleReply(req, res) {
  const body = (await readBody(req)) || {};
  const { truth, difficulty = 'cold', conversation = [], composure = 100, crack = false } = body;

  if (!KEY || body.offline) {
    // Rebuild the stateless scripted replier by replaying prior questions.
    if (crack) return json(res, 200, fallbackCrack());
    const replier = makeFallbackReplier();
    const questions = conversation.filter((t) => t.role === 'detective').map((t) => t.text);
    let out = { dialogue: '...', tell: 'watches you', composure_delta: 0, offline: true };
    for (const q of questions) out = replier(q, composure);
    return json(res, 200, out);
  }

  try {
    const messages = replyMessages(conversation, composure);
    if (crack) {
      messages.push({
        role: 'user',
        content:
          '[Your composure has shattered — you have nothing left. Drop the guard completely: if you are ' +
          'guilty, confess fully to the crime; if you are innocent, blurt out the real secret you have ' +
          'been protecting. Return the usual JSON with caught_in_lie=true and an added "cracked": true.]',
      });
    }
    const text = await callClaude({
      key: KEY,
      system: replySystem(truth, difficulty),
      messages,
      max_tokens: 600,
      temperature: 0.85,
    });
    const reply = extractJSON(text);
    if (crack) reply.cracked = true;
    return json(res, 200, reply);
  } catch (err) {
    return json(res, 200, {
      dialogue: '(The suspect stares at you, silent — the line went dead for a moment.)',
      tell: 'the room holds its breath', composure_delta: 0, error: String(err.message || err),
    });
  }
}

async function handleConfront(req, res) {
  const body = (await readBody(req)) || {};
  const { truth, itemA, itemB } = body;
  if (!itemA || !itemB) return json(res, 400, { error: 'need two items' });

  if (!KEY || body.offline) {
    return json(res, 200, fallbackConfront(itemA, itemB));
  }
  try {
    const text = await callClaude({
      key: KEY,
      system: confrontSystem(truth),
      messages: [{ role: 'user', content: confrontUser(itemA, itemB) }],
      max_tokens: 400,
      temperature: 0,
    });
    return json(res, 200, extractJSON(text));
  } catch (err) {
    return json(res, 200, {
      is_contradiction: false, severity: 0, composure_delta: 0,
      verdict: 'The adjudicator could not rule — the line dropped.',
      reaction: 'She waits, unreadable.', error: String(err.message || err),
    });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    if (req.url === '/api/case') return handleCase(req, res);
    if (req.url === '/api/reply') return handleReply(req, res);
    if (req.url === '/api/confront') return handleConfront(req, res);
  }
  if (req.method === 'GET' && req.url === '/api/health') {
    return json(res, 200, { ok: true, live: !!KEY });
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  SUSPECT  →  http://localhost:${PORT}`);
  console.log(`  Interrogation model: ${KEY ? 'LIVE (claude-fable-5)' : 'OFFLINE (bundled case — set ANTHROPIC_API_KEY for generated cases)'}\n`);
});
