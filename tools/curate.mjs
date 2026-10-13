#!/usr/bin/env node
// Curates the baked level set: for every slot of the difficulty curve, generate candidate levels from the arts in ARTS with the
// game's own generator, keep the one whose measured win rate for the *casual player* sits closest to the slot's target inside
// the slot's dispatch band, and rewrite the BAKED LEVELS block of index.html. Difficulty is set by two things: the casual
// player's win rate (any cat that places everything it carries, chosen at random among those; see GEN.playout) and the tray,
// which shrinks chapter by chapter from five boxes to three. The plan's random-win rate is still measured and baked, but it
// no longer sets anything: a random player loses levels that nobody playing with eyes open loses. Pinned levels (the six
// Appendix B references) keep their hand-made lanes and sit in the slots their measured rating earns, at the tray that gets
// them there.
//   node tools/curate.mjs            # bake into index.html and print the curve
//   node tools/curate.mjs --dry      # print the curve only
//   --seeds N (3)  --arts N (8)      # seeds per art per slot, arts tried per slot: more is slower and slightly better
//   --allow-off-band                 # a written decision (plan §2.1): let a slot take a candidate outside its rung's dispatch band
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const m = /<script id="core">([\s\S]*?)<\/script>/.exec(html);
if (!m) { console.error('core script not found'); process.exit(2); }
const sandbox = { module: { exports: {} }, console };
vm.runInNewContext(m[1], sandbox, { filename: 'core.js' });
const { ARTS, LEVELS, GEN, loadLevel, layoutHash, makeRng } = sandbox.module.exports;

const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const DRY = argv.includes('--dry');
const SEEDS = flag('--seeds', 3), ARTS_PER_SLOT = flag('--arts', 8);
const ALLOW_OFF_BAND = argv.includes('--allow-off-band');
const CHAPTER = 8;
const MAX_USES = 3;                                      // an art appears at most this often across the set
const RATE_N = 300;                                      // casual playouts per rating
// Rungs: chapters 1 to 5 are the small pictures in the prototype plan's H4 band of 25 to 40 dispatches. From chapter 6 the
// pictures grow a rung per chapter (iteration 3): each rung has its own band, measured on its arts at these targets, and its
// own pool of arts, each usable `perChapter` times in a chapter since a rung has few pictures. The descent restarts at a
// rung (`restart`): a bigger picture is a fresh start for the casual player too, and plan §2.1's climb rule holds within it.
const RUNGS = [
  { from: 1, to: 40, band: [25, 40], arts: (a) => !ARTS[a].big, perChapter: 1 },
  { from: 41, to: 48, band: [34, 64], arts: (a) => ARTS[a].big && ARTS[a].art.length === 14, perChapter: 2, restart: true, seeds: 8 },   // four pictures: more seeds each
];
const rungOf = (n) => RUNGS.find(r => n >= r.from && n <= r.to) || (() => { console.error(`level ${n} is in no rung`); process.exit(2); })();
// The tray per chapter: five boxes to learn with, four, then three. A pinned level names its own.
const TRAY = [5, 4, 4, 3, 3, 3];

// The curve, one entry per level. A number is the casual player's win rate to aim for; `pin` keeps a hand-made level in that
// slot (with `tray` where its rating needs one); `boss` closes a chapter with a level the greedy player loses, at that casual
// target. Lookahead levels live only in boss slots: every other level must be one the greedy player solves (plan §2.1).
// Chapter 1 is the onboarding chapter and has no boss; every later chapter closes with one. That shape is checked below.
const CURVE = [
  { pin: 'heart' }, { pin: 'chick' }, 0.99, 0.98, 0.97, 0.96, 0.95, 0.94,
  { pin: 'icecream', tray: 4 }, 0.90, 0.87, 0.84, 0.81, 0.78, 0.75, { boss: 0.62 },
  0.74, 0.71, 0.68, 0.65, { pin: 'mushroom', tray: 3 }, 0.60, 0.57, { boss: 0.50 },
  0.60, 0.58, 0.56, { pin: 'catface', tray: 2 }, 0.50, 0.47, 0.44, { pin: 'rainbow', boss: 0.35, tray: 3 },
  0.46, 0.43, 0.40, 0.38, 0.36, 0.34, 0.32, { boss: 0.25 },
  0.80, 0.72, 0.65, 0.58, 0.52, 0.46, 0.40, { boss: 0.30 },   // chapter 6: the 14x14 rung, descent restarted
];

