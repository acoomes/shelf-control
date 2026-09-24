#!/usr/bin/env node
// Headless self-test for Shelf Control (plan §13.1 + Phase 3 acceptance).
// Extracts the pure <script id="core"> from index.html and runs it in a bare VM context.
//   node tools/headless.mjs            # full run
//   node tools/headless.mjs --quick    # fewer playouts / candidates
//   node tools/headless.mjs --timing   # also assert the 400 ms generation budget (host-dependent)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const m = /<script id="core">([\s\S]*?)<\/script>/.exec(html);
if (!m) { console.error('core script not found'); process.exit(2); }
const sandbox = { module: { exports: {} }, console };
vm.runInNewContext(m[1], sandbox, { filename: 'core.js' });
const C = sandbox.module.exports;
const { ARTS, LEVELS, BACKTEST, GEN, createSim, makeRng, loadLevel, validateBakedLevels } = C;
const PINNED = LEVELS.filter(l => l.pinned), CURATED = LEVELS.filter(l => !l.pinned);   // six Appendix B references + the curated rest
const ART_LIST = Object.entries(ARTS).map(([id, a]) => ({ id, art: a.art }));

const quick = process.argv.includes('--quick');
const timing = process.argv.includes('--timing');   // wall-clock generation budget is host-dependent: assert only when asked
const PLAYOUTS = quick ? 300 : 1000;
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const fmt = (x) => (typeof x === 'number' ? x.toFixed(3) : String(x));

console.log('== loader ==');
try { validateBakedLevels(); ok(true, `all ${LEVELS.length} baked levels pass loader assertions (${PINNED.length} pinned, ${CURATED.length} curated from ${ART_LIST.length} arts)`); } catch (e) { ok(false, `loader: ${e.message}`); }
for (const bad of [
  { name: 'gap under a colour', level: { art: ['RR', '.R'], lanes: ['R3'] } },
  { name: 'ragged rows', level: { art: ['RRR', 'RR'], lanes: ['R5'] } },
  { name: 'count mismatch', level: { art: ['RR', 'RR'], lanes: ['R3'] } },
  { name: 'unknown colour', level: { art: ['ZZ'], lanes: ['Z2'] } },
]) {
  let threw = false; try { loadLevel(bad.level); } catch (e) { threw = e instanceof C.LevelError; }
  ok(threw, `loader rejects: ${bad.name}`);
}

