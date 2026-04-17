# PR Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every PR gets a sticky comment with a link to a live preview of the site as modified by that PR.

**Architecture:** Migrate the main deploy from artifact-based to branch-based (`gh-pages`) using `JamesIves/github-pages-deploy-action@v4`, then add a new workflow using `rossjrw/pr-preview-action@v1` that deploys PR builds to `pr-preview/pr-N/` subdirectories on the same branch.

**Tech Stack:** GitHub Actions, `JamesIves/github-pages-deploy-action@v4`, `rossjrw/pr-preview-action@v1`

---

## File Structure

- **Modify:** `.github/workflows/deploy.yml` — switch from artifact-based to branch-based Pages deployment
- **Create:** `.github/workflows/pr-preview.yml` — new workflow for PR preview deploy/cleanup
- **Modify:** `README.md` — document PR preview behavior

---

### Task 1: Migrate deploy.yml to branch-based deployment

**Files:**
- Modify: `.github/workflows/deploy.yml:1-48` (full file rewrite)

- [ ] **Step 1: Replace artifact-based deploy with branch-based deploy**

Replace the full contents of `.github/workflows/deploy.yml` with:

```yaml
name: Deploy PR Review Dashboard

on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:
  push:
    branches: [main]

permissions:
  contents: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: "20"
          cache: "npm"

      - run: npm ci

      - name: Fetch PR review data
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/fetch-data.js

      - uses: JamesIves/github-pages-deploy-action@v4
        with:
          branch: gh-pages
          folder: public
          clean-exclude: pr-preview
```

Changes from original:
- `permissions`: `contents: write` replaces `contents: read` + `pages: write` + `id-token: write`
- Removed: `environment` block (lines 22-24)
- Removed: `actions/configure-pages` step (line 40)
- Removed: `actions/upload-pages-artifact` step (lines 42-44)
- Removed: `actions/deploy-pages` step (lines 46-48)
- Added: `JamesIves/github-pages-deploy-action@v4` with `branch: gh-pages`, `folder: public`, `clean-exclude: pr-preview`

- [ ] **Step 2: Validate YAML syntax**

Run: `npx yaml-lint .github/workflows/deploy.yml || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))"`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: migrate deploy to branch-based GitHub Pages"
```

---

### Task 2: Add PR preview workflow

**Files:**
- Create: `.github/workflows/pr-preview.yml`

- [ ] **Step 1: Create the pr-preview workflow**

Create `.github/workflows/pr-preview.yml` with:

```yaml
name: PR Preview

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: preview-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - if: github.event.action != 'closed'
        uses: actions/setup-node@v6
        with:
          node-version: "20"
          cache: "npm"

      - if: github.event.action != 'closed'
        run: npm ci

      - if: github.event.action != 'closed'
        name: Fetch PR review data
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/fetch-data.js

      - uses: rossjrw/pr-preview-action@v1
        with:
          source-dir: public/
```

Notes:
- Build steps are skipped on `closed` events (only cleanup needed)
- The action auto-detects deploy vs. cleanup based on the PR event type
- `cancel-in-progress: true` so a new push supersedes an in-flight preview build
- Preview URL will be `https://celestiaorg.github.io/pr-review-dashboard/pr-preview/pr-<N>/`

- [ ] **Step 2: Validate YAML syntax**

Run: `npx yaml-lint .github/workflows/pr-preview.yml || python3 -c "import yaml; yaml.safe_load(open('.github/workflows/pr-preview.yml'))"`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pr-preview.yml
git commit -m "ci: add PR preview workflow"
```

---

### Task 3: Update README

**Files:**
- Modify: `README.md:59-69` (Deployment section)

- [ ] **Step 1: Add PR previews subsection after the existing Deployment section**

Insert after line 69 (the `fetch-review-counts.yml` paragraph), before `## Testing`:

```markdown

### PR previews

Every pull request automatically gets a live preview. The [`pr-preview.yml`](./.github/workflows/pr-preview.yml) workflow builds the site from the PR branch and deploys it to a subdirectory on the `gh-pages` branch. A bot comment on the PR links to the preview (e.g. `https://celestiaorg.github.io/pr-review-dashboard/pr-preview/pr-42/`). The preview is cleaned up when the PR is closed or merged.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add PR previews section to README"
```

---

### Post-merge: One-time manual step

After the first deploy pushes to `gh-pages`, switch the repo's GitHub Pages source:

```bash
gh api repos/celestiaorg/pr-review-dashboard/pages -X PATCH \
  -f source[branch]=gh-pages -f source[path]=/ -f build_type=legacy
```

Or: Settings > Pages > Source > Branch: `gh-pages`, folder: `/ (root)`.
