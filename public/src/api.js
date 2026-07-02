// Browser-side calls to the server proxy. The server holds the key and, when
// it is missing, transparently returns the bundled scripted case — so this
// layer never has to know whether it is live or offline.

async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

export const api = {
  health: () => fetch('/api/health').then((r) => r.json()).catch(() => ({ ok: false, live: false })),
  newCase: (difficulty) => post('/api/case', { difficulty }),
  reply: (payload) => post('/api/reply', payload),
  confront: (payload) => post('/api/confront', payload),
};