CURVE.forEach((entry, i) => {
  const n = i + 1, want = n % CHAPTER === 0 && n > CHAPTER;
  const isBoss = typeof entry === 'object' && entry.boss !== undefined;
  if (isBoss !== want) { console.error(`CURVE: level ${n} ${want ? 'must be' : 'may not be'} a boss (plan §2.1: a boss closes every chapter after the first and nothing else)`); process.exit(2); }
});

/** generator parameters for a casual target: the plan's presets by lane count and tray use, aimed at the casual rate */
function presetFor(target, boss) {
  if (boss) return { lanes: 4, refTrayMax: 4, pBig: 0.85, bigMult: [2.5, 4.5], target, metric: 'casual' };
  if (target >= 0.90) return { lanes: 3, refTrayMax: 1, pBig: 0.45, bigMult: [1.5, 2.2], target, metric: 'casual' };
  if (target >= 0.70) return { lanes: 3, refTrayMax: 2, pBig: 0.45, bigMult: [1.5, 2.5], target, metric: 'casual' };
  if (target >= 0.45) return { lanes: 3, refTrayMax: 3, pBig: 0.65, bigMult: [2.0, 3.5], target, metric: 'casual' };
  return { lanes: 4, refTrayMax: 4, pBig: 0.85, bigMult: [2.5, 4.5], target, metric: 'casual' };
}
const casual = (cols, lanes, cap) => GEN.casualWinRate(cols, lanes, cap, makeRng(7), RATE_N);

const pinned = Object.fromEntries(LEVELS.filter(l => l.pinned).map(l => [l.id, l]));
for (const e of CURVE) if (e.pin && !pinned[e.pin]) { console.error(`pinned level ${e.pin} is not in the current baked set`); process.exit(2); }
const uses = Object.fromEntries(Object.keys(ARTS).map(a => [a, 0]));
const chapterUses = []; CURVE.forEach((e, i) => { const c = Math.floor(i / CHAPTER); (chapterUses[c] ||= {}); if (e.pin) { const a = pinned[e.pin].artId; chapterUses[c][a] = (chapterUses[c][a] || 0) + 1; } });
for (const e of CURVE) if (e.pin) uses[pinned[e.pin].artId]++;

