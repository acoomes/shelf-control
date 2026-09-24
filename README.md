# Shelf Control — web prototype

Cats stroll along a shelf above an empty picture frame and bat coloured blocks off it. The blocks fall, land with a marimba *tok*, and a pixel-art picture grows from the floor up. Cats with blocks left over nap in one of five cardboard boxes. Run out of boxes and the level is lost.

This is the functional single-file prototype described in [`shelf-control-prototype-plan.md`](shelf-control-prototype-plan.md). It exists to answer one question: **does building the picture up feel ridiculously satisfying, and is the puzzle real?**

## Run it

Open `index.html` in a browser. That's it: no build step, no assets, no dependencies. For phones, serve the folder (`npx serve .` or any static server) and open it on the device; it is portrait-first and letterboxes everywhere else.

Keys on desktop: `D` toggles the debug overlay, `R` restarts, `Esc` closes dialogs.

## Two builds: test and live

`main` is the shipped build and `dev` is the test build. `.github/workflows/pages.yml` publishes both to GitHub Pages from one repository on every push to either branch:

| branch | URL | developer tools |
|---|---|---|
| `main` | `https://<owner>.github.io/shelf-control/` | off |
| `dev` | `https://<owner>.github.io/shelf-control/test/` | on, and the level select says *test build* |

Shipping is a merge from `dev` into `main`. The repository's *Pages* source is *GitHub Actions* (set on 2026-09-24; with the older branch source GitHub's own build raced the workflow and `/test/` came and went). Until a `dev` branch exists, `/test/` mirrors `main`. The `github-pages` environment only accepts deployments from `main`, so a push to `dev` does not deploy by itself: it dispatches the `main` copy of the workflow, which publishes both builds. Each build ships with its installable-app files (see below); the deploy stamps the commit into the service worker's cache version and names the test build's app *Shelf Control (test)* so the two can be installed side by side.

The two builds are the same file. The source is the dev channel; the deploy rewrites the single line `const BUILD = { channel: 'dev' };` to `'live'` for the root URL and fails if that line is not found. Developer tools are the debug overlay (settings → 🐞 Debug, or `D`), the seed field in the generated chooser, and the *test build* label; without the seed field every *Generate* draws a fresh seed. `?debug=1` turns all of them on for any URL and `?debug=0` turns them off, which is how to preview the live build from a local file.

## Daily level and share

One generated level per UTC date, the same on every device: the art rotates through the `ARTS` table (day 1, 2026-09-24, is the heart), the preset is medium, the seed is the date, and the reference tray limit is the plan's default rather than the debug slider's, so two devices never disagree. The level select shows it above the chapters with the day's number, its picture and the result. Retries are allowed and counted; the first win is the result, as the genre does it. A streak counts consecutive UTC days with a win and survives until the day after the last one ends. *Share* on the win card and the tile produces `Shelf Control #12 · 1:12 · 3 boxes` (plus `· try 2` when it took more than one) followed by the finished picture as an emoji grid, squares only so the rows line up; a colour without a square of its own borrows one no other colour in that picture uses. `navigator.share` where it exists, the clipboard otherwise, a selectable box when even that is blocked. Daily results carry `daily` (the day number) and `attempt` in telemetry. The arithmetic (`DAILY` in the core script) is pure and covered by the headless suite; the play-through by the `daily` e2e scenario.

## Installable

`manifest.webmanifest`, icons in `icons/` (rendered from the game's own cat routine by `node tools/icons.mjs`; re-run it if `drawIcon` changes), and `sw.js`, a service worker that caches the single file and its icons, network first so a deploy lands on the next online load and cache when offline. The worker registers only over http(s), never from a `file://` open, so the browser suite runs without it. After the second session in a browser tab the level select shows a one-line *add to home screen* hint (Chrome's install prompt where the browser offers one, the Share-sheet route on iOS) until it is dismissed or the app is installed. A launch from the home screen arrives at `./?standalone=1`, counts as a standalone session and carries `standalone: true` in every telemetry record. Still to do by hand on devices, per the plan's audit: safe-area insets, audio unlock in standalone mode, rubber-banding, orientation.

## Test it

```
node tools/headless.mjs          # plan §13.1 + Phase 3 acceptance (≈90 s); --quick for a 5 s smoke run; --timing also asserts the 400 ms generation budget
node tools/e2e.mjs               # Playwright scenarios in a real Chromium (fake clock); SHOTS=dir saves screenshots
node tools/perf.mjs              # frame times per phase under 4x CPU throttling, plus a CPU profile of a parade
node tools/curate.mjs            # re-bake the 40-level set from the arts table (≈2 min); --dry prints the curve without writing
node tools/icons.mjs             # re-render the app icons from the game's cat routine
```

The headless suite needs only Node. The other two need Playwright: `npm install` (it is the only devDependency) or a global `npm install -g playwright`, then `npx playwright install chromium`. `npm test` and `npm run e2e` are shorthands.

