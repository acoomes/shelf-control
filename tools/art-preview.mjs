// Puts a picture on the shelf and photographs it, to judge a new art's feel before any level is baked from it: the level
// as it opens (the picture ghosted, the cats waiting), then the shelf with every block placed. Also writes the picture on
// its own. Usage: node tools/art-preview.mjs <artId> <output dir>      Needs Playwright with Chromium, like tools/e2e.mjs.
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

const [artId, out] = process.argv.slice(2);
if (!artId || !out) { console.error('usage: node tools/art-preview.mjs <artId> <output dir>'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });
const here = path.dirname(new URL(import.meta.url).pathname);
const url = pathToFileURL(path.join(here, '..', 'index.html')).href + '?debug=0';
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
await page.goto(url); await page.waitForFunction(() => window.SC && SC.ARTS);
const info = await page.evaluate((id) => {
  const a = SC.ARTS[id]; if (!a) return null;
  const t0 = performance.now();
  const lv = SC.GEN.generateLevel({ art: a.art, artId: id, preset: 'medium', seed: 3, candidates: 24, playouts: 40 });
  SC.UI.playGenerated(lv, 'build');
  const L = SC.Game.L;
  return { name: a.name, w: L.W, h: L.h ?? L.H, cell: L.cell, blocks: a.art.join('').replace(/\./g, '').length, cats: SC.Game.sim.cats.length, refLine: Array.isArray(lv.ref) ? lv.ref.length : null, achieved: lv.achieved, genMs: Math.round(performance.now() - t0) };
}, artId);
if (!info) { console.error(`no art "${artId}"`); process.exit(2); }
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(out, `${artId}-fresh.png`) });
await page.evaluate(() => { SC.Game.present = SC.Game.sim.cols.map(s => s.map(() => true)); });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, `${artId}-done.png`) });
const palette = Object.fromEntries([...fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8').matchAll(/\b([A-Z]):\{ name:'[^']*',\s*hex:'(#[0-9A-Fa-f]{6})' \}/g)].map(m => [m[1], m[2]]));
const png = await page.evaluate(([id, palette]) => {
  const art = SC.ARTS[id].art, s = 24, c = document.createElement('canvas'); c.width = art[0].length * s; c.height = art.length * s; const g = c.getContext('2d');
  art.forEach((row, r) => [...row].forEach((k, col) => { if (k === '.') return; g.fillStyle = palette[k]; g.fillRect(col * s, r * s, s - 1, s - 1); }));
  return c.toDataURL('image/png');
}, [artId, palette]);
fs.writeFileSync(path.join(out, `${artId}-art.png`), Buffer.from(png.split(',')[1], 'base64'));
await browser.close();
console.log(`${info.name}: ${info.w}x${info.h}, ${info.blocks} blocks, cell ${info.cell}px, ${info.cats} cats, reference line ${info.refLine} dispatches, random-win ${Math.round(info.achieved * 100)}%, generated in ${info.genMs} ms`);
