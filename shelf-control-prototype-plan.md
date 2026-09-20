# SHELF CONTROL — Web Prototype Build Plan (v1)

*Working title. A "live puzzle" where cats knock colored blocks off a shelf to build pixel art.*
*Audience for this document: Claude Fable (the builder). Owner: Andrew. Status: ready to build.*

---

## 0. How to use this document

You are building a **functional, single-file web prototype** of a mobile puzzle game. The prototype exists to answer one question: **does this feel ridiculously satisfying, and is the puzzle real?** It is a feel test and a rules test, not a product.

- **§4–§7 are binding.** Rules, the logic/presentation split, and the level data were backtested in Python (Appendix B). Implement them as written. If something plays badly once it's on screen, say so and propose a change; don't silently redesign.
- **§8–§10 are direction.** Make taste calls on visuals and sound, but hit the feel targets. When in doubt, choose the option that is smoother, rounder, and more legible.
- **§12 is the build order.** Work phase by phase. After each phase, run its acceptance checks and report results in 3–5 lines before continuing.
- **§14 is the fence.** Nothing in it gets built, however tempting.
- Juice is not polish here. Satisfaction *is* the hypothesis, so sound and landing feedback arrive in Phase 2, not at the end.

---

## 1. The pitch

Cats stroll along a shelf above an empty picture frame. Each cat is a color and carries a number of blocks. As a cat passes over a column whose next missing block matches its color, it bats one block off the shelf. The block falls, lands with a musical *tok*, and a pixel-art picture grows from the floor up. Cats with blocks left over hop into one of five cardboard boxes to wait for another go. Run out of boxes and the level is lost.

**The 5-second read (what an onlooker must understand with zero text):** tap cat → cat walks the shelf → blocks fall and click into a picture → leftover cats pile into boxes → boxes are nearly full → tension.

**Genre skeleton kept from the comps:** tap-to-dispatch color agents, a small waiting tray as the fail state, art-shaped level targets, fully deterministic levels, one-tap control.

