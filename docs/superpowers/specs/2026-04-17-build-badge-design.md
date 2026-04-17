# Build Badge Design

## Goal

Display a small `build: <short-sha>` link in the site footer, pointing to the GitHub commit that produced the current deploy. Primarily serves as a verifiable signal for PR preview deployments (step 4 of the PR-preview rollout checklist), and secondarily lets any visitor tell at a glance which commit is live.

## Approach

Workflow injects build metadata into `public/build-info.json` at deploy time; the frontend fetches it and renders a short-SHA link in the footer. Mirrors the existing `data.json` / `review-counts.json` pattern — static file, fetched at runtime, no build-time HTML mutation.

## Changes

### 1. `scripts/write-build-info.js`

New CLI script that reads env vars and writes `public/build-info.json`.

- Reads `GITHUB_SHA` (required) and `GITHUB_REPOSITORY` (required, e.g. `celestiaorg/pr-review-dashboard`)
- Writes `{ sha, repo, builtAt }` where `builtAt` is `new Date().toISOString()`
- Exits non-zero with a clear message if either env var is missing
- Exports a pure `buildInfoPayload({ sha, repo, now })` for unit testing; the CLI entry wires env vars + filesystem

### 2. `scripts/write-build-info.test.js`

Unit tests for `buildInfoPayload`:

- Returns the expected shape `{ sha, repo, builtAt }` given inputs
- Uses the injected `now` for `builtAt` (deterministic)

Following existing `scripts/*.test.js` style (Jest, per `package.json`).

### 3. `public/index.html`

Add a `<span id="build-info" class="build-info"></span>` inside the existing `<footer>`, after the `.legend` span. No content at render time — `app.js` populates it.

### 4. `public/app.js`

New `fetchAndRenderBuildInfo()`:

- `fetch("build-info.json")`
- On success: render `<a href="https://github.com/{repo}/commit/{sha}">build: {sha.slice(0,7)}</a>` into `#build-info` with `target="_blank" rel="noopener noreferrer"`
- On 404 or parse failure: leave the span empty (silent hide). No error banner — this is non-critical metadata
- Call once on initial load; not included in the 5-minute auto-refresh (build info only changes when the site redeploys)

### 5. `public/style.css`

Style `.build-info` as small, muted text. No new layout — it sits next to the existing legend in the footer.

### 6. `.gitignore`

Add `public/build-info.json` (generated artifact, like `public/data.json`).

### 7. `.github/workflows/deploy.yml`

Add a "Write build info" step after `npm ci`, before the deploy step:

```yaml
- name: Write build info
  env:
    GITHUB_SHA: ${{ github.sha }}
    GITHUB_REPOSITORY: ${{ github.repository }}
  run: node scripts/write-build-info.js
```

(`GITHUB_SHA` and `GITHUB_REPOSITORY` are provided automatically by Actions, but we pass them explicitly for clarity and to match what the script reads.)

### 8. `.github/workflows/pr-preview.yml`

Same "Write build info" step, but using the PR head commit SHA so the badge on the preview points at the PR's actual commit. Guarded with `if: github.event.action != 'closed'` to match the other build steps:

```yaml
- if: github.event.action != 'closed'
  name: Write build info
  env:
    GITHUB_SHA: ${{ github.event.pull_request.head.sha }}
    GITHUB_REPOSITORY: ${{ github.repository }}
  run: node scripts/write-build-info.js
```

On the `closed` event the build step is skipped entirely (cleanup only), so no build info is written.

## Error handling

- Missing env vars in the script → non-zero exit with a clear message. Fails the workflow loudly; we don't want silent deploys missing metadata.
- Missing or malformed `build-info.json` at runtime → silently hide the badge. Non-critical; the site still works.
- Fork-based PRs (already excluded from preview by design, per `2026-04-16-pr-preview-design.md`) — no change to that constraint.

## Testing

- **TDD**: `scripts/write-build-info.test.js` covers the payload helper.
- **No frontend tests** — consistent with the rest of the project; `app.js` has no unit tests today.
- **Manual verification (this IS step 4 of the PR-preview checklist):**
  1. Open the PR → sticky preview comment appears with a URL
  2. Load preview URL → footer shows `build: <short-sha>` linked to the PR's head commit
  3. Load production URL → footer shows main's SHA (a different commit)
  4. Merge PR → preview URL is cleaned up (step 5)

## Out of scope

- "Built X minutes ago" timestamp display (the JSON carries `builtAt` but we don't render it yet)
- Visual preview-vs-prod indicator beyond the SHA itself
- Frontend test infrastructure (jsdom, etc.)
- Linking to the PR (not the commit) for preview deploys
