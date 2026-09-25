#!/usr/bin/env node
// End-to-end scenarios for Shelf Control, driven through a real Chromium via Playwright (plan §13.2).
//   node tools/e2e.mjs                 # run every scenario
//   node tools/e2e.mjs grace stuck     # run a subset
//   SHOTS=/some/dir node tools/e2e.mjs # also save screenshots
// Uses Playwright's fake clock so a 90-second level plays in a few seconds of wall time.
import path from 'node:path';
import fs from 'node:fs';
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

const PAGE_URL = 'file://' + path.resolve(path.dirname(new globalThis.URL(import.meta.url).pathname), '..', 'index.html');
const SHOTS = process.env.SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };

// tiny fixture levels (each satisfies the loader: per colour, cat counts == cell counts)
const FIX = {
  graceSave: { id: 'fx-grace', name: 'Grace', art: ['GGGGGG', 'RRRRRR', 'BBBBBB'], lanes: ['R1 R1 R1 R1 R1 R1 B6 G6'] },
  stuck:     { id: 'fx-stuck', name: 'Stuck', art: ['RRRRRR', 'BBBBBB'], lanes: ['R1 R1 R1 R1 R1 R1 B6'] },
  dig:       { id: 'fx-dig',   name: 'Dig',   art: ['RRRR', 'BBBB'], lanes: ['R1 B4 R3'] },
  autoFin:   { id: 'fx-auto',  name: 'Auto',  art: ['RRRR', 'RRRR', 'RRRR', 'BBBB'], lanes: ['B4 R12'] },       // one cat, three laps
  autoLate:  { id: 'fx-auto2', name: 'Late',  art: ['RRRR', 'RRRR', 'GGGG'], lanes: ['R8', 'G4'] },             // becomes the last cat while in flight
  autoNo:    { id: 'fx-auto3', name: 'NoAuto', art: ['RRRR', 'RRRR', 'RRRR', 'BBBB'], lanes: ['B4 R8 R4'] },     // never the last cat with blocks until its final lap
};

async function open(opts = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: opts.dpr || 2, reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  const t0 = new Date(opts.time || '2026-01-01T00:00:00Z');
  await page.clock.install({ time: t0 });
  await page.goto(PAGE_URL + (opts.query || ''));
  await page.clock.pauseAt(new Date(t0.getTime() + 1000));   // frozen between calls: no real-time drift in the game clock
  await page.clock.runFor(300);
  // With the clock paused, Playwright's own rAF-polling waits (page.click / textContent on selectors) would hang, so
  // DOM interaction goes through evaluate(): clickSel finds an element (optionally by text or index) and clicks it.
  const findIn = (sel, text, index) => { const m = /^(.*):has-text\("(.*)"\)$/.exec(sel); const base = m ? m[1] : sel; const want = m ? m[2] : text; const all = [...document.querySelectorAll(base)].filter(e => want == null || e.textContent.includes(want)); return all[index || 0] || null; };
  const api = {
    page, browser, errors, dpr: opts.dpr || 2,
    async run(ms) { await page.clock.runFor(ms); },
    async clickSel(sel, index = 0) { const found = await page.evaluate(([sel, index, f]) => { const el = (new Function('return ' + f)())(sel, null, index); if (!el) return false; el.click(); return true; }, [sel, index, findIn.toString()]); if (!found) throw new Error('no element ' + sel); await page.clock.runFor(20); },
    async text(sel) { return page.evaluate((sel) => { const el = document.querySelector(sel); return el ? el.textContent : ''; }, sel); },
    async shot(name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); },
    async start(level, o = {}) { await page.evaluate(([lv, o]) => { SC.Game.levelIndex = typeof lv === 'number' ? lv : -1; SC.startLevel(typeof lv === 'number' ? SC.LEVELS[lv] : lv, o); }, [level, o]); await page.clock.runFor(100); },
    async design(x, y) { const v = await page.evaluate(() => ({ s: SC.view.scale, ox: SC.view.ox, oy: SC.view.oy, d: SC.view.dpr })); return { x: v.ox / v.d + x * v.s, y: v.oy / v.d + y * v.s }; },
    async clickDesign(x, y) { const p = await api.design(x, y); await page.mouse.click(p.x, p.y); await page.clock.runFor(20); },
    async tapLane(i) { const p = await page.evaluate((i) => ({ x: SC.Game.L.laneX(i), y: SC.Game.L.laneRows[0].y }), i); await api.clickDesign(p.x, p.y); },
    async tapDeep(i) { const p = await page.evaluate((i) => ({ x: SC.Game.L.laneX(i), y: SC.Game.L.laneRows[1].y }), i); await api.clickDesign(p.x, p.y); },
    async tapBox(slot) { const p = await page.evaluate((s) => { const tr = SC.Game.L.tray(SC.Game.sim.boxes.length); return { x: tr.cx(s), y: tr.y + tr.h / 2 }; }, slot); await api.clickDesign(p.x, p.y); },
    async snap() { return page.evaluate(() => { const G = SC.Game, s = G.sim ? G.sim.snapshot() : null; return { state: G.state, status: s && s.status, reason: s && s.failReason, ptr: s && s.ptr, boxes: s && s.boxes, inFlight: s && s.inFlight, lanes: s && s.lanes, stats: G.sim && G.sim.stats, blocks: G.blocks.length, landed: G.present.flat().filter(Boolean).length, placed: G.sim && G.sim.placedCount(), total: G.sim && G.sim.totalCells(), queue: G.queue.length, waiting: G.actors.filter(a => a.state === 'wait').map(a => a.id), grace: G.graceHead ? G.graceHead.grace : null, boxesN: G.sim && G.sim.boxes.length, modal: SC.UI.modalOpen(), telemetry: G.telemetry.length, fps: G.fps }; }); },
    async settle(maxMs = 20000) { for (let t = 0; t < maxMs; t += 100) { await page.clock.runFor(100); const s = await api.snap(); if (s.inFlight.length === 0 && s.blocks === 0 && s.queue === 0) return s; } return api.snap(); },
    async close() { await browser.close(); },
  };
  return api;
}

/** Solve the current level with the turn-based solver and play its line, waiting for each pass to resolve (turn-based model). */
async function playSolution(api, { fast = true } = {}) {
  const { page } = api;
  const moves = await page.evaluate(() => { const G = SC.Game, sim = G.sim; const cols = sim.cols, L = sim.lanes.map(l => l.map(c => [c.color, c.count])); const r = SC.GEN.solve(cols, L, sim.boxes.length, 5e6); return r.line; });
  if (!moves) return null;
  const trayIds = [];
  for (let k = 0; k < moves.length; k++) {
    const [kind, idx] = moves[k];
    const catId = await page.evaluate(([kind, idx, trayIds]) => { const sim = SC.Game.sim; return kind === 'lane' ? sim.lanes[idx][0].id : trayIds[idx]; }, [kind, idx, trayIds]);
    if (kind === 'tray') trayIds.splice(idx, 1);
    // tap where the cat is
    const where = await page.evaluate((id) => { const c = SC.Game.sim.catById(id); return { where: c.where, lane: c.lane, slot: c.slot }; }, catId);
    if (fast) await page.evaluate((t) => SC.tap(t), where.where === 'lane' ? { kind: 'lane', lane: where.lane } : { kind: 'box', slot: where.slot });
    else if (where.where === 'lane') await api.tapLane(where.lane); else await api.tapBox(where.slot);
    const s = await api.settle(30000);
    const left = await page.evaluate((id) => SC.Game.sim.catById(id).count, catId);
    if (left > 0) trayIds.push(catId);
    if (s.state !== 'playing') break;
  }
  return moves.length;
}