/** play an evaluator move line through a real sim (turn-based: arrive right after each dispatch); returns the sim */
function replayLineInSim(level, line, opts) {
  const sim = createSim(level, opts); const trayIds = [];
  for (const [kind, idx] of line) {
    const cat = kind === 'lane' ? sim.lanes[idx][0] : trayIds[idx];
    if (kind === 'tray') trayIds.splice(idx, 1);
    const r = sim.dispatch(cat.id); if (!r.ok) return { sim, error: `denied ${r.reason}` };
    const a = sim.arrive(cat.id); if (a.to === 'wait') return { sim, error: 'no box' };
    if (cat.count > 0) trayIds.push(cat);
  }
  return { sim };
}
console.log('\n== 13.1.1 exhaustive turn-based solve (pinned) + reference-line replay (curated) ==');
const solverLine = {};
for (const lv of PINNED) {
  const { cols, lanes, cap } = GEN.lanesOf(lv);
  const t0 = Date.now();
  const r = GEN.solve(cols, lanes, cap, 20e6);
  ok(r.solvable && !r.aborted, `${lv.id}: solvable=${r.solvable} nodes=${r.nodes} line=${r.line ? r.line.length + ' moves' : '-'} (${Date.now() - t0} ms)`);
  if (r.line) solverLine[lv.id] = r.line.length;
  if (r.line) { const rr = replayLineInSim(lv, r.line); ok(!rr.error && rr.sim.status === 'won', `${lv.id}: the solver's line wins in the real sim`); }
}
{
  let bad = [];
  for (const lv of CURATED) {
    const sim = createSim(lv); let fail = null;
    for (const id of lv.ref) { const r = sim.dispatch(id); if (!r.ok) { fail = `dispatch ${id} denied (${r.reason})`; break; } sim.arrive(id); }
    if (!fail && sim.status !== 'won') fail = `status ${sim.status} after the line`;
    if (!fail && lv.ref.length !== lv.rating.dispatches) fail = `ref has ${lv.ref.length} moves, rating says ${lv.rating.dispatches}`;
    if (fail) bad.push(`${lv.id}: ${fail}`);
  }
  ok(bad.length === 0, `every curated level wins in the sim along its baked reference line (${CURATED.length} levels)${bad.length ? ': ' + bad.join('; ') : ''}`);
  const inBand = (l) => l.rating.dispatches >= 25 && l.rating.dispatches <= 40;
  const overrides = CURATED.filter(l => l.curve && l.curve.offBand);                       // baked with --allow-off-band: a written decision, carried in the level itself
  const band = CURATED.filter(l => inBand(l) || (l.curve && l.curve.offBand)).length;
  ok(band === CURATED.length, `every curated level sits in the H4 band of 25–40 dispatches${overrides.length ? `, except ${overrides.length} baked outside it by written decision (${overrides.map(l => `${l.id} ${l.rating.dispatches}`).join(', ')})` : ''} (${CURATED.length - overrides.length}/${CURATED.length} in band)`);
  ok(overrides.every(l => !inBand(l)), 'no level carries an off-band override it does not need');
  // the six references keep their hand-made lanes for the Appendix B cross-check; exactly two of them run outside the band,
  // by a written decision in the iteration 2 plan (§2.1): heart is the tutorial and short, rainbow is the finale and long
  const EXEMPT = { heart: true, rainbow: true };
  const pinnedOut = PINNED.filter(l => solverLine[l.id] < 25 || solverLine[l.id] > 40).map(l => `${l.id} ${solverLine[l.id]}`);
  ok(pinnedOut.every(s => EXEMPT[s.split(' ')[0]]) && pinnedOut.length === Object.keys(EXEMPT).length, `pinned references outside the band are exactly the two documented exceptions (${pinnedOut.join(', ')})`);
}
{
  // the solver must also say no when the answer is no, and must backtrack when lane-first ordering fails
  const un = GEN.solve(C.columns(['R', 'B']), [[['R', 1], ['B', 1]]], 0);
  ok(!un.solvable && !un.aborted, `solver reports unsolvable (cap 0): solvable=${un.solvable} nodes=${un.nodes}`);
  // lane-first greed boxes five R1s, then G5 has no box: a dead end the DFS must back out of
  const bt = GEN.solve(C.columns(['RRRRR', 'GGGGG', 'BBBBB']), [[['R', 1], ['R', 1], ['R', 1], ['R', 1], ['R', 1]], [['G', 5], ['B', 5]]], 5);
  ok(bt.solvable && bt.nodes > bt.line.length, `solver backtracks out of a dead end: solvable=${bt.solvable} nodes=${bt.nodes} > line ${bt.line ? bt.line.length : '-'}`);
}
{
  // RNG golden vector (pin for the C# port)
  const r = C.mulberry32(1); const v = [r(), r(), r(), r()].map(x => x.toFixed(9)).join(',');
  ok(v === '0.627073941,0.002735721,0.527447040,0.981050967', `mulberry32(1) golden vector ${v}`);
}

console.log(`\n== 13.1.2 random playouts (${PLAYOUTS} per level) vs Appendix B ==`);
for (const lv of PINNED) {
  const { cols, lanes, cap } = GEN.lanesOf(lv);
  const rng = makeRng(C.hashSeed('playout:' + lv.id));
  const rate = GEN.randomWinRate(cols, lanes, cap, rng, PLAYOUTS);
  const greedy = GEN.playout(cols, lanes, cap, rng, true);
  const ref = BACKTEST[lv.id];
  ok(Math.abs(rate - ref.randomWin) <= 0.05, `${lv.id}: random-win ${fmt(rate)} (appendix ${ref.randomWin})`);
  ok(greedy === ref.greedyWins, `${lv.id}: greedy wins=${greedy} (appendix ${ref.greedyWins})`);
}
{
  const N = quick ? 100 : 300; let off = [], greedyOff = [];
  for (const lv of CURATED) {
    const { cols, lanes, cap } = GEN.lanesOf(lv);
    const rate = GEN.randomWinRate(cols, lanes, cap, makeRng(C.hashSeed('rate:' + lv.id)), N);
    if (Math.abs(rate - lv.rating.randomWin) > 0.10) off.push(`${lv.id} ${fmt(rate)} vs ${lv.rating.randomWin}`);
    if (GEN.playout(cols, lanes, cap, makeRng(1), true) !== lv.rating.greedyWins) greedyOff.push(lv.id);
  }
  ok(off.length === 0, `baked ratings hold: ${N} fresh playouts per curated level within ±0.10 of the tile's number${off.length ? ' (off: ' + off.join(', ') + ')' : ''}`);
  ok(greedyOff.length === 0, `baked greedy flags hold${greedyOff.length ? ' (off: ' + greedyOff.join(', ') + ')' : ''}`);
  const bosses = CURATED.filter(l => l.curve && l.curve.boss);
  ok(bosses.length > 0 && bosses.every(l => !l.rating.greedyWins), `every chapter boss needs lookahead (${bosses.map(l => l.id).join(', ')})`);
}

