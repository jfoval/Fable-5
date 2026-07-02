// shot.mjs — headless browser smoke test: boots the app, plays a few hands at
// high speed, captures console errors, and screenshots the broadcast + modals.
// Uses the pre-installed Chromium; playwright-core is resolved from an env path
// so it stays out of the project's dependencies.
//
//   PW=/path/to/playwright-core node tools/shot.mjs

import { spawn } from 'node:child_process';
import path from 'node:path';

const PW = process.env.PW || 'playwright-core';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = process.env.OUT || '/tmp/bluff-shots';
const pw = await import(PW);
const chromium = pw.chromium || pw.default?.chromium;

import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });

// boot server on a test port with NO api key (offline/scripted path)
const server = spawn('node', ['server.js'], { env: { ...process.env, PORT: '5199', ANTHROPIC_API_KEY: '' }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const errors = [];
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
// Ignore blocked external font CDN (environmental network policy), not an app bug.
const isEnvNoise = (t) => /fonts\.googleapis|fonts\.gstatic|favicon|Failed to load resource/.test(t);
page.on('console', (m) => { if (m.type() === 'error' && !isEnvNoise(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => { if (!isEnvNoise(r.url())) errors.push('REQFAIL: ' + r.url()); });

try {
  await page.goto('http://localhost:5199/', { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(OUT, '1-setup.png') });

  // Start match at 3x
  await page.click('#start');
  await page.waitForSelector('#stage:not(.hidden)');
  await page.click('.ctrl.sp[data-speed="3"]');
  await page.click('#btnComm'); // enable commentator (offline -> local lines)

  // Let the scripted classic hand play out.
  await page.waitForTimeout(9000);
  await page.screenshot({ path: path.join(OUT, '2-broadcast.png') });

  // Wait for the verdict banner to actually show, then capture it.
  let verdictText = '';
  for (let i = 0; i < 40; i++) {
    const v = await page.evaluate(() => {
      const el = document.querySelector('#verdict.show .vb-inner');
      return el ? el.textContent : '';
    });
    if (v) { verdictText = v; break; }
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: path.join(OUT, '2b-verdict.png') });
  const verdictSeen = !!verdictText;

  // Let a couple more hands run.
  await page.waitForTimeout(8000);
  await page.screenshot({ path: path.join(OUT, '3-more.png') });

  // Open audit modal.
  await page.click('#btnAudit');
  await page.waitForSelector('#auditModal:not(.hidden)');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, '4-audit.png') });
  const auditClean = await page.evaluate(() => !!document.querySelector('.audit-status.clean'));
  const auditPayloads = await page.evaluate(() => document.querySelectorAll('.audit-item').length);
  await page.keyboard.press('Escape');

  // Open replay.
  await page.click('#btnReplay');
  await page.waitForSelector('#replayModal:not(.hidden)');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '5-replay.png') });
  const replaySteps = await page.evaluate(() => document.querySelectorAll('.replay-step').length);

  console.log(JSON.stringify({
    errors, verdictSeen, verdictText, auditClean, auditPayloads, replaySteps,
  }, null, 2));
} catch (e) {
  console.log('SMOKE ERROR:', e.message);
  errors.push(e.message);
} finally {
  await browser.close();
  server.kill();
}

console.log(errors.length ? `\n✗ ${errors.length} console/page errors` : '\n✔ no console errors');
process.exit(errors.length ? 1 : 0);
