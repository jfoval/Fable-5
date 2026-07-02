// audit.js — the integrity ledger.
//
// Every payload sent to an agent is recorded here together with the secrets it
// must NEVER contain (the opponent's current hole cards and every word of the
// opponent's private monologue/read). check() independently re-scans each
// payload and proves the secrets are absent. If a single payload ever leaks,
// the viewer turns red and the demo is, correctly, called fake.

export class AuditLog {
  constructor() {
    this.records = [];
    this.leaks = 0;
  }

  // record: { handNumber, seat, persona, street, system, view, messages, secrets, retry }
  add(record) {
    const verdict = check(record);
    if (!verdict.clean) this.leaks++;
    const entry = { ...record, verdict, seq: this.records.length + 1 };
    this.records.push(entry);
    return entry;
  }

  clean() { return this.leaks === 0; }
  summary() {
    return {
      payloads: this.records.length,
      leaks: this.leaks,
      clean: this.leaks === 0,
    };
  }
}

// Scan one payload against its declared secrets. Returns { clean, findings }.
export function check(record) {
  const findings = [];
  const secrets = record.secrets || {};
  const oppCards = secrets.holeCards || [];
  const oppTexts = (secrets.texts || []).filter((t) => t && t.trim().length >= 12);

  // --- Card leak: scan the LIVE-hand view (own cards + public board + action
  // log), which by construction must never contain an opponent hole card. The
  // match_history block is deliberately excluded because it holds only public
  // results and the player's OWN past cards, which can coincidentally share a
  // rank+suit with the opponent's current card across re-shuffled hands. ---
  const liveView = { ...(record.view || {}) };
  delete liveView.match_history;
  const liveText = JSON.stringify(liveView);
  for (const code of oppCards) {
    if (tokenPresent(liveText, code)) {
      findings.push({ type: 'card', detail: `opponent hole card "${code}" appeared in the live-hand payload` });
    }
  }

  // --- Thought leak: the opponent's monologue/read text must appear NOWHERE in
  // the entire payload (system + all messages). ---
  const fullText = record.system + '\n' + JSON.stringify(record.messages || []);
  for (const t of oppTexts) {
    if (fullText.includes(t.trim())) {
      findings.push({ type: 'thought', detail: `opponent private text leaked: "${t.slice(0, 40)}..."` });
    }
  }

  return { clean: findings.length === 0, findings };
}

// Match a card code like "As" only as a JSON string token ("As"), not as an
// incidental substring inside a word.
function tokenPresent(text, code) {
  return text.includes(`"${code}"`);
}
