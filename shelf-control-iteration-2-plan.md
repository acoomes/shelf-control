# SHELF CONTROL — Iteration 2 Plan: from validated prototype to a playable web product

Companion to `shelf-control-prototype-plan.md` (v1). That document asked whether the game is fun; the answer, from a five-person playtest and a working auto-finish, is yes. This one asks the next question and scopes only what answers it.

## 0. Where we are (2026-09-24)

- Live: `https://andrewcoomes.com/shelf-control/` (`main`, developer tools off). Test: `https://andrewcoomes.com/shelf-control/test/` (`dev`, developer tools on). Pipeline: feature branch → PR into `dev` → play it on `/test/` → PR `dev` into `main`.
- Shipped since the prototype: iPhone audio unlock, closable debug overlay, ready-cat cue, auto-finish, two-build deploy.
- Left open by the prototype plan: **H1** (build vs teardown) was never put in front of people even though the yoink mode exists; **H3** (legible in ten seconds, no text) is untested; **H4** telemetry exists only behind a copy button.
- Known debt: one settings toggle reported as doing nothing (name unknown); the Pages source should be *GitHub Actions* so GitHub's branch build stops racing the workflow.

## 1. The one question this iteration answers

**Do strangers come back?** The prototype proved twenty good minutes for people who love you. Iteration 2 must produce day-1 and day-7 return numbers from people who do not, on a content set deep enough that returning is possible. Everything in scope serves that; everything that does not is out (§3).

## 2. Scope (binding)

### 2.1 Content: 40 curated levels from 16 arts

- Ten new arts, each ≤ 12 × 12 with 4–7 colours, authored as text grids like the existing six and reviewed on the test build before curation. Art is the real bottleneck: levels are nearly free, pictures are not.
- `tools/curate.mjs`: for each art × preset, run the existing generator (64 candidates, rated, six finalists re-rated), keep the candidate closest to the band, and emit the baked `LEVELS` block into `index.html`. Regenerated, never hand-edited. Every baked level keeps passing the loader and the solver in the headless suite.
- Difficulty curve, measured not felt: order by random-win rate descending with greedy-solvable levels first; the first "needs lookahead" level closes chapter 2 at level 16; one hard (≤ 5 %) level per eight, each a chapter's last level. (Baked 2026-09-24: the level-16 boss came out at 0.06 rather than the 0.12 aimed for, because no greedy-losing candidate sat nearer; it stays, on the argument that lookahead levels are about thinking, not luck, and the "+1 box" continue is there.) Level 1 stays as it is (the tutorial is tuned to it); the other five references keep their hand-made lanes and take the slots their measured rating earns, so the curve never runs backwards to fit them. Curation also enforces the prototype's H4 band as written there: 25–40 dispatches per level, so a level runs 45–90 s. If the art set cannot fill 40 slots inside that band, the band is widened by a written decision that re-opens H4, never by the tool.
- Level select scrolls in pages of eight; done/not-done plus best time, which the game already stores. No stars, no currencies.

Acceptance: 40 levels live; the evaluator's curve is monotone within ±0.10; every level solvable; each level's reference line fits the dispatch band.

### 2.2 Daily level and share

- One generated level per UTC date, same for everyone: art rotates through the set, preset medium, seed from the date. Retries allowed and counted.
- Share text in the Wordle pattern: `Shelf Control #123 · 1:12 · 3 boxes` followed by the finished picture as an emoji grid. The finished mosaic was the prototype pitch's "collectible, shareable" claim; this is where it earns that. `navigator.share` where available, clipboard otherwise.
- Streak counter in local storage.

Acceptance: two devices on the same date get the same level; share works on iOS Safari and Android Chrome; the daily has its own telemetry events.

### 2.3 Measurement that reaches you

- Events: `session_start`, `level_start`, `level_end` (the existing telemetry record, which already carries dispatches, boxes, grace saves, continues, auto-loops), `daily_share`, `install`. An anonymous device id in local storage; no personal data.
- Backend, your call (§6): PostHog free tier (fastest, funnels and retention for free) or a Cloudflare Worker with D1 (no third party, about a hundred lines). Recommendation: PostHog now; migrate only if it ever matters.
- The dev channel reports to a separate project so playtests never pollute the live numbers.

