// ui.js — the broadcast DOM: table, cards, chips, thought panels (typewriter),
// stats, and the dramatic overlays. Pure presentation; it holds no game logic.

const SUIT_GLYPH = { c: '♣', d: '♦', h: '♥', s: '♠' };
const RED = { d: true, h: true };
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export class BroadcastUI {
  constructor(clock) {
    this.clock = clock;
    this.$ = (s, r = document) => r.querySelector(s);
    this.panels = [this.$('#panel0'), this.$('#panel1')];
    this.seats = [this.$('#seat0'), this.$('#seat1')];
    this.stats = [this.$('#stat0'), this.$('#stat1')];
    this.board = this.$('#board');
    this.pot = this.$('#pot');
    this.personas = null;
  }

  setPersonas(personas) {
    this.personas = personas;
    personas.forEach((p, i) => {
      document.documentElement.style.setProperty(i === 0 ? '--p0' : '--p1', p.color);
      this.panels[i].style.setProperty('--accent', p.color);
      this.seats[i].style.setProperty('--accent', p.color);
      this.stats[i].style.setProperty('--accent', p.color);
      this.$('.tp-name', this.panels[i]).textContent = p.name;
      this.$('.tp-tag', this.panels[i]).textContent = p.tag;
      this.$('.seat-name', this.seats[i]).innerHTML = `<span class="swatch"></span>${p.name}`;
      this.$('.seat-name .swatch', this.seats[i]).style.background = p.color;
    });
    this.renderStats([blankStats(), blankStats()]);
  }

  // ---- card rendering -------------------------------------------------------
  cardEl(code, { small = false, back = false, dealing = false } = {}) {
    const el = document.createElement('div');
    el.className = 'card' + (small ? ' small' : '') + (dealing ? ' dealing' : '');
    if (back) { el.classList.add('back'); return el; }
    const r = code.slice(0, code.length - 1);
    const s = code[code.length - 1];
    const rank = r === 'T' ? '10' : r;
    if (RED[s]) el.classList.add('red');
    el.innerHTML = `<div class="r">${rank}</div><div class="s">${SUIT_GLYPH[s]}</div>`;
    el.dataset.code = code;
    return el;
  }

  // ---- new hand -------------------------------------------------------------
  newHand({ handNumber, blinds, button, stacks, holeCards }) {
    this.$('#hudHand').textContent = `Hand ${handNumber}`;
    this.$('#hudBlinds').textContent = `Blinds ${fmt(blinds.sb)}/${fmt(blinds.bb)}`;
    this.$('#hudLevel').textContent = `Level ${(blinds.level ?? 0) + 1}`;
    this.board.innerHTML = '';
    this.$('#streetLabel').textContent = '';
    this.setPot(0);
    this.hideVerdict();
    this.setAllIn(false);
    for (let i = 0; i < 2; i++) {
      this.seats[i].classList.remove('active');
      this.$('.seat-stack', this.seats[i]).textContent = fmt(stacks[i]);
      this.$('.dealer-btn', this.seats[i]).classList.toggle('show', i === button);
      this.$(`[data-bet="${i}"]`).innerHTML = '';
      this.$('.talk-bubble', this.seats[i]).classList.remove('show');
      const hole = this.$(`[data-hole="${i}"]`);
      hole.innerHTML = '';
      holeCards[i].forEach((c, k) => setTimeout(() => hole.appendChild(this.cardEl(c, { dealing: true })), k * 90));
      this.clearPanel(i);
    }
  }

  clearPanel(i) {
    this.$('.tp-body', this.panels[i]).innerHTML = '';
    this.$('.tp-read-body', this.panels[i]).textContent = '';
    this.$('.tp-source', this.panels[i]).textContent = '';
    this.panels[i].classList.remove('thinking', 'locked');
  }

  setActive(seat) {
    for (let i = 0; i < 2; i++) {
      this.seats[i].classList.toggle('active', i === seat);
      this.panels[i].classList.toggle('thinking', i === seat);
    }
  }
  clearActive() {
    this.seats.forEach((s) => s.classList.remove('active'));
    this.panels.forEach((p) => p.classList.remove('thinking'));
  }

  // ---- typewriter monologue -------------------------------------------------
  async streamThought(seat, decision) {
    const panel = this.panels[seat];
    panel.classList.remove('thinking');
    this.$('.tp-read-body', panel).textContent = decision.read_on_opponent || '—';
    const body = this.$('.tp-body', panel);
    body.innerHTML = '';
    const text = decision.inner_monologue || '…';
    const caret = document.createElement('span');
    const holder = document.createElement('span');
    body.appendChild(holder); body.appendChild(caret);
    caret.className = 'caret'; caret.textContent = ' ';

    for (let i = 0; i < text.length; i++) {
      await this.clock.gate();
      holder.textContent += text[i];
      body.scrollTop = body.scrollHeight;
      const ch = text[i];
      const d = ch === '.' || ch === '!' || ch === '?' ? 90 : ch === ',' ? 45 : 16;
      await this.clock.delay(d);
    }
    caret.remove();

    // source + action chip
    const src = decision.source === 'api' ? 'Fable 5 · live'
      : decision.source === 'scripted' ? 'scripted demo'
      : decision.source === 'offline' ? 'offline brain'
      : 'default';
    const amt = (decision.action === 'bet' || decision.action === 'raise') && decision.amount ? ` ${fmt(decision.amount)}` : '';
    this.$('.tp-source', panel).innerHTML =
      `<span class="action-chip ${decision.action === 'fold' ? 'fold' : ''}">${decision.action.toUpperCase()}${amt}</span>` +
      `<span style="margin-left:10px">${src}</span>`;
  }

  showTalk(seat, text) {
    if (!text) return;
    const b = this.$('.talk-bubble', this.seats[seat]);
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(this._talkT?.[seat]);
    this._talkT = this._talkT || {};
    this._talkT[seat] = setTimeout(() => b.classList.remove('show'), 4200 / this.clock.speed);
  }

  // ---- action visuals -------------------------------------------------------
  applyAction(seat, { stacks, pot, committedStreet }) {
    this.$('.seat-stack', this.seats[seat]).textContent = fmt(stacks[seat]);
    const bet = this.$(`[data-bet="${seat}"]`);
    bet.innerHTML = committedStreet > 0 ? `<span class="chipstack">${chips(committedStreet)}</span> ${fmt(committedStreet)}` : '';
    this.setPot(pot, true);
  }

  setPot(v, grow) {
    this.pot.innerHTML = `POT <b>${fmt(v)}</b>`;
    if (grow) { this.pot.classList.remove('grow'); void this.pot.offsetWidth; this.pot.classList.add('grow'); }
  }

  clearStreetBets() {
    for (let i = 0; i < 2; i++) this.$(`[data-bet="${i}"]`).innerHTML = '';
  }

  async revealStreet(street, board, { dramatic = false } = {}) {
    this.$('#streetLabel').textContent = street.toUpperCase();
    this.clearStreetBets();
    const existing = this.board.children.length;
    const toAdd = board.slice(existing);
    if (dramatic) await this.clock.delay(700); // beat before the card lands
    for (const code of toAdd) {
      const el = this.cardEl(code, { dealing: true });
      this.board.appendChild(el);
      await this.clock.delay(dramatic ? 420 : 240);
    }
  }

  // ---- showdown -------------------------------------------------------------
  markShowdown(hands, winners) {
    for (const h of hands) {
      const hole = this.$(`[data-hole="${h.seat}"]`);
      [...hole.children].forEach((c) => {
        c.classList.add('flip');
        if (h.folded) c.classList.add('muck');
        else if (winners.includes(h.seat)) c.classList.add('winner');
      });
    }
    // highlight winning board cards too
    if (winners.length) [...this.board.children].forEach((c) => c.classList.add('winner'));
  }

  markWinnerStack(seat) {
    const el = this.$('.seat-stack', this.seats[seat]);
    el.classList.remove('won'); void el.offsetWidth; el.classList.add('won');
  }

  // ---- overlays -------------------------------------------------------------
  showVerdict(v) {
    const el = this.$('#verdict');
    const inner = this.$('.vb-inner', el);
    const kind = v.kind === 'bluff-won' ? 'bluff' : v.kind === 'bluff-caught' ? 'read' : v.kind === 'chop' ? 'chop' : '';
    inner.className = 'vb-inner ' + kind;
    const who = v.seat >= 0 && this.personas ? this.personas[v.seat].name : '';
    inner.innerHTML = `${v.title}<span class="vb-sub">${who}</span>`;
    el.classList.add('show');
  }
  hideVerdict() { this.$('#verdict').classList.remove('show'); }

  setAllIn(on, lockPanels = on) {
    this.$('#allin').classList.toggle('show', on);
    this.panels.forEach((p) => p.classList.toggle('locked', on && lockPanels));
  }

  setDealHint(on) { this.$('#dealHint').classList.toggle('show', on); }

  setCommentary(text) { this.$('#commentary .comm-text').textContent = text; }

  // ---- stats ----------------------------------------------------------------
  renderStats(stats) {
    stats.forEach((st, i) => {
      const name = this.personas ? this.personas[i].name : `Seat ${i + 1}`;
      const aggr = st.decisions ? Math.round((st.aggressiveActions / st.decisions) * 100) : 0;
      const bluffRate = st.bluffsAttempted ? `${st.bluffsWorked}/${st.bluffsAttempted}` : '0/0';
      this.stats[i].innerHTML =
        `<h4>${name}<span>${st.handsWon}W</span></h4>` +
        row('Bluffs (worked/tried)', bluffRate) +
        row('Aggression', `${aggr}%`) +
        row('Biggest pot', fmt(st.biggestPot)) +
        row('Decisions', st.decisions);
    });
  }
}

function row(label, val) {
  return `<div class="statrow"><span>${label}</span><b>${val}</b></div>`;
}
function blankStats() {
  return { handsWon: 0, decisions: 0, aggressiveActions: 0, bluffsAttempted: 0, bluffsWorked: 0, biggestPot: 0 };
}

// tiny chip glyph stack, colored by size tier
function chips(v) {
  const tiers = v >= 5000 ? 4 : v >= 1000 ? 3 : v >= 300 ? 2 : 1;
  const colors = ['#e0575b', '#54d1c4', '#d9a441', '#9ad06b'];
  let s = '';
  for (let i = 0; i < tiers; i++) s += `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colors[i]};margin-left:-3px;border:1px solid rgba(0,0,0,.4)"></span>`;
  return s;
}
