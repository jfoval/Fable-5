// Emergence detection. Samples the world on a fixed cadence, tracks population
// by species cluster and trait distributions over "generations" (time slices),
// and flags notable events: booms, crashes, extinctions, predator–prey cycles,
// and trait divergence (proto-speciation). These events feed both the on-screen
// ticker and the narrator.

const BANDS = ['grazer', 'omnivore', 'hunter'];

function band(diet) {
  return diet < 0.34 ? 'grazer' : diet < 0.62 ? 'omnivore' : 'hunter';
}

const TRAIT_KEYS = ['speed', 'size', 'vision', 'metabolism', 'aggression', 'diet'];

export class Emergence {
  constructor(sampleEvery = 2.5) {
    this.sampleEvery = sampleEvery;
    this.acc = 0;
    this.samples = [];      // rolling history for charts + detection
    this.events = [];       // all detected events (most recent last)
    this.gen = 0;
    this._lastBd = null;
    this._cooldown = {};    // per-event-type cooldown timestamps
  }

  reset() {
    this.acc = 0;
    this.samples.length = 0;
    this.events.length = 0;
    this.gen = 0;
    this._lastBd = null;
    this._cooldown = {};
  }

  _snapshot(world) {
    const counts = { grazer: 0, omnivore: 0, hunter: 0 };
    const sums = {};
    for (const k of TRAIT_KEYS) sums[k] = 0;
    const sizes = [];
    for (const c of world.creatures) {
      counts[band(c.g.diet)]++;
      for (const k of TRAIT_KEYS) sums[k] += c.g[k];
      sizes.push(c.g.size);
    }
    const n = world.creatures.length || 1;
    const avg = {};
    for (const k of TRAIT_KEYS) avg[k] = sums[k] / n;
    return {
      t: world.time,
      gen: this.gen,
      pop: world.creatures.length,
      food: world.liveFood,
      counts,
      avg,
    };
  }

  // Called every sim step. Returns an array of newly-detected events (possibly empty).
  update(world, dt) {
    this.acc += dt;
    if (this.acc < this.sampleEvery) return [];
    this.acc -= this.sampleEvery;
    this.gen++;

    const s = this._snapshot(world);
    this.samples.push(s);
    if (this.samples.length > 400) this.samples.shift();

    const fresh = this._detect(world, s);
    for (const e of fresh) this.events.push(e);
    if (this.events.length > 60) this.events.splice(0, this.events.length - 60);
    return fresh;
  }

  _canFire(type, t, gap) {
    const last = this._cooldown[type] || -1e9;
    if (t - last < gap) return false;
    this._cooldown[type] = t;
    return true;
  }

  _detect(world, s) {
    const out = [];
    const hist = this.samples;
    const t = s.t;

    // window ~10s back
    const backIdx = this._indexBefore(t - 10);
    if (backIdx >= 0) {
      const prev = hist[backIdx];
      const growth = (s.pop - prev.pop) / Math.max(6, prev.pop);
      if (growth > 0.45 && s.pop > 60 && this._canFire('boom', t, 14)) {
        out.push(ev('boom', t,
          `Population boom — up ${(growth * 100) | 0}% to ${s.pop} in ${Math.round(t - prev.t)}s.`, 2));
      }
      if (growth < -0.4 && prev.pop > 60 && this._canFire('crash', t, 14)) {
        out.push(ev('crash', t,
          `Population crash — down ${Math.abs((growth * 100) | 0)}% to ${s.pop}.`, 3));
      }
    }

    // sustained bust: fallen well below a recent local peak (slower collapse
    // that the 10s window misses but is a real boom→bust)
    const recentPeak = this._peakSince(t - 40);
    if (recentPeak.pop > 90 && s.pop < recentPeak.pop * 0.62 && s.pop > 0 &&
        this._canFire('crash', t, 22)) {
      out.push(ev('crash', t,
        `The population is collapsing — down from ${recentPeak.pop} to ${s.pop} as the world overshot its food.`, 3));
    }

    // extinction of a cluster
    if (this._lastBd) {
      for (const b of BANDS) {
        if (this._lastBd[b] >= 6 && s.counts[b] === 0 && this._canFire('ext_' + b, t, 25)) {
          out.push(ev('extinction', t, `The ${b}s have gone extinct.`, 3));
        }
        // emergence of a new predator lineage
        if (b === 'hunter' && this._lastBd[b] < 3 && s.counts[b] >= 12 && this._canFire('rise_hunter', t, 30)) {
          out.push(ev('predators-rise', t, `A hunting lineage has taken hold — ${s.counts[b]} predators now roam.`, 2));
        }
      }
    }
    this._lastBd = { ...s.counts };

    // predator–prey oscillation: anti-correlation between hunters and grazers
    if (hist.length >= 14) {
      const win = hist.slice(-14);
      const corr = negCorr(win.map((x) => x.counts.hunter), win.map((x) => x.counts.grazer));
      const hunterAmp = amplitude(win.map((x) => x.counts.hunter));
      if (corr < -0.55 && hunterAmp > 6 && this._canFire('cycle', t, 40)) {
        out.push(ev('predator-prey-cycle', t,
          `Predator and prey are locked in a cycle — hunters surge as grazers thin, then fall as prey grows scarce.`, 2));
      }
    }

    // trait divergence / proto-speciation via 1-D 2-means on size among grazers
    const graz = world.creatures.filter((c) => c.g.diet < 0.5).map((c) => c.g.size);
    if (graz.length > 40) {
      const split = twoMeans(graz);
      if (split && split.separation > 2.1 && split.minShare > 0.3 &&
          this._canFire('divergence', t, 75)) {
        out.push(ev('trait-divergence', t,
          `Grazers are splitting into two forms — a smaller, nimble type and a larger, sturdier one.`, 2));
      }
    }

    return out;
  }

