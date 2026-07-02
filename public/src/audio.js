// All sound is synthesized with the Web Audio API — no asset files. A filtered
// noise bed for rain, and a two-thump heartbeat whose tempo climbs as composure
// falls below 40. Starts muted-until-gesture per browser autoplay rules.

export function createAudio() {
  let ctx = null, master = null, rainGain = null;
  let heartTimer = null, bpm = 0, targetBpm = 0;
  let muted = false, started = false;

  function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    // ---- rain: brown-ish noise through a lowpass, gently wobbling ----
    const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2 + white * 0.15;
    }
    const rain = ctx.createBufferSource();
    rain.buffer = buf; rain.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.4;
    rainGain = ctx.createGain(); rainGain.gain.value = 0.5;
    // slow filter wobble = wind
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.08; lfoGain.gain.value = 500;
    lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
    rain.connect(lp); lp.connect(rainGain); rainGain.connect(master);
    rain.start(); lfo.start();
  }

  function thump() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const beat = (delay, freq, gain) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(freq, now + delay);
      o.frequency.exponentialRampToValueAtTime(freq * 0.55, now + delay + 0.14);
      g.gain.setValueAtTime(0.0001, now + delay);
      g.gain.exponentialRampToValueAtTime(gain, now + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.22);
      o.connect(g); g.connect(master);
      o.start(now + delay); o.stop(now + delay + 0.3);
    };
    beat(0, 62, 0.55);       // lub
    beat(0.16, 52, 0.4);     // dub

    bpm += (targetBpm - bpm) * 0.3;
    const interval = 60000 / Math.max(40, bpm);
    heartTimer = setTimeout(thump, interval);
  }

  return {
    // called on first user gesture
    start() {
      if (started) return;
      ensure();
      ctx.resume?.();
      started = true;
      master.gain.linearRampToValueAtTime(muted ? 0 : 0.9, ctx.currentTime + 1.2);
    },
    // composure drives the heartbeat: silent while calm, rising under 40
    setComposure(c) {
      if (c < 42) {
        targetBpm = 58 + (42 - c) * 2.2;      // 58 → ~150 near zero
        if (!heartTimer && started) { bpm = targetBpm; thump(); }
      } else {
        targetBpm = 0;
        if (heartTimer) { clearTimeout(heartTimer); heartTimer = null; }
      }
    },
    // a short sting when a contradiction lands
    sting() {
      if (!ctx || muted) return;
      const now = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(180, now);
      o.frequency.exponentialRampToValueAtTime(40, now + 0.5);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.4, now + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      o.connect(f); f.connect(g); g.connect(master);
      o.start(now); o.stop(now + 0.65);
    },
    toggleMute() {
      muted = !muted;
      if (ctx && started) master.gain.linearRampToValueAtTime(muted ? 0 : 0.9, ctx.currentTime + 0.3);
      return muted;
    },
    isMuted: () => muted,
  };
}
