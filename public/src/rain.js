// Rain streaking a dark window, drawn as falling streaks with occasional
// wind gusts and a faint fog at the base. Runs on its own canvas behind the
// stage. Cheap enough to leave running the whole game.

export function startRain(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, drops = [];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.width = innerWidth * dpr;
    H = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    const count = reduce ? 60 : Math.round((innerWidth * innerHeight) / 5200);
    drops = Array.from({ length: count }, () => spawn(true));
  }

  function spawn(anywhere) {
    const speed = 9 + Math.random() * 16;
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : -40,
      len: (6 + Math.random() * 18),
      speed,
      wind: 1.6 + Math.random() * 1.2,
      alpha: 0.12 + Math.random() * 0.28,
    };
  }

  let gust = 0, gustTarget = 0, t = 0;
  function frame() {
    t += 0.016;
    if (Math.random() < 0.006) gustTarget = (Math.random() - 0.5) * 3.2;
    gust += (gustTarget - gust) * 0.02;

    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';
    for (const d of drops) {
      const dx = (d.wind + gust) * (d.speed * 0.14);
      const dy = d.speed;
      ctx.strokeStyle = `rgba(200,210,225,${d.alpha})`;
      ctx.lineWidth = d.len > 16 ? 1.4 : 0.9;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - dx, d.y - d.len - dy * 0.4);
      ctx.stroke();
      d.x += dx;
      d.y += dy;
      if (d.y > H + 20 || d.x < -30 || d.x > W + 30) Object.assign(d, spawn(false));
    }
    // faint drifting fog near the floor
    const fog = ctx.createLinearGradient(0, H * 0.72, 0, H);
    fog.addColorStop(0, 'rgba(20,22,28,0)');
    fog.addColorStop(1, `rgba(30,33,40,${0.10 + Math.sin(t * 0.4) * 0.03})`);
    ctx.fillStyle = fog;
    ctx.fillRect(0, H * 0.72, W, H * 0.28);

    requestAnimationFrame(frame);
  }

  addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
}
