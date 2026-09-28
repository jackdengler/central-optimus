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
