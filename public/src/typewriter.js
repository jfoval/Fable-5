// Typewriter reveal for suspect dialogue. Resolves when the line finishes (or
// when the player clicks to skip). Respects reduced-motion by rendering whole.

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function typewrite(el, text, { cps = 42, onTick } = {}) {
  el.textContent = '';
  el.classList.add('caret');
  if (reduce) { el.textContent = text; el.classList.remove('caret'); return Promise.resolve(); }

  return new Promise((resolve) => {
    let i = 0;
    const chars = [...text];
    let raf, last = 0;
    const interval = 1000 / cps;
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      el.textContent = text;
      el.classList.remove('caret');
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', skip);
      resolve();
    }
    function skip() { finish(); }

    function step(ts) {
      if (!last) last = ts;
      const due = Math.floor((ts - last) / interval);
      if (due > 0) {
        i = Math.min(chars.length, i + due);
        el.textContent = chars.slice(0, i).join('');
        last = ts;
        onTick?.(chars[i - 1]);
      }
      if (i >= chars.length) return finish();
      raf = requestAnimationFrame(step);
    }
    document.addEventListener('pointerdown', skip);
    raf = requestAnimationFrame(step);
  });
}
