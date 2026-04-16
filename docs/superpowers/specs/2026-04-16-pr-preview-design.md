# PR Preview Design

## Goal

Every PR gets an auto-posted comment linking to a live preview of the site as modified by that PR. Previews are cleaned up when the PR closes or merges.

## Approach

Use `rossjrw/pr-preview-action` on the existing GitHub Pages infrastructure. This requires migrating the main deploy from artifact-based (`actions/deploy-pages`) to branch-based (`gh-pages` branch) deployment.

## Changes

### 1. Migrate `deploy.yml` to branch-based deployment

Replace the artifact-based deploy steps (`actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages`) with `JamesIves/github-pages-deploy-action@v4`, which pushes built files to the `gh-pages` branch.

- **Permissions**: change from `pages: write` + `id-token: write` to `contents: write`
- **clean-exclude**: set to `pr-preview` so main deploys don't wipe PR preview directories
- **Remove**: the `environment` block (not needed for branch-based deploys)
- **Keep**: checkout, node setup, npm ci, data fetch steps unchanged

### 2. New `pr-preview.yml` workflow

Triggers on `pull_request` events: `opened`, `synchronize`, `reopened`, `closed`.

- **Build step** (skipped on `closed`): checkout, `actions/setup-node`, `npm ci`, `node scripts/fetch-data.js` with `GITHUB_TOKEN`
- **Deploy step**: `rossjrw/pr-preview-action@v1` with `source-dir: public/`
- The action auto-detects the event type: deploys on open/update, cleans up on close
- Posts/updates a sticky PR comment with the preview URL (e.g. `https://celestiaorg.github.io/pr-review-dashboard/pr-preview/pr-42/`)
- **Permissions**: `contents: write` (push to `gh-pages`) + `pull-requests: write` (post comment)
- **Concurrency**: per-PR group (`preview-${{ github.event.pull_request.number }}`) with `cancel-in-progress: true`

### 3. One-time manual step: switch Pages source

After the first deploy creates the `gh-pages` branch, update the repo's GitHub Pages settings from "workflow" source to "branch" source (`gh-pages`, root `/`):

```
gh api repos/celestiaorg/pr-review-dashboard/pages -X PATCH \
  -f source[branch]=gh-pages -f source[path]=/ -f build_type=legacy
```

Brief downtime (seconds to minutes) between merging the workflow changes and the first successful push to `gh-pages`. The cron runs every 5 minutes so this resolves quickly.

### 4. README update

Add a section documenting that PRs get an auto-comment with a preview link and that previews are cleaned up on close/merge.

## Constraints

- Fork-based PRs won't get previews (no write access to `gh-pages`, no access to secrets). This is acceptable — all PRs are expected to come from branches within the org.
- The main deploy and PR preview workflows use separate concurrency groups. Simultaneous pushes to `gh-pages` are rare (main deploy takes ~30s, runs every 5 min) and retriable if they collide.

## Out of scope

- Preview support for fork PRs
- Changes to `fetch-review-counts.yml` (unrelated workflow, commits to `main`)
