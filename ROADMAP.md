# Shelf Control roadmap: the next three iterations

One rule carries over from the prototype: each iteration answers one question, and the next iteration is only funded by the answer. What follows is a plan with gates, not a promise; the gates are the point.

Where we stand on 2026-09-24: iteration 1 is live (the prototype, playtest fixes, auto-finish), and iteration 2's first slice (forty curated levels) is on the test build. `shelf-control-iteration-2-plan.md` remains the binding scope for iteration 2; this document only positions it and sketches what comes after.

---

## Iteration 2 (in progress): do strangers come back?

The prototype proved twenty good minutes for people who love you. This iteration produces day-1 and day-7 return numbers from people who do not, on a content set deep enough that returning is possible.

**Done:** slice 1, content. Sixteen pictures, forty curated levels in five chapters, a curation tool that enforces the plan's rules rather than scoring them, level select paged by chapter, layout-hashed level ids.

**Slice 2: daily level, share, installable.**
- One generated level per UTC date, the same for everyone: art rotates through the set, preset medium, seed from the date. Retries allowed and counted. A streak counter in local storage.
- Share text in the Wordle pattern (`Shelf Control #123 · 1:12 · 3 boxes`) followed by the finished picture as an emoji grid. This is where the "collectible, shareable" claim from the pitch earns its keep. `navigator.share` where available, clipboard otherwise.
- Manifest, icons, a service worker caching the single file so the game works offline after first load, an "add to home screen" hint after the second session. A standalone-mode audit on iOS and Android: safe-area insets, audio unlock, rubber-banding, orientation.
- The fix list: the setting that does nothing (once it has a name), iPhone sound confirmed on the live build, auto-finish glow-only under reduced motion, workflow action bumps when their Node 24 releases land.

**Slice 3: measurement, then strangers.**
- PostHog, free tier: `session_start`, `level_start`, `level_end`, `level_continue`, `daily_share`, `install`, an anonymous device id, no personal data. One project; a `channel` property keeps playtests on the test build out of the live numbers. The "+1 box" continue is instrumented now as its own event, accepted over offered, because its take-rate decides whether it can carry a rewarded ad later. (Built 2026-09-24.)
- Playtest round two: ten or more strangers (friends of friends, one puzzle community, one HTML5 portal listing as the distribution hedge).
- H1 closed: five people play build mode and the yoink mode, alternating order, and say which they would keep playing. The loser is deleted.
- H3 closed: a fifteen-second recording of level 3 shown cold to three people who then explain the rules. If they cannot, the fix goes into what the recording shows, never into the tutorial, and the test is re-run on three new people. No money goes into distribution while H3 fails.

**Exit:** a written retention readout and a go/no-go on the store wrap. The plan does not yet name the bar, so here is a proposal to confirm before the readout, not after: **D1 at or above 25 % and D7 at or above 8 % from the portal cohort** funds iteration 3 as written below. Casual puzzle titles that go on to work typically show D1 in the thirties and D7 in the low teens from store installs; portal traffic runs colder, so the bar is set below that. Below the bar, iteration 3 becomes the funnel iteration described at the end of the next section, and the wrap waits.

Second-order effect to watch: the daily level is the cheapest return trigger in the genre, which also means it can flatter D1 while the forty-level curve is what actually decides D7. Read the two cohorts separately (daily-only players versus chapter players) or the readout will lie.

---

## Iteration 3: does it earn?

Conditional on the iteration 2 gate. The question changes from *do they come back* to *does a returning player pay for the developer fees, the review cycle and the first user-acquisition test*.

**Scope.**
- **Store wrap.** Capacitor around the unchanged web build, iOS and Android. The PWA audit from iteration 2 is most of the work already done; the wrap adds store assets, an icon, a privacy policy (PostHog needs one), and the review dance.
- **Monetization exactly as decided in the iteration 2 plan, §4:** an interstitial on fail with a cap, optional after wins, rewarded video for "+1 box" only and never for difficulty skips, and a remove-ads purchase. The web build stays clean: it is the funnel and the test bed, and a canvas game wearing display ads is a worse first impression than no game.
- **Name.** The codename ends here. A store and trademark pass before the wrap ships; "Knock It Off!" is taken.
- **Content, cheaply.** Chapters 6 to 8 (24 levels) from the same curation tool, which costs minutes, plus six new arts, which cost taste. No new mechanics unless the D7 curve from iteration 2 visibly plateaus inside chapters 3 to 5; if it does, the first drip mechanic is the fat cat (needs two boxes), because it is the cheapest to build and the easiest to explain without text.
- **First paid acquisition test** with a fixed, small budget, only if H3 passed; a game that is not legible in ten seconds does not get a marketing budget.

**Explicitly not:** an engine port (the web build stays the product until performance, not preference, says otherwise), accounts, cloud saves, localization, user-generated content.

**Exit:** ARPDAU and eCPM by platform, the rewarded take-rate on "+1 box" against the free take-rate measured in iteration 2, crash-free rate, and CPI from the test budget. Go/no-go on scaling spend.

**If the iteration 2 gate fails,** iteration 3 is *fix the funnel* instead: the level 1 to 8 start-to-win funnel from the dashboard, the H3 recording loop until three cold viewers can explain the rules, and one more content pass. The wrap and the ads slide a whole iteration, and that is the right outcome: wrapping a game strangers abandon only makes the abandonment cost store fees.

---

## Iteration 4: does it hold?

The live-ops iteration. By now there are two numbers that matter, lifetime value against cost per install, and everything in scope moves one of them.

**Scope.**
- **The mechanics drip** from the prototype plan's Appendix C, one per twelve levels or so: fat cat, mystery cat (colour hidden until it reaches the front), sleepy cat (skips every other pass), frosted cells, kitten pairs, side shelves, one rainbow cat a level. Each ships behind a flag and is read against plain levels on D7 before the next one starts. The plan's own warning still stands: depth of content first, the drip only where the data asks for it.
- **A content cadence.** The curation tool bakes a chapter a week; a weekly hard daily joins the daily. This is the point of having made the level pipeline mechanical in iteration 2.
- **Light meta.** A gallery of finished pictures (the shareable mosaic becomes the collectible), best times per chapter. No currencies, no energy, no stars unless retention data begs for them, and the plan's position is that it will not.
- **Localization** of the small string set into the six store languages the install base shows, and cloud save through the store accounts only if the reinstall rate says progress loss is a churn reason.
- **Scaled acquisition** at whatever the iteration 3 CPI justifies, with H3 still green.

**Exit:** lifetime value against cost per install on the scaled budget, and one of three decisions: scale further, hold and harvest, or shelve. An engine port is on the table only here, and only if web performance on low-end Android is the measured reason players leave.

---

## What is deliberately not on this roadmap

- Multiplayer, social graphs, clans, leaderboards beyond the share text. The genre's return loop is the daily and the curve, not other people.
- Generate-from-photo or upload-your-own-picture. Charming, expensive, a moderation problem, and it competes with the curated set for the player's attention.
- A second game mode. H1 settles build versus teardown in iteration 2 and the loser is deleted; the roadmap does not resurrect it.