console.log('\n== 13.1.3 determinism ==');
{
  const lv = LEVELS[3];
  const run = () => {
    const sim = createSim(lv); const out = [];
    const order = [];
    const rng = makeRng(42);
    for (let step = 0; step < 200 && sim.status === 'playing'; step++) {
      const tappable = sim.tappableCats().filter(c => sim.canPlaceNow(c) > 0 || c.where === 'lane');
      if (!tappable.length) break;
      const c = rng.choice(tappable);
      const r = sim.dispatch(c.id); order.push(c.id);
      if (r.ok) { out.push(r.placements.map(p => `${p.col}:${p.row}${p.color}`).join(' ')); const a = sim.arrive(c.id); if (a.to === 'wait') break; }
    }
    return { out: out.join('|'), order: order.join(',') };
  };
  const a = run(), b = run();
  ok(a.out === b.out && a.order === b.order && a.out.length > 0, `same dispatch order twice → identical placement lists (${a.out.split('|').length} dispatches)`);
  // §4.10: five cats dispatched back-to-back (none arrived) place exactly what sequential dispatch+arrive places
  for (const lv of LEVELS) {
    const order = []; const seq = createSim(lv); const par = createSim(lv);
    const outSeq = [], outPar = [];
    for (let i = 0; i < 5; i++) { const lane = seq.lanes[i % seq.lanes.length]; if (!lane.length) break; const id = lane[0].id; order.push(id); const r = seq.dispatch(id); outSeq.push(r.placements.map(p => `${p.col}:${p.row}${p.color}`).join(' ')); seq.arrive(id); }
    for (const id of order) { const r = par.dispatch(id); outPar.push(r.ok ? r.placements.map(p => `${p.col}:${p.row}${p.color}`).join(' ') : 'DENIED'); }
    ok(outSeq.join('|') === outPar.join('|') && par.inFlight.length === order.length, `${lv.id}: back-to-back parade of ${order.length} == sequential resolution`);
  }
  const golden = {};
  for (const lv of LEVELS) { const sim = createSim(lv); const parts = []; for (let i = 0; i < 12; i++) { const lane = sim.lanes[i % sim.lanes.length]; if (!lane.length) continue; const id = lane[0].id; const r = sim.dispatch(id); parts.push(r.ok ? r.placements.map(p => `${p.col}${p.row}`).join('') : r.reason); if (r.ok) sim.arrive(id); } golden[lv.id] = C.hashSeed(parts.join('|')); }
  const GOLDEN = { heart: 3785182514, chick: 4117558065, mushroom: 1688537698, icecream: 1379069667, catface: 3638597410, rainbow: 3689267354 };
  ok(Object.keys(GOLDEN).every(id => golden[id] === GOLDEN[id]), `placement golden hashes match for the reference levels (${JSON.stringify(Object.fromEntries(Object.keys(GOLDEN).map(id => [id, golden[id]])))})`);
}

