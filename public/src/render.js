// Canvas renderer. Creatures are drawn procedurally as glowing, organic cells —
// a radial-gradient body, a nucleus, and a few flagella — baked into cached
// sprites (keyed by species + size) so we can drawImage() hundreds of them per
// frame and hold 60fps. Colour encodes diet (grazer→teal, hunter→coral);
// brightness encodes energy.

const COL = {
  grazer: [70, 224, 168],
  omni: [234, 195, 106],
  hunter: [255, 107, 107],
};

function dietColor(diet) {
  // blend teal → amber → coral across diet 0..1
  const stops = [
    [0.0, COL.grazer],
    [0.5, COL.omni],
    [1.0, COL.hunter],
  ];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (diet >= stops[i][0] && diet <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const t = (diet - a[0]) / (b[0] - a[0] || 1);
  return [
    Math.round(a[1][0] + (b[1][0] - a[1][0]) * t),
    Math.round(a[1][1] + (b[1][1] - a[1][1]) * t),
    Math.round(a[1][2] + (b[1][2] - a[1][2]) * t),
  ];
}

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.sprites = new Map();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this._foodCanvasDirty = true;
    this._makeFoodSprite();
  }

  _makeFoodSprite() {
    const s = 14;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(s / 2, s / 2, 0.5, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(170,255,205,0.95)');
    g.addColorStop(0.4, 'rgba(90,220,150,0.7)');
    g.addColorStop(1, 'rgba(70,200,140,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    this._foodSprite = cv;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.cw = r.width; this.ch = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    // fit world into canvas (contain)
    const W = this.world.width, H = this.world.height;
    this.scale = Math.min(this.cw / W, this.ch / H);
    this.ox = (this.cw - W * this.scale) / 2;
    this.oy = (this.ch - H * this.scale) / 2;
  }

  // world → screen (CSS px)
  toScreen(x, y) {
    return [this.ox + x * this.scale, this.oy + y * this.scale];
  }
  toWorld(sx, sy) {
    return [(sx - this.ox) / this.scale, (sy - this.oy) / this.scale];
  }

  _sprite(diet, radius) {
    const bucket = Math.max(3, Math.round(radius));
    const dq = Math.round(diet * 6) / 6;
    const key = dq + ':' + bucket;
    let s = this.sprites.get(key);
    if (s) return s;

    const [r, g, b] = dietColor(dq);
    const pad = 7;
    const R = bucket;
    const size = Math.ceil((R + pad) * 2);
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d');
    const cx = size / 2, cy = size / 2;

    // outer glow
    const glow = c.createRadialGradient(cx, cy, R * 0.2, cx, cy, R + pad);
    glow.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
    glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
    c.fillStyle = glow;
    c.fillRect(0, 0, size, size);

    // flagella / cilia (organic wisps), pointing back (-x)
    c.strokeStyle = `rgba(${r},${g},${b},0.5)`;
    c.lineWidth = Math.max(1, R * 0.14);
    c.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      c.beginPath();
      c.moveTo(cx - R * 0.5, cy + i * R * 0.35);
      c.quadraticCurveTo(cx - R * 1.3, cy + i * R * 0.9, cx - R * 1.7, cy + i * R * 0.6);
      c.stroke();
    }

    // body: teardrop (rounded, slightly pointed toward +x heading)
    const body = c.createRadialGradient(cx + R * 0.3, cy - R * 0.3, R * 0.15, cx, cy, R);
    body.addColorStop(0, `rgba(${Math.min(255,r+70)},${Math.min(255,g+70)},${Math.min(255,b+70)},1)`);
    body.addColorStop(0.6, `rgba(${r},${g},${b},0.98)`);
    body.addColorStop(1, `rgba(${Math.round(r*0.5)},${Math.round(g*0.5)},${Math.round(b*0.5)},0.95)`);
    c.fillStyle = body;
    c.beginPath();
    c.moveTo(cx + R * 1.15, cy);                       // pointed front
    c.quadraticCurveTo(cx + R * 0.3, cy - R, cx - R * 0.5, cy - R * 0.7);
    c.quadraticCurveTo(cx - R * 1.0, cy, cx - R * 0.5, cy + R * 0.7);
    c.quadraticCurveTo(cx + R * 0.3, cy + R, cx + R * 1.15, cy);
    c.fill();

    // membrane rim
    c.strokeStyle = `rgba(${Math.min(255,r+40)},${Math.min(255,g+40)},${Math.min(255,b+40)},0.5)`;
    c.lineWidth = Math.max(0.8, R * 0.09);
    c.stroke();

    // nucleus
    c.fillStyle = `rgba(255,255,255,0.32)`;
    c.beginPath();
    c.arc(cx + R * 0.12, cy - R * 0.05, R * 0.32, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = `rgba(${r},${g},${b},0.9)`;
    c.beginPath();
    c.arc(cx + R * 0.12, cy - R * 0.05, R * 0.16, 0, Math.PI * 2);
    c.fill();

    s = { cv, half: size / 2, R };
    this.sprites.set(key, s);
    return s;
  }

  draw(selectedId) {
    const ctx = this.ctx;
    const W = this.world;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, this.cw, this.ch);

    // subtle ambient plankton grid
    this._drawField(ctx);

    // ---- food ---- (cached glow sprite, no per-dot shadowBlur → fast)
    const fs = this._foodSprite;
    const fsz = Math.max(4, 7 * this.scale);
    const fh = fsz / 2;
    for (let i = 0; i < W.food.length; i++) {
      const f = W.food[i];
      if (f.eaten) continue;
      ctx.drawImage(fs, this.ox + f.x * this.scale - fh, this.oy + f.y * this.scale - fh, fsz, fsz);
    }

    // ---- creatures ----
    const list = W.creatures;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const sx = this.ox + c.x * this.scale;
      const sy = this.oy + c.y * this.scale;
      const rad = c.radius * this.scale;
      const sp = this._sprite(c.g.diet, rad);
      const energyK = Math.max(0.4, Math.min(1.15, c.energy / 90));

      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(c.heading);
      ctx.globalAlpha = Math.min(1, 0.55 + energyK * 0.5);
      const s = (rad + 7) / sp.half;
      ctx.drawImage(sp.cv, -sp.half * s, -sp.half * s, sp.cv.width * s, sp.cv.height * s);
      ctx.restore();

      // event flashes
      if (c.attacking > 0) this._ring(ctx, sx, sy, rad + 6, `rgba(255,90,90,${c.attacking})`, 2);
      else if (c.eating > 0) this._ring(ctx, sx, sy, rad + 4, `rgba(120,235,175,${c.eating * 0.7})`, 1.5);

      if (c.id === selectedId) {
        this._ring(ctx, sx, sy, rad + 9 + Math.sin(W.tick * 0.15) * 2, 'rgba(111,211,255,0.95)', 2);
        // vision halo
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(111,211,255,0.12)';
        ctx.lineWidth = 1;
        ctx.arc(sx, sy, c.g.vision * this.scale, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  _ring(ctx, x, y, r, color, lw) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  _drawField(ctx) {
    // faint moving nutrient gradient dots for depth (cheap, static-ish)
    ctx.save();
    ctx.globalAlpha = 0.5;
    const g = ctx.createLinearGradient(0, 0, this.cw, this.ch);
    g.addColorStop(0, 'rgba(20,40,50,0.0)');
    g.addColorStop(1, 'rgba(30,20,50,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(this.ox, this.oy, this.world.width * this.scale, this.world.height * this.scale);
    // border of the arena
    ctx.strokeStyle = 'rgba(120,150,170,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.ox, this.oy, this.world.width * this.scale, this.world.height * this.scale);
    ctx.restore();
  }

  // hit-test for click-to-inspect (screen coords in CSS px)
  pick(sx, sy) {
    const [wx, wy] = this.toWorld(sx, sy);
    let best = null, bestD = Infinity;
    for (const c of this.world.creatures) {
      const dx = c.x - wx, dy = c.y - wy;
      const d = dx * dx + dy * dy;
      const rr = (c.radius + 8) * (c.radius + 8);
      if (d < rr && d < bestD) { bestD = d; best = c; }
    }
    return best;
  }
}

export { dietColor };
