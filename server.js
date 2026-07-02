// Primordial — zero-dependency static server + Anthropic narration proxy.
// One command to run:  npm start   (or:  node server.js)
//
// The narration endpoint keeps ANTHROPIC_API_KEY server-side; the browser
// never sees it. If the key is absent the endpoint returns { offline: true }
// and the UI shows "Narrator offline" while the simulation keeps running.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 5173;
const MODEL = 'claude-fable-5';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC, urlPath));
  if (!filePath.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  } catch {
    send(res, 404, 'Not found');
  }
}

// Build the naturalist system prompt + user payload, call Anthropic, return text.
async function narrate(req, res) {
  let raw = '';
  for await (const chunk of req) raw += chunk;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return send(res, 200, JSON.stringify({ offline: true }), {
      'Content-Type': 'application/json',
    });
  }

  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    return send(res, 400, JSON.stringify({ error: 'bad json' }), {
      'Content-Type': 'application/json',
    });
  }

  const system =
    'You are the field naturalist narrating "Primordial," a living artificial-life world. ' +
    'You speak in the warm, precise, fascinated voice of a naturalist watching evolution unfold ' +
    'in real time. You are given a compact snapshot of the world state and a list of recent events. ' +
    'Write EXACTLY 2-3 sentences of narration. Reference the specific, concrete things in the data — ' +
    'real trait shifts, real booms or crashes, the actual balance of grazers and hunters. ' +
    'Name what is changing and why it matters for who survives. Never write generic filler, never ' +
    'invent numbers not in the data, never mention that you are an AI or that this is a simulation. ' +
    'No preamble, no headings — just the observation.';

  const body = {
    model: MODEL,
    max_tokens: 220,
    system,
    messages: [
      {
        role: 'user',
        content:
          'Here is the current world snapshot as JSON. Narrate what is happening now.\n\n' +
          JSON.stringify(payload, null, 2),
      },
    ],
  };

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const detail = await r.text();
      return send(res, 200, JSON.stringify({ error: `api ${r.status}`, detail }), {
        'Content-Type': 'application/json',
      });
    }
    const data = await r.json();
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();
    send(res, 200, JSON.stringify({ text }), { 'Content-Type': 'application/json' });
  } catch (err) {
    send(res, 200, JSON.stringify({ error: String(err && err.message || err) }), {
      'Content-Type': 'application/json',
    });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/narrate') return narrate(req, res);
  if (req.method === 'GET' && req.url === '/api/health') {
    return send(res, 200, JSON.stringify({ ok: true, narrator: !!process.env.ANTHROPIC_API_KEY }), {
      'Content-Type': 'application/json',
    });
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  const has = !!process.env.ANTHROPIC_API_KEY;
  console.log(`\n  Primordial running →  http://localhost:${PORT}`);
  console.log(`  Narrator: ${has ? `online (${MODEL})` : 'offline (set ANTHROPIC_API_KEY to enable)'}\n`);
});