console.log('\n== 13.1.4 invariant after every dispatch + sim vs evaluator agreement ==');
{
  let invariantViolations = 0, disagreements = 0, games = 0, simWins = 0, evalWins = 0, dispatches = 0;
  for (const lv of LEVELS) {
    const { cols, lanes: L, cap } = GEN.lanesOf(lv);
    const G_N = lv.pinned ? 200 : (quick ? 10 : 40);
    for (let g = 0; g < G_N; g++) {
      games++;
      const rng = makeRng(C.hashSeed(`agree:${lv.id}:${g}`));
      const sim = createSim(lv);
      const ptr = new Array(cols.length).fill(0), pos = new Array(L.length).fill(0), tray = [], trayIds = [];
      let evalResult = null, mismatch = null;
      for (let step = 0; step < 500; step++) {
        if (GEN.allDone(cols, ptr)) { evalResult = true; break; }
        const mv = GEN.moves(cols, ptr, pos, L, tray);
        if (!mv.length) { evalResult = false; break; }
        const m = rng.choice(mv);
        const simCat = m[0] === 'lane' ? sim.lanes[m[1]][0] : trayIds[m[1]];
        const r = sim.dispatch(simCat.id); dispatches++;
        if (!r.ok) { mismatch = `sim denied a legal evaluator move (${r.reason})`; break; }
        const inv = sim.checkInvariant(); if (!inv.ok) { invariantViolations++; console.log(`  invariant broken: ${JSON.stringify(inv)}`); }
        const ev = GEN.apply(cols, ptr, pos, L, tray, m, cap);
        if (m[0] === 'tray') trayIds.splice(m[1], 1);
        if (ev && simCat.count > 0) trayIds.push(simCat);
        if (ptr.join() !== sim.ptr.join()) { mismatch = 'ptr differs'; break; }
        if (ev && simCat.count > 0 && tray[tray.length - 1][1] !== simCat.count) { mismatch = 'remaining count differs'; break; }
        const a = sim.arrive(simCat.id);
        const expect = !ev ? 'wait' : simCat.count === 0 ? 'exit' : 'box';
        if (a.to !== expect) { mismatch = `arrive → ${a.to}, evaluator implies ${expect}`; break; }
        if (!ev) { evalResult = false; break; }
        if (sim.status === 'won') { evalResult = GEN.allDone(cols, ptr); if (!evalResult) mismatch = 'sim won before evaluator'; break; }
      }
      if (!mismatch && evalResult === true && sim.status !== 'won') mismatch = 'evaluator won but sim did not';
      if (!mismatch && evalResult === false && sim.status === 'won') mismatch = 'evaluator lost but sim won';
      if (mismatch) { disagreements++; console.log(`  ${lv.id} game ${g}: ${mismatch}`); }
      if (evalResult === true) evalWins++;
      if (sim.status === 'won') simWins++;
    }
  }
  ok(invariantViolations === 0, `invariant held after every dispatch (${dispatches} dispatches across ${games} random games)`);
  ok(disagreements === 0 && simWins === evalWins, `sim and evaluator agree on every random game (sim wins ${simWins}, evaluator wins ${evalWins})`);
}

