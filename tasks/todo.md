# Central Optimus — Big Type launcher (clean-slate redesign)

Status: **Built on the feature branch 2026-09-28. Awaiting approval to merge to `main`.**

## Decisions

| Question | Decision |
|---|---|
| Direction | Clean slate. Drop the watch-movement canvas and flip-card |
| Aesthetic | **N · Big Type, original** (picked from 14 concepts and 5 variations). Ref: `scratchpad/optimus-concepts/project/N-BigType.dc.html` |
| Form factor | **Portrait iPhone first.** Desktop gets a centred phone-width column |
| Shipping | Branch `claude/optimus-app-interface-ot0g6w` → preview URL → merge to `main` after approval |
| Scope | Everything, no mid-build checkpoint |

### Content
- **Bands (3):** Fitness, Movies, Budget. Order = most urgent today:
  1. a movie release ≤2 days away, or
  2. days since the last lift greater than the median gap between lifts,
  3. otherwise Fitness first.

  The top band carries a reason tag (e.g. "ON TOP: 3D SINCE LAST LIFT · USUAL GAP 2D").
- **Fitness:** big number = lifts in the last 30 days (LA local days). Secondary: days since last lift, last workout name/duration.
- **Movies:** big number = T–days to the next booked or must-see release. Secondary: titles (booked first), date.
- **Budget (veiled):** Jack's last complete month of spend, plus the average per month. This mirrors budget-together's `compute('p1')` (`docs/mobile.html`) exactly:
  - What counts: positive amounts only, non-excluded transactions, not gambling, cash, insurance, transfer, investing or ignored custom categories.
  - Solo p1 spend counts in full. Shared spend counts at p1's share: a settled transaction uses its `settledSplit`; an unsettled one uses the live `catSplits` rule per month and category (groceries 75%, housing fixed $3,075/mo, default 50%).
  - The average uses complete months not in `excludedFromAvg` (currently Sep and Oct 2025).
  - Verified against the app's own code on real data: 0 mismatches over 12 months.
- **Bottom strip:** Parlay (53%), Recipes (7), Tapology, Clean Script, Savings, Family Tree, Polished Space. Two rows, ≥11px text.

### Behavior
- **Band-to-app launch:** the tapped band expands to full screen and becomes the app's header while the iframe loads. Close collapses it back. Replaces the flip-card.
- **Live ticker tape:** the marquee rotates real headlines from the data.
- **Scratch-off budget reveal:** press and hold wipes the redaction (with a haptic tick). It re-veils after 5s.
- **Search filters the bands:** typing collapses non-matching bands and strip items. Enter launches the top match; ⌘K focuses search.
- **Stale-data striping:** a band whose data couldn't refresh gets diagonal stripes and an "AS OF h:mm" tag.

### Fixes over the original N mockup
- Strip and footer text ≥11px.
- A deliberate redaction treatment (hatched plus a HOLD stamp) instead of a flat black box.
- App names auto-fit to the band width.

## Carries over from the old launcher
The PAT gate (optimistic reveal plus background re-verify), the postMessage PAT handshake for `auth: "pat"` apps, iframe hosting with the load watchdog, retry/close, `#app/<id>` deep links, back/forward, the CSP, the service worker (bump the cache), and the manifest.

## Build plan
- [x] P0 Foundations: remove `mechanism.js`, the flip-card and Konsta. Split `app.js` into modules (auth, embed, data, ui). Self-host Anton and DM Mono woff2 (the CSP's font-src is 'self'). Add `dataRepo` to config
- [x] P1 Data layer: `data.js` summarizers for fitness, movies, parlay, recipes and budget (tested against real files); IndexedDB cache plus ETag; stale flags
- [x] P2 Home UI: header/time/weather, ticker tape, 3 bands with auto-fit names, urgency ordering, strip, search
- [x] P3 Interactions: band-to-app launch/close, scratch-off reveal, search filtering, reduced-motion paths
- [x] P4 Proof: update the Playwright specs and snapshots, lint, format, a11y, iPhone-size renders; push to the preview branch

## Round 2 (2026-09-28): icon, offline-first, sound/haptics, scores
- [x] Big Type icon: a condensed "O" cut from the three band colours, with the tape and a real shadow. Maskable icon and splash are black
- [x] Offline-first: stale weather fallback, OFFLINE · AS OF status, re-sync on reconnect, honest offline message for apps
- [x] feel.js: synthesized tick, open, close and tear cues, iOS ambient audio session, Android vibration, sound toggle in search
- [x] Scores band and panel plus ticker: Steelers, Penn State, UFC via ESPN. Live game takes the top band; game day ranks above the lift gap
- [x] Compact bands: short bands drop secondary lines instead of clipping them (4 bands on an iPhone 14)
- Not verified here: ESPN's live responses (this container's network policy blocks ESPN). The parser is built on ESPN's documented shape and tested with fixtures

