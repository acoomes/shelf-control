#!/usr/bin/env node
// End-to-end scenarios for Shelf Control, driven through a real Chromium via Playwright (plan §13.2).
//   node tools/e2e.mjs                 # run every scenario
//   node tools/e2e.mjs grace stuck     # run a subset
//   SHOTS=/some/dir node tools/e2e.mjs # also save screenshots
// Uses Playwright's fake clock so a 90-second level plays in a few seconds of wall time.
import path from 'node:path';
import fs from 'node:fs';
let chromium;
try { ({ chromium } = await import('playwright')); } catch (e) { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }

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
};

async function open(opts = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto(PAGE_URL);
  await page.clock.runFor(300);
  const api = {
    page, browser, errors,
    async run(ms) { await page.clock.runFor(ms); },
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
    const card = await api.page.textContent('#panel');
    ok(/done!/.test(card) && /dispatches/.test(card), `win card shows results: ${card.replace(/\s+/g, ' ').slice(0, 90)}`);
    await api.page.click('#panel .btn.good');   // Next
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
    const txt = await api.page.textContent('#panel');
    ok(/No box was free/.test(txt) && /\+1 box/.test(txt), `fail card explains the reason and offers +1 box`);
    await api.page.click('#panel .btn.good');          // +1 box and continue
    await api.run(600);
    s = await api.snap();
    ok(s.status === 'playing' && s.boxesN === 6 && s.waiting.length === 0 && s.stats.continuesUsed === 1, `+1 box: sixth box added, waiter seated, play resumes (boxes=${s.boxesN})`);
    await api.shot('after-continue');
    // finish the level: B6, G6 then boxed R1s
    await api.tapLane(0); await api.settle(); await api.tapLane(0); await api.settle();
    for (let i = 0; i < 6; i++) { await api.tapBox(i); await api.run(300); }
    s = await api.settle(); await api.run(1800); s = await api.snap();
    ok(s.status === 'won', `won after the continue (6 boxes, stats: ${JSON.stringify(s.stats)})`);
    const tele = await api.page.evaluate(() => SC.telemetry());
    ok(tele.length === 2 && tele[0].result === 'failed' && tele[0].reason === 'no_box' && tele[1].result === 'won' && tele[1].continuesUsed === 1, `telemetry: ${JSON.stringify(tele.map(r => [r.result, r.reason, r.continuesUsed]))}`);
  },
  async stuck(api) {
    await api.start(FIX.stuck);
    for (let i = 0; i < 5; i++) { await api.tapLane(0); await api.settle(); }
    await api.run(1000);
    let s = await api.snap();
    ok(s.status === 'failed' && s.reason === 'stuck' && s.modal, `stuck detected after the beat (state=${s.state}, reason=${s.reason})`);
    const txt = await api.page.textContent('#panel'); ok(/tray is full/.test(txt), 'stuck card explains in plain words');
    await api.page.click('#panel .btn.good'); await api.run(300);
    s = await api.snap(); ok(s.status === 'playing' && s.boxesN === 6, '+1 box resolves the stuck state');
    await api.tapLane(0); await api.settle(); await api.tapLane(0); await api.settle();
    for (let i = 0; i < 6; i++) { await api.tapBox(i); await api.run(300); }
    await api.settle(); await api.run(1800); s = await api.snap(); ok(s.status === 'won', 'won after stuck + continue');
  },
  async tripleTap(api) {
    await api.start(1);                                // chick: 3 lanes
    await api.tapLane(0); await api.tapLane(1); await api.tapLane(2);      // within a few fake ms
    await api.run(50);
    let s = await api.snap();
    ok(s.stats.dispatches === 1 && s.queue === 2, `first tap dispatched immediately, two buffered (dispatches=${s.stats.dispatches}, queue=${s.queue})`);
    await api.tapLane(0);                               // fourth tap: buffer full → denied, not eaten silently
    await api.run(20); s = await api.snap();
    const extra = await api.page.evaluate(() => SC.Game.extraDenied);
    ok(s.queue === 2 && extra === 1, `fourth tap within the gap is a visible deny (buffer full), not dropped silently`);
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
    await api.tapLane(0); await api.run(50); s = await api.snap();
    ok(s.stats.deniedTaps === d0 + 1 && s.inFlight.length === 5, 'sixth tap: shelf_full soft deny');
    const flash = await api.page.evaluate(() => SC.Game.shelfFlash > 0);
    ok(flash, 'shelf edge flashes on the deny');
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
    await api.page.click('#btn-restart'); await api.run(100);
    let s = await api.snap();
    ok(s.status === 'playing' && s.inFlight.length === 0 && s.placed === 0 && s.landed === 0 && s.stats.dispatches === 0, 'restart is instant and clean');
    await api.page.setViewportSize({ width: 800, height: 600 }); await api.run(100);
    const v = await api.page.evaluate(() => ({ s: SC.view.scale, cw: SC.view.canvas.width, ch: SC.view.canvas.height }));
    ok(Math.abs(v.s - 600 / 844) < 1e-6 && v.cw === 1600 && v.ch === 1200, `landscape resize: scale ${v.s.toFixed(3)}, canvas ${v.cw}x${v.ch} (dpr 2)`);
    await api.shot('landscape');
    await api.page.setViewportSize({ width: 390, height: 844 }); await api.run(100);
  },
  async yoink(api) {
    await api.page.evaluate(() => { const lv = SC.GEN.generateLevel({ art: SC.LEVELS[1].art, preset: 'easy', seed: 7, reverse: true, candidates: 20, playouts: 40 }); lv.artId = 'chick'; SC.UI.playGenerated(lv, 'yoink'); });
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
    await api.page.click('.tile.gen'); await api.run(200);
    const t0 = Date.now();
    await api.page.click('#panel .btn.good'); await api.run(1200);
    const s = await api.snap();
    ok(s.status === 'playing' && !s.modal, `generated level starts (wall ${Date.now() - t0} ms incl. UI)`);
    const def = await api.page.evaluate(() => ({ id: SC.Game.def.id, achieved: SC.Game.def.achieved, ms: SC.Game.def.genMs }));
    ok(def.id.startsWith('gen-') && def.ms < 400, `generation ${def.ms} ms, achieved ${def.achieved}`);
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
};

const wanted = process.argv.slice(2).filter(a => !a.startsWith('-'));
const names = wanted.length ? wanted : Object.keys(scenarios);
for (const name of names) {
  if (!scenarios[name]) { console.log(`unknown scenario ${name}`); failures++; continue; }
  console.log(`\n== ${name} ==`);
  const api = await open({ reducedMotion: name === 'reduced' });
  try { await scenarios[name](api); } catch (e) { ok(false, `${name} threw: ${e.stack || e}`); }
  const errs = api.errors;
  ok(errs.length === 0, errs.length ? `console errors: ${errs.join(' | ').slice(0, 300)}` : 'no console errors');
  await api.close();
}
console.log(`\n${failures ? failures + ' FAILURE(S)' : 'ALL PASS'}`);
process.exit(failures ? 1 : 0);
