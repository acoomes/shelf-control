// Renders the itch.io page assets from the game itself: a 630x500 cover built from the app icon routine (index.html:
// drawIcon) and three phone-sized screenshots of the live build (level select, a level in play, the same level a few
// dispatches in). Usage: node tools/itch-assets.mjs <output dir>      Needs Playwright with Chromium, like tools/e2e.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

async function loadPlaywright() {
  try { return await import('playwright'); } catch (e) { /* not installed locally */ }
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const entry = createRequire(import.meta.url).resolve(path.join(root, 'playwright', 'package.json'));
    return await import(pathToFileURL(path.join(path.dirname(entry), 'index.mjs')).href);
  } catch (e) { /* no global install either */ }
  console.error('Playwright is not installed. Run `npm install` (devDependency) or `npm install -g playwright`, then `npx playwright install chromium`.');
  process.exit(2);
}

const out = process.argv[2]; if (!out) { console.error('usage: node tools/itch-assets.mjs <output dir>'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const here = path.dirname(new URL(import.meta.url).pathname);
const url = pathToFileURL(path.join(here, '..', 'index.html')).href + '?debug=0';   // the live look: no test-build label, no debug overlay
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
await page.goto(url); await page.waitForFunction(() => window.SC && SC.drawIcon && SC.Game);
const wait = (ms) => page.waitForTimeout(ms);

// the cover: the maskable icon on its own background colour, the title beneath
const cover = await page.evaluate(() => {
  const W = 630, H = 500, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const icon = document.createElement('canvas'); SC.drawIcon(icon, 512, true);
  const px = icon.getContext('2d').getImageData(4, 4, 1, 1).data;
  g.fillStyle = `rgb(${px[0]},${px[1]},${px[2]})`; g.fillRect(0, 0, W, H);
  const lum = (0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) / 255, ink = lum > 0.6 ? '#222' : '#fff';
  const s = 330; g.drawImage(icon, (W - s) / 2, 18, s, s);
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = 'bold 54px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'; g.fillText('Shelf Control', W / 2, 418);
  g.font = '24px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'; g.globalAlpha = 0.88; g.fillText('Stack the cats. Build the picture.', W / 2, 460);
  return c.toDataURL('image/png');
});
fs.writeFileSync(path.join(out, 'cover-630x500.png'), Buffer.from(cover.split(',')[1], 'base64'));

// the screenshots: the level select as it opens, level 3 fresh, level 3 a few dispatches in
await wait(400);
await page.screenshot({ path: path.join(out, 'shot-1-levels.png') });
await page.evaluate(() => { SC.Game.levelIndex = 2; SC.startLevel(SC.LEVELS[2]); });
await wait(900);
await page.screenshot({ path: path.join(out, 'shot-2-level.png') });
const design = async (x, y) => { const v = await page.evaluate(() => ({ s: SC.view.scale, ox: SC.view.ox, oy: SC.view.oy, d: SC.view.dpr })); return { x: v.ox / v.d + x * v.s, y: v.oy / v.d + y * v.s }; };
for (const lane of [0, 1, 2]) {
  const p = await page.evaluate((i) => ({ x: SC.Game.L.laneX(i), y: SC.Game.L.laneRows[0].y }), lane);
  const q = await design(p.x, p.y); await page.mouse.click(q.x, q.y); await wait(1400);
}
await wait(1200);
await page.screenshot({ path: path.join(out, 'shot-3-play.png') });
await browser.close();
console.log(`wrote cover-630x500.png, shot-1-levels.png, shot-2-level.png, shot-3-play.png to ${out}`);