## Round 3 (2026-09-28): fit, no reason tags, every team + UFC main event
User feedback came from an iPhone screenshot. The band text spilled past the strip and got cut off by the diagonal. They didn't want the "ON TOP" reasoning. They wanted upcoming games for every team and the next UFC main event.
- [x] Root cause: a stray edit had merged the compact rule into the eye-icon rule. Compact mode gave the secondary lines a 12px width instead of hiding them. Also, the fit check assumed both sides of a band had equal height, but the diagonal cuts a right-side reading at the bottom and a left-side one at the top.
- [x] `fitBandNames` computes per-side limits from the clip polygon. Reading lines ellipsize at the reading width. The compact rule is restored.
- [x] Reason tags removed. Bands still reorder by urgency.
- [x] The Scores band has one row per team (PIT / PSU / UFC). UFC skips Contender Series weeks and takes the main event from the card title, e.g. "UFC 320: Ankalaev vs. Pereira 2". If the title doesn't name a fight, it falls back to the last listed bout. The main event also shows in the ticker.
- [x] The Scores name stacks under the rows when the band is tall enough. Otherwise it sits beside them in a reserved column.
- [x] Small fixes: "Township of" is stripped from the place name; a build without a build.json shows "PREVIEW".
- [x] `tests/fit.spec.js` checks the geometry: every reading part must sit inside its band's diagonal on the iPhone 14 and iPhone SE, using long names. It fails on the previous commit and passes now. Result: 43/43 on Chromium.
- Not verified here: ESPN's calendar shape for the Contender Series fallback (ESPN is blocked from this container).

