#!/usr/bin/env node
// Curates the baked level set (iteration 2 plan §2.1): for every slot of the difficulty curve, generate candidate levels
// from the arts in ARTS with the game's own generator, keep the one whose measured random-win rate sits closest to the
// slot's target inside the H4 dispatch band, and rewrite the BAKED LEVELS block of index.html. Pinned levels (the six
// Appendix B references) keep their hand-made lanes and sit in the slots their measured rating earns.
//   node tools/curate.mjs            # bake into index.html and print the curve
//   node tools/curate.mjs --dry      # print the curve only
//   --seeds N (3)  --arts N (8)      # seeds per art per slot, arts tried per slot: more is slower and slightly better
//   --allow-off-band                 # a written decision (plan §2.1): let a slot take a candidate outside the dispatch band
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
const { ARTS, LEVELS, GEN, loadLevel } = sandbox.module.exports;

const argv = process.argv.slice(2);
const flag = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const DRY = argv.includes('--dry');
const SEEDS = flag('--seeds', 3), ARTS_PER_SLOT = flag('--arts', 8);
const ALLOW_OFF_BAND = argv.includes('--allow-off-band');
const CHAPTER = 8;
const BAND = [25, 40];                                   // prototype plan H4: dispatches per level
const MAX_USES = 3;                                      // an art appears at most this often across the set

// The curve, one entry per level. A number is the random-win rate to aim for; `pin` keeps a hand-made level in that slot;
// `boss` closes a chapter with a level the greedy player loses (target ≤ 0.05 uses the generator's hard-ceiling search).
const CURVE = [
  { pin: 'heart' }, 0.92, 0.88, 0.84, 0.80, 0.76, 0.72, { pin: 'chick' },
  0.66, 0.62, 0.58, { pin: 'mushroom' }, 0.48, 0.44, 0.40, { boss: 0.12 },
  0.36, { pin: 'icecream' }, 0.28, 0.25, 0.22, 0.20, 0.18, { boss: 0.05 },
  0.18, 0.16, 0.15, { pin: 'catface' }, 0.12, 0.11, 0.10, { boss: 0.05 },
  0.10, 0.09, 0.08, 0.08, 0.07, 0.06, 0.06, { pin: 'rainbow' },
];

/** generator parameters for a target rate: interpolates the plan's four presets */
function presetFor(target, boss) {
  if (boss) return { lanes: 4, refTrayMax: 4, pBig: 0.85, bigMult: [2.5, 4.5], target, targetIsCeiling: target <= 0.05 };
  if (target >= 0.80) return { lanes: 3, refTrayMax: 1, pBig: 0.45, bigMult: [1.5, 2.2], target };
  if (target >= 0.55) return { lanes: 3, refTrayMax: 2, pBig: 0.45, bigMult: [1.5, 2.5], target };
  if (target >= 0.25) return { lanes: 3, refTrayMax: 3, pBig: 0.65, bigMult: [2.0, 3.5], target };
  return { lanes: 4, refTrayMax: 4, pBig: 0.85, bigMult: [2.5, 4.5], target };
}

const pinned = Object.fromEntries(LEVELS.filter(l => l.pinned).map(l => [l.id, l]));
for (const e of CURVE) if (e.pin && !pinned[e.pin]) { console.error(`pinned level ${e.pin} is not in the current baked set`); process.exit(2); }
const uses = Object.fromEntries(Object.keys(ARTS).map(a => [a, 0]));
const chapterArts = []; CURVE.forEach((e, i) => { const c = Math.floor(i / CHAPTER); (chapterArts[c] ||= new Set()); if (e.pin) chapterArts[c].add(pinned[e.pin].artId); });
for (const e of CURVE) if (e.pin) uses[pinned[e.pin].artId]++;

