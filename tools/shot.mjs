// Headless visual + smoke check. Loads the running app, watches for JS errors,
// lets the sim run, fires god-mode, and captures screenshots.
// Optional dev tool. Requires Playwright available on the machine. Tries the
// normal resolution first, then a couple of common global locations.
async function loadPlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright/index.js']) {
    try { const m = await import(p); return m.chromium || m.default?.chromium; } catch {}
  }
  throw new Error('Playwright not found — `npm i -g playwright` or run `npm run tune` for a headless check instead.');
}
const chromium = await loadPlaywright();

import { tmpdir } from 'node:os';
const URL = process.env.URL || 'http://localhost:5173';
const OUT = process.env.OUT || tmpdir();

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });

// crank speed to 10 to evolve fast
await page.$eval('#speed', (el) => { el.value = '10'; el.dispatchEvent(new Event('input')); });

async function stats() {
  return page.evaluate(() => {
    const p = window.__primordial;
    const s = p.emergence.summarize(p.world);
    return { pop: p.world.creatures.length, time: Math.round(p.world.time),
             clusters: s.clusters, avg: s.average_traits, gen: p.state.maxGen,
             events: p.emergence.events.length };
  });
}

await page.waitForTimeout(2500);
console.log('early:', JSON.stringify(await stats()));
await page.screenshot({ path: `${OUT}/shot-01-early.png` });

// run a while
await page.waitForTimeout(9000);
const mid = await stats();
console.log('mid:  ', JSON.stringify(mid));
await page.screenshot({ path: `${OUT}/shot-02-mid.png` });

// click a creature to open inspector
await page.mouse.click(800, 470);
await page.waitForTimeout(300);

// fire a meteor
await page.click('#btn-meteor');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/shot-03-meteor.png` });

await page.waitForTimeout(8000);
const late = await stats();
console.log('late: ', JSON.stringify(late));
await page.screenshot({ path: `${OUT}/shot-04-late.png` });

console.log('JS errors:', errors.length);
for (const e of errors.slice(0, 20)) console.log('  ', e);

await browser.close();