console.log('\n== Phase 3 generator acceptance ==');
{
  const presets = Object.keys(GEN.PRESETS);
  const N = quick ? 30 : 100;
  for (const preset of presets) {
    let pass = 0, fails = 0;
    for (let i = 0; i < N; i++) {
      const art = ART_LIST[i % ART_LIST.length].art;
      const rng = makeRng(C.hashSeed(`gen:${preset}:${i}`));
      const p = GEN.PRESETS[preset];
      const cols = C.columns(art);
      const g = GEN.generate(cols, rng, { lanes: p.lanes, refTrayMax: p.refTrayMax, pBig: p.pBig, bigMult: p.bigMult });
      if (GEN.replay(g.cols, g.lanes, g.ref, g.where, 5)) pass++; else fails++;
      if (g.maxTray > p.refTrayMax) fails++;
      // the generated level must also load and be winnable in the sim by replaying the reference line
      const lanes = g.lanes.map(l => l.map(([color, count]) => ({ color, count })));
      const sim = createSim({ id: 'g', art, lanes });
      const pos = new Array(lanes.length).fill(0); const idOf = {};
      for (const k of g.ref) {
        let cat;
        if (k in idOf) cat = sim.catById(idOf[k]); else { const [li, j] = g.where[k]; cat = sim.lanes[li][0]; idOf[k] = cat.id; if (cat.laneIndex !== j) fails++; pos[li]++; }
        const r = sim.dispatch(cat.id); if (!r.ok) { fails++; break; }
        sim.arrive(cat.id);
      }
      if (sim.status !== 'won') fails++;
    }
    ok(fails === 0 && pass === N, `${preset}: ${pass}/${N} generated levels pass replay(), respect ref_tray_max, and win in the sim along the reference line`);
  }
}
{
  // generate-80-and-select: achieved rating vs preset target (Appendix B reachability table)
  const info = (cond, msg) => (quick ? console.log(`INFO  ${msg}`) : ok(cond, msg));
  const reach = { // art → preset → expected achieved (from Appendix B); null = unreachable, tile shows achieved
    heart:{ tutorial:0.97, easy:0.70, medium:0.60, hard:0.60 }, chick:{ tutorial:0.96, easy:0.70, medium:0.31, hard:0.12 },
    mushroom:{ tutorial:0.97, easy:0.70, medium:0.30, hard:0.04 }, icecream:{ tutorial:0.94, easy:0.72, medium:0.29, hard:0.03 },
    catface:{ tutorial:0.94, easy:0.66, medium:0.30, hard:0.02 }, rainbow:{ tutorial:0.90, easy:0.48, medium:0.30, hard:0.02 },
  };
  // full mode uses the game's own defaults (what the 🎲 tile runs); quick mode shrinks the budget for a fast smoke run
  const budget = quick ? { candidates: 20, playouts: 40 } : {};
  let maxMs = 0;
  for (const lv of ART_LIST) {
    for (const preset of Object.keys(GEN.PRESETS)) {
      // best of two runs: the plan's 400 ms is a cost target for the generator, not a GC-pause lottery
      let ms = Infinity, level = null;
      for (let r = 0; r < 2; r++) { const t0 = performance.now(); const lv2 = GEN.generateLevel({ art: lv.art, preset, seed: C.hashSeed(`sel:${lv.id}:${preset}`), ...budget }); ms = Math.min(ms, performance.now() - t0); level = level || lv2; }
      maxMs = Math.max(maxMs, ms);
      const p = GEN.PRESETS[preset];
      const expected = reach[lv.id] ? reach[lv.id][preset] : null;
      if (expected === null) { console.log(`INFO  ${lv.id.padEnd(10)} ${preset.padEnd(8)} achieved=${fmt(level.achieved)} target=${p.target}${p.targetIsCeiling ? '(ceiling)' : ''} greedyWins=${level.greedyWins} (${ms.toFixed(0)} ms; no Appendix B figure)`); continue; }
      const reachable = p.targetIsCeiling ? expected <= p.target + 0.02 : Math.abs(expected - p.target) <= 0.05; // Appendix B: '±0.10 wherever that art can reach it'
      const within = p.targetIsCeiling ? level.achieved <= p.target + 0.10 : Math.abs(level.achieved - p.target) <= 0.10;
      const nearAppendix = Math.abs(level.achieved - expected) <= 0.15;
      const line = `${lv.id.padEnd(9)} ${preset.padEnd(8)} achieved=${fmt(level.achieved)} target=${p.target}${p.targetIsCeiling ? '(ceiling)' : ''} appendix=${expected} greedyWins=${level.greedyWins} refMaxTray=${level.refMaxTray} ${ms.toFixed(0)} ms`;
      if (reachable) info(within, line); else info(nearAppendix, line + '  [unreachable per Appendix B; tile shows achieved]');
    }
  }
  if (timing) ok(maxMs < 400, `generation time max ${maxMs.toFixed(0)} ms (< 400 ms target)`); else console.log(`INFO  generation time max ${maxMs.toFixed(0)} ms (plan target < 400 ms on desktop; run with --timing to assert it)`);
  // determinism: same seed → identical lanes
  const a = GEN.generateLevel({ art: LEVELS[1].art, preset: 'medium', seed: 12345, candidates: 10, playouts: 20 });
  const b = GEN.generateLevel({ art: LEVELS[1].art, preset: 'medium', seed: 12345, candidates: 10, playouts: 20 });
  ok(JSON.stringify(a.lanes) === JSON.stringify(b.lanes) && a.achieved === b.achieved, 'same seed → identical lanes and rating');
  const c = GEN.generateLevel({ art: LEVELS[1].art, preset: 'medium', seed: 12346, candidates: 10, playouts: 20 });
  ok(JSON.stringify(a.lanes) !== JSON.stringify(c.lanes), 'different seed → different lanes');
  // yoink: reverse:true lanes solve the reversed sim
  const y = GEN.generateLevel({ art: LEVELS[2].art, preset: 'easy', seed: 7, reverse: true, candidates: 10, playouts: 20 });
  const ysim = createSim(y);                       // mode derived from level.reverse
  ok(ysim.mode === 'yoink' && ysim.checkInvariant().ok, 'yoink generated level opens as a yoink sim with the invariant intact');
  // replay the generator's reference line through the yoink sim: it must win, and every placement must be the topmost remaining block
  { const sim = createSim(y, { mode: 'yoink' }); const idOf = {}; let bad = 0;
    for (const k of y.ref) { let cat; if (k in idOf) cat = sim.catById(idOf[k]); else { const [li] = y.where[k]; cat = sim.lanes[li][0]; idOf[k] = cat.id; }
      const before = sim.ptr.slice(); const r = sim.dispatch(cat.id); if (!r.ok) { bad++; break; }
      for (const pl of r.placements) if (pl.row !== sim.cols[pl.col].length - 1 - before[pl.col]++) bad++;
      sim.arrive(cat.id); }
    ok(bad === 0 && sim.status === 'won', `yoink: reference line wins in the reversed sim, plucking the topmost block each time (${y.ref.length} moves)`); }
  { const ysolve = GEN.solve(GEN.lanesOf(y, true).cols, GEN.lanesOf(y, true).lanes, 5); ok(ysolve.solvable, 'yoink level is solvable for the turn-based solver too'); }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures ? 1 : 0);
