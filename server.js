// server.js — zero-dependency static server + Anthropic proxy for BLUFF.
//
//   node server.js       (or: npm start)
//
// The ANTHROPIC_API_KEY stays server-side: the browser posts to /api/agent and
// /api/commentator, never to Anthropic directly. Every agent payload is also
// appended to audit.log (JSONL) as a server-side ground-truth ledger.

import http from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 5173;
const MODEL = 'claude-fable-5';
const BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
const AUDIT_FILE = path.join(__dirname, 'audit.log');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' });

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

// One agent decision. The browser sends { system, messages, audit }. We append
// the audit stub to disk, then relay to Anthropic and return the raw text.
async function agent(req, res) {
  const payload = await readBody(req);
  if (!payload) return json(res, 400, { error: 'bad json' });

  // Ground-truth audit ledger: append the ACTUAL payload sent to the model
  // (system + user message). This is the on-disk proof of what each agent saw.
  const userMsg = (payload.messages || []).find((m) => m.role === 'user');
  appendFile(AUDIT_FILE, JSON.stringify({
    t: new Date().toISOString(),
    meta: payload.audit || null,
    system_len: (payload.system || '').length,
    user_payload: userMsg ? userMsg.content : null,
  }) + '\n').catch(() => {});

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(res, 200, { offline: true });

  const body = {
    model: MODEL,
    max_tokens: payload.max_tokens || 400,
    system: payload.system,
    messages: payload.messages,
  };
  try {
    const r = await fetch(`${BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return json(res, 200, { error: `api ${r.status}`, detail: (await r.text()).slice(0, 300) });
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return json(res, 200, { text });
  } catch (err) {
    return json(res, 200, { error: String((err && err.message) || err) });
  }
}

// One ESPN-style commentary line after a big pot.
async function commentator(req, res) {
  const payload = await readBody(req);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(res, 200, { offline: true });
  const system =
    'You are a high-energy poker broadcast commentator, in the booth for a heads-up final. ' +
    'Given a summary of the hand that just finished, deliver EXACTLY ONE punchy, quotable line — the kind ' +
    'that ends up as a highlight caption. Name what happened, dramatize the read or the bluff, keep it under ' +
    '30 words. No preamble, no quotes around it, just the line.';
  try {
    const r = await fetch(`${BASE}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 120, system,
        messages: [{ role: 'user', content: JSON.stringify(payload.hand || {}, null, 2) }],
      }),
    });
    if (!r.ok) return json(res, 200, { error: `api ${r.status}` });
    const data = await r.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return json(res, 200, { text });
  } catch (err) {
    return json(res, 200, { error: String((err && err.message) || err) });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/agent') return agent(req, res);
  if (req.method === 'POST' && req.url === '/api/commentator') return commentator(req, res);
  if (req.method === 'GET' && req.url === '/api/health') {
    return json(res, 200, { ok: true, model: MODEL, live: !!process.env.ANTHROPIC_API_KEY });
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  const live = !!process.env.ANTHROPIC_API_KEY;
  console.log(`\n  ♠ BLUFF running →  http://localhost:${PORT}`);
  console.log(`  Agents: ${live ? `LIVE (${MODEL})` : 'offline — set ANTHROPIC_API_KEY for real reasoning'}\n`);
});
