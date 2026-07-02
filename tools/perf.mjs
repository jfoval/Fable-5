async function loadPlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright/index.js']) {
    try { const m = await import(p); return m.chromium || m.default?.chromium; } catch {}
  }
  throw new Error('Playwright not found — `npm i -g playwright` or run `npm run tune` instead.');
}
const chromium = await loadPlaywright();
import { tmpdir } from 'node:os';
const OUT = process.env.OUT || tmpdir();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });

// keep default speed 2 to grow, wait until pop >= 300
await page.$eval('#speed', (el) => { el.value = '3'; el.dispatchEvent(new Event('input')); });
await page.waitForFunction(() => window.__primordial.world.creatures.length >= 300, { timeout: 20000 }).catch(()=>{});

// now set 1x and measure FPS over ~3s at whatever population
await page.$eval('#speed', (el) => { el.value = '1'; el.dispatchEvent(new Event('input')); });
const fps = await page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  function f(){ n++; if (performance.now()-t0 < 3000) requestAnimationFrame(f); else res({fps: Math.round(n*1000/(performance.now()-t0)), pop: window.__primordial.world.creatures.length}); }
  requestAnimationFrame(f);
}));
console.log('1x FPS:', JSON.stringify(fps));

// inspector: pick the creature nearest screen-center, click its screen position
const target = await page.evaluate(() => {
  const p = window.__primordial;
  let best=null,bd=1e9; const cx=p.world.width/2, cy=p.world.height/2;
  for (const c of p.world.creatures){ const d=(c.x-cx)**2+(c.y-cy)**2; if(d<bd){bd=d;best=c;} }
  if (!best) return null;
  const [sx, sy] = p.renderer.toScreen(best.x, best.y);
  return { id: best.id, sx, sy };
});
if (target) {
  const box = await page.$eval('#world', (el)=>{ const r=el.getBoundingClientRect(); return {l:r.left,t:r.top}; });
  await page.mouse.click(box.l + target.sx, box.t + target.sy);
  await page.waitForTimeout(300);
}
const inspectorText = await page.$eval('#inspector', (el) => el.textContent.replace(/\s+/g,' ').trim().slice(0,200));
console.log('inspector:', inspectorText);
await page.screenshot({ path: `${OUT}/shot-05-inspector.png` });
console.log('pageerrors:', errs.length, errs.slice(0,5));
await browser.close();
