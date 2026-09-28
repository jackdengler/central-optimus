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