`tools/headless.mjs` extracts the pure `<script id="core">` from `index.html` and runs it in a bare VM, so the game logic is tested exactly as shipped. In the browser, `window.__selftest()` (also the *Self-test* button in the debug overlay) runs a shorter version. `tools/e2e.mjs` drives the page through `window.SC` (the game's debug handle) and real pointer clicks under a paused fake clock, so game time only advances when a scenario says so; each scenario is a plan §13.2 manual check made repeatable. The six-level solver-driven run takes about ten minutes because every frame is rendered.

## How the file is laid out

`index.html` has two scripts, in the order the plan's §6.2 asks for:

- **`<script id="core">`** — pure logic, no DOM, no time, no `Math.random`: `CONFIG` → `RNG` (mulberry32) → `LEVEL DATA` (palette, the `ARTS` table of sixteen hand-drawn pictures, the baked 40-level set written by `tools/curate.mjs`, loader assertions) → `GENERATOR` (Appendix A port: `generate`, `replay`, turn-based `playout`, exhaustive `solve`, `generateLevel` = generate-80-and-select) → `SIM` (`createSim`, the plan §6.3 API, build and yoink modes). Written to be ported to C# line for line.
- **`<script id="app">`** — `AUDIO` (Web Audio synthesis, pentatonic landing ladder) → `RENDER` (layout, block sprites, procedural cats, boxes, scene) → `ACTORS` (cat and block state machines, fixed-step `update`) → `INPUT` (Pointer Events, tap buffer) → `UI/SCREENS` (level select, win/fail cards, settings, generated chooser, tutorial tips) → `DEBUG/TELEMETRY` → `BOOT`.

## Acceptance report by phase

**Phase 1 — logic and grey box.** All six levels load and pass the loader assertions. Level 1 is completable by tapping; both fail reasons (`no_box`, `stuck`) and the win are reachable (e2e scenarios `win`, `graceFail`, `stuck`). Shelf capacity counts waiting cats, a box frees on dispatch, grace saves work (`grace`). A rapid triple tap dispatches three cats in order with none lost (`tripleTap`). Headless §13.1: all six baked levels solvable; 1,000 random playouts per level land within ±0.05 of Appendix B (heart 0.96, chick 0.70, mushroom 0.54, ice cream 0.36, cat 0.13, rainbow 0.02); greedy flags match; identical placements for identical dispatch orders; the colour invariant held after 24k dispatches; the sim agrees with the turn-based evaluator on 1,200 random games.

**Phase 2 — feel.** Block sprites, procedural cats, the §8.1 layout, the whole §9 juice table and the §10 synthesis are in. Landing pitches climb a C-pentatonic ladder while landings stay inside `comboWindow`, cap at 14 and hold with sparkle. The tray wobbles at four, shivers and pulses at five, and shows a radial countdown on a waiting cat while every boxed cat that could save the day bounces and glows. Reserved cells (committed, block still falling) pulse at 40 % with no outline; open ghosts are a flat 20 %; frontier cells add an outline. Frame times (`tools/perf.mjs`, headless Chromium, software rasterisation, 390×844 at 2×): 60 fps with no frame over 18.2 ms in every phase (idle, level start, two five-cat parades, win with confetti). Under a 4× CPU throttle the same software rasteriser manages about 15–20 fps during a parade, which says more about software canvas at 2× than about a phone GPU; the "no drops below 55 fps on a mid phone" check still has to be done on a phone. The wall, the static furniture and the board's settled cells are cached as layers and only re-rasterised when they change.

**Phase 3 — generator.** Appendix A ported and cross-checked against the verbatim Python: identical results on the same random stream (720/720 generate+replay cases, 1,200/1,200 playouts, 72/72 select pipelines) and matching distributions under different RNGs. 100 generated levels per preset pass `replay()` and win in the sim along their reference line. Selection is two-stage (64 candidates rated with 100 playouts, the six closest to the target re-rated with 200 more, winner picked on the combined estimate) and lands within ±0.10 of the preset target wherever Appendix B says the art can reach it; elsewhere the tile shows the achieved rating. Same seed → identical lanes. Generation peaks at about 320 ms on this box (best of two runs per art/preset).

**Phase 4 — polish.** Tutorial tips (four on level 1, one line on level 2), settings (sound, symbols, assist, auto-finish, motion, reset), symbols mode, level-select thumbnails, debug overlay with live stats and sliders, telemetry records with *Copy stats* and a textarea fallback, "+1 box" once per attempt, reduced motion.

**Phase 5 — yoink A/B.** `CONFIG.mode = 'yoink'`: the board starts full, cats pluck the topmost matching block per column, blocks pop upward into the sack, the badge is remaining sack space. Same sim with reversed columns; lanes come from the generator with `reverse: true`. Selectable from the generated chooser and the debug overlay; telemetry records `mode`.

## The level set

Forty levels in five chapters of eight, curated from sixteen pictures by `tools/curate.mjs`. Each slot of the curve names a random-win rate to aim for (0.97 at level 1 down to 0.06 at level 39); the tool generates candidates for that slot from the arts not yet used in the chapter, keeps the one closest to the target that also sits in the prototype plan's H4 band of 25–40 dispatches, and bakes it with its measured rating and its reference line. Chapter 1 is the onboarding chapter and has no boss. Chapter 2 ends on the first lookahead level (a boss the greedy player loses, rated 0.07); chapters 3 to 5 end on hard bosses that the greedy player loses at or below the plan's 5 % ceiling, the last of them the rainbow from the prototype. Bosses sit at levels 16, 24, 32 and 40 and nowhere else: the tool refuses a curve shaped otherwise and the suite asserts the baked set matches. The tool refuses to bake a boss slot without a qualifying candidate; the ceiling and the greedy rule have no override. The six Appendix B reference levels keep their hand-made lanes and take the slots their measured rating earns (heart 1, chick 8, mushroom 12, ice cream 18, cat 28, rainbow 40). No picture appears twice in a chapter or more than three times overall, and outside the bosses the curve never climbs back by more than 0.10 (the tool refuses a candidate that would). The level select pages by chapter, remembers the page, and comes back to the chapter of the last level played.

A level's id is its identity for progress and telemetry. The six references are their art (`heart`); a curated level is its art, its slot and a six-digit hash of its layout (`ghost-2-8c1f2a`), so a re-bake that changes a puzzle changes its id, progress earned on the old puzzle is dropped at boot instead of marking the new one done, and the loader refuses an id that does not match its lanes. The headless suite replays every curated level's baked reference line in the sim, re-measures its rating with 300 fresh playouts (must stay within ±0.10 of the tile's number), checks the greedy flag and the dispatch band, and keeps the exhaustive solver and the Appendix B comparison on the six references. To add a picture, add it to `ARTS` and re-bake.

## Taste calls and deviations worth knowing about

- **Layout.** The cat tree hugs the left edge and the slide is an S-curve down the right edge so neither crosses the frame. Cells are `min(30, ⌊(326 − gaps)/W⌋)`, so 12-wide art gets 25 px cells instead of the plan's ≈29.
- **Tap buffer.** Two taps can queue behind the 0.28 s dispatch gap. A third early tap is a visible soft deny (head shake, two low notes) rather than a silently eaten tap. A queued tap on a lane resolves to *whoever is at the front of that lane when it fires*; a queued tap on a box resolves to *whoever is in that box when it fires*.
- **Grace.** Only the cat at the slide's end runs a countdown; cats held behind it have not "arrived" yet, so they keep their full 2.5 s once they get there.
- **Hard preset.** *Hard* is a ceiling (≤ 0.05) that is also meant to force lookahead, so a candidate the greedy player loses and that sits within the ±0.10 acceptance band outranks one the greedy player solves; inside the ceiling the tie-break is greedy-loses, then the lower rate. Hard starts from 48 candidates and, while the winner is still greedy-solvable, tries up to three more batches of 32 (hard levels are cheap to rate, so this stays under 400 ms). Some arts cannot get there at all (Heart, Chick, Mushroom in the plan's own backtest), and the chooser then says "no lookahead-forcing level found in N candidates, closest shown" rather than pretending. The reference tray limit is clamped to the tray capacity in play, so a 3-box experiment generates 3-box-solvable levels.
- **Select-and-rate.** The plan's single-pass "best of 80 by 100 playouts" reports a winner's-curse estimate (the best of 80 noisy numbers is biased toward the target). Selection here is two-stage and the shown rating is the 300-playout combined estimate the winner was chosen on. Candidates are 64 rather than 80 to keep generation under 400 ms, which is the plan's own remedy (cut candidates before playouts).
- **Dialogs pause play.** Opening settings mid-parade freezes the simulation (cats, timers, the grace countdown) until it closes; the plan does not say, and letting a 2.5 s countdown expire behind a panel the player cannot tap through would be a cheap death.
- **Auto-finish.** Once the ending is settled, the game plays it: when the cat just dispatched (or just arriving) is the only one still carrying blocks, every remaining cell is its colour and nothing is left to decide, so it laps the shelf by itself at 2.5× speed, turning round at the shelf's end instead of resting in a box, until its blocks are gone; its final lap slides out as usual. The genre does this (the last stretch of a *Color Flow* level runs itself) and the playtest asked for it: tapping the same box three times for an assured ending is a chore, not a puzzle. Off switch in settings, speed in the debug overlay, `autoLoops` in telemetry and on the win card.
- **Ready cats.** A boxed cat that can place again hops about once a second and its box glows softly, and level 1 points at the first one with a hand. The first playtest (two children, two adults) did not discover that boxed cats are tappable with the earlier 3 px shimmer.
- **Audio unlock.** The audio context is resumed on pointerup, touchend and click as well as pointerdown, because iOS does not count a touch pointerdown as a user activation; before this, sound on iPhones only started after a DOM button (settings) had been clicked. Dialog buttons, the canvas and key presses all unlock it now, and it is re-resumed when the tab becomes visible again.
- **Telemetry.** Records carry `art`, `preset`, `seed`, `mode`, `trayCapacity` and `shelfCapacity` in addition to the plan's fields, and generated-level ids include the art, so experiments on different arts with the same seed stay distinguishable.
- **Not built:** the optional audio bed (plan §10 says off by default if it costs time; only the full-tray heartbeat exists) and everything in §14.