const out = [], rows = [], unfillable = [];
const t0 = Date.now();
CURVE.forEach((entry, i) => {
  const n = i + 1, chapter = Math.floor(i / CHAPTER);
  if (entry.pin) {
    const lv = pinned[entry.pin];
    out.push({ ...lv, lanes: lv.lanes.slice() });
    const L = loadLevel(lv); const r = GEN.solve(L.cols, L.lanes.map(l => l.map(c => [c.color, c.count])), L.trayCapacity, 5e6);
    rows.push({ n, id: lv.id, target: lv.rating.randomWin, achieved: lv.rating.randomWin, greedy: lv.rating.greedyWins, dispatches: r.solvable ? r.line.length : NaN, note: 'pinned' });
    return;
  }
  const boss = typeof entry === 'object', target = boss ? entry.boss : entry;
  const presetName = `curve_${n}`; GEN.PRESETS[presetName] = presetFor(target, boss);
  const candidates = Object.keys(ARTS).filter(a => !chapterArts[chapter].has(a) && uses[a] < MAX_USES)
    .sort((a, b) => uses[a] - uses[b] || (a < b ? -1 : 1));
  const pool = candidates.slice(0, ARTS_PER_SLOT);
  let best = null, nearest = null, nearestBoss = null;
  for (const artId of pool) for (let seed = 1; seed <= SEEDS; seed++) {
    const lv = GEN.generateLevel({ art: ARTS[artId].art, artId, preset: presetName, seed, candidates: 48 });
    const d = lv.ref.length, outside = d < BAND[0] ? BAND[0] - d : d > BAND[1] ? d - BAND[1] : 0;
    if (outside && !ALLOW_OFF_BAND) { if (!nearest || outside < nearest.outside) nearest = { artId, seed, d, achieved: lv.achieved, outside }; continue; }   // never a candidate
    if (boss && lv.greedyWins) { if (!nearestBoss || Math.abs(lv.achieved - target) < Math.abs(nearestBoss.achieved - target)) nearestBoss = { artId, seed, d, achieved: lv.achieved }; continue; }   // a boss the greedy player solves is not a boss: binding, no override
    const score = Math.abs(lv.achieved - target) + (outside ? 0.5 + 0.02 * outside : 0) + 0.03 * uses[artId];
    if (!best || score < best.score) best = { score, lv, artId, seed, outside };
  }
  if (!best) {
    if (boss && nearestBoss && !nearest) unfillable.push(`level ${n} (boss, target ${target}): every candidate is greedy-solvable; nearest ${nearestBoss.artId} seed ${nearestBoss.seed} rated ${nearestBoss.achieved.toFixed(2)}. Try more --seeds or --arts; there is no override for the boss rule`);
    else unfillable.push(`level ${n} (target ${target}${boss ? ', boss' : ''}): no candidate inside ${BAND[0]}–${BAND[1]} dispatches${boss ? ' that the greedy player loses' : ''}; nearest ${nearest ? `${nearest.artId} seed ${nearest.seed} at ${nearest.d} (rated ${nearest.achieved.toFixed(2)})` : 'none'}`);
    return;
  }
  const { lv, artId, seed } = best;
  uses[artId]++; chapterArts[chapter].add(artId);
  // the reference line as sim cat ids (cats are numbered lane by lane, front to back), so the headless suite can replay it
  const offsets = []; let acc = 0; for (const l of lv.lanes) { offsets.push(acc); acc += l.split(' ').length; }
  const ref = lv.ref.map(k => offsets[lv.where[k][0]] + lv.where[k][1]);
  out.push({ id: `${artId}-${n}`, name: ARTS[artId].name, artId, lanes: lv.lanes.slice(), seed, curve: { target, boss, offBand: best.outside > 0 }, ref,
             rating: { randomWin: Math.round(lv.achieved * 1000) / 1000, greedyWins: lv.greedyWins, dispatches: lv.ref.length } });
  rows.push({ n, id: `${artId}-${n}`, target, achieved: lv.achieved, greedy: lv.greedyWins, dispatches: lv.ref.length,
              note: best.outside ? `off-band by ${best.outside} (written decision: --allow-off-band)` : '' });
  process.stderr.write(`slot ${n}/${CURVE.length} ${artId} target ${target} → ${lv.achieved.toFixed(2)}${lv.greedyWins ? 'g' : 'L'}/${lv.ref.length}\n`);
});

