// Renders the app icons with the game's own cat routine (index.html: drawIcon) and writes icons/*.png.
// Usage: node tools/icons.mjs        # uses the same Playwright Chromium as tools/e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Resolve Playwright from the local install first, then from the global npm root, else explain how to get it. */
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
const { chromium } = await loadPlaywright();

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'icons'); fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch(); const page = await browser.newPage();
await page.goto('file://' + path.join(root, 'index.html'));
await page.waitForFunction(() => window.SC && SC.drawIcon);
for (const [name, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true], ['apple-touch-icon.png', 180, false]]) {
  const dataUrl = await page.evaluate(([size, maskable]) => { const c = document.createElement('canvas'); SC.drawIcon(c, size, maskable); return c.toDataURL('image/png'); }, [size, maskable]);
  fs.writeFileSync(path.join(out, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`wrote icons/${name}`);
}
await browser.close();
