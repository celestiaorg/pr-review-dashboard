# GitHub Pages Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host the PR Review Dashboard at `https://celestiaorg.github.io/pr-review-dashboard/` via GitHub Pages + a scheduled GitHub Actions workflow that fetches PR data every 5 minutes.

**Architecture:** Replace the Express server with a static site. A GitHub Actions cron job runs `scripts/fetch-data.js` every 5 min, which writes `public/data.json` using the existing `github.js` library. The workflow uploads `public/` as a Pages artifact and deploys it. The frontend fetches `data.json` instead of `/api/reviews`. No commits to `main` per run — Pages artifacts avoid history pollution.

**Tech Stack:** Node.js 20, Jest, GitHub Actions (`actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`), `serve` (static file server for local dev).

Spec: [docs/superpowers/specs/2026-04-15-github-pages-deployment-design.md](../specs/2026-04-15-github-pages-deployment-design.md)

---

### Task 1: Add `scripts/fetch-data.js` via TDD

Creates the CLI that the GitHub Action will run to produce `public/data.json`.

**Files:**
- Create: `scripts/fetch-data.js`
- Test: `scripts/fetch-data.test.js`

- [ ] **Step 1: Write the failing test**

Create `scripts/fetch-data.test.js`:

```js
const fs = require("fs");
const path = require("path");
const os = require("os");

jest.mock("../github", () => ({
  getPendingReviews: jest.fn(),
}));

const { getPendingReviews } = require("../github");
const { main } = require("./fetch-data");

describe("fetch-data main", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-data-test-"));
  const outputPath = path.join(tmpDir, "data.json");

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("writes data.json with reviews, teamMembers, thresholds, and fetchedAt", async () => {
    const fakeReviews = { rootulp: [{ number: 1 }], ninabarbakadze: [] };
    getPendingReviews.mockResolvedValue(fakeReviews);

    const config = {
      org: "celestiaorg",
      repos: ["celestia-app"],
      teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
      thresholds: { greenMaxHours: 12, yellowMaxHours: 24 },
    };

    await main({ config, token: "ghp_fake", outputPath });

    const written = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    expect(written.reviews).toEqual(fakeReviews);
    expect(written.teamMembers).toEqual(config.teamMembers);
    expect(written.thresholds).toEqual(config.thresholds);
    expect(typeof written.fetchedAt).toBe("string");
    expect(new Date(written.fetchedAt).toString()).not.toBe("Invalid Date");
    expect(getPendingReviews).toHaveBeenCalledWith(config, "ghp_fake");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest scripts/fetch-data.test.js`
Expected: FAIL — `Cannot find module './fetch-data'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/fetch-data.js`:

```js
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { getPendingReviews } = require("../github");

async function main({ config, token, outputPath }) {
  const reviews = await getPendingReviews(config, token);
  const payload = {
    reviews,
    teamMembers: config.teamMembers,
    thresholds: config.thresholds,
    fetchedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
}

module.exports = { main };

if (require.main === module) {
  require("dotenv").config();
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("Error: GITHUB_TOKEN environment variable is required.");
    process.exit(1);
  }
  const outputPath = path.join(__dirname, "..", "public", "data.json");
  main({ config, token, outputPath })
    .then(() => console.log(`Wrote ${outputPath}`))
    .catch((err) => {
      console.error("Failed to fetch data:", err);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest scripts/fetch-data.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npx jest`
Expected: All tests pass (existing `github.test.js` + new `scripts/fetch-data.test.js`).

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-data.js scripts/fetch-data.test.js
git commit -m "feat: add scripts/fetch-data.js to write public/data.json

Headless data-fetch entrypoint for the GitHub Pages deployment.
Reuses github.js and writes the same JSON shape the old /api/reviews
endpoint returned.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Update frontend to fetch `data.json`

**Files:**
- Modify: `public/app.js:175`

- [ ] **Step 1: Edit fetch URL**

Change line 175 in `public/app.js` from:

```js
const response = await fetch("/api/reviews");
```

to:

```js
const response = await fetch("data.json");
```

- [ ] **Step 2: Commit**