## Round 4 (2026-09-28): light mode across Optimus, fitness and movies
- [x] Shared contract: one `co.theme` localStorage key on jackdengler.github.io, applied before first paint, with the `storage` event syncing an embedded app live (verified both ways between frames)
- [x] Launcher: sun/moon button next to the lock and a "light" search action. Bands, tape, app bars and on-band chips keep print black (`--k`/`--paper`); `--accent-ink` (#7a6300 in light) carries yellow's text uses. All light text is 4.5:1 or better
- [x] iOS: the translucent status bar has white text, so light mode paints a black strip behind it
- [x] Bug the new test caught: an inline pre-paint `html, body { background: #0b0b0b }` beat the themed rule, so a runtime toggle left the page dark. It now uses `var(--ground, #0b0b0b)`
- [x] Fitness: "Light mode / Dark mode" row on home; movies: header icon. Both repos have light token overrides

## Round 5 (2026-09-28): Big Type redesign of fitness + movies (behaviour unchanged)
- [x] Fitness: rose hero band (today + checklist progress); Anton A/B/C with today filled rose; number-led Food/Body tiles; square ticks; arrow menu rows. Set screen has a full-width Anton exercise name, a per-exercise progress strip and 52–80px weight/reps. Rest screen has a giant countdown and a drain bar. "DONE." in rose. Square, uppercase-mono everywhere; Anton list titles
- [x] Movies: square and flat (radius tokens 0, no soft shadows); wine month bands with the launcher's diagonal; Anton dates and titles; the trailer button shows the trailer's YouTube still; square interest strip; the rest of the app follows. Skin values are tokens in :root
- [x] Proof of unchanged behaviour: the same scripted session on old and new builds leaves identical saved data (fitness) and identical counts and marks (movies)
- [x] An independent QA subagent reviewed every screen and diff and found 31 issues. Fixed the real ones. Worst was a new `.done` class colliding with the old done-screen rule, which ballooned the progress strip from exercise 2 on
- [x] Movies CI: snapshots depended on a live GitHub API call. The fixture now stubs external calls as offline

## Round 6 (2026-09-28): motion and feel
- [x] Entrance: on unlock the bands deal in from alternating sides along their diagonal, the tape unrolls, and the strip and search rise
- [x] Count-up: band figures roll to their value once each band lands. Budget figures roll as they're scratched off. Rolls resume across re-renders (renderBands rebuilds the reading on every update, which first swallowed the animation)
- [x] App open: the band's colour, carrying the app name in Anton, fills the screen as the clip grows, then lifts off; close reverses it
- [x] Press physics: bands and strip tiles give under a press and spring back with overshoot
- [x] Clock digits drop in on the minute; a live game doubles the tape speed with a pulsing red lead
- [x] Reduced motion switches all of it off. The geometry and visual tests wait for the motion to settle (`#app.is-entering`, `[data-counting]`)

## Round 7 (2026-09-28): readings, strip, tape, launch/collapse
- [x] Strip: names only (no numbers for Parlay or Recipes). Tiles are a wrapping row of Anton names, each with a slanted swatch in the app's colour
- [x] Clock sits 10px lower (6px on short screens). Anton's digits rise above their line box and were touching the status bar
- [x] Movies band: one row per film, like Scores. Up to 2 BOOKED (yellow tag, by booked date), then MUST, then LIKELY with their release dates. Watched and past films are dropped
- [x] Budget band: last complete month's IN, OUT and SAVED %, veiled. Income and rate come from budget-together's own rules (p1 income rows; rate = (in − out) / in). Matches its ring card on all 12 ledger months
- [x] Hold the tape to fast-forward it (6×); it eases back on release
- [x] Launch: the app grows out of the band in the band's own diagonal shape under the band's colour, while the band's name flies up into the app bar title. Close plays the same moves in reverse, ending on the band. Uses Web Animations; a fast re-tap cancels cleanly
- [x] Tests cover the movie rows, the budget figures, the tape speed-up, and launch/collapse leaving nothing behind. The SE geometry test caught the budget and movie readings overflowing short bands, so both were fixed
- [x] Savings, Recipes and Parlay get the Optimus look: Anton + DM Mono self-hosted, the shared `co.theme` light/dark script and toggle, square edges, and yellow as a fill only. Brand colour appears as bands and markers. For each app, the same scripted session on the old and new builds gave identical storage, text and network calls (Parlay: 0 differences over 170 checkpoints, font requests aside). Pushed: savings `d167962`, recipes `2954866`, parlay `2e6eca0`

## Round 8 (2026-09-29): phone feedback
- [x] Budget IN showed "—" on the phone: a same-day 304 kept the summary cached by the previous build (no income field). SUMMARY_VERSION is now 2. A browser test seeds an old cache and answers 304; it fails at version 1 and passes at 2. data.spec pins every summary's shape to the version
- [x] Home-screen icon showed a letter "O". That is iOS's fallback when it can't use the icon, and the manifest listed an SVG first, which iOS can't use for home-screen icons. The manifest now lists only PNGs (180, 192, 512, maskable), the same pattern as upcoming-movies. The existing home-screen icon has to be removed and added again
- [x] Scores panel shows each team's record after its name, e.g. STEELERS (2-1). It comes from ESPN's team.recordSummary, or is counted from the schedule's results

## Round 9 (2026-09-29): team colours
- [x] Steelers, Penn State and Amherst palettes on a second key, `co.team` ("" | steelers | psu | amherst), on `<html data-team>`. It sits on top of light/dark, so each team has a dark and a light set; `co.theme` and the apps that read it are untouched
- [x] Steelers: #101820 ground and #FFB612 gold tape (light: warm gold paper). Penn State: Nittany Navy ground with a white tape (light: navy tape, Beaver Blue accents). Amherst: #3F1F69 purple family with a lavender tape (light: purple tape)
- [x] New `--on-accent` token for text and rules printed on the accent, since a navy or purple tape can't carry black text. The tape, RETRY/UNLOCK, BOOKED tags and HOLD hint use it
- [x] Header swatch button cycles Classic → Steelers → Penn State → Amherst; search actions "steelers theme", "penn state theme", "amherst theme", "classic theme" ("steelers" alone still opens Scores)
- [x] Tests: cycling persists across reload, team and mode are independent, and every team × mode keeps ink, muted ink, accent text and tape text at 4.5:1 or better. 54/54 on Chromium; existing snapshots unchanged. Header fits on the iPhone SE with the extra button
- [x] Fitness and Movies follow `co.team` live (same head script and palettes; the storage event carries a change from the launcher into an open app). Fitness gets a "Colours · …" row. Fitness's hard-coded black on accent fills now uses `--sel-ink`. Every team × mode is at least 4.5:1 for ink, muted text, accent text and text on the accent in both apps
- Not done: Savings, Recipes and Parlay still read only `co.theme`
- Pre-existing, not from this change: movies' 3 embedded-mode spacing tests fail locally on main before and after

## Review
- **What was built:** the Big Type launcher (commit `f8b9e1a`), plus the data layer (`f8e3b86`).
- **Verification:**
  - Rendered at iPhone 14 size against the real data files: 10 lifts / 30d, T–4, Fitness on top because the gap was 5d against a usual 2d.
  - Fixed what the render showed: header overlap, reason-tag collision, the HOLD button covering a figure, the search placeholder, and the tape clipping the sunset line.
  - The budget summarizer matches budget-together's own `compute('p1')` on all 12 ledger months.
  - Playwright: 29/29 pass on Chromium (smoke, home, launch, auth, data, visual). WebKit isn't installed in this container, so CI runs the mobile-safari project.
- **Follow-ups (not done):**
  - The app icon (`icons/icon.svg`) is still the old cream design.
  - The splash colors in `deploy.yml` are still cream.
  - `mobile-safari` specs are unverified locally.