const scenarios = {
  async win(api) {
    await api.start(0);
    const n = await playSolution(api);
    await api.run(1800);
    const s = await api.snap();
    ok(s.status === 'won' && s.state === 'won' && s.modal && s.telemetry === 1, `level 1 won by playing the solver line (${n} moves): state=${s.state} landed=${s.landed}/${s.total} telemetry=${s.telemetry}`);
    ok(s.landed === s.total && s.placed === s.total, 'every block landed visually and logically');
    await api.shot('win-card');
    const card = await api.text('#panel');
    ok(/done!/.test(card) && /dispatches/.test(card), `win card shows results: ${card.replace(/\s+/g, ' ').slice(0, 90)}`);
    await api.clickSel('#panel .btn.good');   // Next
    await api.run(300);
    const s2 = await api.snap();
    ok(s2.status === 'playing' && !s2.modal, 'Next starts level 2');
  },
  async allLevels(api) {
    for (let i = 0; i < 6; i++) {
      await api.start(i);
      const n = await playSolution(api);
      await api.run(1800);
      const s = await api.snap();
      ok(s.status === 'won' && s.landed === s.total, `level ${i + 1} (${await api.page.evaluate(() => SC.Game.def.name)}) won along the solver line: ${n} moves, ${s.stats.dispatches} dispatches, playTime ${await api.page.evaluate(() => SC.Game.playTime.toFixed(1))}s`);
    }
    const tele = await api.page.evaluate(() => SC.telemetry());
    ok(tele.every(r => r.standalone === false && r.daily === null && r.attempt === null), 'curated records carry standalone:false and no daily fields');
    ok(tele.length === 6 && tele.every(r => r.result === 'won' && typeof r.timeSec === 'number'), `six telemetry records: ${tele.map(r => `${r.level}:${r.timeSec}s/${r.dispatches}d/${r.maxBoxesUsed}b`).join(' ')}`);
  },
  async grace(api) {
    await api.start(FIX.graceSave);
    for (let i = 0; i < 5; i++) { await api.tapLane(0); const s = await api.settle(); ok(s.boxes.filter(b => b !== null).length === i + 1, `dig ${i + 1}: cat boxed (places 0)`); }
    await api.tapLane(0);                              // sixth R1: no box → waits
    for (let t = 0; t < 60; t++) { await api.run(100); const s = await api.snap(); if (s.waiting.length) break; }
    let s = await api.snap(); ok(s.waiting.length === 1 && s.inFlight.length === 1, `sixth cat waits at the slide end (grace running: ${s.grace && s.grace.toFixed(2)}s)`);
    await api.shot('grace-wait');
    const deny = await api.page.evaluate(() => SC.Game.sim.stats.deniedTaps);
    await api.tapBox(0); await api.run(50);
    s = await api.snap(); ok(s.stats.deniedTaps === deny + 1 && s.waiting.length === 1, 'boxed cat with nothing to place is denied (head shake), waiter still waiting');
    await api.tapLane(0);                              // B6: fills the bottom row; frontier becomes R
    await api.run(400);
    await api.tapBox(2);                               // a boxed R1 can now place → box 2 frees → grace save
    await api.run(600);
    s = await api.snap();
    ok(s.waiting.length === 0 && s.stats.graceSaves === 1 && s.state === 'playing', `grace save: waiter seated (graceSaves=${s.stats.graceSaves})`);
    await api.shot('grace-saved');
    s = await api.settle();
    ok(s.status === 'playing' && s.boxes.filter(b => b !== null).length === 5, `tray back to 5/5 after the save (boxes=${s.boxes.join(',')})`);
  },
  async graceFail(api) {
    await api.start(FIX.graceSave);
    for (let i = 0; i < 5; i++) { await api.tapLane(0); await api.settle(); }
    await api.tapLane(0);
    for (let t = 0; t < 60; t++) { await api.run(100); const s = await api.snap(); if (s.waiting.length) break; }
    await api.run(2600 + 900);                         // grace 2.5 s + fail sequence 0.8 s
    let s = await api.snap();
    ok(s.status === 'failed' && s.reason === 'no_box' && s.modal, `grace expired → failed/no_box, fail card shown (state=${s.state})`);
    await api.shot('fail-card');
    const txt = await api.text('#panel');
    ok(/No box was free/.test(txt) && /\+1 box/.test(txt), `fail card explains the reason and offers +1 box`);
    await api.clickSel('#panel .btn.good');          // +1 box and continue
    await api.run(600);
    s = await api.snap();
    ok(s.status === 'playing' && s.boxesN === 6 && s.waiting.length === 0 && s.stats.continuesUsed === 1, `+1 box: sixth box added, waiter seated, play resumes (boxes=${s.boxesN})`);
    await api.shot('after-continue');
    // finish the level: B6 (bottom row), the six boxed R1s (middle row), then G6 (top row)
    await api.tapLane(0); await api.settle();
    for (let i = 0; i < 6; i++) { await api.tapBox(i); await api.run(300); if (i === 3) await api.settle(); }   // ≤5 in flight (shelf capacity)
    await api.settle(); await api.tapLane(0); s = await api.settle(); await api.run(1800); s = await api.snap();
    ok(s.status === 'won', `won after the continue (6 boxes, stats: ${JSON.stringify(s.stats)})`);
    const tele = await api.page.evaluate(() => SC.telemetry());
    ok(tele.length === 2 && tele[0].result === 'failed' && tele[0].reason === 'no_box' && tele[1].result === 'won' && tele[1].continuesUsed === 1, `telemetry: ${JSON.stringify(tele.map(r => [r.result, r.reason, r.continuesUsed]))}`);
    // the accepted continue is an event of its own, and the play id ties it to the failure it rescued and the ending that followed
    const q = await api.page.evaluate(() => SC.Telemetry.queue().filter(e => e.event !== 'session_start').map(e => ({ event: e.event, play: e.properties.play, reason: e.properties.reason, result: e.properties.result, continuesUsed: e.properties.continuesUsed, placedPct: e.properties.placedPct })));
    ok(q.map(e => e.event).join(',') === 'level_start,level_end,level_continue,level_end', `queued events: ${q.map(e => e.event).join(', ')}`);
    ok(q.every(e => /^[0-9a-f]{8}$/.test(e.play) && e.play === q[0].play) && q[1].continuesUsed === 0 && q[2].reason === 'no_box' && q[2].placedPct === Number((txt.match(/(\d+)% of the picture/) || [])[1]) && q[3].result === 'won' && q[3].continuesUsed === 1 && tele[0].play === q[0].play, `one play id on all four (${q[0].play}); the continue names the failure it rescued and the card's ${q[2].placedPct}% placed`);
  },
  async stuck(api) {
    await api.start(FIX.stuck);
    for (let i = 0; i < 5; i++) { await api.tapLane(0); await api.settle(); }
    await api.run(300); let s = await api.snap();
    ok(s.status === 'playing', 'not yet stuck before the 0.8 s beat');
    await api.run(1600); s = await api.snap();
    ok(s.status === 'failed' && s.reason === 'stuck' && s.modal, `stuck detected after the beat, fail card after the sequence (state=${s.state}, reason=${s.reason})`);
    const txt = await api.text('#panel'); ok(/tray is full/.test(txt), 'stuck card explains in plain words');
    await api.clickSel('#panel .btn.good'); await api.run(300);
    s = await api.snap(); ok(s.status === 'playing' && s.boxesN === 6, '+1 box resolves the stuck state');
    await api.tapLane(0); await api.settle();                                   // sixth R1 digs into the new box
    await api.tapLane(0); await api.settle();                                   // B6 fills the bottom row
    for (let i = 0; i < 6; i++) { await api.tapBox(i); await api.run(300); if (i === 3) await api.settle(); }   // boxed R1s finish the top row, ≤5 in flight
    await api.settle(); await api.run(1800); s = await api.snap(); ok(s.status === 'won', 'won after stuck + continue');
    // Escape, the settings button and settings → Done must all leave the result card reachable
    await api.page.keyboard.press('Escape'); await api.run(50); s = await api.snap(); ok(s.modal, 'Escape leaves the win card open');
    await api.page.evaluate(() => document.getElementById('btn-settings').click()); await api.run(50);   // the backdrop covers the HUD, so drive the handler directly
    let txt2 = await api.text('#panel'); ok(/Settings/.test(txt2), 'settings opens on top of the win card');
    await api.clickSel('#panel .btn:has-text("Done")'); await api.run(50);
    txt2 = await api.text('#panel'); s = await api.snap(); ok(s.modal && /done!/.test(txt2), 'closing settings brings the win card back');
  },
  async tripleTap(api) {
    await api.start(1);                                // chick: 3 lanes
    // four taps inside one frame (the fake clock keeps flowing between Playwright round-trips, so enqueue synchronously
    // through the same path a pointer tap uses)
    const q = await api.page.evaluate(() => { SC.tap({ kind: 'lane', lane: 0 }); SC.tap({ kind: 'lane', lane: 1 }); SC.tap({ kind: 'lane', lane: 2 }); const mid = { d: SC.Game.sim.stats.dispatches, q: SC.Game.queue.length }; SC.tap({ kind: 'lane', lane: 0 }); return { mid, after: { d: SC.Game.sim.stats.dispatches, q: SC.Game.queue.length, denied: SC.Game.extraDenied } }; });
    ok(q.mid.d === 1 && q.mid.q === 2, `first tap dispatched immediately, two buffered (dispatches=${q.mid.d}, queue=${q.mid.q})`);
    ok(q.after.q === 2 && q.after.denied === 1 && q.after.d === 1, `fourth tap within the gap is a visible deny (buffer full), not dropped silently`);
    let s;
    await api.run(700); s = await api.snap();
    ok(s.stats.dispatches === 3 && s.inFlight.length === 3 && s.queue === 0, `three cats dispatched in order (inFlight=${s.inFlight.join(',')})`);
    const gaps = await api.page.evaluate(() => SC.Game.flight.map(a => a.pathS));
    ok(gaps[0] > gaps[1] && gaps[1] > gaps[2], `no overtaking: path positions ${gaps.map(g => g.toFixed(0)).join(' > ')}`);
    await api.shot('parade');
  },
  async shelfFull(api) {
    await api.start(4);                                // cat face: 3 lanes with plenty of cats
    await api.page.evaluate(() => { SC.CONFIG.walkSpeed = 1.5; });
    for (let i = 0; i < 5; i++) { await api.tapLane(i % 3); await api.run(320); }
    let s = await api.snap(); ok(s.inFlight.length === 5, 'five cats in flight');
    const d0 = s.stats.deniedTaps;
    await api.tapLane(0); s = await api.snap();
    ok(s.stats.deniedTaps === d0 + 1 && s.inFlight.length === 5, 'sixth tap: shelf_full soft deny');
    const flash = await api.page.evaluate(() => SC.Game.shelfFlash > 0);
    ok(flash, `shelf edge flashes on the deny (flash ${flash})`);
    await api.shot('shelf-full');
    await api.page.evaluate(() => { SC.CONFIG.walkSpeed = 4.5; });
  },
  async dig(api) {
    await api.start(FIX.dig);
    let s = await api.snap(); ok(s.lanes[0].length === 3, 'lane has 3 cats');
    await api.tapDeep(0); await api.run(50);
    const wig = await api.page.evaluate(() => SC.Game.actors[SC.Game.sim.lanes[0][0].id].wiggle > 0);
    ok(wig, 'tapping a non-front cat wiggles the front cat');
    await api.tapLane(0); s = await api.settle();
    ok(s.boxes[0] === 0 && s.stats.zeroPlaceDispatches === 1, 'front R1 places nothing and takes a box (dig)');
    await api.tapLane(0); await api.run(400); await api.tapBox(0); s = await api.settle();
    ok(s.ptr.join() === '2,1,1,1' || s.placed === 5, `B4 placed the row, boxed R1 placed on top (ptr=${s.ptr.join()})`);
    await api.tapLane(0); s = await api.settle(); await api.run(1800); s = await api.snap();
    ok(s.status === 'won', 'R3 finishes the picture');
  },
  async restartAndResize(api) {
    await api.start(2);
    await api.tapLane(0); await api.tapLane(1); await api.run(800);
    await api.clickSel('#btn-restart'); await api.run(100);
    let s = await api.snap();
    ok(s.status === 'playing' && s.inFlight.length === 0 && s.placed === 0 && s.landed === 0 && s.stats.dispatches === 0, 'restart is instant and clean');
    await api.page.setViewportSize({ width: 800, height: 600 }); await api.run(100);
    const v = await api.page.evaluate(() => ({ s: SC.view.scale, cw: SC.view.canvas.width, ch: SC.view.canvas.height }));
    ok(Math.abs(v.s - 600 / 844) < 1e-6 && v.cw === 1600 && v.ch === 1200, `landscape resize: scale ${v.s.toFixed(3)}, canvas ${v.cw}x${v.ch} (dpr 2)`);
    await api.shot('landscape');
    await api.page.setViewportSize({ width: 390, height: 844 }); await api.run(100);
  },
  async yoink(api) {
    await api.page.evaluate(() => { const lv = SC.GEN.generateLevel({ art: SC.ARTS.chick.art, artId: 'chick', preset: 'easy', seed: 7, reverse: true, candidates: 20, playouts: 40 }); SC.UI.playGenerated(lv, 'yoink'); });
    await api.run(100);
    let s = await api.snap();
    ok(s.status === 'playing' && s.landed === s.total, `yoink level starts with a full board (${s.landed}/${s.total} blocks present)`);
    const n = await playSolution(api);
    await api.run(1800); s = await api.snap();
    ok(s.status === 'won' && s.landed === 0, `yoink: solver line wins (${n} moves), board emptied (${s.landed} left)`);
    await api.shot('yoink-won');
    const tele = await api.page.evaluate(() => SC.telemetry());
    ok(tele[tele.length - 1].mode === 'yoink', 'telemetry records mode=yoink');
  },
  async generated(api) {
    await api.clickSel('.tile.gen'); await api.run(200);
    const t0 = Date.now();
    await api.clickSel('#panel .btn.good'); await api.run(1200);
    const s = await api.snap();
    ok(s.status === 'playing' && !s.modal, `generated level starts (wall ${Date.now() - t0} ms incl. UI)`);
    const def = await api.page.evaluate(() => ({ id: SC.Game.def.id, achieved: SC.Game.def.achieved, ms: SC.Game.def.genMs }));
    ok(def.id.startsWith('gen-') && def.ms < 400, `generation ${def.ms} ms, achieved ${def.achieved}`);
  },
  async reduced(api) {
    await api.start(4);
    await api.page.evaluate(() => { SC.settings.motion = 'on'; SC.CONFIG.walkSpeed = 1.5; });
    for (let i = 0; i < 5; i++) { await api.tapLane(i % 3); await api.run(320); }
    await api.tapLane(0); await api.run(30);                              // shelf_full deny → shake starts
    const a = await api.page.evaluate(() => { const c = SC.Game.sim.lanes[0][0]; const act = SC.Game.actors[c.id]; return { shake: act.shake, x: act.x, tx: SC.Game.L.laneX(0) }; });
    ok(a.shake > 0, `deny registered (shake ${a.shake.toFixed(2)})`);
    const xs = []; for (let i = 0; i < 6; i++) { await api.run(16); xs.push(await api.page.evaluate(() => SC.Game.actors[SC.Game.sim.lanes[0][0].id].x)); }
    ok(xs.every(x => Math.abs(x - a.tx) < 0.5), `reduced motion: the denied cat does not oscillate (x spread ${(Math.max(...xs) - Math.min(...xs)).toFixed(2)} px)`);
    await api.page.evaluate(() => { SC.settings.motion = 'auto'; SC.CONFIG.walkSpeed = 4.5; });
  },
  async pauseModal(api) {
    await api.start(FIX.graceSave);
    for (let i = 0; i < 5; i++) { await api.tapLane(0); await api.settle(); }
    await api.tapLane(0);
    for (let t = 0; t < 60; t++) { await api.run(100); const s = await api.snap(); if (s.waiting.length) break; }
    await api.clickSel('#btn-settings'); await api.run(50);
    const before = await api.snap();
    await api.run(4000);                                                  // settings open for 4 s > graceSeconds
    let s = await api.snap();
    ok(before.modal && s.modal && s.status === 'playing' && Math.abs(s.grace - before.grace) < 1e-6, `play is paused while settings is open (grace ${before.grace.toFixed(2)} → ${s.grace.toFixed(2)}, status ${s.status})`);
    await api.clickSel('#panel .btn:has-text("Done")'); await api.run(3400);   // close: the countdown resumes and expires
    s = await api.snap();
    ok(s.status === 'failed' && s.reason === 'no_box', `after closing settings the grace countdown resumes and expires (status ${s.status}/${s.reason})`);
  },
  async symbolsGrayscale(api) {
    await api.page.evaluate(() => { SC.settings.symbols = true; });
    await api.start(3);
    await api.tapLane(0); await api.run(2500);
    await api.page.evaluate(() => { document.getElementById('c').style.filter = 'grayscale(1)'; });
    await api.shot('symbols-grayscale');
    await api.page.evaluate(() => { document.getElementById('c').style.filter = ''; SC.settings.symbols = false; });
    ok(true, 'symbols/grayscale screenshot taken (visual check)');
  },
  async devTools(api) {
    // the checked-in file is the dev channel: debug overlay from settings and the D key, a visible close control, seed field in the chooser
    const dev = await api.page.evaluate(() => ({ channel: SC.BUILD.channel, devTools: SC.devTools, foot: document.getElementById('foot-label').textContent }));
    ok(dev.channel === 'dev' && dev.devTools === true && dev.foot === 'test build', `source file is the dev channel with dev tools on (label "${dev.foot}")`);
    await api.clickSel('#btn-settings2'); await api.run(50);
    let txt = await api.text('#panel'); ok(/Debug/.test(txt), 'settings shows the Debug button on the dev channel');
    await api.clickSel('#panel .btn:has-text("Debug")'); await api.run(50);
    let d = await api.page.evaluate(() => { const dbg = document.getElementById('debug'); const btn = dbg.querySelector('.head .btn'); const cs = getComputedStyle(btn); return { hidden: dbg.classList.contains('hidden'), close: btn && btn.textContent, color: cs.color, bg: cs.backgroundColor, panelBg: getComputedStyle(dbg).backgroundColor }; });
    ok(!d.hidden && d.close === '✕', 'debug overlay opens with a close control in its header');
    ok(d.color === 'rgb(255, 255, 255)' && d.bg !== d.panelBg && !/, 0\)$/.test(d.bg), `debug buttons are legible on the dark panel (text ${d.color} on ${d.bg})`);
    await api.shot('debug-overlay');
    await api.clickSel('#debug .head .btn'); await api.run(50);
    d = await api.page.evaluate(() => document.getElementById('debug').classList.contains('hidden')); ok(d, 'the ✕ closes the overlay');
    await api.page.keyboard.press('d'); await api.run(50);
    d = await api.page.evaluate(() => document.getElementById('debug').classList.contains('hidden')); ok(!d, 'D reopens it');
    await api.page.keyboard.press('d'); await api.run(50);
    d = await api.page.evaluate(() => document.getElementById('debug').classList.contains('hidden')); ok(d, 'D closes it again');
    await api.page.evaluate(() => SC.UI.showGen()); await api.run(50);
    txt = await api.text('#panel'); ok(/Seed/.test(txt) && /Random seed/.test(txt), 'generated chooser has the seed field and Random seed on the dev channel');
    await api.page.evaluate(() => SC.UI.closeModal());
  },
  async liveBuild(api) {
    // ?debug=0 previews the live channel: no Debug button, D does nothing, no seed field (the deploy flips BUILD.channel instead)
    const dev = await api.page.evaluate(() => ({ devTools: SC.devTools, foot: document.getElementById('foot-label').textContent }));
    ok(dev.devTools === false && dev.foot === 'web prototype', `dev tools off with ?debug=0, label follows ("${dev.foot}")`);
    await api.clickSel('#btn-settings2'); await api.run(50);
    let txt = await api.text('#panel'); ok(/Reset progress/.test(txt) && !/Debug/.test(txt), 'settings has no Debug button');
    await api.clickSel('#panel .btn:has-text("Done")'); await api.run(50);
    await api.page.keyboard.press('d'); await api.run(50);
    const hidden = await api.page.evaluate(() => document.getElementById('debug').classList.contains('hidden')); ok(hidden, 'D key does not open the overlay');
    await api.page.evaluate(() => SC.UI.showGen()); await api.run(50);
    txt = await api.text('#panel'); ok(/Preset/.test(txt) && !/Seed/.test(txt), 'generated chooser hides the seed field');
    // with the field hidden, each Generate must draw a fresh seed instead of replaying the cached spec
    await api.clickSel('#panel .btn:has-text("Generate & play")'); await api.run(1200);
    const id1 = await api.page.evaluate(() => SC.Game.def && SC.Game.def.id);
    await api.page.evaluate(() => SC.UI.showSelect()); await api.run(50);
    await api.page.evaluate(() => SC.UI.showGen()); await api.run(50);
    await api.clickSel('#panel .btn:has-text("Generate & play")'); await api.run(1200);
    const id2 = await api.page.evaluate(() => SC.Game.def && SC.Game.def.id);
    ok(id1 && id2 && id1.startsWith('gen-') && id1 !== id2, `each Generate on the live build gets a fresh seed (${id1} → ${id2})`);
  },
  async boxReady(api) {
    // a boxed cat that can go again hops and its box glows; level 1's tutorial points at the first one at the moment it becomes tappable
    await api.start(FIX.dig);                                          // R over B: R1 is boxed first, B4 fills the bottom row, then R is the frontier
    await api.page.evaluate(() => { SC.Game.levelIndex = 0; });         // tutorial tips are level-1 only
    await api.tapLane(0); await api.settle();
    let s = await api.snap(); ok(s.boxes.filter(b => b !== null).length === 1, 'R1 is boxed with a block left');
    const before = await api.page.evaluate(() => { const a = SC.Game.actors[SC.Game.sim.boxes[0].id]; return { bounce: a.bounce, glow: a.glow, hands: document.querySelectorAll('.tip.hand').length }; });
    ok(before.bounce === 0 && !before.glow && before.hands === 0, 'no cue while the boxed cat cannot place');
    await api.tapLane(0);                                               // B4 fills the bottom row
    let tut = null;                                                     // the pointer appears the moment the row has landed, so look then (the tips time out)
    for (let t = 0; t < 12000 && !(tut && tut.ready); t += 100) { await api.run(100); tut = await api.page.evaluate(() => ({ ready: SC.Game.tut.boxReady, blocks: SC.Game.blocks.length, hands: document.querySelectorAll('.tip.hand').length, tips: [...document.querySelectorAll('.tip')].map(t => t.textContent) })); }
    ok(tut.ready && tut.blocks === 0 && tut.hands === 1 && tut.tips.some(t => /can go again/.test(t)), `tutorial points at the ready cat once its row has landed (${tut.tips.join(' | ')})`);
    await api.shot('box-ready');
    await api.settle();
    let peak = 0, glow = 0;
    for (let i = 0; i < 80; i++) { await api.run(16); const v = await api.page.evaluate(() => { const a = SC.Game.actors[SC.Game.sim.boxes[0].id]; return { b: a.bounce, g: a.glow }; }); peak = Math.max(peak, v.b); glow = Math.max(glow, v.g); }
    ok(peak > 6 && glow > 0.2, `ready boxed cat hops (peak ${peak.toFixed(1)} px) and its box glows (${glow.toFixed(2)})`);
    await api.tapBox(0); await api.settle(); s = await api.snap();
    ok(s.boxes[0] === null, 'tapping the boxed cat sends it again');
    await api.tapLane(0); await api.settle(); await api.run(1800); s = await api.snap(); ok(s.status === 'won', `R3 finishes the picture (status ${s.status})`);
  },
  async chapters(api) {
    // the level select pages by chapter: eight levels a page plus the generated tile, remembered, following the last level played
    let s = await api.page.evaluate(() => ({ pills: document.querySelectorAll('#chapters .chap').length, on: document.querySelector('#chapters .chap.on').textContent, tiles: document.querySelectorAll('#tiles .tile:not(.gen)').length, gen: document.querySelectorAll('#tiles .tile.gen').length, first: document.querySelector('#tiles .tile .name').textContent }));
    ok(s.pills === 5 && s.on === '1' && s.tiles === 8 && s.gen === 1 && /^1\. /.test(s.first), `chapter 1: eight levels and the generated tile (${JSON.stringify(s)})`);
    await api.clickSel('#chapters .chap', 2); await api.run(20);
    s = await api.page.evaluate(() => ({ on: document.querySelector('#chapters .chap.on').textContent, first: document.querySelector('#tiles .tile .name').textContent, tiles: document.querySelectorAll('#tiles .tile:not(.gen)').length }));
    ok(s.on === '3' && /^17\. /.test(s.first) && s.tiles === 8, 'chapter 3 starts at level 17');
    await api.start(11); await api.run(50); await api.page.evaluate(() => SC.UI.showSelect()); await api.run(20);
    s = await api.page.evaluate(() => ({ on: document.querySelector('#chapters .chap.on').textContent, first: document.querySelector('#tiles .tile .name').textContent }));
    ok(s.on === '2' && /^9\. /.test(s.first), 'coming back from level 12 lands on chapter 2');
    await api.clickSel('#tiles .tile', 0); await api.run(50);
    ok((await api.page.evaluate(() => SC.Game.levelIndex)) === 8, 'the first tile of chapter 2 starts level 9');
  },
  async staleProgress(api) {
    // progress is keyed by level id and a curated id carries its layout: an entry left by an earlier bake is dropped at
    // boot, a live one is kept (a second page in the same context shares the storage and boots in real time)
    const live = await api.page.evaluate(() => SC.LEVELS[1].id);
    await api.page.evaluate((live) => localStorage.setItem('sc.progress', JSON.stringify({ done: { 'ghost-2': { timeSec: 50, dispatches: 27, when: 1 }, [live]: { timeSec: 61.5, dispatches: 27, when: 2 } } })), live);
    const page2 = await api.page.context().newPage();
    page2.on('pageerror', e => api.errors.push(e.message));
    await page2.goto(PAGE_URL); await page2.waitForFunction(() => window.SC && document.querySelectorAll('#tiles .tile').length > 0);
    const s = await page2.evaluate(() => { const p = JSON.parse(localStorage.getItem('sc.progress')); return { keys: Object.keys(p.done), doneTiles: [...document.querySelectorAll('#tiles .tile.done .name')].map(e => e.textContent) }; });
    await page2.close();
    ok(s.keys.length === 1 && s.keys[0] === live, `a stale id from an earlier bake is dropped at boot and the live one kept (${s.keys.join(', ')})`);
    ok(s.doneTiles.length === 1 && /^2\. /.test(s.doneTiles[0]), `the level select shows exactly that level done (${s.doneTiles.join(', ')})`);
  },
  async daily(api) {
    // one generated level per UTC date (plan §2.2): the tile names the day, the level is DAILY.def's, a win keeps a streak, share text carries the emoji picture
    const info = await api.page.evaluate(() => { const now = Date.now(); const d = SC.DAILY.def(now); return { n: SC.DAILY.number(now), key: SC.DAILY.key(now), id: d.id, lanes: d.lanes, tile: document.querySelector('#daily .tile .name').textContent, meta: document.querySelector('#daily .tile .meta').textContent }; });
    ok(info.tile === `Daily #${info.n}` && /same for everyone/.test(info.meta), `the select screen offers ${info.tile} for ${info.key} (${info.meta})`);
    await api.clickSel('#daily .tile'); await api.run(100);
    const st = await api.page.evaluate(() => ({ id: SC.Game.def.id, lanes: SC.Game.def.lanes, title: document.querySelector('#hud-title').textContent, attempts: JSON.parse(localStorage.getItem('sc.daily')).attempts }));
    ok(st.id === info.id && JSON.stringify(st.lanes) === JSON.stringify(info.lanes) && st.title.startsWith(`Daily #${info.n}`), `tapping it starts ${st.id} with the lanes DAILY.def gives (title "${st.title}")`);
    ok(st.attempts[info.key] === 1, 'the attempt is counted');
    // share targets: no system sheet here, a clipboard that records what it was given
    await api.page.evaluate(() => { window.__shared = null; Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t) => { window.__shared = t; return Promise.resolve(); } }, configurable: true }); });
    const n = await playSolution(api); await api.run(1800);
    const s = await api.snap(); const card = await api.text('#panel');
    ok(s.status === 'won' && new RegExp(`Daily #${info.n} done!`).test(card) && /Come back tomorrow/.test(card), `won along the solver line (${n} moves); the card says Daily #${info.n} done and mentions tomorrow`);
    await api.clickSel('#panel .btn.good'); await api.run(100);   // Share
    const r = await api.page.evaluate(() => { const k = SC.DAILY.key(Date.now()), w = SC.daily.wins[k]; return { shared: window.__shared, expected: SC.DAILY.shareText({ n: SC.DAILY.number(Date.now()), timeSec: w.timeSec, boxes: w.boxes, attempts: w.attempts, art: SC.Game.def.art }), d: SC.daily, btn: document.querySelector('#panel .btn.good').textContent, rec: SC.telemetry()[0] }; });
    ok(r.shared === r.expected && /^Shelf Control #\d+ · \d+:\d\d · \d+ box/.test(r.shared) && /[🟥🟧🟨🟩🟦🟪⬛⬜🟫]/u.test(r.shared), `Share copied the Wordle-style text with the emoji picture (${r.shared.split('\n')[0]})`);
    ok(r.btn === 'Copied!' && r.d.streak === 1 && r.d.lastWon === info.n && r.d.wins[info.key].attempts === 1, `the button says Copied!, streak 1, the win is stored (${JSON.stringify(r.d.wins[info.key])})`);
    ok(r.rec.daily === info.n && r.rec.attempt === 1 && r.rec.level === info.id, 'the telemetry record carries the day number and the attempt');
    ok(await api.page.evaluate((n) => SC.Telemetry.queue().some(e => e.event === 'daily_share' && e.properties.method === 'copied' && e.properties.daily === n && e.properties.attempts === 1), info.n), 'a daily_share event is queued with the method and the day');
    // UTC midnight passes with the win card still open: Share still shares the daily that was completed
    await api.page.clock.setSystemTime(new Date('2026-10-06T00:00:05Z')); await api.run(20);
    await api.page.evaluate(() => { window.__shared = null; }); await api.clickSel('#panel .btn.good'); await api.run(100);
    const late = await api.page.evaluate(() => ({ shared: window.__shared, today: SC.DAILY.number(Date.now()) }));
    ok(late.today === info.n + 1 && late.shared === r.expected, `after midnight (now Daily #${late.today}) the card still shares Daily #${info.n}`);
    await api.clickSel('#panel .btn', 1); await api.run(50);   // Levels
    const next = await api.page.evaluate(() => ({ name: document.querySelector('#daily .tile .name').textContent, state: document.querySelectorAll('#daily .tile .meta')[1].textContent }));
    ok(next.name === `Daily #${info.n + 1}` && /Not played yet/.test(next.state), `the tile has moved on to ${next.name} (${next.state})`);
    await api.page.clock.setSystemTime(new Date('2026-10-05T12:30:00Z')); await api.run(20); await api.page.evaluate(() => SC.UI.showSelect()); await api.run(20);   // back to the day of the win for the rest
    const tile = await api.text('#daily .tile');
    ok(/Done in \d+:\d\d/.test(tile) && /Share/.test(tile), `the daily tile now shows the result and a Share button (${tile.replace(/\s+/g, ' ').trim()})`);
    await api.clickSel('#daily .tile'); await api.run(100);
    const again = await api.page.evaluate(() => JSON.parse(localStorage.getItem('sc.daily')));
    ok(again.attempts[info.key] === 2 && again.streak === 1 && again.wins[info.key].attempts === 1, 'a replay counts a second attempt; the streak and the stored result stay');
    ok((await api.page.evaluate(() => { const p = JSON.parse(localStorage.getItem('sc.progress') || '{"done":{}}'); return Object.keys(p.done).length === 0; })), 'the daily never writes into the chapter progress');
  },
  async dailyStale(api) {
    // a stored daily result belongs to the puzzle it was earned on: when the day's puzzle changes, the result is dropped rather than shown
    // against the new one, and the streak steps back a day. Same page, reloaded: the fake clock is context-wide and paused, so a second
    // page's timers would never fire; here api.run drives the boot and the reconcile timer.
    const { page } = api;
    const { k, n } = await page.evaluate(() => ({ k: SC.DAILY.key(Date.now()), n: SC.DAILY.number(Date.now()) }));
    await page.evaluate(([k, n]) => localStorage.setItem('sc.daily', JSON.stringify({ attempts: { [k]: 2 }, wins: { [k]: { timeSec: 23, dispatches: 21, boxes: 2, attempts: 2, layout: 'ffffff' } }, streak: 3, best: 3, lastWon: n })), [k, n]);
    await page.reload(); await api.run(400);
    const s = await page.evaluate(() => ({ d: JSON.parse(localStorage.getItem('sc.daily')), tile: document.querySelectorAll('#daily .tile .meta')[1].textContent, share: !!document.querySelector('#daily .tile .share') }));
    ok(!s.d.wins[k] && !s.d.attempts[k], `a result earned on a different layout is dropped for ${k}`);
    ok(s.d.streak === 2 && s.d.lastWon === n - 1 && s.d.best === 3, `the streak steps back to the day before (streak ${s.d.streak}, lastWon ${s.d.lastWon}, best ${s.d.best})`);
    ok(/Not played yet/.test(s.tile) && /2-day streak/.test(s.tile) && !s.share, `the tile offers the new puzzle with the surviving streak (${s.tile})`);
    // a matching record is left alone
    await page.evaluate(([k, n]) => { const d = SC.DAILY.def(Date.now()); localStorage.setItem('sc.daily', JSON.stringify({ attempts: { [k]: 1 }, wins: { [k]: { timeSec: 61, dispatches: 30, boxes: 3, attempts: 1, layout: d.daily.layout } }, streak: 1, best: 1, lastWon: n })); }, [k, n]);
    await page.reload(); await api.run(400);
    const s3 = await page.evaluate(() => ({ kept: !!JSON.parse(localStorage.getItem('sc.daily')).wins[SC.DAILY.key(Date.now())], tile: document.querySelectorAll('#daily .tile .meta')[1].textContent }));
    ok(s3.kept && /Done in 1:01/.test(s3.tile), `a result on the current layout stays (${s3.tile})`);
    // a replay saves the books again: the stored win must carry only what was earned, never a session marker
    await api.clickSel('#daily .tile'); await api.run(100);
    const s4 = await page.evaluate((k) => { const w = JSON.parse(localStorage.getItem('sc.daily')).wins[k]; return { keys: Object.keys(w).sort().join(','), attempts: JSON.parse(localStorage.getItem('sc.daily')).attempts[k] }; }, k);
    ok(s4.keys === 'attempts,boxes,dispatches,layout,timeSec' && s4.attempts === 2, `after a replay the stored win holds only its result fields (${s4.keys})`);
  },
  async telemetry(api) {
    // plan §2.3: events over plain HTTP, queued in storage, flushed through a replaceable transport; off from a file:// open unless enabled
    const { page } = api;
    const boot = await page.evaluate(() => ({ enabled: SC.Telemetry.enabled, pending: SC.Telemetry.pending(), q: SC.Telemetry.queue(), keys: Object.keys(localStorage).filter(k => k.startsWith('sc.tq.')), device: JSON.parse(localStorage.getItem('sc.device')) }));
    ok(boot.enabled === false && boot.pending === 1 && boot.q[0].event === 'session_start' && boot.q[0].properties.channel === 'dev' && boot.q[0].properties.source === 'web' && boot.q[0].properties.standalone === false && boot.q[0].properties.sessions === 1 && /^[0-9a-f]{16}$/.test(boot.device) && boot.q[0].distinct_id === boot.device, `a file:// open queues session_start without sending (device ${boot.device})`);
    ok(boot.keys.length === 1 && boot.keys[0] === `sc.tq.${String(Date.parse(boot.q[0].timestamp)).padStart(13, '0')}.${boot.q[0].uuid}`, `each event is its own key in storage (${boot.keys[0]})`);
    await page.evaluate(() => { window.__sent = []; window.__ok = false; SC.Telemetry.transport = (body) => { window.__sent.push(body); return Promise.resolve(window.__ok); }; SC.Telemetry.enabled = true; });
    await api.start(FIX.autoFin); await api.run(50);
    let s = await page.evaluate(() => ({ sent: window.__sent.length, pending: SC.Telemetry.pending(), last: window.__sent[window.__sent.length - 1] }));
    ok(s.sent >= 1 && s.pending === 2 && s.last.api_key.startsWith('phc_') && s.last.batch.some(e => e.event === 'level_start' && e.properties.level === 'fx-auto' && e.properties.levelNo === null && e.properties.mode === 'build'), 'level_start is posted with the project key; a refused post keeps the queue');
    await page.evaluate(() => { window.__ok = true; });
    await api.tapLane(0); await api.settle(); await api.tapLane(0); await api.settle(); await api.run(1800);   // B4 places the bottom row, then R12 wins through auto-finish
    s = await page.evaluate(() => { const last = window.__sent[window.__sent.length - 1].batch; return { pending: SC.Telemetry.pending(), sent: SC.Telemetry.sent, stored: Object.keys(localStorage).filter(k => k.startsWith('sc.tq.')).length, events: last.map(e => e.event), end: last.find(e => e.event === 'level_end') }; });
    ok(s.pending === 0 && s.stored === 0 && s.sent === 3 && s.events.join(',') === 'session_start,level_start,level_end', `once a post succeeds the queue drains in order (${s.events.join(', ')})`);
    ok(s.end && s.end.properties.result === 'won' && s.end.properties.dispatches === 2 && s.end.properties.autoLoops === 2 && s.end.properties.level === 'fx-auto' && s.end.properties.channel === 'dev' && typeof s.end.properties.timeSec === 'number', 'level_end carries the play record');
    // the toggle: off records nothing and clears what is queued; on records again
    s = await page.evaluate(() => { window.__ok = false; SC.settings.telemetry = false; const r = SC.Telemetry.record('level_start', {}); SC.settings.telemetry = true; SC.Telemetry.record('level_start', { level: 'x' }); SC.Telemetry.record('level_start', { level: 'y' }); return { r, pending: SC.Telemetry.pending() }; });
    ok(s.r === null && s.pending === 2, 'with the setting off nothing is recorded; on again it is');
    // what could not be sent survives a reload
    await page.reload(); await api.run(300);
    s = await page.evaluate(() => ({ pending: SC.Telemetry.pending(), levels: SC.Telemetry.queue().map(e => e.properties.level).filter(Boolean).sort().join(), device: JSON.parse(localStorage.getItem('sc.device')), same: SC.Telemetry.device === JSON.parse(localStorage.getItem('sc.device')) }));
    ok(s.pending === 3 && s.levels === 'x,y' && s.device === boot.device && s.same, `the queue and the device id persist across a reload (${s.pending} pending, device ${s.device})`);
    // the queue is capped
    s = await page.evaluate(() => { for (let i = 0; i < 260; i++) SC.Telemetry.record('level_start', { i }); return SC.Telemetry.pending(); });
    ok(s === 200, `the queue keeps the latest 200 events when nothing can be sent (${s})`);
    // storage is shared with other tabs (and with the other build on the same origin): acknowledged events leave by uuid, whatever else
    // arrived meanwhile stays, and a lease held by another tab defers this one's post (microtasks only: the fake clock is paused)
    s = await page.evaluate(async () => {
      const tick = async () => { for (let i = 0; i < 6; i++) await null; };
      localStorage.removeItem('sc.tqlock');   // the reload above left the old page's lease behind, and the paused clock would never let it lapse
      SC.Telemetry.clear(); SC.Telemetry.enabled = true; window.__posts = []; let settle = null;   // the reload made this a file:// open again
      SC.Telemetry.transport = (body) => { window.__posts.push(body.batch.map(e => e.properties.level)); return new Promise(r => { settle = r; }); };
      SC.Telemetry.record('level_start', { level: 'a' });                       // in flight now
      localStorage.setItem(`sc.tq.${String(Date.now()).padStart(13, '0')}.from-another-tab`, JSON.stringify({ uuid: 'from-another-tab', event: 'level_start', distinct_id: 'x', timestamp: 't', properties: { level: 'b' } }));
      SC.Telemetry.record('level_start', { level: 'c' });                       // recorded while in flight
      const uuids = SC.Telemetry.queue().map(e => e.uuid);
      settle(true); await tick();                                               // a acknowledged; b and c must remain and go next
      const afterFirst = SC.Telemetry.queue().map(e => e.properties.level).sort();   // one paused-clock millisecond: their order is not defined
      settle(true); await tick();
      const afterSecond = SC.Telemetry.queue().length;
      localStorage.setItem('sc.tqlock', JSON.stringify({ owner: 'other-tab', until: Date.now() + 15000 }));
      SC.Telemetry.record('level_start', { level: 'd' });
      const heldPosts = window.__posts.length, heldPending = SC.Telemetry.pending();
      localStorage.removeItem('sc.tqlock'); SC.Telemetry.flush(); await tick(); settle(true); await tick();
      return { uuids, posts: window.__posts, afterFirst, afterSecond, heldPosts, heldPending, finalPending: SC.Telemetry.pending() };
    });
    ok(s.uuids.length === 3 && s.uuids.every(u => typeof u === 'string' && u.length >= 8) && s.posts[0].join() === 'a' && s.afterFirst.join() === 'b,c', `an acknowledged batch leaves by uuid; what other tabs or later play added stays (${s.afterFirst.join(', ')} remained)`);
    ok(s.posts[1].slice().sort().join() === 'b,c' && s.afterSecond === 0, 'the rest goes in the next post');
    ok(s.heldPosts === 2 && s.heldPending === 1 && s.posts[2].join() === 'd' && s.finalPending === 0, `a lease held by another tab defers the post until it lapses (${s.posts.length} posts)`);
    // the opt-out is one per origin: the flag another tab persisted stops this tab recording and posting before anything syncs, a flush
    // drops what that tab may have queued meanwhile, and the storage event brings the setting itself across (and back)
    s = await page.evaluate(async () => {
      const tick = async () => { for (let i = 0; i < 6; i++) await null; };
      SC.Telemetry.transport = () => Promise.resolve(false);                                   // nothing gets through, so the queue shows what was recorded
      SC.Telemetry.record('level_start', { level: 'y' }); await tick();
      const queued = SC.Telemetry.pending();
      const persisted = JSON.parse(localStorage.getItem('sc.settings') || '{}');
      const write = (v) => localStorage.setItem('sc.settings', JSON.stringify(Object.assign({}, persisted, { telemetry: v })));
      write(false);                                                                             // what the other tab's toggle writes
      const off = SC.Telemetry.record('level_start', { level: 'z' }), stillMemory = SC.settings.telemetry, beforeFlush = SC.Telemetry.pending();
      SC.Telemetry.flush(); await tick();
      const afterFlush = SC.Telemetry.pending();
      window.dispatchEvent(new StorageEvent('storage', { key: 'sc.settings', newValue: localStorage.getItem('sc.settings') }));
      const synced = SC.settings.telemetry;
      write(true); window.dispatchEvent(new StorageEvent('storage', { key: 'sc.settings', newValue: localStorage.getItem('sc.settings') }));
      const back = SC.settings.telemetry, on = SC.Telemetry.record('level_start', { level: 'w' }); await tick();
      return { queued, off, stillMemory, beforeFlush, afterFlush, synced, back, on: !!on, finalPending: SC.Telemetry.pending() };
    });
    ok(s.queued === 1 && s.off === null && s.stillMemory === true && s.beforeFlush === 1 && s.afterFlush === 0, `another tab's opt-out stops this tab recording at once, and its next flush drops the queue (${s.beforeFlush} → ${s.afterFlush})`);
    ok(s.synced === false && s.back === true && s.on && s.finalPending === 1, 'the storage event carries the setting across, and back');
    // the device id is storage's, not this tab's: an id another tab minted first is the one every later event carries
    s = await page.evaluate(() => { localStorage.setItem('sc.device', JSON.stringify('0123456789abcdef')); const e = SC.Telemetry.record('level_start', { level: 'v' }); return { id: e.distinct_id, prop: e.properties.distinct_id, dev: SC.Telemetry.device }; });
    ok(s.id === '0123456789abcdef' && s.prop === s.id && s.dev === s.id, `an id another tab persisted first is adopted by the next record (${s.id})`);
  },
  async pwa(api) {
    // installable (plan §2.4): manifest and icons in place, no worker from a file:// open, a home-screen hint after the second session, standalone launches counted
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
    const icons = manifest.icons.map(i => i.src), missing = icons.filter(i => !fs.existsSync(path.join(root, i)));
    ok(manifest.display === 'standalone' && manifest.start_url.includes('standalone=1') && icons.length >= 3 && missing.length === 0 && manifest.icons.some(i => i.purpose === 'maskable'), `manifest: standalone, start_url flags the launch, ${icons.length} icons present including a maskable one`);
    ok(fs.existsSync(path.join(root, 'sw.js')) && fs.existsSync(path.join(root, 'icons', 'apple-touch-icon.png')), 'sw.js and the apple touch icon exist');
    const head = await api.page.evaluate(() => ({ manifest: !!document.querySelector('link[rel=manifest]'), apple: !!document.querySelector('link[rel=apple-touch-icon]'), standalone: SC.standalone, sessions: SC.sessions.count, hint: document.querySelector('#a2hs').classList.contains('hidden') }));
    ok(head.manifest && head.apple && head.standalone === false && head.sessions === 1 && head.hint, `the page links the manifest and touch icon; a file:// open is a first, non-standalone session with no hint (${JSON.stringify(head)})`);
    const ctx = api.page.context();
    const p2 = await ctx.newPage(); p2.on('pageerror', e => api.errors.push(e.message)); await p2.goto(PAGE_URL); await p2.waitForFunction(() => window.SC);
    const h2 = await p2.evaluate(() => ({ hidden: document.querySelector('#a2hs').classList.contains('hidden'), text: document.querySelector('#a2hs').textContent, count: SC.sessions.count }));
    ok(!h2.hidden && /home screen/i.test(h2.text) && h2.count === 2, `second session: the hint shows (${h2.text.trim().slice(0, 70)})`);
    await p2.evaluate(() => document.querySelector('#a2hs .btn.secondary').click());
    ok(await p2.evaluate(() => document.querySelector('#a2hs').classList.contains('hidden') && JSON.parse(localStorage.getItem('sc.sessions')).a2hsDismissed === true), 'dismissing hides it and is remembered');
    await p2.close();
    const p3 = await ctx.newPage(); p3.on('pageerror', e => api.errors.push(e.message)); await p3.goto(PAGE_URL + '?standalone=1'); await p3.waitForFunction(() => window.SC);
    const h3 = await p3.evaluate(() => ({ standalone: SC.standalone, n: SC.sessions.standalone, hidden: document.querySelector('#a2hs').classList.contains('hidden') }));
    ok(h3.standalone === true && h3.n === 1 && h3.hidden, 'a ?standalone=1 launch counts as a home-screen session and shows no hint');
    await p3.close();
  },
  async autoFinish(api) {
    // the last cat with blocks left laps the shelf by itself, fast, instead of resting in a box and waiting for the same tap again
    await api.start(FIX.autoFin);
    await api.tapLane(0); await api.settle();                                   // B4 fills the bottom row
    const t0 = await api.page.evaluate(() => SC.Game.playTime);
    await api.tapLane(0); await api.run(60);                                    // R12: the only cat left, 8 blocks after this pass
    const fast = await api.page.evaluate(() => { const a = SC.Game.flight[0]; return a && a.fast; });
    ok(fast === true, 'the last cat goes fast from the tap that settles the ending');
    await api.run(320); await api.shot('auto-finish');
    let seenBox = false;
    let s = null; for (let t = 0; t < 20000; t += 100) { await api.run(100); s = await api.snap(); if (s.boxes.some(b => b !== null)) seenBox = true; if (s.inFlight.length === 0 && s.blocks === 0) break; }
    await api.run(1800); s = await api.snap();
    const t1 = await api.page.evaluate(() => SC.Game.playTime);
    ok(s.status === 'won' && s.stats.dispatches === 2 && s.stats.autoLoops === 2, `won with one tap for the last cat: dispatches ${s.stats.dispatches}, auto laps ${s.stats.autoLoops}`);
    ok(!seenBox && s.stats.maxBoxesUsed === 0, 'it never rested in a box');
    ok(t1 - t0 < 6, `three laps took ${(t1 - t0).toFixed(1)} s of game time`);
    const card = await api.text('#panel'); ok(/finished by itself: 2 extra laps/.test(card), 'the win card says so');
    // becoming the last cat while already in flight: R8 places nothing (G is the frontier), G4 follows and empties, R8 loops at the slide's end
    await api.start(FIX.autoLate);
    await api.tapLane(0); await api.run(30); await api.tapLane(1); await api.run(400);   // the second tap is buffered behind minDispatchGap
    const fast2 = await api.page.evaluate(() => SC.Game.flight.map(a => !!a.fast));
    ok(fast2.length === 2 && !fast2[0] && !fast2[1], 'neither cat is fast while both carry or await blocks');
    await api.settle(); await api.run(1800); s = await api.snap();
    ok(s.status === 'won' && s.stats.autoLoops === 2 && s.stats.zeroPlaceDispatches === 1 && s.stats.maxBoxesUsed === 0, `R8 loops twice once G4 is done (auto laps ${s.stats.autoLoops}, boxes ${s.stats.maxBoxesUsed})`);
    // not the last cat: rests in a box as before, and its final lap is a normal one
    await api.start(FIX.autoNo);
    await api.tapLane(0); await api.settle(); await api.tapLane(0); await api.settle(); s = await api.snap();
    ok(s.status === 'playing' && s.boxes[0] !== null && s.stats.autoLoops === 0, 'R8 rests in a box while R4 still waits in the lane');
    await api.tapLane(0); await api.settle(); s = await api.snap();
    ok(s.status === 'playing' && s.boxes[0] !== null, 'a boxed last cat is not dispatched for the player');
    await api.tapBox(0); await api.settle(); await api.run(1800); s = await api.snap();
    ok(s.status === 'won' && s.stats.autoLoops === 0 && s.stats.maxBoxesUsed === 1, 'its single remaining pass needs no auto-finish');
    // turning the setting off mid-lap (settings dialog, which pauses play): the cat drops to walking pace, takes the slide and rests in a box
    await api.start(FIX.autoFin);
    await api.tapLane(0); await api.settle(); await api.tapLane(0); await api.run(400);
    ok(await api.page.evaluate(() => SC.Game.flight[0].fast === true), 'last cat is lapping fast');
    await api.page.evaluate(() => document.getElementById('btn-settings').click()); await api.run(50);
    await api.clickSel('#panel input[type=checkbox]', 3); await api.clickSel('#panel .btn:has-text("Done")'); await api.run(50);
    ok(await api.page.evaluate(() => SC.settings.autoFinish === false && SC.Game.flight[0].fast === false), 'the checkbox clears the fast flag on the lapping cat');
    let sawSlide = false; for (let t = 0; t < 20000; t += 100) { await api.run(100); const f = await api.page.evaluate(() => SC.Game.flight[0] ? SC.Game.flight[0].seg : null); if (f === 'slide') sawSlide = true; s = await api.snap(); if (s.inFlight.length === 0) break; }
    ok(sawSlide && s.boxes[0] !== null && s.stats.autoLoops === 0, 'it took the slide down and rested in a box instead of turning round');
    // the same with the field flipped directly (no handler): the turn-round point itself is gated on the setting
    await api.page.evaluate(() => { SC.settings.autoFinish = true; });
    await api.start(FIX.autoFin);
    await api.tapLane(0); await api.settle(); await api.tapLane(0); await api.run(400);
    await api.page.evaluate(() => { SC.settings.autoFinish = false; });
    sawSlide = false; for (let t = 0; t < 20000; t += 100) { await api.run(100); const f = await api.page.evaluate(() => SC.Game.flight[0] ? SC.Game.flight[0].seg : null); if (f === 'slide') sawSlide = true; s = await api.snap(); if (s.inFlight.length === 0) break; }
    ok(sawSlide && s.boxes[0] !== null && s.stats.autoLoops === 0, 'a still-fast cat with the setting off also takes the slide to a box');
    // the setting turns it off
    await api.start(FIX.autoFin);
    await api.tapLane(0); await api.settle(); await api.tapLane(0); await api.settle(); s = await api.snap();
    ok(s.status === 'playing' && s.boxes[0] !== null && s.stats.autoLoops === 0, 'with auto-finish off the last cat rests in a box');
    await api.tapBox(0); await api.settle(); await api.tapBox(0); await api.settle(); await api.run(1800); s = await api.snap();
    ok(s.status === 'won' && s.stats.dispatches === 4, 'and needs the two extra taps');
    await api.page.evaluate(() => { SC.settings.autoFinish = true; });
  },
};

const wanted = process.argv.slice(2).filter(a => !a.startsWith('-'));
const names = wanted.length ? wanted : Object.keys(scenarios);
for (const name of names) {
  if (!scenarios[name]) { console.log(`unknown scenario ${name}`); failures++; continue; }
  console.log(`\n== ${name} ==`);
  const api = await open({ reducedMotion: name === 'reduced', dpr: name === 'allLevels' ? 1 : 2, query: name === 'liveBuild' ? '?debug=0' : '', time: name === 'daily' || name === 'dailyStale' ? '2026-10-05T12:00:00Z' : undefined });
  try { await scenarios[name](api); } catch (e) { ok(false, `${name} threw: ${e.stack || e}`); }
  const errs = api.errors;
  ok(errs.length === 0, errs.length ? `console errors: ${errs.join(' | ').slice(0, 300)}` : 'no console errors');
  await api.close();
}
console.log(`\n${failures ? failures + ' FAILURE(S)' : 'ALL PASS'}`);
process.exit(failures ? 1 : 0);
