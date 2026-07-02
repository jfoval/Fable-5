// Lightweight canvas charts — no libraries. Two views driven by the emergence
// sample history: population by species cluster (stacked area) and average
// trait values over generations (normalised multi-line).

const COLORS = {
  grazer: '#46e0a8', omnivore: '#eac36a', hunter: '#ff6b6b',
  speed: '#6fd3ff', size: '#b98bff', vision: '#8ad6a0',
  metabolism: '#f0a868', aggression: '#ff6b6b', diet: '#eac36a',
};

// trait normalisation ranges (mirror genome TRAITS)
const TR = {
  speed: [0.55, 3.2], size: [0.5, 2.6], vision: [45, 210],
  metabolism: [0.55, 2.0], aggression: [0, 1], diet: [0, 1],
};

function setup(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

export class Charts {
  constructor(popCanvas, traitCanvas, legendEl) {
    this.popCanvas = popCanvas;
    this.traitCanvas = traitCanvas;
    this.legendEl = legendEl;
    this.traitKeys = ['speed', 'size', 'vision', 'aggression', 'diet'];
    if (legendEl) {
      legendEl.innerHTML = this.traitKeys
        .map((k) => `<span><i style="background:${COLORS[k]}"></i>${k}</span>`)
        .join('');
    }
    window.addEventListener('resize', () => this._sizeDirty = true);
  }

  render(samples) {
    if (!samples.length) return;
    this._popChart(samples);
    this._traitChart(samples);
  }

  _popChart(samples) {
    const { ctx, w, h } = setup(this.popCanvas);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 4, r: 4, t: 8, b: 6 };
    const n = samples.length;
    let maxPop = 10;
    for (const s of samples) maxPop = Math.max(maxPop, s.pop);
    maxPop *= 1.1;

    const gx = (i) => pad.l + (i / Math.max(1, n - 1)) * (w - pad.l - pad.r);
    const gy = (v) => h - pad.b - (v / maxPop) * (h - pad.t - pad.b);

    // stacked areas: grazer (bottom) + omnivore + hunter
    const order = ['grazer', 'omnivore', 'hunter'];
    const stacks = samples.map((s) => {
      let acc = 0; const o = {};
      for (const k of order) { o[k] = [acc, acc + s.counts[k]]; acc += s.counts[k]; }
      return o;
    });

    for (const k of order) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) ctx.lineTo(gx(i), gy(stacks[i][k][1]));
      for (let i = n - 1; i >= 0; i--) ctx.lineTo(gx(i), gy(stacks[i][k][0]));
      ctx.closePath();
      ctx.fillStyle = hexA(COLORS[k], 0.5);
      ctx.fill();
      // top line
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = gx(i), y = gy(stacks[i][k][1]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = COLORS[k];
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    this._axis(ctx, w, h, pad, maxPop);
  }

  _traitChart(samples) {
    const { ctx, w, h } = setup(this.traitCanvas);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 4, r: 4, t: 8, b: 6 };
    const n = samples.length;
    const gx = (i) => pad.l + (i / Math.max(1, n - 1)) * (w - pad.l - pad.r);
    const gy = (v) => h - pad.b - v * (h - pad.t - pad.b); // v already 0..1

    // faint gridlines
    ctx.strokeStyle = 'rgba(120,150,170,0.08)';
    ctx.lineWidth = 1;
    for (let q = 0; q <= 1; q += 0.25) {
      ctx.beginPath(); ctx.moveTo(pad.l, gy(q)); ctx.lineTo(w - pad.r, gy(q)); ctx.stroke();
    }

    for (const k of this.traitKeys) {
      const [lo, hi] = TR[k];
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const norm = Math.max(0, Math.min(1, (samples[i].avg[k] - lo) / (hi - lo)));
        const x = gx(i), y = gy(norm);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = COLORS[k];
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }

  _axis(ctx, w, h, pad, maxPop) {
    ctx.fillStyle = 'rgba(147,162,174,0.7)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.round(maxPop)), pad.l + 1, pad.t + 8);
    ctx.fillText('0', pad.l + 1, h - pad.b - 1);
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