**What is new:** the payoff is inverted. Every comp found tears a picture *down* (shooters, ants, tanks). This one builds the picture *up*, which adds three things: gravity gives an ordering rule everyone already understands (you can't place a block in mid-air), each level ends on a finished artwork instead of an empty board (collectible, shareable, and a reveal arc for video), and the near-complete picture at the moment of failure makes "one more box" feel worth it.

---

## 2. Why this design — evidence

Design decisions below trace to market data, not vibes. Summaries are paraphrased; read the sources for detail.

| Finding | Design consequence |
|---|---|
| Pixel Flow (Loom Games, ~10 people, launched Aug 2025) passed ~$500K/day within about four months. Its structure: conveyor, return bench, strict slot limits, front-row-only interaction. Space pressure is what makes it a puzzle. [1] | Keep that skeleton exactly: lanes with front-only access, a 5-slot tray, shelf capacity. |
| It is fully deterministic, and skilled players can chain dispatches to temporarily exceed the tray limit. Engagement is reported near an hour a day. [1] | Deterministic sim, seeded levels, no randomness at play time. Real-time "juggling" (§5) is a feature; do not "fix" it. |
| The tray works because players manage it actively all the time, so failure reads as "my mistake" and buying more room feels legitimate rather than a bail-out. [2] | Boxes sit at the visual center of the screen and are the most expressive objects in the game (§8.6). The continue offer is literally "+1 box". |
| Art-shaped targets double as ad creatives, and conveyor motion makes creatives feel alive. The next breakout is expected to recombine these proven elements rather than clone them cheaper. [2] | Pixel-art targets, a constantly moving parade of cats, and an inverted (constructive) payoff as the recombination. |
| Conveyor puzzles are described as the fastest-growing, highest-grossing hybrid-casual puzzle trend; bus-sort games resurged by adding a conveyor, and Voodoo's entry varies the route shape per level. [3][4] | The category is proven and crowded. Differentiation must be visible in the first three seconds of footage. |
| Colony Flow (ABI): tap a box, ants stream out and carry matching blocks home, five slots, buried boxes, explicitly no timers. Bus Fever Party (Lumi) was at roughly 2.5M downloads in 30 days when checked. [5][6] | No level timer, no lives in the prototype. Swarm-style motion is part of the appeal: allow up to 5 cats on the shelf at once. |
| Smash Fest (Flow Games): aim, fire, watch physics chain reactions resolve. [7] | The shared thread across all four comps is *commit, then watch a live process pay off*. Falling, landing blocks are this game's version of that payoff. |
| Player reviews: Pixel Flow players complain that the fail arrives with no chance to react; an Ants Flow reviewer calls the ASMR the best part and says repeated retries on hard levels destroy it. [8][9] | Grace window before failing (§4.6). Difficulty comes from planning, never from speed. Satisfaction feedback is protected above all else. |

Sources:
[1] https://www.deconstructoroffun.com/blog/2026/2/13/pixel-flow-the-publishers-dream
[2] https://www.deconstructoroffun.com/blog/pixel-flow-and-the-rise-of-sort-puzzles
[3] https://nextbiggames.com/2026/05/30/hybrid-casual-puzzle-trends-2025/
[4] https://carlospereiragame.substack.com/p/super-monday-casual-hybrid-and-hyper-f15
[5] https://play.google.com/store/apps/details?id=com.abi.colony.flow
[6] https://www.appbrain.com/app/bus-fever-party/gridplus.busjam.carpuzzle
[7] https://play.google.com/store/apps/details?id=com.flow.cannonball.smash.carnival
[8] https://play.google.com/store/apps/details?id=com.loomgames.pixelflow
[9] https://play.google.com/store/apps/details?id=com.ants.box

**Honest caveat:** "nobody is doing a constructive version" rests on a handful of store and portal searches, not a full market sweep. Treat it as a hypothesis.

---

## 3. What the prototype must answer

| # | Hypothesis | How the prototype tests it |
|---|---|---|
| H1 | Building up is at least as satisfying as tearing down. | Phase 5 adds a mirrored teardown mode on the same sim. Put both in front of 5+ people and ask which they'd keep playing. |
| H2 | The boxes read as the center of play and failing feels fair. | Watch first-time players. After a fail, ask "whose fault was that?" The right answer is "mine". |
| H3 | The game is legible in 10 seconds with no text. | Screen-record 15 s of level 3. Show it cold. If the viewer can't explain the rules, the UA thesis is imaginary. |
| H4 | Levels of 45–90 s and ~25–40 dispatches feel right. | Debug telemetry (§11.4) logs time, dispatches, max boxes used, grace saves. |

---

## 4. Core rules (binding)

### 4.1 Board
- A grid `W × H` (8–12 wide, 8–11 tall). Every cell has a target color.
- Each column is a **solid stack from the floor**. The only empty cells allowed are air *above* a column's topmost block. A level with a gap under a colored cell is invalid; the loader must reject it.
- Per column `c`, the logic holds `cols[c]` = the color sequence bottom→top, and `ptr[c]` = index of the next block to place. The **frontier** is the set of next-needed cells, one per unfinished column.

### 4.2 Cats
- A cat is `{ id, color, count }`. `count` = blocks it still carries. For each color, the counts of all cats sum to exactly the number of cells of that color.
- Cats wait in **lanes** (2–4 FIFO queues). Only the **front cat of each lane** is tappable. Cats resting in boxes are also tappable.

### 4.3 The pass
- A dispatched cat climbs the cat tree, walks the shelf left→right once, slides down on the right.
- **Rule A — one block per column per pass.** Walking over column `c`: if `count > 0` and the frontier cell of `c` is this cat's color, it drops exactly one block there. `ptr[c]++`, `count--`.
- After the pass: `count == 0` → the cat leaves happily. Otherwise it needs a box.
- (Backtest note: letting a cat dump a whole same-color run per column made levels nearly unlosable, random play won 83–100%. Rule A produces a real difficulty range. Keep Rule A. A `burstDrop` flag may exist in CONFIG for experiments, default `false`.)

### 4.4 Shelf capacity
- At most `shelfCapacity = 5` cats may be **in flight** (hopping, climbing, walking, sliding, or waiting for a box). A tap at capacity is a soft deny (§4.9).

### 4.5 Boxes (the tray)
- `trayCapacity = 5` boxes. A box is freed **the instant its cat is dispatched**, not when the cat finishes.
- On reaching the bottom of the slide, a cat with blocks left takes the first free box.

### 4.6 Grace, then fail
- If no box is free on arrival, the cat **waits at the slide's end for `graceSeconds = 2.5`**, visibly teetering with a radial countdown. It still counts as in flight. Cats behind it queue up and hold.
- If the player frees a box in time (by dispatching a boxed cat), the waiting cat takes it and play continues. This is a *grace save*; count it in telemetry.
- If grace expires: **fail** (`reason: 'no_box'`). Offer "+1 box" once per attempt (free in the prototype): adds a sixth box, the waiting cat takes it, play resumes.

### 4.7 Stuck detection
Fail with `reason: 'stuck'` after a 0.8 s beat when **all** of these hold: nothing is in flight; no tappable cat could place at least one block right now; and the tray is full or every lane is empty. (If the tray has room and lanes have cats, the player can still dig, so it is not stuck.)

### 4.8 Win
All columns complete. Logical completion happens at the final dispatch; the celebration triggers when the last block visually lands.

### 4.9 Soft denies (never punish, never eat the tap silently)
| Situation | Response |
|---|---|
| Shelf at capacity | Cat shakes its head, shelf edge flashes, low double-note. |
| Boxed cat that would place 0 blocks right now | Same head shake plus a small "?" puff. Not dispatched. |
| Lane-front cat that would place 0 blocks | **Allowed.** It walks, drops nothing, and takes a box. Digging through a lane to reach the cat behind is a core move. |
| Cat that isn't at the front of its lane | Tiny wiggle on the front cat of that lane to show who is tappable. |

### 4.10 Determinism: resolve on dispatch, animate on playback
Later cats can never overtake earlier ones (same path, same speed, enforced minimum gap), and columns are independent. Therefore a cat's entire pass is known the moment it is dispatched.

- `sim.dispatch(cat)` **immediately** computes the cat's full placement list against the logical board (which already includes every block committed by cats ahead of it), advances `ptr`, and decrements `count`.
- The presentation layer then plays that list back: as the walking cat crosses each placement column it swipes a paw and a block falls.
- Consequence: the logical outcome is identical to resolving passes one at a time in dispatch order. The game is a turn-based deterministic puzzle wearing a real-time costume. Frame rate can never change a result.
- A cell that is committed but whose block has not landed yet is **reserved** and must render differently from an open ghost cell (§8.4), otherwise the board looks wrong while blocks are falling.

---

## 5. Why the real-time layer still matters (do not remove)

Because a box frees the instant its cat is dispatched, and boxes are only claimed on arrival, a player can keep more cats in circulation than the tray holds by keeping some on the shelf: send a lane cat while the tray is full, then send a boxed cat before the first one gets home, and the first takes the vacated box. Shelf capacity (which counts waiting cats) bounds this. This is the same family of skill that the genre leader's analysts credit for its depth. Combined with the grace window, it produces last-second saves without any timer. Levels are generated to be solvable **without** juggling; juggling is how good players rescue mistakes.

---

## 6. Architecture

### 6.1 Target environment and hard constraints
- **One self-contained `index.html`.** Inline CSS and JS. Vanilla JS, Canvas 2D, Web Audio. No frameworks, no build step, no physics engine, no image or audio files.
- Optional: Google Fonts stylesheet for **Fredoka** with fallback stack `ui-rounded, "Nunito", system-ui, sans-serif`. The game must look fine if the font never loads.
- Persistence is optional. If used, wrap every `localStorage` call in try/catch and fall back to in-memory state; some sandboxes block storage.
- Pointer Events for input (touch and mouse). Portrait-first. Design space **390 × 844** logical px, uniformly scaled to fit, letterboxed with the wall gradient. Cap `devicePixelRatio` at 2.
- Target 60 fps on a mid-range phone. Pre-render block sprites per color to offscreen canvases. Pool particles. Respect `prefers-reduced-motion` (no shake, fewer particles).
- Audio starts only after the first user gesture (resume the AudioContext on first pointerdown).

### 6.2 Module layout (sections of the one file, in this order)
`CONFIG` → `RNG` (mulberry32) → `LEVEL DATA` → `GENERATOR` (Phase 3) → `SIM` (pure logic) → `AUDIO` → `RENDER` → `ACTORS` (cat/block presentation state machines) → `INPUT` → `UI/SCREENS` → `DEBUG/TELEMETRY` → `BOOT`.

**The SIM and GENERATOR must be pure:** no DOM, no time, no `Math.random`, no references to rendering. Write them as if they will be ported line-for-line to C# for Unity, because they will be.

### 6.3 Sim API
```js
const sim = createSim(level);        // level: { art: string[], lanes: string[], tray?: 5, shelf?: 5 }

sim.cols            // string[][]  colours bottom->top per column
sim.ptr             // number[]    LOGICAL next index per column (includes blocks still falling)
sim.lanes           // Cat[][]     index 0 = front
sim.boxes           // (Cat|null)[]
sim.inFlight        // Cat[]       dispatch order; includes cats waiting for a box
sim.status          // 'playing' | 'won' | 'failed'

sim.canPlaceNow(cat)        // -> number of blocks this cat would drop if dispatched now
sim.isTappable(cat)         // lane front or boxed
sim.dispatch(catId)         // -> { ok:false, reason:'shelf_full'|'nothing_to_place'|'not_tappable' }
                            //  | { ok:true, placements:[{col,row,color}], remaining }
sim.arrive(catId)           // presentation calls this at the slide's end
                            // -> { to:'exit' } | { to:'box', slot } | { to:'wait' }
sim.assignWaiting()         // call after any box frees -> [{ catId, slot }]
sim.graceExpired(catId)     // -> sets status 'failed', reason 'no_box'
sim.addBox()                // the "+1 box" continue
sim.isStuck()               // §4.7
```

A cat leaves `inFlight` when `arrive` sends it to a box or the exit, or when `assignWaiting` gives it a box. A waiting cat stays in `inFlight` and keeps occupying shelf capacity.

`dispatch` in full:
```
if inFlight.length >= shelfCapacity            -> shelf_full
n = canPlaceNow(cat)
if cat is boxed and n == 0                     -> nothing_to_place
remove cat from its lane front or its box      (box is free from this instant)
placements = []
for c in 0..W-1:
    if cat.count > 0 and ptr[c] < cols[c].length and cols[c][ptr[c]] == cat.color:
        placements.push({ col:c, row:ptr[c], color:cat.color }); ptr[c]++; cat.count--
inFlight.push(cat)
if every column complete -> status = 'won'
return { ok:true, placements, remaining: cat.count }
```
Because columns are solid from the floor, `row` (counted from the bottom) equals `ptr[c]` at placement time.

### 6.4 Presentation timeline for one cat
`QUEUED/BOXED → HOP (0.22 s) → CLIMB (0.30 s) → WALK → SLIDE (0.40 s) → [BOX_HOP 0.25 s | EXIT 0.5 s | WAIT]`

- **Input buffering:** enforce `minDispatchGap = 0.28 s` between dispatches. Taps that arrive early are queued (max 2) and fired in order when the gap elapses. The logical dispatch happens when fired. Never drop a tap.
- **Walk:** from 0.8 cells left of column 0 to 0.8 cells right of the last column at `walkSpeed = 4.5` columns/s.
- **Drop playback:** when the cat's x crosses the center of a placement column: paw swipe (90 ms), badge number ticks down, a block spawns at the shelf's front edge and falls. `fallTime = 0.12 + 0.11 * sqrt(rowsFallen)` seconds, ease-in. This guarantees two blocks falling in the same column land in order.
- Fixed-timestep update (1/120 s) inside a single `requestAnimationFrame` loop; render once per frame.

---

## 7. Level data (baked and validated)

Phases 1–2 use these six levels verbatim so the core experience does not depend on the generator. Each `lanes` string lists cats front→back as `<colorKey><count>`. All six were verified solvable by exhaustive search; difficulty figures are in Appendix B.

```js
const PALETTE = {
  R:{ name:'Strawberry', hex:'#FF5A6E' }, O:{ name:'Tangerine', hex:'#FF9F45' },
  Y:{ name:'Lemon',      hex:'#FFD84D' }, G:{ name:'Mint',      hex:'#5FD38D' },
  B:{ name:'Sky',        hex:'#6EC6FF' }, P:{ name:'Grape',     hex:'#9B7BFF' },
  K:{ name:'Cocoa',      hex:'#6B566F' }, W:{ name:'Cream',     hex:'#FFF4E0' },
  N:{ name:'Bubblegum',  hex:'#FF9CCB' }, T:{ name:'Caramel',   hex:'#C98B5B' },
};

const LEVELS = [
  { id:'heart', name:'Heart', art:[           // 9x8, 72 blocks, 3 colours — tutorial
      "WWWWWWWWW",
      "WWNRWRRWW",
      "WNRRRRRRW",
      "WRRRRRRRW",
      "WWRRRRRWW",
      "WWWRRRWWW",
      "WWWWRWWWW",
      "WWWWWWWWW" ],
    lanes:[ "W18 W6 R5 N2", "R5 R3 W7 R12 W14" ] },

  { id:'chick', name:'Chick', art:[           // 10x10, 100 blocks, 5 colours — easy
      "BBBBBBBBBB",
      "BBBYYYYBBB",
      "BBYYYYYYBB",
      "BBYKYYKYBB",
      "BBYYOOYYBB",
      "BYYYYYYYYB",
      "BYYYYYYYYB",
      "BBYYYYYYBB",
      "BBBOBBOBBB",
      "GGGGGGGGGG" ],
    lanes:[ "G10 Y14 B4 K2 B1", "B8 O2 B2 B4 B6", "O2 Y4 Y13 Y9 B19" ] },

  { id:'mushroom', name:'Mushroom', art:[     // 11x10, 110 blocks, 5 colours — easy+
      "BBBBBBBBBBB",
      "BBBRRRRRBBB",
      "BBRRWRRRRBB",
      "BRRRRRRWRRB",
      "BRWRRRRRRRB",
      "BRRRRWRRRRB",
      "BBBWWWWWBBB",
      "BBBWKWKWBBB",
      "BBBWWWWWBBB",
      "GGGGGGGGGGG" ],
    lanes:[ "G11 W1 B5", "W11 B14 B2 R9 B10 W1", "B14 R16 K2 R10 W4" ] },

  { id:'icecream', name:'Ice cream', art:[    // 10x11, 110 blocks, 6 colours — medium
      "BBBBBBBBBB",
      "BBBBRBBBBB",
      "BBBNNNNBBB",
      "BBNNNNNNBB",
      "BBNNNNNNBB",
      "BBGGGGGGBB",
      "BGGGGGGGGB",
      "BBTOTOTOBB",
      "BBBOTOTBBB",
      "BBBBTOBBBB",
      "BBBBOBBBBB" ],
    lanes:[ "B10 T6 B4 N16", "O2 O5 B2 B2 B10", "B9 B18 G8 G6 R1 B8 B3" ] },

  { id:'catface', name:'Cat', art:[           // 11x11, 121 blocks, 5 colours — medium+
      "BBBBBBBBBBB",
      "BOOBBBBBOOB",
      "BONOBBBONOB",
      "BOOOOOOOOOB",
      "BOOOOOOOOOB",
      "BOKOOOOOKOB",
      "BOOOONOOOOB",
      "BOWWOKOWWOB",
      "BBOWWWWWOBB",
      "BBBOOOOOBBB",
      "BBBBBBBBBBB" ],
    lanes:[ "B11 B14 B6 O9 B12 O4 B1", "W9 N1 O9 O7 O8", "O15 K3 B10 N2" ] },

  { id:'rainbow', name:'Rainbow', art:[       // 12x10, 120 blocks, 7 colours — hard (needs lookahead)
      "BBBBBBBBBBBB",
      "BBBBBRRBBBBB",
      "BBBRRRRRRBBB",
      "BRROOOOOORRB",
      "BROOYYYYOORB",
      "RROYGGGGYORR",
      "ROYGPPPPGYOR",
      "ROYGPBBPGYOR",
      "WWWWPBBPWWWW",
      "WWWWWBBWWWWW" ],
    lanes:[ "O8 G2 B15 O8", "G2 P8 Y8 B2 R2", "B7 R16 G4", "W18 B2 Y2 R4 B12" ] },
];
```

**Loader validation (assert at boot, fail loudly):** all art rows equal length; no gap under a colored cell; per color, sum of cat counts equals the number of cells of that color; every color key exists in `PALETTE`.

**Art guidelines for new levels:** a framed mosaic, not a floating sprite. Backgrounds are real colors and therefore real blocks. 3–7 colors. Color count is the strongest difficulty lever found in the backtest, then lane count, then the share of big cats.

---

## 8. Look and feel

**Direction:** a sunlit room at the soft end of the day. Pastel wall, one deep plum picture frame where all the saturated color lives, warm wood, cardboard. Everything is rounded, nothing has a hard corner, nothing is pure black. Spend the boldness on the board and the cats; keep the chrome quiet.

### 8.1 Screen layout (390 × 844 design space)
```
┌──────────────────────────────────────┐
│ (⟲)      Level 4 · Ice cream     (⚙) │  y 28–72   top bar
│                                      │
│ ▓tree▓ ═══════ shelf ═══════ ╲slide  │  y ≈ 176   cats walk on top of the shelf, left → right
│  ▓▓   ┌──────────────────────┐  ╲    │
│  ▓▓   │                      │   ╲   │  y 196–520 board well (cells ≈ min(30, 350/W) px)
│  ▓▓   │   blueprint + blocks │    ╲  │            blocks fall from the shelf's front edge
│  ▓▓   └──────────────────────┘     ↓ │
│      [box][box][box][box][box]       │  y 548–618 the tray: five cardboard boxes, centered
│                                      │
│       lane 1    lane 2    lane 3     │  y 650–830 front cats large (≈64 px), 2nd row ≈ 80 %,
│        🐈        🐈        🐈         │            3rd row ≈ 62 % and dimmed; deeper cats shown
│        🐈        🐈        🐈         │            as a "+N" chip
└──────────────────────────────────────┘
```
The cat tree on the left and the slide on the right close the loop visually: lanes → tree → shelf → slide → boxes. The parade always circulates clockwise.

### 8.2 Color tokens
| Token | Value | Use |
|---|---|---|
| `wallTop` / `wallBottom` | `#FFE3EC` → `#E4D7FF` | full-screen vertical gradient |
| `well` | `#2A2140` | board frame interior, soft inner shadow |
| `wood` / `woodEdge` | `#B07A4E` / `#8E5F3A` | shelf, cat tree, slide |
| `rope` | `#E8C79A` | sisal wrap on the tree |
| `card` / `cardDark` | `#D9A66B` / `#B9854F` | boxes and flaps |
| `ink` | `#33284F` | text, eyes, outlines (never `#000`) |
| `danger` | `#FF5A6E` | tray warnings only |

### 8.3 Blocks
Rounded rect, radius 22 % of the cell, 1.5 px gap between cells. Base color; top 30 % highlight (white at 28 % alpha); bottom 22 % shade (black at 14 %); a small specular dot top-left. Pre-render one sprite per color.

### 8.4 Blueprint cells (full information, at a glance)
- **Open ghost:** target color at 20 % alpha over the well. The whole picture is visible faintly from the start; the puzzle is deterministic and players must be able to plan.
- **Frontier ghost** (next needed in each column): add a 1.5 px outline in the target color at 70 % alpha. This is how players read "what does the board want right now".
- **Reserved** (committed, block still falling): 40 % alpha with a gentle pulse, no outline.
- **Landed:** the solid block sprite.
- Optional **symbols** setting for color-blind play: emboss a small glyph per color on blocks, ghosts, and cat badges (● ▲ ■ ◆ ★ ♥ ✚ ☾ ⬟ ✿).

### 8.5 Cats (procedural, no sprites)
- Body: horizontal ellipse. Head: circle overlapping the front. Two rounded-triangle ears with bubblegum inners. Tail: a thick curved stroke that sways. Muzzle and belly: body color mixed 55 % toward white. 2 px outline in the body color darkened 25 % so Cream cats read against the wall. Eyes: `ink` dots with a white glint; use Cream eyes on Cocoa cats.
- **Badge:** white pill above the head, bold `ink` number, pops 1 → 1.3 → 1 on every change.
- **Walk:** 3 px vertical bob at 6 Hz, legs as two alternating small ellipses, tail sway. **Paw swipe:** front paw arcs forward 90 ms.
- **Ready state:** a tappable cat that can place at least one block right now does a small idle bounce. One that can't sits still and looks slightly away. This is the `assist` setting; default on.
- **Boxed:** only ears, eyes, and two paws show over the rim. Eyes track the most recently dispatched cat. Occasional blink and ear twitch.
- **Leaving happy:** small jump, two hearts, slides out through a cat flap bottom-right.

### 8.6 The tray is the star
| Boxes occupied | Behavior |
|---|---|
| 0–3 | calm |
| 4 | the empty box wobbles; a soft `danger` glow under the tray |
| 5 | all boxes shiver every 2 s; a faint vignette; a low heartbeat-like pulse in the audio bed |
| cat waiting (grace) | radial countdown ring on the waiting cat; every boxed cat that *can* place right now bounces hard and glows, because tapping one of them is the save |

---

## 9. Juice spec

| Event | Visual | Audio | Timing |
|---|---|---|---|
| Tap accepted | cat squashes 0.85 then springs toward the tree; its lane slides forward with an ease-out | soft rising pop | 220 ms hop |
| Tap denied | head shake; shelf edge flash if capacity | two low muted notes | 180 ms |
| Paw swipe | paw arc; block tips off the shelf edge | tiny tick | 90 ms |
| Block falling | slight stretch on the fall axis (scaleY up to 1.12) | none | `fallTime` |
| **Block lands** | squash 0.70 → 1.08 → 1.00; 4 dust puffs; 2 px nudge on that column only | **marimba pluck; pitch climbs a pentatonic ladder while landings keep coming within `comboWindow` = 1.2 s; resets after silence** | 140 ms settle |
| Row completed | light sweep left→right across the row | short glissando chime | 300 ms |
| Cat empties | jump, hearts, badge shows ✓ | three-note rising arpeggio plus a synth "mrrp" | 500 ms |
| Cat takes a box | hop, box bulges and settles, flaps bounce | cardboard thup | 250 ms |
| Tray at 4 / 5 | §8.6 | bed gains a pulse | continuous |
| Grace save | waiting cat leaps into the freed box; "Phew!" floats up | bright two-note relief | 300 ms |
| Win | diagonal flash wave across the picture, picture "breathes" 1 → 1.04 → 1, palette confetti, boxed and lane cats cheer | six-note fanfare | 1.4 s, then results card |
| Fail | the waiting cat flops, boxes droop, desaturate 30 % | two falling notes, no harsh buzzer | 0.8 s, then fail card |

Haptics: `navigator.vibrate(8)` on landings and `vibrate(20)` on win when available. Fail silently where unsupported.

**The landing melody is the single most important piece of feedback in the prototype.** A well-chained parade should sound like someone running a mallet up a xylophone. Tune this before anything else in Phase 2.

---

## 10. Audio synthesis (Web Audio, no files)
- One `AudioContext`, master gain 0.5, a compressor on the master, a mute toggle.
- **Pluck:** triangle oscillator plus a quieter sine one octave up → gain envelope (attack 2 ms, exponential decay 180 ms) → lowpass at 2.2 kHz. Random detune ±6 cents.
- **Ladder:** C major pentatonic from C4: `C D E G A` repeating upward, capped at 14 steps, then hold the top note with a little sparkle (extra sine two octaves up).
- **Pop / thup / tick:** 30–60 ms filtered noise bursts with a fast pitch-swept sine.
- **Bed (optional, Phase 4):** a very quiet two-chord pad. Off by default if it costs time.
- Limit polyphony to 12 voices; steal the oldest.

---

## 11. UX flow

### 11.1 Screens
`Level select` (six thumbnails: finished levels in full color, unfinished as faint blueprints, plus a "🎲 Generated" tile from Phase 3) → `Playing` → `Win card` (picture, time, dispatches, "Next") or `Fail card` (reason in plain words, "+1 box and continue" once, "Try again").

Restart (⟲) is always one tap, instant, no confirmation.

### 11.2 Tutorial (level 1 only, three tips, never blocks input)
1. Pulsing hand on the first Cream cat: "Tap a cat."
2. When the first cat returns to a box: "Cats with blocks left nap in a box. Run out of boxes and it's over."
3. On the first frontier color change: "Glowing squares show what each column needs next."
Level 2 adds one line on first load: "Only the front cat in each line can go."

### 11.3 Settings
Sound, symbols, assist, reduced motion override, reset progress.

### 11.4 Debug overlay and telemetry (press `D` or tap the 🐞 in settings)
- Live: fps, in-flight count, boxes used, logical vs. landed blocks, current seed, mode.
- Sliders: `walkSpeed`, `minDispatchGap`, `graceSeconds`, `shelfCapacity`, `trayCapacity`.
- At level end, `console.log` and keep in memory:
  `{ level, seed, mode, result, reason, timeSec, dispatches, zeroPlaceDispatches, maxBoxesUsed, graceSaves, continuesUsed, deniedTaps }`
- "Copy stats" button. Clipboard access can be blocked in sandboxed frames; fall back to showing the JSON in a selectable textarea.

---

## 12. Build phases and acceptance criteria

### Phase 1 — Logic and a playable grey box
Build `CONFIG`, `RNG`, `LEVEL DATA` with loader validation, the full `SIM` (§6.3), input with buffering, and a plain renderer: flat rectangles for blocks, circles with numbers for cats, straight-line movement along the loop, the four cell states.
- [ ] All six levels load; loader assertions pass.
- [ ] Level 1 is completable by tapping. Win and both fail reasons are reachable.
- [ ] Shelf capacity counts waiting cats. A box frees on dispatch. Grace save works.
- [ ] Rapid triple-tap dispatches three cats in order with none lost.
- [ ] Headless check (§13.1) passes if a JS runtime is available.

### Phase 2 — Feel
Replace the grey box with §8–§10: block sprites, procedural cats, the layout, all of the juice table, audio with the pentatonic ladder, tray expressiveness, win and fail sequences.
- [ ] With the sound on and eyes closed, a five-cat parade is recognizably musical.
- [ ] No frame drops below 55 fps during a full parade with confetti on a mid phone or throttled desktop.
- [ ] A reserved cell is never visually mistaken for an open one.
- [ ] Someone who has not read this document can explain the rules after watching 10 seconds.

### Phase 3 — Generator and endless levels
Port Appendix A to JS (`mulberry32` seeded). Add the "🎲 Generated" tile: pick art from the six (or any valid grid), pick a preset, generate 80 candidates, rate each with 100 random playouts plus one greedy playout, keep the one closest to the preset's target.
- [ ] 100 generated levels per preset: 100 % pass `replay()` (Appendix A).
- [ ] After generate-80-and-select, the achieved random-win is within ±0.10 of the preset target wherever Appendix B says that art can reach it. Where it can't (a 3-color art on *hard*, a 7-color art on *easy*), the tile shows the achieved rating instead of the requested one.
- [ ] Same seed → identical lanes, every time.
- [ ] Generation finishes in under 400 ms on desktop. If not, cut candidates before cutting playouts.

### Phase 4 — Prototype polish
Tutorial tips, settings, symbols mode, level select thumbnails, debug overlay, telemetry, "+1 box" continue, reduced motion.
- [ ] A full six-level run produces six telemetry records that can be copied out.
- [ ] Symbols mode is playable in greyscale (test with a CSS `filter: grayscale(1)` on the canvas).

### Phase 5 — The A/B that matters (optional, only after 1–4 pass)
`CONFIG.mode = 'build' | 'yoink'`. In **yoink** mode the board starts full; per column the frontier is the *topmost remaining* block; a passing cat plucks one matching top block per column, which pops upward into its sack; a cat's number is remaining sack space. Logic is the same sim with each column's sequence reversed, so lanes must come from the generator with `reverse: true` (the baked lanes are only valid for build mode).
- [ ] Both modes selectable from the debug overlay on any generated level.
- [ ] Telemetry records `mode` so sessions can be compared.

---

## 13. Test plan

### 13.1 Headless (run in Node or any JS runtime if you have one; otherwise expose as `window.__selftest()`)
1. For each baked level: depth-first search with memoization on `(ptr, lanePositions, sortedTray)` confirms a winning line exists under the turn-based model (no juggling). Expect six passes.
2. 1,000 random playouts per baked level; print the win rate next to the Appendix B figure. Expect agreement within ±0.05.
3. Determinism: dispatch the same cat order twice; assert identical placement lists.
4. Invariant after every dispatch: for each color, unplaced cells == sum of remaining counts over all cats of that color.

### 13.2 Manual
- Tap every non-tappable thing; nothing breaks, every tap gets a response.
- Fill the tray on purpose, trigger grace, save it; then let it expire.
- Dispatch a boxed cat with nothing to place: denied with a head shake.
- Dig: send a lane cat that places nothing; it boxes; the cat behind becomes tappable.
- Background the tab mid-parade and return: no teleporting, no double-resolved blocks (clamp `dt`).
- Resize and rotate: layout holds, canvas stays sharp.

---

## 14. Non-goals (do not build)
Ads, IAP, currencies, lives, timers, boosters, accounts, backend, analytics SDKs, meta progression, story, more than the three tutorial tips, localization, a level editor UI, more mechanics than §4, image import, frameworks, bundlers, asset files.

---

## 15. CONFIG defaults
```js
const CONFIG = {
  mode: 'build',           // 'build' | 'yoink' (Phase 5)
  trayCapacity: 5,  shelfCapacity: 5,
  walkSpeed: 4.5,          // columns per second; try 4–6
  minDispatchGap: 0.28,    // seconds; also the tap buffer cadence
  tapBuffer: 2,
  graceSeconds: 2.5,
  stuckBeat: 0.8,
  comboWindow: 1.2,        // seconds; landing-melody ladder
  burstDrop: false,        // experimental; breaks difficulty, see §4.3
  assist: true, symbols: false, sound: true,
  dprCap: 2, fixedStep: 1/120,
};
```

---

## Appendix A — Reference generator and evaluator (Python, validated; port as-is)

The supply is built by **playing a reference solution forward under the real rules**, so every level is solvable by construction and the reference never needs more than `ref_tray_max` boxes. Difficulty comes from how much slack that leaves, how many cats are "big" (carry more than they can place in one pass), and how many colors and lanes there are.

```python
import random, sys

def columns(grid):                      # rows are top->bottom strings; returns colour lists bottom->top
    H, W = len(grid), len(grid[0]); cols = []
    for c in range(W):
        seq = [grid[r][c] for r in range(H - 1, -1, -1)]
        while seq and seq[-1] == '.': seq.pop()
        assert '.' not in seq, f"column {c}: gap under a colour"
        cols.append(seq)
    return cols

def frontier(cols, ptr, color):         # how many columns want this colour next
    return sum(1 for c, s in enumerate(cols) if ptr[c] < len(s) and s[ptr[c]] == color)

def run_pass(cols, ptr, color, count):  # Rule A: one block per column per pass
    placed = 0
    for c, s in enumerate(cols):
        if count and ptr[c] < len(s) and s[ptr[c]] == color:
            ptr[c] += 1; count -= 1; placed += 1
    return placed

def generate(grid, rng, lanes=3, tray_cap=5, ref_tray_max=3, p_big=0.5,
             big_mult=(2.0, 3.5), max_count=20, p_recall=0.75):
    cols = columns(grid); ptr = [0] * len(cols)
    un = {}                                           # blocks per colour not yet given to a cat
    for s in cols:
        for ch in s: un[ch] = un.get(ch, 0) + 1
    tray, cats, ref, last, max_tray = [], [], [], None, 0   # tray items: [colour, left, catIndex]
    while any(ptr[c] < len(cols[c]) for c in range(len(cols))):
        recall = [t for t in tray if frontier(cols, ptr, t[0]) > 0]
        fresh  = [x for x in un if un[x] > 0 and frontier(cols, ptr, x) > 0]
        if recall and (not fresh or rng.random() < p_recall):      # reference player re-sends a boxed cat
            t = rng.choice(recall); t[1] -= run_pass(cols, ptr, t[0], t[1]); ref.append(t[2])
            if t[1] == 0: tray.remove(t)
            last = t[0]; continue
        if len(fresh) > 1 and last in fresh and rng.random() < 0.8: fresh.remove(last)   # colour variety
        x = rng.choice(fresh); can = frontier(cols, ptr, x)
        if len(tray) < ref_tray_max and un[x] > can and rng.random() < p_big:
            n = min(un[x], max_count, max(can + 1, int(can * rng.uniform(*big_mult))))   # BIG: will need a box
        else:
            n = min(can, un[x], max_count)                                                # CLEAN: empties in one pass
        un[x] -= n; cats.append((x, n)); k = len(cats) - 1; ref.append(k)
        left = n - run_pass(cols, ptr, x, n)
        if left: tray.append([x, left, k])
        max_tray = max(max_tray, len(tray)); last = x
    assert not tray and not any(un.values())
    L = [[] for _ in range(lanes)]; where = {}        # deal into lanes, biased to the shortest; order kept per lane
    for k, cat in enumerate(cats):
        w = [1.0 / (1 + len(l)) ** 2 for l in L]
        i = rng.choices(range(lanes), weights=w)[0]; where[k] = (i, len(L[i])); L[i].append(cat)
    return cols, L, max_tray, ref, where              # ref: cat indices in dispatch order (repeats = re-sends)

def replay(cols, L, ref, where, cap=5):
    """Proof of solvability: replays the reference line under the evaluator's rules. Must return True."""
    ptr, pos, tray = [0] * len(cols), [0] * len(L), {}
    for k in ref:
        if k in tray: x, n = tray.pop(k)
        else:
            i, j = where[k]; assert pos[i] == j, "reference cat is not at the front of its lane"
            x, n = L[i][j]; pos[i] += 1
        left = n - run_pass(cols, ptr, x, n)
        if left:
            if len(tray) >= cap: return False
            tray[k] = (x, left)
    return all(ptr[c] == len(cols[c]) for c in range(len(cols))) and not tray
```

Why solvability holds: cats are created in the order the reference player first sends them, and each lane preserves that order, so whenever the reference needs cat *k*, every cat ahead of it in its lane has already gone. Invariant that guarantees the loop never stalls: for every color, unplaced cells = boxed remainders + unassigned blocks, so any color on the frontier always has a supplier.

Evaluation uses a turn-based abstraction (one pass fully resolves before the next move; a lane cat that returns with blocks to a full tray is a loss). It is conservative: real-time juggling only gives the player more capacity.

```python
def moves(cols, ptr, pos, L, tray):
    return [('lane', i) for i, p in enumerate(pos) if p < len(L[i])] + \
           [('tray', j) for j, (x, n) in enumerate(tray) if frontier(cols, ptr, x) > 0]

def apply(cols, ptr, pos, L, tray, m, cap):
    if m[0] == 'lane': x, n = L[m[1]][pos[m[1]]]; pos[m[1]] += 1
    else:              x, n = tray.pop(m[1])
    left = n - run_pass(cols, ptr, x, n)
    if left:
        if len(tray) >= cap: return False            # came home, no free box -> loss
        tray.append((x, left))
    return True

def playout(cols, L, cap, rng, greedy):              # greedy=False: uniform random legal moves
    ptr, pos, tray = [0] * len(cols), [0] * len(L), []
    while not all(ptr[c] == len(cols[c]) for c in range(len(cols))):
        mv = moves(cols, ptr, pos, L, tray)
        if not mv: return False
        if greedy:                                   # one-step lookahead "attentive casual player"
            def score(m):
                x, n = L[m[1]][pos[m[1]]] if m[0] == 'lane' else tray[m[1]]
                can = min(n, frontier(cols, ptr, x)); fatal = m[0] == 'lane' and can < n and len(tray) >= cap
                return (not fatal, can == n, can + (0.5 if m[0] == 'tray' else 0))
            m = max(mv, key=score)
        else: m = rng.choice(mv)
        if not apply(cols, ptr, pos, L, tray, m, cap): return False
    return True
```

Presets (validated) and selection targets:

| Preset | lanes | ref_tray_max | p_big | big_mult | Target random-win | Greedy player |
|---|---|---|---|---|---|---|
| tutorial | 2 | 1 | 0.45 | 1.5–2.2 | ≈ 0.97 | wins |
| easy | 3 | 2 | 0.45 | 1.5–2.5 | ≈ 0.70 | wins |
| medium | 3 | 3 | 0.65 | 2.0–3.5 | ≈ 0.30 | wins |
| hard | 4 | 4 | 0.85 | 2.5–4.5 | ≤ 0.05 | **must lose** (forces lookahead) |

The greedy player is deterministic, so its result per level is a yes/no, not a rate. Use it as the "needs real planning" flag.

JS PRNG to use everywhere randomness is needed:
```js
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
```

---

## Appendix B — Backtest results (Python, before any game code existed)

**Rule choice.** With a cat allowed to dump a whole same-color run into a column per pass, uniform-random play won 83–100 % of 144 generated levels. The tray never mattered. With Rule A (one block per column per pass) the same sweep ranged from 0.97 down to 0.00 depending on preset and color count, and every one of 144 levels was confirmed solvable by exhaustive search.

**Baked levels (1,000–2,000 random playouts each, exhaustive solve, tray = 5):**

| Level | Blocks | Colors | Cats | Lanes | Reference max boxes | Random-win | Greedy wins | Solvable |
|---|---|---|---|---|---|---|---|---|
| Heart | 72 | 3 | 9 | 2 | 1 | 0.97 | yes | yes |
| Chick | 100 | 5 | 15 | 3 | 2 | 0.70 | yes | yes |
| Mushroom | 110 | 5 | 14 | 3 | 2 | 0.52 | yes | yes |
| Ice cream | 110 | 6 | 16 | 3 | 2 | 0.32 | yes | yes |
| Cat | 121 | 5 | 16 | 3 | 3 | 0.13 | yes | yes |
| Rainbow | 120 | 7 | 17 | 4 | 4 | 0.025 | **no** | yes |

Typical winning lines take 18–40 dispatches. With parades of up to five cats and a ~2.5 s pass, levels should land in the 45–90 s range (an estimate; H4 checks it).

**What generate-80-and-select can reach** (achieved random-win per art and preset; 80 candidates × 100 playouts; all candidates pass `replay()`):

| Art (colors) | tutorial → 0.97 | easy → 0.70 | medium → 0.30 | hard → ≤ 0.05 |
|---|---|---|---|---|
| Heart (3) | 0.97 | 0.70 | 0.60 | 0.60 |
| Chick (5) | 0.96 | 0.70 | 0.31 | 0.12 |
| Mushroom (5) | 0.97 | 0.70 | 0.30 | 0.04 |
| Ice cream (6) | 0.94 | 0.72 | 0.29 | 0.03, greedy loses |
| Cat (5) | 0.94 | 0.66 | 0.30 | 0.02, greedy loses |
| Rainbow (7) | 0.90 | 0.48 | 0.30 | 0.02, greedy loses |

Raw presets without selection are wide (the *hard* preset spans roughly 0.02–0.90 across arts), so the selection step is not optional. A 3-color picture cannot be made hard and a 7-color picture cannot be made trivial; choose art to match the slot in the curve.

**Levers, strongest first:** number of colors; number of lanes; share and size of big cats; `ref_tray_max` (slack). Board size mostly changes length, not difficulty.

**Known limits of the backtest:** it models a turn-based player. It says nothing about feel, and it understates how forgiving the real-time game is.

---

## Appendix C — Beyond the prototype (context only; do not build)

- **Port:** `SIM` and `GENERATOR` go to C# line-for-line; Unity 6.3 LTS.
- **Content pipeline:** any PNG up to ~16 × 16 with ≤ 8 colors → generator → rated by random-win and the greedy flag → slotted into a difficulty curve. Level content is nearly free, which is the solo-dev advantage here.
- **Mechanics drip (one per ~12 levels):** fat cat (needs two boxes); mystery cat (color hidden until it reaches the front); sleepy cat (skips every other pass); frosted cell (needs two blocks' worth of hits); kitten pairs that must travel together; side shelves that push blocks in horizontally; one rainbow cat per level.
- **Meta:** a gallery wall of finished mosaics; room decoration later.
- **Monetization pattern to mirror, per the genre leader's teardown [1]:** interstitial on fail, optional after wins, rewarded video limited to lives, no rewarded difficulty skips, "+1 box" as the core continue, a remove-ads purchase.
- **Distribution hedge:** the web build is itself shippable to HTML5 portals, which already carry conveyor-puzzle clones.
- **Naming:** "Shelf Control" is a codename. Run a store and trademark pass before shipping. "Knock It Off!" is the obvious pun and is already a Spin Master cat game; skip it.
