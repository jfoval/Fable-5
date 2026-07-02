// The suspect: a procedural silhouette seated in the lamp pool. Not a sprite —
// every limb is drawn each frame so the idle behaviour can decay smoothly.
// High composure: near-still, slow breathing. As it falls: sway, table taps,
// a hand dragged down the face, a fine tremor. On a landed hit: a flinch.

export function startStage(canvas) {
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, cx = 0, floor = 0, scale = 1;

  let composure = 100;      // 0..100
  let shown = 100;          // eased
  let active = false;       // is an interrogation on screen
  let t = 0;
  let flinch = 0;           // decays after a hit
  let wipe = 0;             // 0..1 hand-to-face progress
  let nextWipe = 6;
  let tapPhase = -1;        // >=0 while tapping

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.width = innerWidth * dpr;
    H = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    cx = W / 2;
    scale = Math.min(W, H * 1.15) / 720;
    floor = H * 0.86;
  }

  // ---- drawing helpers ----------------------------------------------------
  function limb(x1, y1, x2, y2, w) {
    ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function draw() {
    t += 0.016;
    shown += (composure - shown) * 0.05;
    flinch *= 0.9;
    ctx.clearRect(0, 0, W, H);
    if (!active) return requestAnimationFrame(draw);

    const dread = (100 - shown) / 100;              // 0 calm .. 1 broken
    const breath = Math.sin(t * (1.1 + dread * 1.4)) * (2 + dread * 3) * scale;
    const tremor = reduce ? 0 : (Math.random() - 0.5) * dread * 3.4 * scale;
    const sway = Math.sin(t * 0.8) * dread * 10 * scale;
    const flx = flinch * 14 * scale * Math.sin(t * 40);

    // schedule involuntary tells more often as dread rises
    if (!reduce && wipe <= 0 && t > nextWipe && dread > 0.25) {
      wipe = 0.0001; nextWipe = t + 4 + Math.random() * 6;
    }
    if (wipe > 0) { wipe += 0.02; if (wipe >= 1) wipe = 0; }
    if (tapPhase < 0 && dread > 0.15 && Math.random() < 0.006 + dread * 0.02) tapPhase = 0;
    if (tapPhase >= 0) { tapPhase += 0.14; if (tapPhase > Math.PI * 4) tapPhase = -1; }

    const ox = cx + sway + tremor + flx;
    const s = scale;

    // ---- long cast shadow (lamp is above/front) ----
    const g = ctx.createRadialGradient(cx, floor + 8 * s, 10 * s, cx, floor + 8 * s, 260 * s);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, floor + 8 * s, 240 * s, 34 * s, 0, 0, Math.PI * 2); ctx.fill();

    // geometry of the seated figure (relative to floor)
    const hipY = floor - 40 * s;
    const shoulderY = hipY - 150 * s + breath * 0.3;
    const neckY = shoulderY - 6 * s;
    const headY = neckY - 52 * s + breath * 0.5;
    const shoulderW = 92 * s;

    const bodyFill = '#050506';
    const rim = 'rgba(232,182,103,0.5)';

    // ---- torso (trapezoid, seated) ----
    ctx.fillStyle = bodyFill;
    ctx.beginPath();
    ctx.moveTo(ox - shoulderW, shoulderY);
    ctx.quadraticCurveTo(ox - shoulderW - 8 * s, (shoulderY + hipY) / 2, ox - 74 * s, hipY);
    ctx.lineTo(ox + 74 * s, hipY);
    ctx.quadraticCurveTo(ox + shoulderW + 8 * s, (shoulderY + hipY) / 2, ox + shoulderW, shoulderY);
    ctx.quadraticCurveTo(ox, shoulderY - 26 * s, ox - shoulderW, shoulderY);
    ctx.closePath();
    ctx.fill();

    // rim light down the left edge of the torso
    ctx.strokeStyle = rim; ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(ox - shoulderW, shoulderY);
    ctx.quadraticCurveTo(ox - shoulderW - 8 * s, (shoulderY + hipY) / 2, ox - 74 * s, hipY);
    ctx.stroke();

    // ---- neck + head ----
    ctx.fillStyle = bodyFill;
    limb(ox, neckY + 10 * s, ox, neckY - 6 * s, 26 * s);
    const headTilt = Math.sin(t * 0.6) * dread * 0.12;
    ctx.save();
    ctx.translate(ox, headY);
    ctx.rotate(headTilt);
    ctx.beginPath();
    ctx.ellipse(0, 0, 30 * s, 36 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    // rim on head
    ctx.strokeStyle = rim; ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.ellipse(-2 * s, -2 * s, 30 * s, 36 * s, 0, Math.PI * 0.55, Math.PI * 1.35); ctx.stroke();
    ctx.restore();

    // ---- arms & hands on the table ----
    const tableY = hipY - 8 * s;
    const handRest = 66 * s;
    // left arm — becomes the wiping arm
    ctx.strokeStyle = bodyFill;
    const lShoulder = [ox - shoulderW + 8 * s, shoulderY + 8 * s];
    let lHand;
    if (wipe > 0) {
      // raise hand to the face and drag down
      const p = Math.sin(wipe * Math.PI);              // up then down
      const hx = ox - 20 * s;
      const hy = headY + 30 * s - p * 42 * s;
      lHand = [hx, hy];
    } else {
      lHand = [ox - handRest, tableY + Math.sin(t * 1.3) * dread * 2 * s];
    }
    const lElbow = [lShoulder[0] - 14 * s, (lShoulder[1] + lHand[1]) / 2 + 18 * s];
    limb(lShoulder[0], lShoulder[1], lElbow[0], lElbow[1], 20 * s);
    limb(lElbow[0], lElbow[1], lHand[0], lHand[1], 17 * s);
    dot(lHand[0], lHand[1], 9 * s, bodyFill, rim);

    // right arm — taps the table when tapping
    const rShoulder = [ox + shoulderW - 8 * s, shoulderY + 8 * s];
    const tap = tapPhase >= 0 ? Math.max(0, Math.sin(tapPhase)) * 10 * s : 0;
    const rHand = [ox + handRest, tableY - tap + Math.sin(t * 1.1) * dread * 2 * s];
    const rElbow = [rShoulder[0] + 14 * s, (rShoulder[1] + rHand[1]) / 2 + 18 * s];
    limb(rShoulder[0], rShoulder[1], rElbow[0], rElbow[1], 20 * s);
    limb(rElbow[0], rElbow[1], rHand[0], rHand[1], 17 * s);
    dot(rHand[0], rHand[1], 9 * s, bodyFill, rim);

    // the table edge, catching a sliver of lamplight
    ctx.strokeStyle = 'rgba(232,182,103,0.16)';
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.moveTo(cx - 300 * s, tableY + 26 * s);
    ctx.lineTo(cx + 300 * s, tableY + 26 * s);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(cx - 320 * s, tableY + 26 * s, 640 * s, H);

    requestAnimationFrame(draw);
  }

  function dot(x, y, r, fill, rim) {
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = rim; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(x - r * 0.2, y - r * 0.2, r, Math.PI * 0.6, Math.PI * 1.4); ctx.stroke();
  }

  addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);

  return {
    setComposure: (v) => { composure = Math.max(0, Math.min(100, v)); },
    setActive: (v) => { active = v; },
    flinch: () => { flinch = 1; wipe = 0.0001; },
  };
}
