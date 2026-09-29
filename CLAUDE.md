# central-optimus — Claude working notes

## Workflow preferences

- **Push directly to `main`.** The user wants edits to reach the
  deployed PWA immediately. Skip feature branches; commit and push
  straight to `main`. The deploy workflow triggers on push to main,
  so each commit ships.
- No pull requests unless the user explicitly asks for one.

## Repo shape (for quick orientation)

- `launcher/` — installable PWA ("Big Type" home, PAT gate, manifest,
  SW). Edit `launcher/src/input.css` (Tailwind v4), not
  `launcher/styles.css` (generated, git-ignored). `app.js` = UI,
  `data.js` = live readings from `dataRepo`, `apps.json` = registry
  (`home: band|strip`). Design notes: `tasks/todo.md`.
- `apps/<name>/` — each private app's built `dist/` lands here via
  that app's own CI (set up per-app in the app's repo).
- `.github/workflows/deploy.yml` — installs Node + npm deps, runs
  `npm run build` (Tailwind), rasterizes `icons/icon.svg` into PNGs
  with `rsvg-convert`, assembles `launcher/` + `apps/*` into `_site/`,
  deploys to GitHub Pages.
- `launcher/theme.js` — light/dark mode. One localStorage key,
  `co.theme` ("dark" | "light", default dark), shared with the apps on
  this origin (fitness-tracker and upcoming-movies carry an identical
  head script); the `storage` event keeps an embedded app in step.
  Light values live in `:root[data-theme="light"]` in `input.css`;
  `--k`/`--paper` stay fixed for things on bands, tape and app bars.
  A second key, `co.team` ("" | steelers | psu | amherst), layers a team
  palette over either mode via `<html data-team>`; fitness-tracker and
  upcoming-movies carry the same palettes and head script. Text on the
  accent uses `--on-accent`.
- `launcher/config.json` — `githubUser` is the only allowed login for
  the PAT gate. Currently `jackdengler`.

## Auth

Launcher gates itself by calling `GET https://api.github.com/user`
with a PAT the visitor pastes, and unlocking only if `login` matches
`config.githubUser`. Token lives in `localStorage` under
`co.gh.token`. This is real authentication (verifies account
ownership) but NOT confidentiality — the static bundle is public and
anyone can `curl` `apps.json`. Per-app sensitive content must be
protected by that app's own backend auth. Upgrade path for edge-level
protection: Cloudflare Access in front of the domain.

## Running locally

```
npm install
npm run build            # or: npm run dev (watch)
python3 -m http.server 8000 --directory launcher
```