const out = [], rows = [], unfillable = [];
const CLIMB = 0.10;                                     // plan §2.1: outside the chapter bosses the curve never climbs back by more than this
let lastNonBoss = null;                                 // rating of the previous non-boss level
const t0 = Date.now();
CURVE.forEach((entry, i) => {
  const n = i + 1, chapter = Math.floor(i / CHAPTER), rung = rungOf(n), BAND = rung.band;
  if (rung.restart && n === rung.from) lastNonBoss = null;   // a new rung: the descent starts over
  if (entry.pin) {
    const lv = pinned[entry.pin], tray = entry.tray ?? lv.tray ?? 5, isBoss = entry.boss !== undefined;
    const L = loadLevel({ ...lv, tray }); const lanes = L.lanes.map(l => l.map(c => [c.color, c.count]));
    const r = GEN.solve(L.cols, lanes, tray, 5e6);
    if (!r.solvable) { unfillable.push(`level ${n} (pinned ${lv.id}) is not solvable with ${tray} boxes; give it a bigger tray in CURVE`); return; }
    const greedyWins = GEN.playout(L.cols, lanes, tray, makeRng(1), true), rate = casual(L.cols, lanes, tray);
    const randomWin = Math.round(GEN.randomWinRate(L.cols, lanes, tray, makeRng(7), 300) * 1000) / 1000;
    if (isBoss && greedyWins) unfillable.push(`level ${n} (pinned ${lv.id}) sits in a boss slot but the greedy player solves it with ${tray} boxes`);
    if (!isBoss && !greedyWins) unfillable.push(`level ${n} (pinned ${lv.id}) needs lookahead with ${tray} boxes but is not in a boss slot; move it or give it a bigger tray`);
    const target = isBoss ? entry.boss : lastNonBoss ?? rate;
    out.push({ ...lv, lanes: lv.lanes.slice(), tray, curve: isBoss ? { target: entry.boss, boss: true } : undefined,
               rating: { randomWin, casualWin: Math.round(rate * 1000) / 1000, greedyWins } });
    rows.push({ n, id: lv.id, target, achieved: rate, greedy: greedyWins, dispatches: r.line.length, tray, band: BAND, note: 'pinned' });
    if (!isBoss) {                                     // a pinned boss is exempt from the descent; the others sit on the curve like any level
      if (lastNonBoss !== null && rate > lastNonBoss + CLIMB + 1e-9) unfillable.push(`level ${n} (pinned ${lv.id}, rated ${rate.toFixed(2)} with ${tray} boxes) climbs more than ${CLIMB} above the previous level (${lastNonBoss.toFixed(2)}); move it in CURVE or shrink its tray`);
      lastNonBoss = rate;
    }
    return;
  }
  const boss = typeof entry === 'object', target = boss ? entry.boss : entry, tray = TRAY[chapter];
  const presetName = `curve_${n}`; GEN.PRESETS[presetName] = presetFor(target, boss);
  const candidates = Object.keys(ARTS).filter(a => rung.arts(a) && (chapterUses[chapter][a] || 0) < rung.perChapter && uses[a] < MAX_USES)   // the rung's own pictures
    .sort((a, b) => uses[a] - uses[b] || (chapterUses[chapter][a] || 0) - (chapterUses[chapter][b] || 0) || (a < b ? -1 : 1));
  const pool = candidates.slice(0, ARTS_PER_SLOT);
  let best = null, nearest = null, nearestBoss = null, nearestClimb = null, nearestLook = null; const accepted = [];
  for (const artId of pool) for (let seed = 1; seed <= (rung.seeds || SEEDS); seed++) {
    const lv = GEN.generateLevel({ art: ARTS[artId].art, artId, preset: presetName, seed, trayCap: tray });   // the game's own defaults: candidates by picture size, six finalists
    const d = lv.ref.length, outside = d < BAND[0] ? BAND[0] - d : d > BAND[1] ? d - BAND[1] : 0;
    const rate = lv.achieved;                            // the preset's metric is the casual rate: this is the combined 300-playout estimate the winner was chosen on
    if (outside && !ALLOW_OFF_BAND) { if (!nearest || outside < nearest.outside) nearest = { artId, seed, d, achieved: rate, outside }; continue; }   // never a candidate
    if (boss && lv.greedyWins) { if (!nearestBoss || Math.abs(rate - target) < Math.abs(nearestBoss.achieved - target)) nearestBoss = { artId, seed, d, achieved: rate }; continue; }   // a boss the greedy player solves is not a boss: binding, no override
    if (!boss && lastNonBoss !== null && rate > lastNonBoss + CLIMB + 1e-9) { if (!nearestClimb || rate < nearestClimb.achieved) nearestClimb = { artId, seed, d, achieved: rate }; continue; }   // would climb back up the curve
    if (!boss && !lv.greedyWins) { if (!nearestLook || Math.abs(rate - target) < Math.abs(nearestLook.achieved - target)) nearestLook = { artId, seed, d, achieved: rate }; continue; }   // lookahead levels only close chapters
    const score = Math.abs(rate - target) + (outside ? 0.5 + 0.02 * outside : 0) + 0.03 * uses[artId];
    accepted.push({ score, lv, artId, seed, outside, rate });
  }
  // the winner's selection estimate is biased toward the target (the best of many noisy numbers), so each candidate is
  // re-measured with fresh playouts in score order and the first whose fresh rate still respects the descent is the level;
  // that fresh number is what is baked, what the descent rule sees next, and what the suite re-measures against
  let fresh = null;
  for (const c of accepted.sort((a, b) => a.score - b.score)) {
    const Lw = loadLevel({ ...c.lv, tray }); const lanesW = Lw.lanes.map(l => l.map(cc => [cc.color, cc.count]));
    const r = GEN.casualWinRate(Lw.cols, lanesW, tray, makeRng(11), RATE_N * 2);
    if (!boss && lastNonBoss !== null && r > lastNonBoss + CLIMB + 1e-9) { if (!nearestClimb || r < nearestClimb.achieved) nearestClimb = { artId: c.artId, seed: c.seed, d: c.lv.ref.length, achieved: r }; continue; }
    best = c; fresh = { rate: r, Lw, lanesW }; break;
  }
  if (!best) {
    if (boss && nearestBoss && !nearest) unfillable.push(`level ${n} (boss, target ${target}, ${tray} boxes): every candidate is greedy-solvable; nearest ${nearestBoss.artId} seed ${nearestBoss.seed} rated ${nearestBoss.achieved.toFixed(2)}. Try more --seeds or --arts; there is no override for the boss rule`);
    else if (nearestClimb && !nearest) unfillable.push(`level ${n} (target ${target}, ${tray} boxes): every in-band candidate is rated more than ${CLIMB} above the previous level (${lastNonBoss.toFixed(2)}); lowest ${nearestClimb.artId} seed ${nearestClimb.seed} rated ${nearestClimb.achieved.toFixed(2)}. Try more --seeds or --arts, or lower the earlier targets in CURVE`);
    else if (nearestLook && !nearest) unfillable.push(`level ${n} (target ${target}, ${tray} boxes): every in-band candidate needs lookahead, which only a boss slot may; nearest ${nearestLook.artId} seed ${nearestLook.seed} rated ${nearestLook.achieved.toFixed(2)}. Try more --seeds or --arts, or raise the target`);
    else unfillable.push(`level ${n} (target ${target}${boss ? ', boss' : ''}, ${tray} boxes): no candidate inside ${BAND[0]}–${BAND[1]} dispatches${boss ? ' that the greedy player loses' : ''}; nearest ${nearest ? `${nearest.artId} seed ${nearest.seed} at ${nearest.d} (rated ${nearest.achieved.toFixed(2)})` : 'none'}`);
    return;
  }
  const { lv, artId, seed } = best, { rate, Lw, lanesW } = fresh;
  uses[artId]++; chapterUses[chapter][artId] = (chapterUses[chapter][artId] || 0) + 1;
  if (!boss) lastNonBoss = rate;
  // the reference line as sim cat ids (cats are numbered lane by lane, front to back), so the headless suite can replay it
  const offsets = []; let acc = 0; for (const l of lv.lanes) { offsets.push(acc); acc += l.split(' ').length; }
  const ref = lv.ref.map(k => offsets[lv.where[k][0]] + lv.where[k][1]);
  const randomWin = Math.round(GEN.randomWinRate(Lw.cols, lanesW, tray, makeRng(7), 300) * 1000) / 1000;   // the plan's number, kept for the record
  // the id carries the layout, so a later bake that changes this slot's puzzle also changes the key progress is stored under
  const id = `${artId}-${n}-${layoutHash(ARTS[artId].art, lv.lanes)}`;
  out.push({ id, name: ARTS[artId].name, artId, lanes: lv.lanes.slice(), tray, seed, curve: { target, boss, offBand: best.outside > 0, band: rung === RUNGS[0] ? undefined : BAND }, ref,
             rating: { randomWin, casualWin: Math.round(rate * 1000) / 1000, greedyWins: lv.greedyWins, dispatches: lv.ref.length } });
  rows.push({ n, id, target, achieved: rate, greedy: lv.greedyWins, dispatches: lv.ref.length, tray, band: BAND,
              note: best.outside ? `off-band by ${best.outside} (written decision: --allow-off-band)` : '' });
  process.stderr.write(`slot ${n}/${CURVE.length} ${artId} target ${target} → ${rate.toFixed(2)}${lv.greedyWins ? 'g' : 'L'}/${lv.ref.length} tray ${tray}\n`);
});

