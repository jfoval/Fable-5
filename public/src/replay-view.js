// replay-view.js — steps through the last hand, each agent's monologue printed
// beside the action it produced, with bluffs and correct/incorrect reads flagged.

export function renderReplay(container, summary, decisions, personas) {
  if (!summary) { container.innerHTML = closeBtn() + `<h2>⧉ Replay</h2><p class="sub">No completed hand yet.</p>`; return; }

  const result = summary.result;
  const winners = result?.winners || [];
  const showdown = result?.showdown;
  // Who fired the last bluff (if any) — used to judge the decisive fold/call.
  const lastBluff = [...decisions].reverse().find((d) => d.isBluff);

  let html = closeBtn();
  html += `<h2>⧉ Hand ${summary.handNumber} — replay</h2>`;
  html += `<p class="sub">Blinds ${summary.blinds.sb}/${summary.blinds.bb} · board ${summary.board.join(' ') || '—'} · ` +
    `${verdictText(result, personas)}</p>`;

  for (const d of decisions) {
    const name = personas[d.seat].name;
    const color = personas[d.seat].color;
    const tag = readTag(d, decisions, result, lastBluff);
    const amt = (d.decision.action === 'bet' || d.decision.action === 'raise') && d.decision.amount ? ` ${d.decision.amount}` : '';
    html += `<div class="replay-step ${d.isBluff ? 'bluff' : ''}">
      <div class="replay-meta">
        <div class="who" style="color:${color}">${name}</div>
        <div>${d.street}</div>
        <div>${d.holeCards.join(' ')}</div>
        <div style="margin-top:6px">board: ${d.board.join(' ') || '—'}</div>
        <div style="margin-top:6px;color:var(--gold)">${d.decision.action.toUpperCase()}${amt}</div>
        <div>pot ${d.potAfter}</div>
      </div>
      <div>
        <div class="replay-mono">${tag}${escapeHtml(d.decision.inner_monologue)}</div>
        ${d.decision.read_on_opponent ? `<div class="replay-read">read: “${escapeHtml(d.decision.read_on_opponent)}”</div>` : ''}
        ${d.decision.table_talk ? `<div class="replay-read">🗣 “${escapeHtml(d.decision.table_talk)}”</div>` : ''}
      </div>
    </div>`;
  }
  container.innerHTML = html;
}

function readTag(d, decisions, result, lastBluff) {
  const aggressive = ['bet', 'raise', 'all-in'].includes(d.decision.action);
  if (aggressive) {
    return d.isBluff ? `<span class="tag bluff">BLUFF</span>` : `<span class="tag value">VALUE</span>`;
  }
  // Judge the decisive fold / call.
  const winners = result?.winners || [];
  if (d.decision.action === 'fold') {
    // Was this the fold that ended the hand?
    const isLast = decisions[decisions.length - 1] === d;
    if (isLast && lastBluff && !winners.includes(d.seat)) {
      return `<span class="tag readbad">GOT BLUFFED</span>`;
    }
    if (isLast) return `<span class="tag readgood">DISCIPLINED LAYDOWN</span>`;
  }
  if (d.decision.action === 'call' && result?.showdown) {
    return winners.includes(d.seat) ? `<span class="tag readgood">READ WAS RIGHT</span>` : `<span class="tag readbad">PAID IT OFF</span>`;
  }
  return '';
}

function verdictText(result, personas) {
  if (!result) return '';
  const w = (result.winners || []).map((s) => personas[s].name).join(' & ');
  if (result.type === 'fold') return `${w} won it — no showdown`;
  return `${w} won at showdown`;
}

function closeBtn() { return `<button class="btn ghost close" data-close>✕ Close</button>`; }
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
