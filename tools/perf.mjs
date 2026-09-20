#!/usr/bin/env node
// Frame-time probe for Shelf Control (plan §12 Phase 2: no drops below 55 fps during a full parade with confetti).
// Real clock, viewport 390x844 at deviceScaleFactor 2, CPU throttled 4x via CDP to approximate a mid-range phone.
//   node tools/perf.mjs            # prints p50 / p95 / max frame time and the share of frames over 18.2 ms per phase
//   THROTTLE=1 node tools/perf.mjs # no CPU throttling
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

async function loadPlaywright() {
  try { return await import('playwright'); } catch (e) { /* not installed locally */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const entry = createRequire(import.meta.url).resolve(path.join(root, 'playwright', 'package.json'));
    return await import(pathToFileURL(path.join(path.dirname(entry), 'index.mjs')).href);
  } catch (e) { /* no global install either */ }
  console.error('Playwright is not installed. Run `npm install` or `npm install -g playwright`.'); process.exit(2);
}
const { chromium } = await loadPlaywright();
const PAGE_URL = 'file://' + path.resolve(path.dirname(new globalThis.URL(import.meta.url).pathname), '..', 'index.html');
const THROTTLE = Number(process.env.THROTTLE || 4);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(PAGE_URL);
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

async function sample(label, ms) {
  const r = await page.evaluate((ms) => new Promise(resolve => {
    const d = []; let last = performance.now(); const t0 = last;
    const f = (now) => { d.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(f); else resolve(d.slice(1)); };
    requestAnimationFrame(f);
  }), ms);
  r.sort((a, b) => a - b);
  const q = (p) => r[Math.min(r.length - 1, Math.floor(p * r.length))];
  const over = r.filter(x => x > 18.2).length / r.length;
  console.log(`${label.padEnd(22)} frames ${String(r.length).padStart(4)}  p50 ${q(0.5).toFixed(1).padStart(5)} ms  p95 ${q(0.95).toFixed(1).padStart(5)} ms  max ${q(1).toFixed(1).padStart(5)} ms  >18.2ms ${(over * 100).toFixed(1)}%`);
  return { label, p50: q(0.5), p95: q(0.95), max: q(1), over };
}
const wait = (ms) => page.waitForTimeout(ms);

await wait(300);
const idle = await sample('level select (idle)', 2000);
await page.evaluate(() => { SC.Game.levelIndex = 5; SC.startLevel(SC.LEVELS[5]); });   // rainbow: 12 wide, 4 lanes
await wait(200);
const start = await sample('level start (no cats)', 2000);
// five cats in flight, blocks falling and landing
await page.evaluate(() => { for (let i = 0; i < 5; i++) SC.tap({ kind: 'lane', lane: i % 4 }); });
const parade = await sample('5-cat parade', 3500);
// keep the parade going: tap again as capacity frees
await page.evaluate(() => { for (let i = 0; i < 5; i++) SC.tap({ kind: 'lane', lane: (i + 1) % 4 }); });
const parade2 = await sample('second parade', 3000);
// win with confetti on a tiny level
await page.evaluate(() => { SC.Game.levelIndex = -1; SC.startLevel({ id: 'fx-win', name: 'Win', art: ['RRRRRR', 'BBBBBB'], lanes: ['B6 R6'] }); });
await wait(100);
await page.evaluate(() => { SC.tap({ kind: 'lane', lane: 0 }); });
await wait(400);
await page.evaluate(() => { SC.tap({ kind: 'lane', lane: 0 }); });
await wait(3800);
const st = await page.evaluate(() => SC.Game.state);
const win = await sample(`win + confetti (${st})`, 1800);
// CPU profile of a parade to name the hot functions
await page.evaluate(() => { SC.Game.levelIndex = 4; SC.startLevel(SC.LEVELS[4]); });
await wait(200);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start');
await page.evaluate(() => { for (let i = 0; i < 5; i++) SC.tap({ kind: 'lane', lane: i % 3 }); });
await wait(3500);
const { profile } = await cdp.send('Profiler.stop');
const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n]));
const dt = profile.timeDeltas; let total = 0;
for (let i = 0; i < profile.samples.length; i++) { const n = byId.get(profile.samples[i]); const k = `${n.callFrame.functionName || '(anonymous)'} @${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); total += dt[i] || 0; }
const top = [...self.entries()].filter(([k]) => !/^\(program\)|^\(idle\)|^\(garbage/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('\nTop self-time during a 5-cat parade (CPU profile):');
for (const [k, us] of top) console.log(`  ${(us / 1000).toFixed(1).padStart(7)} ms  ${(100 * us / total).toFixed(1).padStart(5)}%  ${k}`);
console.log(`\nthrottle ${THROTTLE}x · dpr 2 · errors: ${errors.length ? errors.join('; ') : 'none'}`);
const worst = [idle, start, parade, parade2, win].reduce((a, b) => (b.over > a.over ? b : a));
console.log(`worst phase: ${worst.label} with ${(worst.over * 100).toFixed(1)}% of frames over 18.2 ms (target: 0% at 60 Hz, i.e. never below 55 fps)`);
await browser.close();