Acceptance: a dashboard showing D1/D7 return, the start-to-win/fail funnel per level, auto-finish usage and continue take-rate.

### 2.4 Installable web app

- Manifest, icons (the procedural cat rendered to PNG at deploy time), a service worker caching the single file so the game works offline after the first load, and an "add to home screen" hint after the second session.
- Standalone-mode audit on iOS and Android: safe-area insets, audio unlock, no rubber-banding, orientation lock.

Acceptance: installable per Lighthouse; launches from the home screen offline; those launches show up in telemetry.

### 2.5 Close the prototype's open hypotheses (cheap, and they gate iteration 3)

- **H1**: five people play build mode, then the yoink mode from the generated chooser (alternate the order), and say which they would keep playing. Thirty minutes of your time. The loser is deleted, not kept "just in case".
- **H3**: a fifteen-second screen recording of level 3 shown cold to three people who then explain the rules. The recording contains gameplay only, so if they cannot, the fix goes into what it shows (the ghost cells, the count badges, the tray, the drop itself) and never into the tutorial, which the recording does not contain. The recording is then re-shot on the changed build and shown to three new people. No money goes into distribution while H3 fails.

### 2.6 Fix list

- The setting that does nothing (needs its name; Assist and Motion are the candidates).
- Confirm iPhone sound on the live build after the unlock fix; if it still fails, the ring/silent switch is next.
- Reduced motion: auto-finish should be glow-only, no hop.
- Bump the workflow actions when their Node 24 releases land; the warnings are noise until then.

## 3. Explicitly not in iteration 2

- **Engine port.** The web build is the product until retention says otherwise. Porting now freezes feel decisions validated by one household.
- **Store wrap, ads, IAP.** Decided in §4, built in iteration 3.
- **New mechanics** (fat cat, mystery cat, sleepy cat, frosted cells, side shelves from Appendix C). Depth of content first; the drip starts only if D7 on plain levels justifies it.
- **User-generated content, generate-from-description or upload, accounts, cloud saves, localization.**

## 4. Monetization: decided, not built

Mirror the genre leader, as Appendix C already says: an interstitial on fail with a cap, optional after wins, rewarded video for "+1 box" only, never for difficulty skips, and a remove-ads purchase. On the web, none of it. The web build stays clean because it is the funnel and the test bed, and a canvas game wearing display ads is a worse first impression than no game. Ads and the purchase arrive with the store wrap in iteration 3, once day-7 numbers justify the developer fees and the review cycle. One consequence for this iteration: the "+1 box" continue must be instrumented now, so its take-rate is known before it costs a rewarded ad.

## 5. Sequence

Three slices, each a PR into `dev`, each played on `/test/` before the next starts, each shipped to `main` when you say so.

1. **Content** (§2.1) and the fix list (§2.6). The largest slice. The curation tool is mechanical work; the ten arts need taste and your eye.
2. **Daily and share** (§2.2) and the **installable app** (§2.4).
3. **Measurement** (§2.3), then playtest round two: ten or more strangers (friends of friends, one puzzle community, and one HTML5 portal listing as the distribution hedge from Appendix C), plus H1 and H3 (§2.5).

The iteration ends with a written retention readout and a go/no-go on the store wrap.

Model budget: slices 1 and 3 are mostly mechanical and suit cheaper models; the daily and share design, the iOS standalone quirks, and the difficulty-curve tuning are where the heavy model earns its keep.

## 6. Decisions needed

1. Telemetry backend: PostHog (recommended) or a self-hosted Worker.
2. Daily level: in or out. Recommendation: in; it is the cheapest return trigger in the genre and it reuses the generator.
3. The name of the broken setting.
4. Keep the codename through this iteration; run the store and trademark pass before the wrap.

## 7. Acceptance for the iteration

40 levels live with a verified curve · daily level live with share · installable and offline · dashboard with D1/D7 for ten or more strangers · H1 and H3 answered in writing · fix list closed · a go/no-go on iteration 3.