  _peakSince(time) {
    let best = { pop: -1, t: 0 };
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const s = this.samples[i];
      if (s.t < time) break;
      if (s.pop > best.pop) best = s;
    }
    return best;
  }

  _indexBefore(time) {
    for (let i = this.samples.length - 1; i >= 0; i--) {
      if (this.samples[i].t <= time) return i;
    }
    return -1;
  }

  // Compact state for the narrator: current snapshot + trait drift vs ~60s ago.
  summarize(world) {
    const s = this.samples[this.samples.length - 1] || this._snapshot(world);
    const past = this.samples[this._indexBefore(s.t - 60)] || this.samples[0];
    const drift = {};
    if (past) {
      for (const k of TRAIT_KEYS) {
        drift[k] = +(s.avg[k] - past.avg[k]).toFixed(3);
      }
    }
    const recent = this.events.slice(-6).map((e) => ({ t: Math.round(e.t), what: e.text }));
    const bd = world.births_deaths;
    return {
      sim_time_seconds: Math.round(world.time),
      population: s.pop,
      food_available: s.food,
      clusters: s.counts,
      average_traits: roundObj(s.avg),
      trait_drift_last_60s: drift,
      cumulative: {
        births: bd.births,
        starved: bd.starved,
        died_of_age: bd.aged,
        predated: bd.predated,
      },
      recent_events: recent,
    };
  }
}

function ev(type, t, text, severity) {
  return { type, t, text, severity };
}

function roundObj(o) {
  const r = {};
  for (const k in o) r[k] = +o[k].toFixed(3);
  return r;
}

// Pearson correlation, returned directly (negative = anti-correlated).
function negCorr(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da === 0 || db === 0) return 0;
  return num / Math.sqrt(da * db);
}

function amplitude(a) {
  let lo = Infinity, hi = -Infinity;
  for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return hi - lo;
}

// One-dimensional 2-means; reports cluster separation relative to spread.
function twoMeans(vals) {
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-6) return null;
  let c0 = lo + (hi - lo) * 0.25;
  let c1 = lo + (hi - lo) * 0.75;
  for (let iter = 0; iter < 12; iter++) {
    let s0 = 0, n0 = 0, s1 = 0, n1 = 0;
    for (const v of vals) {
      if (Math.abs(v - c0) <= Math.abs(v - c1)) { s0 += v; n0++; }
      else { s1 += v; n1++; }
    }
    if (n0) c0 = s0 / n0;
    if (n1) c1 = s1 / n1;
  }
  let n0 = 0, n1 = 0, var0 = 0, var1 = 0;
  for (const v of vals) {
    if (Math.abs(v - c0) <= Math.abs(v - c1)) { n0++; var0 += (v - c0) ** 2; }
    else { n1++; var1 += (v - c1) ** 2; }
  }
  if (!n0 || !n1) return null;
  const sd = Math.sqrt((var0 + var1) / vals.length) || 1e-6;
  const separation = Math.abs(c1 - c0) / sd;
  const minShare = Math.min(n0, n1) / vals.length;
  return { c0, c1, separation, minShare };
}

export { band };
