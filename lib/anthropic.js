// Thin Anthropic client shared by the server and the playtest harness.
// Keeps the API key server-side; the browser never imports this.

export const MODEL = 'claude-fable-5';
const API_URL = 'https://api.anthropic.com/v1/messages';

// Call the Messages API and return the concatenated text of the reply.
// Throws on transport / non-2xx so callers can decide how to degrade.
export async function callClaude({ key, system, messages, max_tokens = 1024, temperature }) {
  if (!key) throw new Error('no-api-key');
  const body = { model: MODEL, max_tokens, system, messages };
  if (typeof temperature === 'number') body.temperature = temperature;

  const r = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    const err = new Error(`api ${r.status}`);
    err.status = r.status;
    err.detail = detail;
    throw err;
  }

  const data = await r.json();
  return (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

// Pull the first balanced JSON object/array out of a model reply, tolerating
// ```json fences, leading prose, and trailing commentary. Returns a parsed
// value or throws with the raw text attached for debugging.
export function extractJSON(text) {
  if (!text) throw new Error('empty model reply');

  // Prefer a fenced block if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;

  const start = candidate.search(/[[{]/);
  if (start === -1) {
    const e = new Error('no JSON found in reply');
    e.raw = text;
    throw e;
  }

  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch (err) {
          err.raw = slice;
          throw err;
        }
      }
    }
  }
  const e = new Error('unbalanced JSON in reply');
  e.raw = text;
  throw e;
}
