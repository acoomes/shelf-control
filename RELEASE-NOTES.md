# Shelf Control release notes

Two builds from one file: **live** at `https://andrewcoomes.com/shelf-control/` (`main`, developer tools off) and **test** at `https://andrewcoomes.com/shelf-control/test/` (`dev`, debug overlay, seed field, *test build* label). A release is a pull request into `dev`, played on the test build, then shipped by merging `dev` into `main`. Nothing is tagged yet; each entry names its merge commit so the history is traceable without tags.

---

## Iteration 2 · slice 3 (part 1) — Measurement that reaches you

**Status:** live. [PR #8](https://github.com/acoomes/shelf-control/pull/8) into `dev` on 2026-09-24 (`62561bf`). Shipped to `main` by [PR #9](https://github.com/acoomes/shelf-control/pull/9) on 2026-09-24 (`110dc11`).

- **Telemetry to PostHog.** Six events over plain HTTP: `session_start`, `level_start`, `level_end` (the play record the game already kept), `level_continue` (the *+1 box* accepted, with the failure it rescued, so the take-rate is accepted over offered), `daily_share` and `install`. A `play` id ties a level's start, its continue and its endings together. No PostHog script on the page, no cookies, an anonymous device id as the only identity, and a `channel` property that tells the live build from the test build in one project. Events queue in local storage and flush with keepalive fetches, so a session played offline in the installed app reports when the device is next online. *Anonymous play stats* in settings turns it off, in every open tab at once. The debug overlay shows what was sent and what is pending.
- **Packaging by branch.** The deploy now assembles each build with that branch's own `tools/assemble.sh`, so a change to the installable-app files on `dev` reaches `/test/` without a ship; the headless suite runs the script for both channels.

The rest of slice 3 is people work: the stranger playtest with the portal listing, and H1 and H3 answered in writing.

---

## Iteration 2 · slice 2 — The daily, the share and the home screen

**Status:** live. [PR #6](https://github.com/acoomes/shelf-control/pull/6) and [PR #7](https://github.com/acoomes/shelf-control/pull/7) into `dev` on 2026-09-24 (`7f50828`). Shipped to `main` by [PR #9](https://github.com/acoomes/shelf-control/pull/9) on 2026-09-24 (`110dc11`).

- **Daily level.** One generated level per UTC date, the same on every device: the art rotates through the pictures with the tutorial heart sitting out (day 1, 2026-09-24, is the chick), the preset is medium, the seed is the date, and the level is the first of a few seeds whose reference line sits in the plan's 25–40 dispatch band, so a daily is never a warm-up. It sits above the chapters on the level select with its number, its picture and the result. Retries are allowed and counted; the first win is the result, and it belongs to the puzzle it was earned on: if a day's puzzle changes in a later build, the result is dropped rather than shown against the new one. A streak counts consecutive UTC days with a win.
- **Share.** *Share* on the win card and the daily tile produces `Shelf Control #12 · 1:12 · 3 boxes` (plus `· try 2` when it took more than one) followed by the finished picture as an emoji grid. The system share sheet where there is one, the clipboard otherwise, a selectable box when even that is blocked.
- **Installable.** A web app manifest, icons rendered from the game's own cat, and a service worker that caches the single file so the game opens offline after the first load (network first, so a deploy lands on the next online load). After the second session a one-line hint offers the home screen; a launch from there is counted and flagged in telemetry. The test build installs as *Shelf Control (test)* (home-screen label *SC test*), side by side with the live one.
- **Reduced motion.** The auto-finish turn-round glides instead of hopping; the ready-cat cue was already glow-only.
- Telemetry records gain `daily`, `attempt` and `standalone`.

Still by hand, per the plan's audit: safe-area insets, audio unlock and rubber-banding in standalone mode on iOS and Android, and the share sheet on both.

---

## Iteration 2 · slice 1 — Forty levels

**Status:** live. [PR #5](https://github.com/acoomes/shelf-control/pull/5) into `dev`, 2026-09-24. Shipped to `main` by [PR #9](https://github.com/acoomes/shelf-control/pull/9) on 2026-09-24 (`110dc11`).

The first slice of the iteration that asks *do strangers come back?* It replaces the prototype's six hand-made levels with a curated set deep enough that returning is possible.

- **Sixteen pictures.** The six originals plus strawberry, sun, tulip, fish, ghost, star, cactus, umbrella, watermelon and house, 90 to 121 blocks and 4 to 6 colours each. The generated chooser lists all sixteen.
- **Forty curated levels in five chapters of eight.** A new tool, `tools/curate.mjs`, walks a curve of target random-win rates from 0.97 at level 1 to 0.06 at level 39, generates candidates for each slot with the game's own generator (64 candidates, six finalists, up to eight arts and three seeds a slot) and bakes the closest eligible one into `index.html` with its measured rating and reference line. Deterministic: the same curve bakes twice to the same bytes. About two minutes a bake.
- **Bosses where the plan says.** Chapter 1 is the onboarding chapter and has no boss. Chapter 2 ends on the first level that needs lookahead (level 16), chapters 3 to 5 on a hard boss the greedy player loses at or below a 5 % random-win ceiling, the last of them the prototype's rainbow. The six prototype references keep their hand-made lanes and take the slots their measured rating earns: heart 1, chick 8, mushroom 12, ice cream 18, cat 28, rainbow 40.
- **Eligibility is binding, not scored.** A candidate must sit inside the prototype plan's H4 band of 25–40 dispatches, a boss must lose to the greedy player, a hard boss must measure at or below its ceiling, every other level must be greedy-solvable and may not sit more than 0.10 above the level before it. A slot with no eligible candidate refuses the whole bake before the file is touched. The single override, `--allow-off-band`, stamps the level with the decision so it travels with the data. The tool also refuses a curve whose bosses are not exactly at levels 16, 24, 32 and 40.
- **Level select pages by chapter.** Five chapter pills (ticked when a chapter is complete), eight tiles a page plus the generated tile, a heading with the chapter's done count, the page remembered between visits, and a return from a level lands on that level's chapter. Each tile shows its baked rating, with *needs lookahead* on the bosses.
- **Ids are identities.** A curated level's id is its art, its slot and a six-digit hash of its layout (`ghost-2-5c813f`). Progress and telemetry are keyed by id, so a re-bake that changes a puzzle changes its id, a *done* earned on the old puzzle is pruned at boot, and the loader refuses an id that does not match its lanes. One consequence for testers: progress on the 34 curated levels resets once on first load of this build. The six originals keep theirs.
- **The iteration 2 plan** (`shelf-control-iteration-2-plan.md`): scope, decisions and acceptance for the whole iteration. Decisions recorded: telemetry is PostHog, the daily level is in, the broken setting is parked until it has a name, the codename stays.

For the record: the level-16 boss measures 0.07 against the 0.12 aimed for, because no greedy-losing candidate sat nearer; the other bosses 0.02, 0.01 and 0.03. Two pinned references sit outside the dispatch band by design, heart at 23 as the short tutorial and rainbow at 42 as the finale, and the test suite names exactly those two.

Under the hood: the headless suite grew to 122 checks (every curated level replayed along its reference line, re-rated with 300 fresh playouts, and checked for the band, the boss rules, the chapter shape, the greedy rule, the descent and its id) and the browser suite to 20 scenarios and 118 checks, including `chapters` and `staleProgress`. The performance probe selects its levels by id. Seventeen automated review findings across seven rounds were fixed and verified in-thread.

---

## Iteration 1 · 1.2 — Auto-finish

**Status:** live. [PR #3](https://github.com/acoomes/shelf-control/pull/3) into `dev` on 2026-09-22 (`da0d175`), shipped by [PR #4](https://github.com/acoomes/shelf-control/pull/4) on 2026-09-24 UTC (`581a41f`).

- **Auto-finish.** Once the ending is settled, the game plays it: when the cat just dispatched (or just arriving) is the only one still carrying blocks, every remaining cell is its colour and nothing is left to decide, it laps the shelf by itself at 2.5× speed, turning round at the shelf's end instead of resting in a box, until its blocks are gone. Its final lap slides out as usual. The genre does this and the playtest asked for it: tapping the same box three times for an assured ending is a chore, not a puzzle. Off switch in settings, speed in the debug overlay, `autoLoops` in telemetry and on the win card.
- Turning auto-finish off mid-lap is honoured: the lapping cat takes the slide down and rests in a box instead of turning round.
- **Deploy relay.** A push to `dev` asks the `main` copy of the Pages workflow to publish both builds, because the `github-pages` environment only accepts deployments from `main`.
- Browser suite: `autoFinish` scenario with three fixtures (one cat, three laps; becomes the last cat while in flight; never the last cat until its final lap).

---

## Iteration 1 · 1.1 — Playtest fixes

**Status:** live. [PR #2](https://github.com/acoomes/shelf-control/pull/2), 2026-09-22 (`022eb69`).

Follow-ups from the first playtest round on iPhones (two children, two adults, and you).

- **Sound on iPhone.** A touch pointerdown is not a user activation on iOS, so the audio context only resumed after a DOM click. Unlock now also runs on pointerup, touchend, click and keydown, resumes from any non-running state (iOS "interrupted" included) and re-wakes when the tab becomes visible again.
- **Debug overlay.** Its buttons, Close included, were dark on dark. Buttons are legible on the panel and a header carries a visible close control; `D` toggles it.
- **Ready cats.** A boxed cat that can place again hops about once a second and its box glows softly, and level 1 points at the first one with a hand at the moment it becomes tappable. The earlier 3 px shimmer went unnoticed by every tester.
- **Two builds from one file.** A `BUILD.channel` line that the Pages workflow flips to `live` for `main`, while `dev` publishes to `/test/`. Developer tools (debug overlay, `D`, seed field, *test build* label) follow the channel; `?debug=1` and `?debug=0` force them either way. Until a `dev` branch exists, `/test/` mirrors `main`.
- On the live build every *Generate* draws a fresh seed, since the seed field is hidden there.
- Browser suite: `devTools`, `liveBuild` and `boxReady` scenarios.

---

## Iteration 1 · 1.0 — The web prototype

**Status:** live. [PR #1](https://github.com/acoomes/shelf-control/pull/1), 2026-09-20 (`c88cfc7`).

The prototype from `shelf-control-prototype-plan.md`, phases 1 to 5, in a single `index.html`: does building the picture up feel ridiculously satisfying, and is the puzzle real?

- **Core.** Pure simulation (`createSim`, the plan's §6.3 API), deterministic RNG, the level loader with its assertions, and the six hand-made reference levels (heart, chick, mushroom, ice cream, cat, rainbow) with their Appendix B ratings.
- **Generator.** Appendix A ported and cross-checked against the reference Python on the same random stream; two-stage select-and-rate (64 candidates rated with 100 playouts, six finalists re-rated with 200 more); four presets; a generated-level chooser with a seed field. *Hard* is a ceiling (≤ 0.05) that also tries to force lookahead.
- **Feel.** Block sprites, procedural cats, the §8.1 layout, the §9 juice table and the §10 synthesis: a C-pentatonic landing ladder that climbs while landings stay inside the combo window, tray wobble and pulse, a radial grace countdown, reserved-cell pulse, confetti on the win. Static layers cached; 60 fps in the probe with no frame over 18 ms.
- **Play.** A tap buffer for rapid dispatches, shelf capacity, grace saves, "+1 box" continue once per attempt, both fail reasons (`no_box`, `stuck`), win and fail cards, and a yoink (teardown) mode on the same sim for H1.
- **Polish.** Tutorial tips on levels 1 and 2, settings (sound, symbols, assist, auto-finish, motion, reset), symbols mode, level-select thumbnails, reduced motion, dialogs that pause play.
- **Debug and telemetry.** An overlay with live stats and sliders, a self-test, telemetry records with *Copy stats*.
- **Tooling.** A headless suite in a bare VM (the core script exactly as shipped), a Playwright browser suite under a paused fake clock, a frame-time probe, and a README carrying the phase acceptance report.

Verdict from the first playtest: smooth, performs well, satisfying; the prototype was deemed a success.
