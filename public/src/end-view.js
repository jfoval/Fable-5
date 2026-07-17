// end-view.js — the bust screen: a stack-size chart across the whole match,
// the single biggest bluff, and the worst call.

export function renderEnd(container, { match, runner, personas }) {
  const champ = personas[match.winner].name;
  const loser = personas[1 - match.winner].name;

  let html = `<button class="btn ghost close" data-close>✕ Close</button>`;
  html += `<div class="end-hero">
      <div style="font-family:var(--cond);letter-spacing:.2em;color:var(--muted)">MATCH OVER</div>
      <div class="champ">${champ} wins</div>
      <div class="sub" style="text-align:center">${loser} was felted after ${match.history.length} hand${match.history.length === 1 ? '' : 's'}.</div>
    </div>`;

  html += stackChart(match, personas);

  const bluff = biggestBluff(runner);
  const call = worstCall(runner, personas);
  html += `<div class="end-cards">
      <div class="end-card bluff">
        <h4>🎭 Biggest bluff</h4>
        ${bluff ? `<div><b style="color:${personas[bluff.seat].color}">${personas[bluff.seat].name}</b> dragged
          <b>${bluff.pot.toLocaleString()}</b> on hand ${bluff.handNumber} with ${bluff.holeCards?.join(' ') || 'air'} —
          no showdown, pure story.</div>
          <div class="replay-read" style="margin-top:8px">“${escapeHtml(bluff.mono || '')}”</div>`
          : '<div class="sub">No successful bluff was recorded.</div>'}
      </div>
      <div class="end-card call">
        <h4>💸 Worst call</h4>
        ${call ? `<div><b style="color:${personas[call.seat].color}">${personas[call.seat].name}</b> called off
          <b>${call.pot.toLocaleString()}</b> on hand ${call.handNumber} holding ${call.holeCards?.join(' ') || '—'} and lost.</div>
          <div class="replay-read" style="margin-top:8px">“${escapeHtml(call.mono || '')}”</div>`
          : '<div class="sub">No losing call of note.</div>'}
      </div>
    </div>`;

  html += `<div style="text-align:center;margin-top:22px"><button class="btn primary" data-rematch>Rematch ▸</button></div>`;
  container.innerHTML = html;
}

function stackChart(match, personas) {
  const start = match.startingStack;
  const series = [[start], [start]];
  for (const h of match.history) { series[0].push(h.stacksAfter[0]); series[1].push(h.stacksAfter[1]); }
  const total = start * 2;
  const W = 840, H = 220, pad = 30;
  const n = series[0].length;
  const x = (i) => pad + (i / Math.max(1, n - 1)) * (W - pad * 2);
  const y = (v) => pad + (1 - v / total) * (H - pad * 2);
  const path = (s) => s.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) =>
    `<line x1="${pad}" y1="${pad + f * (H - pad * 2)}" x2="${W - pad}" y2="${pad + f * (H - pad * 2)}" stroke="rgba(255,255,255,.06)"/>`).join('');
  const mid = `<line x1="${pad}" y1="${y(start)}" x2="${W - pad}" y2="${y(start)}" stroke="rgba(217,164,65,.35)" stroke-dasharray="4 4"/>`;

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${grid}${mid}
      <path d="${path(series[0])}" fill="none" stroke="${personas[0].color}" stroke-width="2.5"/>
      <path d="${path(series[1])}" fill="none" stroke="${personas[1].color}" stroke-width="2.5"/>
      <text x="${pad}" y="16" fill="var(--muted)" font-size="11" font-family="var(--mono)">chip stacks · start → bust</text>
    </svg>
    <div style="display:flex;gap:18px;justify-content:center;margin-top:-6px;font-size:12px">
      <span style="color:${personas[0].color}">▬ ${personas[0].name}</span>
      <span style="color:${personas[1].color}">▬ ${personas[1].name}</span>
    </div>`;
}

function biggestBluff(runner) {
  let best = null;
  for (const t of runner.transcript) {
    if (!t.isBluff) continue;
    const summary = runner.match.history.find((h) => h.handNumber === t.handNumber);
    if (!summary || !summary.result) continue;
    if (summary.result.type === 'fold' && summary.result.winners.includes(t.seat)) {
      const pot = summary.result.pots.reduce((a, p) => a + p.amount, 0);
      if (!best || pot > best.pot) best = { seat: t.seat, pot, handNumber: t.handNumber, holeCards: t.holeCards, mono: t.decision.inner_monologue };
    }
  }
  return best;
}

function worstCall(runner, personas) {
  let worst = null;
  for (const t of runner.transcript) {
    if (t.decision.action !== 'call') continue;
    const summary = runner.match.history.find((h) => h.handNumber === t.handNumber);
    if (!summary || !summary.result) continue;
    if (!summary.result.winners.includes(t.seat)) {
      const lost = Math.abs(summary.result.netByPlayer[t.seat]);
      if (lost > 0 && (!worst || lost > worst.lost)) {
        const pot = summary.result.pots.reduce((a, p) => a + p.amount, 0);
        worst = { seat: t.seat, pot, lost, handNumber: t.handNumber, holeCards: t.holeCards, mono: t.decision.inner_monologue };
      }
    }
  }
  return worst;
}

function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
