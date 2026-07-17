// net.js — the browser's link to the server proxy. The API key lives only on
// the server; we post payloads and get text back.

export async function serverCall(system, messages, auditStub) {
  try {
    const r = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ system, messages, audit: auditStub, max_tokens: 400 }),
    });
    if (!r.ok) return { error: `http ${r.status}` };
    return await r.json();
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

export async function commentate(handSummary) {
  try {
    const r = await fetch('/api/commentator', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hand: handSummary }),
    });
    if (!r.ok) return { error: `http ${r.status}` };
    return await r.json();
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

export async function health() {
  try { return await (await fetch('/api/health')).json(); }
  catch { return { ok: false, live: false }; }
}