if (unfillable.length) {
  console.error(`\nBake refused: ${unfillable.length} slot(s) cannot be filled. Try more --seeds or --arts; widening the dispatch band is a written decision (plan §2.1), taken with --allow-off-band; the boss rule has no override.\n  ` + unfillable.join('\n  '));
  process.exit(1);
}
console.log(`\n== curve (${((Date.now() - t0) / 1000).toFixed(0)} s) ==`);
console.log('lvl  id                 target  casual  greedy  tray  dispatches  note');
for (const r of rows) console.log(`${String(r.n).padStart(3)}  ${r.id.padEnd(22)} ${r.target.toFixed(2).padStart(6)}  ${r.achieved.toFixed(2).padStart(6)}  ${(r.greedy ? 'wins' : 'LOSES').padEnd(6)}  ${String(r.tray).padStart(4)}  ${String(r.dispatches).padStart(10)}  ${r.note}`);
const inBand = rows.filter(r => r.dispatches >= r.band[0] && r.dispatches <= r.band[1]).length;
const pinnedOut = rows.filter(r => r.note === 'pinned' && (r.dispatches < r.band[0] || r.dispatches > r.band[1])).map(r => `${r.id} ${r.dispatches}`);
console.log(`\n${inBand}/${rows.length} levels inside their rung's dispatch band (${RUNGS.map(r => `levels ${r.from}–${r.to}: ${r.band[0]}–${r.band[1]}`).join('; ')}; every curated level is; pinned references outside it: ${pinnedOut.join(', ') || 'none'}); art uses: ${Object.entries(uses).map(([a, u]) => `${a}:${u}`).join(' ')}`);

