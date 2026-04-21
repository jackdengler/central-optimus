# central-optimus

Public GitHub Pages host for a personal PWA launcher. The launcher
aggregates several PWAs whose **source lives in private repos** into a
single installable site.

## Architecture

```
central-optimus (public)          private app repos
├── launcher/                     ├── app-one/
│   ├── index.html                │   └── CI builds + pushes
│   ├── app.js                    │       dist/ → central-optimus:apps/app-one/
│   ├── styles.css                ├── app-two/
│   ├── config.json               │   └── ...
│   ├── apps.json                 └── ...
│   ├── manifest.webmanifest
│   ├── sw.js
│   └── icons/icon.svg   ← source of truth; PNGs generated in CI
├── apps/                ← each private app's built dist lands here
│   └── <app-name>/
├── .github/workflows/deploy.yml
└── README.md
```

Built site layout served by Pages:

| Path | Served content |
|------|---------------|
| `/` | Launcher dashboard |
| `/apps/<app-name>/` | That PWA |

## Authentication (how the launcher gate works)

The launcher asks for a **GitHub personal access token** on first visit.
It calls `GET https://api.github.com/user` with the token and unlocks
only if the returned `login` matches `githubUser` in `config.json`. The
token is stored in `localStorage` and re-verified on every load. The
"Lock" button clears it.

### To enable the gate

1. Set your GitHub username in `launcher/config.json`:
   ```json
   { "title": "Central Optimus", "githubUser": "your-github-login" }
   ```
2. Generate a fine-grained PAT at
   <https://github.com/settings/personal-access-tokens/new>:
   - **Repository access:** Public repositories (read-only). No repo
     access is needed for identity verification.
   - **Permissions:** leave everything at *No access*. `GET /user`
     works with zero scopes on a valid token.
3. Open the launcher, paste the PAT once. Done.

### Security honesty

This is **real authentication** (the server verifies identity) but not
confidentiality. The Pages site is public — `index.html`, `app.js`, and
`apps.json` can be downloaded by anyone with the URL. What the gate
actually protects is the rendered UI and convenience of app links.

If something inside a specific app is sensitive, that app needs its own
server-side auth. If you later want edge-level protection (no bytes
served to unauthenticated visitors), put **Cloudflare Access** in front
of the domain — free for up to 50 users.

## Local preview

```
python3 -m http.server 8000 --directory launcher
```

Then open http://localhost:8000. Note: icons referenced as PNGs are
generated in CI; locally you'll see a missing-image for
`apple-touch-icon.png` / `icon-512.png` until you either rasterize
locally or ignore them — functionally the launcher still runs.

Optional local rasterize:

```
brew install librsvg
rsvg-convert -w 180 -h 180 launcher/icons/icon.svg -o launcher/icons/apple-touch-icon.png
rsvg-convert -w 512 -h 512 launcher/icons/icon.svg -o launcher/icons/icon-512.png
```

## Adding a new app

Each PWA lives in its **own private repo**. On push to its default
branch, the app's CI pushes its built `dist/` into this repo at
`apps/<app-name>/`. The launcher's deploy workflow then assembles and
ships the combined site.

Concrete per-app workflow (set up in each app repo, not here) — spec:

1. Build the app (`npm ci && npm run build` or equivalent) into `dist/`.
2. Check out `central-optimus` using a **fine-grained PAT** stored as
   a secret (e.g. `CENTRAL_OPTIMUS_TOKEN`) with:
   - Repository access: only `central-optimus`.
   - Permissions: Contents = Read and write.
3. `rm -rf central-optimus/apps/<app-name>` and copy the new `dist/`
   into `central-optimus/apps/<app-name>/`.
4. Commit with `[skip ci]` in the message if you want to avoid
   re-triggering the app's own CI, then push.
5. Optionally trigger a faster launcher rebuild:
   ```
   curl -X POST \
     -H "Authorization: Bearer $CENTRAL_OPTIMUS_TOKEN" \
     -H "Accept: application/vnd.github+json" \
     https://api.github.com/repos/<owner>/central-optimus/dispatches \
     -d '{"event_type":"app-updated"}'
   ```

Then register the app in `launcher/apps.json`:

```json
{
  "apps": [
    {
      "id": "app-one",
      "name": "App One",
      "description": "Does the thing.",
      "path": "apps/app-one/",
      "color": "#4f46e5"
    }
  ]
}
```

Field notes: `path` is relative so it works under both
`<user>.github.io/central-optimus/` and a custom domain. `color` is
optional and tints the tile icon background.

### Important for each nested app

- Register its service worker with an **explicit scope** limited to
  its own subpath, e.g. `navigator.serviceWorker.register('./sw.js', { scope: './' })`.
- Use **relative URLs** for all assets so the app works under any base
  path.
- Its `manifest.webmanifest` should have `"start_url": "./"` and
  `"scope": "./"`.

## Custom domain (future)

Currently served at `https://<your-user>.github.io/central-optimus/`.
To switch later:

1. Drop a single-line `CNAME` file at the repo root containing your
   domain (e.g. `optimus.example.com`).
2. In your DNS, create a `CNAME` record pointing that subdomain at
   `<your-user>.github.io`. Or for an apex domain, four `A` records to
   GitHub's Pages IPs (see GitHub docs).
3. In repo → Settings → Pages, set the custom domain and enforce HTTPS.

If you later enable Cloudflare Access, point DNS at Cloudflare first
(proxied, orange-cloud), then configure Access with your email as the
only allowed identity.

## Deploy workflow

`.github/workflows/deploy.yml` triggers on:
- `push` to the default branch
- `workflow_dispatch` (manual)
- `repository_dispatch` with `event_type: app-updated` (fired by app
  repos after they push a new `dist/`).

The workflow rasterizes the SVG icon into PNGs, assembles
`launcher/` + `apps/*` into `_site/`, and deploys to GitHub Pages.
