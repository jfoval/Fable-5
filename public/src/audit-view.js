// audit-view.js — renders the information-hygiene proof. Opens the real
// payloads sent to each agent and shows, per payload, that the opponent's hole
// cards and private thoughts are absent — highlighting what the agent DID see
// (its own cards in teal, the public board in gold) and any leak in red.

import { check } from './audit.js';

export function renderAudit(container, audit, personas) {
  const s = audit.summary();
  const clean = s.clean;
  const namesOf = (seat) => personas ? personas[seat]?.name : `Seat ${seat + 1}`;

  let html = `<button class="btn ghost close" data-close>✕ Close</button>`;
  html += `<h2>🛡 Information-hygiene audit</h2>`;
  html += `<p class="sub">Every decision is one API payload. Neither agent is ever sent the other's hole cards or
    inner monologue. Below is the ground truth: the actual payloads, re-scanned live.</p>`;

  html += `<div class="audit-status ${clean ? 'clean' : 'dirty'}">
      <span class="big">${clean ? '✔' : '✕'}</span>
      <div>${clean ? 'NO LEAKS DETECTED' : `${s.leaks} LEAK(S) DETECTED`}
        <div class="audit-check">${s.payloads} payloads audited · card tokens & private text cross-checked on every one.</div>
      </div>
    </div>`;

  // Show the most recent ~24 payloads (newest first).
  const recs = audit.records.slice(-24).reverse();
  html += `<div class="audit-list">`;
  for (const rec of recs) {
    const v = check(rec); // re-verify live, don't trust the stored flag
    const oppCards = rec.secrets?.holeCards || [];
    const preview = payloadPreview(rec, oppCards);
    html += `<details class="audit-item">
      <summary>
        <span class="${v.clean ? 'ok' : 'bad'}">${v.clean ? '✔ clean' : '✕ LEAK'}</span>
        <span>#${rec.seq} · Hand ${rec.handNumber} · ${rec.persona} to act · ${rec.street}${rec.retry ? ' · retry' : ''}</span>
        <span style="margin-left:auto;color:var(--muted)">opponent held ${oppCards.join(' ') || '—'} — must be absent</span>
      </summary>
      <div class="payload">
        <div class="audit-check">Opponent hole cards <b>${oppCards.join(' ') || '—'}</b>:
          ${v.findings.some((f) => f.type === 'card') ? '<span style="color:var(--red)">FOUND — LEAK</span>' : '<b>absent ✔</b>'}
          &nbsp;·&nbsp; Opponent private thoughts:
          ${v.findings.some((f) => f.type === 'thought') ? '<span style="color:var(--red)">FOUND — LEAK</span>' : '<b>absent ✔</b>'}
        </div>
        <pre>${preview}</pre>
      </div>
    </details>`;
  }
  html += `</div>`;
  container.innerHTML = html;
}

// Render the user message with the agent's own cards / public board highlighted.
function payloadPreview(rec, oppCards) {
  const userMsg = (rec.messages || []).find((m) => m.role === 'user');
  let text = userMsg ? userMsg.content : '(scripted offline hand — no live payload was sent)';
  text = escapeHtml(text);

  const own = rec.view?.your_hole_cards || [];
  const board = rec.view?.board || [];
  for (const c of own) text = text.replaceAll(`"${c}"`, `"<span class="hl-own">${c}</span>"`);
  for (const c of board) text = text.replaceAll(`"${c}"`, `"<span class="hl-board">${c}</span>"`);
  // If (impossibly) an opponent card is present, flag it red.
  for (const c of oppCards) {
    if (!own.includes(c) && !board.includes(c)) {
      text = text.replaceAll(`"${c}"`, `"<span class="hl-secret">${c}</span>"`);
    }
  }
  const legend = `<span class="hl-own">■</span> own cards  <span class="hl-board">■</span> public board  ` +
    `<span style="color:var(--muted)">— opponent cards never appear</span>\n\n`;
  return legend + text;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
