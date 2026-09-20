# Shelf Control — web prototype

Cats stroll along a shelf above an empty picture frame and bat coloured blocks off it. The blocks fall, land with a marimba *tok*, and a pixel-art picture grows from the floor up. Cats with blocks left over nap in one of five cardboard boxes. Run out of boxes and the level is lost.

This is the functional single-file prototype described in [`shelf-control-prototype-plan.md`](shelf-control-prototype-plan.md). It exists to answer one question: **does building the picture up feel ridiculously satisfying, and is the puzzle real?**

## Run it

Open `index.html` in a browser. That's it: no build step, no assets, no dependencies. For phones, serve the folder (`npx serve .` or any static server) and open it on the device; it is portrait-first and letterboxes everywhere else.

Keys on desktop: `D` toggles the debug overlay, `R` restarts, `Esc` closes dialogs.

## Test it

```
node tools/headless.mjs          # plan §13.1 + Phase 3 acceptance (≈90 s); --quick for a 5 s smoke run
node tools/e2e.mjs               # Playwright scenarios in a real Chromium (fake clock); SHOTS=dir saves screenshots
node tools/perf.mjs              # frame times per phase under 4x CPU throttling, plus a CPU profile of a parade
```

The headless suite needs only Node. The other two need Playwright: `npm install` (it is the only devDependency) or a global `npm install -g playwright`, then `npx playwright install chromium`. `npm test` and `npm run e2e` are shorthands.

`tools/headless.mjs` extracts the pure `<script id="core">` from `index.html` and runs it in a bare VM, so the game logic is tested exactly as shipped. In the browser, `window.__selftest()` (also the *Self-test* button in the debug overlay) runs a shorter version. `tools/e2e.mjs` drives the page through `window.SC` (the game's debug handle) and real pointer clicks; each scenario is a plan §13.2 manual check made repeatable.

## How the file is laid out

`index.html` has two scripts, in the order the plan's §6.2 asks for:

- **`<script id="core">`** — pure logic, no DOM, no time, no `Math.random`: `CONFIG` → `RNG` (mulberry32) → `LEVEL DATA` (palette, six baked levels, loader assertions) → `GENERATOR` (Appendix A port: `generate`, `replay`, turn-based `playout`, exhaustive `solve`, `generateLevel` = generate-80-and-select) → `SIM` (`createSim`, the plan §6.3 API, build and yoink modes). Written to be ported to C# line for line.
- **`<script id="app">`** — `AUDIO` (Web Audio synthesis, pentatonic landing ladder) → `RENDER` (layout, block sprites, procedural cats, boxes, scene) → `ACTORS` (cat and block state machines, fixed-step `update`) → `INPUT` (Pointer Events, tap buffer) → `UI/SCREENS` (level select, win/fail cards, settings, generated chooser, tutorial tips) → `DEBUG/TELEMETRY` → `BOOT`.

## Acceptance report by phase

**Phase 1 — logic and grey box.** All six levels load and pass the loader assertions. Level 1 is completable by tapping; both fail reasons (`no_box`, `stuck`) and the win are reachable (e2e scenarios `win`, `graceFail`, `stuck`). Shelf capacity counts waiting cats, a box frees on dispatch, grace saves work (`grace`). A rapid triple tap dispatches three cats in order with none lost (`tripleTap`). Headless §13.1: all six baked levels solvable; 1,000 random playouts per level land within ±0.05 of Appendix B (heart 0.96, chick 0.70, mushroom 0.54, ice cream 0.36, cat 0.13, rainbow 0.02); greedy flags match; identical placements for identical dispatch orders; the colour invariant held after 24k dispatches; the sim agrees with the turn-based evaluator on 1,200 random games.

**Phase 2 — feel.** Block sprites, procedural cats, the §8.1 layout, the whole §9 juice table and the §10 synthesis are in. Landing pitches climb a C-pentatonic ladder while landings stay inside `comboWindow`, cap at 14 and hold with sparkle. The tray wobbles at four, shivers and pulses at five, and shows a radial countdown on a waiting cat while every boxed cat that could save the day bounces and glows. Reserved cells (committed, block still falling) pulse at 40 % with no outline; open ghosts are a flat 20 %; frontier cells add an outline.

**Phase 3 — generator.** Appendix A ported and cross-checked against the verbatim Python: identical results on the same random stream (720/720 generate+replay cases, 1,200/1,200 playouts, 72/72 select pipelines) and matching distributions under different RNGs. 100 generated levels per preset pass `replay()` and win in the sim along their reference line. Generate-80-and-select lands within ±0.10 of the preset target wherever Appendix B says the art can reach it; elsewhere the tile shows the achieved rating. Same seed → identical lanes. Generation peaks at about 290 ms on this box.

**Phase 4 — polish.** Tutorial tips (three on level 1, one line on level 2), settings (sound, symbols, assist, motion, reset), symbols mode, level-select thumbnails, debug overlay with live stats and sliders, telemetry records with *Copy stats* and a textarea fallback, "+1 box" once per attempt, reduced motion.

**Phase 5 — yoink A/B.** `CONFIG.mode = 'yoink'`: the board starts full, cats pluck the topmost matching block per column, blocks pop upward into the sack, the badge is remaining sack space. Same sim with reversed columns; lanes come from the generator with `reverse: true`. Selectable from the generated chooser and the debug overlay; telemetry records `mode`.

## Taste calls and deviations worth knowing about

- **Layout.** The cat tree hugs the left edge and the slide is an S-curve down the right edge so neither crosses the frame. Cells are `min(30, ⌊(326 − gaps)/W⌋)`, so 12-wide art gets 25 px cells instead of the plan's ≈29.
- **Tap buffer.** Two taps can queue behind the 0.28 s dispatch gap. A third early tap is a visible soft deny (head shake, two low notes) rather than a silently eaten tap. A queued tap on a lane resolves to *whoever is at the front of that lane when it fires*; a queued tap on a box resolves to *whoever is in that box when it fires*.
- **Grace.** Only the cat at the slide's end runs a countdown; cats held behind it have not "arrived" yet, so they keep their full 2.5 s once they get there.
- **Hard preset.** "Closest to target" for *hard* means inside the [0, 0.05] ceiling, tie-broken by *the greedy player loses*. The rating shown is re-measured with 300 fresh playouts after selection, because the selection score itself is a winner's-curse estimate.
- **Dialogs pause play.** Opening settings mid-parade freezes the simulation (cats, timers, the grace countdown) until it closes; the plan does not say, and letting a 2.5 s countdown expire behind a panel the player cannot tap through would be a cheap death.
- **Not built:** the optional audio bed (plan §10 says off by default if it costs time; only the full-tray heartbeat exists) and everything in §14.