```bash
git add public/app.js
git commit -m "refactor: fetch data.json instead of /api/reviews

The app is moving to a static deployment on GitHub Pages where the
reviews payload is pre-generated by a scheduled Action and served
as a static file.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Update `package.json` dependencies and scripts

Remove `express` (no more server), add `serve` for local dev, and replace the `start` script.

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (via `npm install`)

- [ ] **Step 1: Edit `package.json`**

Replace the file contents with:

```json
{
  "name": "pr-reviews",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "directories": {
    "doc": "docs"
  },
  "scripts": {
    "fetch": "node scripts/fetch-data.js",
    "dev": "serve public",
    "start": "npm run fetch && npm run dev",
    "test": "jest"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "commonjs",
  "dependencies": {
    "dotenv": "^17.4.2"
  },
  "devDependencies": {
    "jest": "^30.3.0",
    "serve": "^14.2.4"
  }
}
```

Note: `express` is removed; `dotenv` stays (used by `scripts/fetch-data.js` for local dev). `serve` is added as a devDep so `npm run dev` works offline without `npx` network calls.

- [ ] **Step 2: Update lockfile**

Run: `npm install`
Expected: `node_modules` and `package-lock.json` updated. Exit 0.

- [ ] **Step 3: Verify tests still pass**

Run: `npm test`
Expected: All Jest tests pass.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: swap express for serve; add fetch/dev/start scripts

Drop the Express server dependency now that the app is static.
Add 'serve' as a devDep for local development and define scripts
for the new fetch + static-serve workflow.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Remove `server.js`

**Files:**
- Delete: `server.js`

- [ ] **Step 1: Delete the file**

Run: `git rm server.js`
Expected: `rm 'server.js'`.

- [ ] **Step 2: Commit**

```bash
git commit -m "refactor: remove server.js

Replaced by scripts/fetch-data.js + static serving via 'serve'.
The GitHub Actions workflow handles production data fetches.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Ignore generated `public/data.json`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append to `.gitignore`**

Add a new line at the end of `.gitignore`:

```
public/data.json
```

Final `.gitignore`:

```
node_modules/
.env
.superpowers/
.claude/
public/data.json
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore generated public/data.json

The file is generated by scripts/fetch-data.js locally and by the
deploy workflow in CI; it should never be committed.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Add GitHub Actions deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create the workflow file**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy PR Review Dashboard

on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"

      - run: npm ci

      - name: Fetch PR review data
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/fetch-data.js

      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: public

      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add GitHub Pages deploy workflow

Runs on a 5-minute cron, on push to main, and on workflow_dispatch.
Fetches PR data with scripts/fetch-data.js, then uploads public/ as
a Pages artifact and deploys it. Uses the default GITHUB_TOKEN
(1000 req/hr for public repos).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace README contents**

Write the following to `README.md`:

````markdown
# PR Review Dashboard

A live dashboard that shows each protocol team member's pending PR review queue, with color-coded wait times. Designed to be displayed during team stand-ups.

**Live site:** https://celestiaorg.github.io/pr-review-dashboard/

## Features

- Card grid showing each team member's pending reviews
- Wait times color-coded: green (≤12h), yellow (12-24h), red (>24h)
- Toggle buttons to show/hide members (e.g., when they're on another project)
- Auto-refreshes every 5 minutes
- Only shows open, non-draft PRs in [protocol repos](https://github.com/celestiaorg/protocol?tab=readme-ov-file#repos)

## Prerequisites

- Node.js 18 or later (for built-in `fetch` support)
- A GitHub personal access token with `repo` scope, or the [`gh` CLI](https://cli.github.com/) authenticated

## Running locally

1. Clone the repo and install dependencies:

   ```bash
   git clone git@github.com:celestiaorg/pr-review-dashboard.git
   cd pr-review-dashboard
   npm install
   ```

2. Create a `.env` file with your GitHub token:

   ```bash
   echo "GITHUB_TOKEN=$(gh auth token)" > .env
   ```

   Or set it manually:

   ```bash
   echo "GITHUB_TOKEN=ghp_your_token_here" > .env
   ```

3. Fetch data and start the local server:

   ```bash
   npm start
   ```

   This runs `npm run fetch` (writes `public/data.json`) then `npm run dev` (serves `public/` at http://localhost:3000).

4. Open http://localhost:3000 in your browser.

## Configuration

Team members, repos, and color thresholds are defined in [`config.js`](./config.js). Edit that file to add/remove members or repos, or adjust the color thresholds.

To change the default-hidden members, set `defaultHidden: true` on their entry. Users can override visibility via toggle buttons in the UI (state is persisted in `localStorage`).

## Deployment

The dashboard is deployed to GitHub Pages via `.github/workflows/deploy.yml`:

- Runs every 5 minutes on a cron (plus on every push to `main` and on manual dispatch).
- Fetches PR data using the default `GITHUB_TOKEN` provided to the Actions runner.
- Uploads `public/` (including the freshly-generated `data.json`) as a Pages artifact and deploys it.

To trigger a manual redeploy: `gh workflow run deploy.yml`.

## Testing

```bash
npm test
```
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for GitHub Pages deployment

Point to the live site, describe the new local-dev flow
(npm start → fetch + serve), and add a Deployment section.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Push and open draft PR (no auto-merge)

Per user decision during brainstorming, auto-merge is disabled for this PR because it changes the architecture.

- [ ] **Step 1: Push the branch**

Run: `git push -u origin deploy-to-github-pages`
Expected: branch pushed, remote tracking set.

- [ ] **Step 2: Open draft PR**

```bash
gh pr create --draft --assignee rootulp --title "Deploy dashboard to GitHub Pages" --body "$(cat <<'EOF'
## Summary
- Replace the Express server with a static site hosted on GitHub Pages.
- Add a GitHub Actions workflow that runs every 5 minutes, fetches PR data via `scripts/fetch-data.js`, and deploys `public/` to Pages.
- Frontend fetches `data.json` instead of `/api/reviews`.

## Architecture
See [the design spec](docs/superpowers/specs/2026-04-15-github-pages-deployment-design.md) and [implementation plan](docs/superpowers/plans/2026-04-15-github-pages-deployment.md).

## Test plan
- [ ] `npm test` passes locally
- [ ] `npm start` serves the dashboard at http://localhost:3000 with live data
- [ ] After merge: workflow runs successfully (`gh workflow run deploy.yml`)
- [ ] After merge: https://celestiaorg.github.io/pr-review-dashboard/ loads and displays current reviews

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note: no auto-merge flag — user will review and merge manually.

- [ ] **Step 3: Report PR URL to user**

Output the PR URL from `gh pr create`.

---

### Task 9: Post-merge — enable Pages and deploy (user-triggered)

**Blocked on the user merging the PR.** Once merged:

- [ ] **Step 1: Verify Pages isn't already enabled**

Run: `gh api repos/celestiaorg/pr-review-dashboard/pages 2>/dev/null || echo "not enabled"`

- [ ] **Step 2: Enable GitHub Pages with Actions as source**

Run:

```bash
gh api repos/celestiaorg/pr-review-dashboard/pages \
  -X POST \
  -f 'build_type=workflow'
```

Expected: `201 Created` with a JSON response including `"url": "https://celestiaorg.github.io/pr-review-dashboard/"`.

If Pages is already enabled but not using the workflow source:

```bash
gh api repos/celestiaorg/pr-review-dashboard/pages \
  -X PUT \
  -f 'build_type=workflow'
```

- [ ] **Step 3: Trigger first deploy**

Run: `gh workflow run deploy.yml --repo celestiaorg/pr-review-dashboard`
Then watch it: `gh run watch --repo celestiaorg/pr-review-dashboard`
Expected: workflow completes successfully.

- [ ] **Step 4: Verify the site loads**

Run: `curl -sSfI https://celestiaorg.github.io/pr-review-dashboard/ | head -1`
Expected: `HTTP/2 200`.

Also fetch `data.json`:

Run: `curl -sSf https://celestiaorg.github.io/pr-review-dashboard/data.json | head -c 200`
Expected: valid JSON beginning with `{"reviews":...`.

- [ ] **Step 5: Report URL to user**

Send the user the live URL: `https://celestiaorg.github.io/pr-review-dashboard/`.

---

## Notes for the implementer

- **Don't touch `main`.** The user is using `main` for a stand-up. All work stays on the `deploy-to-github-pages` branch until they merge the PR themselves.
- **TDD discipline:** Task 1 is the only task with meaningful logic. Write the test first, see it fail, then implement. Later tasks are mechanical config changes — no tests needed.
- **Rate-limit fallback:** If the first Action run fails with `403 rate limit exceeded`, create a fine-grained PAT with public-repo read access, store it as a repo secret (e.g., `PAT_FOR_API`), and change `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` to `GITHUB_TOKEN: ${{ secrets.PAT_FOR_API }}` in `deploy.yml`.