const J = (v) => JSON.stringify(v);
function levelText(lv) {
  const lanes = lv.lanes.map(J).join(', ');
  const rating = lv.pinned
    ? `${lv.curve ? `curve:{ target:${lv.curve.target}, boss:true }, ` : ''}rating:{ randomWin:${lv.rating.randomWin}, casualWin:${lv.rating.casualWin}, greedyWins:${lv.rating.greedyWins} }`
    : `seed:${lv.seed}, curve:{ target:${lv.curve.target}${lv.curve.boss ? ', boss:true' : ''}${lv.curve.offBand ? ', offBand:true' : ''}${lv.curve.band ? `, band:[${lv.curve.band.join(',')}]` : ''} },\n    rating:{ randomWin:${lv.rating.randomWin}, casualWin:${lv.rating.casualWin}, greedyWins:${lv.rating.greedyWins}, dispatches:${lv.rating.dispatches} },\n    ref:[${lv.ref.join(',')}]`;
  return `  { id:${J(lv.id)}, name:${J(lv.name)}, artId:${J(lv.artId)}, art:ARTS[${J(lv.artId)}].art, lanes:[ ${lanes} ], tray:${lv.tray},${lv.pinned ? ' pinned:true,' : ''}\n    ${rating} },\n`;
}
const block = "// ---- BAKED LEVELS: written by `node tools/curate.mjs`; do not edit by hand. Entries with pinned:true keep their hand-made\n"
  + "//      lanes (Appendix B reference levels) and are re-emitted as they are; the tool places them by their measured rating. ----\n"
  + "const LEVELS = [\n" + out.map(levelText).join('') + "];\n// ---- END BAKED LEVELS ----\n";
if (DRY) { console.log('\n(dry run: index.html untouched)'); process.exit(0); }
const re = /\/\/ ---- BAKED LEVELS:[\s\S]*?\/\/ ---- END BAKED LEVELS ----\n/;
if (!re.test(html)) { console.error('baked block markers not found'); process.exit(2); }
const html2 = html.replace(re, block);
// the rewritten core must parse and pass the loader before index.html is touched
try {
  const sb2 = { module: { exports: {} }, console };
  vm.runInNewContext(/<script id="core">([\s\S]*?)<\/script>/.exec(html2)[1], sb2, { filename: 'core2.js' });
  sb2.module.exports.validateBakedLevels();
  if (sb2.module.exports.LEVELS.length !== out.length) throw new Error('level count differs after reload');
} catch (e) { console.error(`\nBake refused: the rewritten core does not load (${e.message}); index.html untouched`); process.exit(1); }
fs.writeFileSync(file, html2);
console.log(`\nwrote ${out.length} levels into index.html; loader assertions pass`);
