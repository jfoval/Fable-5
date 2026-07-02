// The Narrator — "Field Notes" panel, voiced by Claude Fable 5.
// Every ~20 sim-aware seconds it POSTs a compact world snapshot + recent events
// to /api/narrate (which proxies the Anthropic API server-side, keeping the key
// secret). If no key is configured the badge reads "Narrator offline" and the
// simulation carries on untouched.

export class Narrator {
  constructor({ panelEl, badgeEl, world, emergence, getSimTime }) {
    this.panel = panelEl;
    this.badge = badgeEl;
    this.world = world;
    this.emergence = emergence;
    this.getSimTime = getSimTime;
    this.offline = false;
    this.busy = false;
    this.intervalSec = 20;         // wall-clock seconds between dispatches
    this._lastAt = -1e9;
    this._checkHealth();
  }

  async _checkHealth() {
    try {
      const r = await fetch('/api/health');
      const j = await r.json();
      if (!j.narrator) this._goOffline();
      else this._setBadge('live', 'Fable 5 · live');
    } catch {
      this._setBadge('', 'connecting…');
    }
  }

  _setBadge(cls, text) {
    if (!this.badge) return;
    this.badge.className = 'badge' + (cls ? ' ' + cls : '');
    this.badge.textContent = text;
  }

  _goOffline() {
    this.offline = true;
    this._setBadge('offline', 'Narrator offline');
    if (!this.panel.dataset.offlineShown) {
      this.panel.dataset.offlineShown = '1';
      this._append(
        'The narrator is offline — set ANTHROPIC_API_KEY and restart to let Fable 5 watch the world. ' +
        'The simulation runs on regardless; open the charts and fire a meteor.',
        null, true
      );
    }
  }

  // Called each animation frame with the real elapsed wall-clock seconds.
  tick(nowSec) {
    if (this.offline || this.busy) return;
    if (nowSec - this._lastAt < this.intervalSec) return;
    this._lastAt = nowSec;
    this._dispatch();
  }

  async _dispatch() {
    this.busy = true;
    const snapshot = this.emergence.summarize(this.world);
    const thinkingEl = this._append('', this.getSimTime(), false, true);
    try {
      const r = await fetch('/api/narrate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(snapshot),
      });
      const j = await r.json();
      if (j.offline) { thinkingEl.remove(); this._goOffline(); return; }
      if (j.text) {
        this._fill(thinkingEl, j.text);
        this._setBadge('live', 'Fable 5 · live');
      } else {
        // API reachable but errored — surface briefly, keep trying.
        thinkingEl.remove();
        this._setBadge('offline', 'Narrator error');
        console.warn('narrate error', j);
      }
    } catch (e) {
      thinkingEl.remove();
      this._setBadge('offline', 'Narrator offline');
      console.warn('narrate fetch failed', e);
    } finally {
      this.busy = false;
    }
  }

  _timeLabel(sec) {
    if (sec == null) return '';
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  _append(text, simSec, offline = false, thinking = false) {
    const note = document.createElement('div');
    note.className = 'note' + (thinking ? ' thinking' : '');
    const time = document.createElement('div');
    time.className = 'note-time';
    time.textContent = offline ? 'SYSTEM' : (this._timeLabel(simSec) + '  ·  sim time');
    const body = document.createElement('div');
    body.className = 'note-body';
    if (thinking) body.innerHTML = 'Fable 5 is observing<span class="dots"></span>';
    else body.textContent = text;
    note.appendChild(time);
    note.appendChild(body);
    this.panel.prepend(note);
    // cap entries
    while (this.panel.children.length > 30) this.panel.lastChild.remove();
    return note;
  }

  _fill(note, text) {
    note.classList.remove('thinking');
    const body = note.querySelector('.note-body');
    body.textContent = text;
  }
}
