# GitHub Pages Deployment — Design

## Goal

Host the PR Review Dashboard at a public URL so protocol-team members (and anyone else) can view it without running the app locally. Target URL: `https://celestiaorg.github.io/pr-review-dashboard/`.

## Constraints

- Free hosting only.
- The GitHub API token must never be exposed to the browser.
- All 13 repos in `config.js` are public, so the PR metadata we display is already world-readable.
- Refresh cadence: approximately 5 minutes (matches current in-app auto-refresh).

## Architecture

Replace the current server-on-demand model with a scheduled server-side fetch that publishes a static artifact.

**Before:**

```
Browser → Express server (/api/reviews) → GitHub API
```

**After:**

```
GitHub Actions (cron */5 * * * *)
    ↓ runs scripts/fetch-data.js
    ↓ writes public/data.json
    ↓ uploads public/ as a Pages artifact
    ↓ deploys to GitHub Pages
Browser → https://celestiaorg.github.io/pr-review-dashboard/ → data.json (static)
```

No `gh-pages` branch, no commits to `main` per run — GitHub Pages' "deploy from artifact" flow avoids commit-history pollution.

## Components

### 1. `scripts/fetch-data.js` (new)

CLI entry point used by the Action and by local dev.

- Loads `config.js`, reads `process.env.GITHUB_TOKEN`.
- Calls `getPendingReviews(config, token)` from `github.js` (unchanged).
- Writes the same JSON shape today's `/api/reviews` returns (`{ reviews, teamMembers, thresholds, fetchedAt }`) to `public/data.json`.
- Exits non-zero on unhandled error so the Action fails visibly.

### 2. `.github/workflows/deploy.yml` (new)

- Triggers: `schedule: */5 * * * *`, `workflow_dispatch`, `push` to `main`.
- Permissions: `contents: read`, `pages: write`, `id-token: write`.
- Steps: checkout → setup Node 20 → `npm ci` → `node scripts/fetch-data.js` → `actions/upload-pages-artifact@v3` with path `public/` → `actions/deploy-pages@v4`.
- Uses the default `${{ secrets.GITHUB_TOKEN }}`. Its 1000 req/hr rate limit comfortably covers 13 repos × ~20–30 timeline calls per run. If this proves insufficient in practice, swap to a PAT stored as a repo secret.
- Concurrency group `pages` with `cancel-in-progress: false` so overlapping cron runs don't step on each other.

### 3. `public/app.js` (edit)

Single change: `fetch('/api/reviews')` → `fetch('data.json')`. Everything downstream (rendering, toggles, staleness indicator) already consumes the same JSON shape.

### 4. `package.json` (edit)

- Remove `express` and `dotenv` dependencies.
- Scripts:
  - `"fetch": "node scripts/fetch-data.js"`
  - `"dev": "npx serve public"`
  - `"test": "jest"`
- Remove the `"start"` script.

### 5. `server.js` (removed)

No longer needed. Local dev uses `npm run fetch && npm run dev`.

### 6. `.gitignore` (edit)

Add `public/data.json` — it is generated output.

### 7. `README.md` (edit)

- "Running locally" section updated to `npm run fetch && npm run dev`.
- New "Deployment" section describing the Actions workflow and the public URL.

### 8. Tests

- Existing `github.test.js` untouched.
- Add `scripts/fetch-data.test.js`: mocks `getPendingReviews`, invokes the script's main function, and verifies `public/data.json` is written with the expected shape. Follow red/green TDD (failing test first).

## Data flow

1. Cron fires every 5 min (practically 5–15 min on free runners).
2. Action checks out repo, installs deps, runs `scripts/fetch-data.js`.
3. `fetch-data.js` calls GitHub REST API (via existing `github.js`) using the default Actions token.
4. `public/data.json` is written.
5. `public/` (HTML, CSS, JS, data.json) is uploaded as a Pages artifact.
6. Pages deploy job publishes it at `https://celestiaorg.github.io/pr-review-dashboard/`.
7. Browser loads the static page, fetches `data.json`, renders the dashboard.

## Error handling

- `github.js` already tolerates per-repo and per-timeline failures (logs a warning, returns an empty list for the failing unit). Kept as-is.
- `fetch-data.js` exits non-zero only on unrecoverable errors — the Action then fails and shows up in the repo's Actions tab. The previously published `data.json` remains live on Pages until the next successful run.
- Frontend already handles a failed fetch by showing an error state; the same code path now applies to `data.json` fetch failures.

## Rollout

1. Implement on a feature branch with TDD.
2. Open a **draft PR without auto-merge** (architecture change warrants human review — overrides the global default).
3. After the user merges to `main`:
   - Enable GitHub Pages via `gh api repos/celestiaorg/pr-review-dashboard/pages -X POST -f build_type=workflow` (or via the UI if the API call is denied).
   - Trigger the first run: `gh workflow run deploy.yml`.
   - Confirm deployment succeeded and the URL returns a live page.
4. Report final URL to the user so they can add it to the repo's About section.

## Out of scope

- Authentication / access control (decision: truly public site).
- Alternative hosts (Vercel/Render/Cloudflare) — GitHub Pages + Actions was chosen.
- Historical data / trends — dashboard remains a live snapshot.
- Client-side caching beyond what GH Pages' CDN already provides.