if (unfillable.length) {
  console.error(`\nBake refused: ${unfillable.length} slot(s) cannot be filled. Try more --seeds or --arts; widening the dispatch band is a written decision (plan §2.1), taken with --allow-off-band; the boss rule has no override.\n  ` + unfillable.join('\n  '));
  process.exit(1);
}
console.log(`\n== curve (${((Date.now() - t0) / 1000).toFixed(0)} s) ==`);
console.log('lvl  id                 target  achieved  greedy  dispatches  note');
for (const r of rows) console.log(`${String(r.n).padStart(3)}  ${r.id.padEnd(18)} ${r.target.toFixed(2).padStart(6)}  ${r.achieved.toFixed(2).padStart(8)}  ${(r.greedy ? 'wins' : 'LOSES').padEnd(6)}  ${String(r.dispatches).padStart(10)}  ${r.note}`);
const inBand = rows.filter(r => r.dispatches >= BAND[0] && r.dispatches <= BAND[1]).length;
const pinnedOut = rows.filter(r => r.note === 'pinned' && (r.dispatches < BAND[0] || r.dispatches > BAND[1])).map(r => `${r.id} ${r.dispatches}`);
console.log(`\n${inBand}/${rows.length} levels inside the ${BAND[0]}–${BAND[1]} dispatch band (every curated level is; pinned references outside it: ${pinnedOut.join(', ') || 'none'}); art uses: ${Object.entries(uses).map(([a, u]) => `${a}:${u}`).join(' ')}`);

function levelText(lv) {
  const lanes = lv.lanes.map(l => `"${l}"`).join(', ');
  const rating = lv.pinned
    ? `rating:{ randomWin:${lv.rating.randomWin}, greedyWins:${lv.rating.greedyWins} }`
    : `seed:${lv.seed}, curve:{ target:${lv.curve.target}${lv.curve.boss ? ', boss:true' : ''}${lv.curve.offBand ? ', offBand:true' : ''} },\n    rating:{ randomWin:${lv.rating.randomWin}, greedyWins:${lv.rating.greedyWins}, dispatches:${lv.rating.dispatches} },\n    ref:[${lv.ref.join(',')}]`;
  return `  { id:'${lv.id}', name:'${lv.name}', artId:'${lv.artId}', art:ARTS.${lv.artId}.art, lanes:[ ${lanes} ],${lv.pinned ? ' pinned:true,' : ''}\n    ${rating} },\n`;
}
const block = "// ---- BAKED LEVELS: written by `node tools/curate.mjs`; do not edit by hand. Entries with pinned:true keep their hand-made\n"
  + "//      lanes (Appendix B reference levels) and are re-emitted as they are; the tool places them by their measured rating. ----\n"
  + "const LEVELS = [\n" + out.map(levelText).join('') + "];\n// ---- END BAKED LEVELS ----\n";
if (DRY) { console.log('\n(dry run: index.html untouched)'); process.exit(0); }
const re = /\/\/ ---- BAKED LEVELS:[\s\S]*?\/\/ ---- END BAKED LEVELS ----\n/;
if (!re.test(html)) { console.error('baked block markers not found'); process.exit(2); }
fs.writeFileSync(file, html.replace(re, block));
// re-load the rewritten core and make sure every level passes the loader
const html2 = fs.readFileSync(file, 'utf8'); const sb2 = { module: { exports: {} }, console };
vm.runInNewContext(/<script id="core">([\s\S]*?)<\/script>/.exec(html2)[1], sb2, { filename: 'core2.js' });
sb2.module.exports.validateBakedLevels();
console.log(`\nwrote ${out.length} levels into index.html; loader assertions pass`);
