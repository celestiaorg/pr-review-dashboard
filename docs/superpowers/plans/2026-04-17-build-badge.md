# Build Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display a small `build: <short-sha>` link in the site footer linking to the GitHub commit that produced the current deploy. Serves as the verifiable visible change for step 4 of the PR-preview rollout checklist.

**Architecture:** A new CLI `scripts/write-build-info.js` runs during CI, reads `GITHUB_SHA` + `GITHUB_REPOSITORY` from env, and writes `public/build-info.json`. The frontend fetches that file on load and renders a short-SHA anchor into a footer span; missing/malformed file → silent hide. Mirrors the existing `data.json` / `review-counts.json` fetch pattern.

**Tech Stack:** Node.js, Jest (existing), GitHub Actions, vanilla JS frontend.

---

## File Structure

- **Create:** `scripts/write-build-info.js` — CLI + pure `buildInfoPayload` helper
- **Create:** `scripts/write-build-info.test.js` — Jest tests for `buildInfoPayload`
- **Modify:** `.gitignore` — ignore `public/build-info.json`
- **Modify:** `public/index.html` — add `<span id="build-info">` to footer
- **Modify:** `public/app.js` — add `fetchAndRenderBuildInfo()` + call it on init
- **Modify:** `public/style.css` — add `.build-info` styling
- **Modify:** `.github/workflows/deploy.yml` — add "Write build info" step
- **Modify:** `.github/workflows/pr-preview.yml` — add guarded "Write build info" step

---

### Task 1: Build-info script (TDD) + CLI

**Files:**
- Test: `scripts/write-build-info.test.js` (new)
- Create: `scripts/write-build-info.js` (new)

- [ ] **Step 1: Write the failing test**

Create `scripts/write-build-info.test.js` with:

```js
const { buildInfoPayload } = require("./write-build-info");

describe("buildInfoPayload", () => {
  test("returns sha, repo, and iso builtAt from the injected now", () => {
    const now = new Date("2026-04-17T12:34:56.000Z");
    const result = buildInfoPayload({
      sha: "abc123def456789",
      repo: "celestiaorg/pr-review-dashboard",
      now,
    });
    expect(result).toEqual({
      sha: "abc123def456789",
      repo: "celestiaorg/pr-review-dashboard",
      builtAt: "2026-04-17T12:34:56.000Z",
    });
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run: `npx jest scripts/write-build-info.test.js`
Expected: FAIL — `Cannot find module './write-build-info'`.

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/write-build-info.js` with:

```js
const fs = require("fs");
const path = require("path");

function buildInfoPayload({ sha, repo, now }) {
  return {
    sha,
    repo,
    builtAt: now.toISOString(),
  };
}

module.exports = { buildInfoPayload };

if (require.main === module) {
  const sha = process.env.GITHUB_SHA;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!sha || !repo) {
    console.error(
      "Error: GITHUB_SHA and GITHUB_REPOSITORY env vars are required."
    );
    process.exit(1);
  }
  const outputPath = path.join(__dirname, "..", "public", "build-info.json");
  const payload = buildInfoPayload({ sha, repo, now: new Date() });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${outputPath}`);
}
```

- [ ] **Step 4: Run the test — confirm it passes**

Run: `npx jest scripts/write-build-info.test.js`
Expected: PASS (1 test).

- [ ] **Step 5: Sanity-check the CLI writes the file**

Run:
```bash
GITHUB_SHA=abc123def456 GITHUB_REPOSITORY=celestiaorg/pr-review-dashboard \
  node scripts/write-build-info.js
cat public/build-info.json
```
Expected output: `Wrote /…/public/build-info.json` then JSON with `sha`, `repo`, and an ISO `builtAt` timestamp.

- [ ] **Step 6: Commit**

```bash
git add scripts/write-build-info.js scripts/write-build-info.test.js
git commit -m "feat: add write-build-info script for CI build metadata"
```

---

### Task 2: Gitignore the generated file

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add `public/build-info.json` to .gitignore**

Edit `.gitignore` so it reads:

```
node_modules/
.env
.superpowers/
.claude/
public/data.json
public/build-info.json
```

- [ ] **Step 2: Verify the locally-written file is ignored**

Run: `git status`
Expected: `public/build-info.json` does NOT appear in the output (the file generated in Task 1 Step 5 should now be ignored).

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore generated public/build-info.json"
```

---

### Task 3: Footer markup, fetch/render, styling

**Files:**
- Modify: `public/index.html:47-53` (footer block)
- Modify: `public/app.js:293-295` (initial fetch section) + add new function
- Modify: `public/style.css` (append `.build-info` rule)

- [ ] **Step 1: Add the build-info span to index.html**

In `public/index.html`, replace the `<footer>` block (lines 47-53):

```html
<footer>
    <span class="legend">
      <span class="legend-item"><span class="dot green"></span> &le;12h</span>
      <span class="legend-item"><span class="dot yellow"></span> 12-24h</span>
      <span class="legend-item"><span class="dot red"></span> &gt;24h</span>
    </span>
  </footer>
```

with:

```html
<footer>
    <span class="legend">
      <span class="legend-item"><span class="dot green"></span> &le;12h</span>
      <span class="legend-item"><span class="dot yellow"></span> 12-24h</span>
      <span class="legend-item"><span class="dot red"></span> &gt;24h</span>
    </span>
    <span id="build-info" class="build-info"></span>
  </footer>
```

- [ ] **Step 2: Add `fetchAndRenderBuildInfo` to app.js**

In `public/app.js`, insert this function directly above the existing `// Initial fetches (run in parallel)` comment:

```js
  async function fetchAndRenderBuildInfo() {
    const el = document.getElementById("build-info");
    if (!el) return;
    try {
      const response = await fetch("build-info.json");
      if (!response.ok) return;
      const data = await response.json();
      if (!data || !data.sha || !data.repo) return;
      const shortSha = String(data.sha).slice(0, 7);
      const link = document.createElement("a");
      link.href = `https://github.com/${data.repo}/commit/${data.sha}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `build: ${shortSha}`;
      el.innerHTML = "";
      el.appendChild(link);
    } catch {
      // Silently ignore — non-critical metadata.
    }
  }
```

- [ ] **Step 3: Call `fetchAndRenderBuildInfo` on initial load**

In `public/app.js`, replace the existing initial fetch block:

```js
  // Initial fetches (run in parallel)
  fetchAndRenderPending();
  fetchAndRenderReviewCounts();
```

with:

```js
  // Initial fetches (run in parallel)
  fetchAndRenderPending();
  fetchAndRenderReviewCounts();
  fetchAndRenderBuildInfo();
```

(Do NOT add `fetchAndRenderBuildInfo()` to the `setInterval` block below — build info only changes on redeploy, so a single initial fetch is sufficient.)

- [ ] **Step 4: Append `.build-info` styling to style.css**

Append to `public/style.css`:

```css
.build-info {
  font-size: 0.75rem;
  color: #555;
}

.build-info a {
  color: #888;
  text-decoration: none;
}

.build-info a:hover {
  color: #a5b4fc;
  text-decoration: underline;
}
```

(The footer already uses `display: flex; justify-content: space-between;`, so legend sits left and build-info sits right without further layout changes.)

- [ ] **Step 5: Verify locally in a browser**

The `public/build-info.json` from Task 1 Step 5 should still be present. Run:

```bash
npm run dev
```

Open http://localhost:3000 (or the port `serve` prints). Expected:
- Footer shows the legend on the left and `build: abc123d` (or similar 7-char SHA) on the right.
- Clicking the SHA opens `https://github.com/celestiaorg/pr-review-dashboard/commit/abc123def456` in a new tab.

Now test the silent-hide fallback:

```bash
rm public/build-info.json
```

Reload the browser. Expected: footer still renders; the right-side build-info area is empty; no error banner or console error.

Stop the dev server when done (Ctrl-C).

- [ ] **Step 6: Run the test suite to confirm nothing regressed**

Run: `npm test`
Expected: all tests pass (including the new one from Task 1).

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "feat: render build-info.json in footer as commit link"
```

---

### Task 4: Wire up the workflows

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/pr-preview.yml`

- [ ] **Step 1: Add "Write build info" step to deploy.yml**

In `.github/workflows/deploy.yml`, insert a new step between the existing `Fetch PR review data` step and the `JamesIves/github-pages-deploy-action@v4` step. After the change, the `steps:` block should read:

```yaml
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

      - name: Write build info
        env:
          GITHUB_SHA: ${{ github.sha }}
          GITHUB_REPOSITORY: ${{ github.repository }}
        run: node scripts/write-build-info.js

      - uses: JamesIves/github-pages-deploy-action@v4
        with:
          branch: gh-pages
          folder: public
          clean-exclude: pr-preview
```

- [ ] **Step 2: Add guarded "Write build info" step to pr-preview.yml**

In `.github/workflows/pr-preview.yml`, insert a new step between the existing `Fetch PR review data` step and the `rossjrw/pr-preview-action@v1` step. The step must carry `if: github.event.action != 'closed'` to match the other build steps (the `closed` event is cleanup-only). After the change, the `steps:` block should read:

```yaml
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

      - if: github.event.action != 'closed'
        name: Write build info
        env:
          GITHUB_SHA: ${{ github.event.pull_request.head.sha }}
          GITHUB_REPOSITORY: ${{ github.repository }}
        run: node scripts/write-build-info.js

      - uses: rossjrw/pr-preview-action@v1
        with:
          source-dir: public/
```

(Using `github.event.pull_request.head.sha` — not `github.sha` — so the badge points at the PR's head commit rather than the synthetic merge commit Actions uses for `pull_request` events.)

- [ ] **Step 3: Sanity-check the workflow diffs**

Run:
```bash
git diff .github/workflows/
```

Visually confirm:
- The new step in `deploy.yml` sits between `Fetch PR review data` and the `JamesIves/github-pages-deploy-action@v4` step.
- The new step in `pr-preview.yml` carries `if: github.event.action != 'closed'` (like its siblings) and sits before the `rossjrw/pr-preview-action@v1` step.
- Indentation matches the surrounding steps (4-space nesting under `steps:`).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml .github/workflows/pr-preview.yml
git commit -m "ci: write build info to public/build-info.json on deploy"
```

---

### Task 5: Push branch, open PR, verify preview

**Files:** none (this task is verification / rollout).

This task is the actual step-4 verification from the PR-preview rollout checklist.

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin build-badge
```

- [ ] **Step 2: Open the PR with auto-merge enabled**

Run:
```bash
gh pr create \
  --title "feat: add footer build badge linking to deployed commit" \
  --assignee rootulp \
  --body "$(cat <<'EOF'
## Summary

- Adds a `build: <short-sha>` link to the site footer that points to the GitHub commit currently deployed
- Main site gets the main-branch SHA; PR previews get the PR's head-commit SHA
- Serves as the visible verification target for step 4 of the PR-preview rollout (#6)

## Test plan

- [ ] PR preview comment appears with a working URL
- [ ] Preview footer shows `build: <short-sha>` linked to this PR's head commit
- [ ] Production footer shows main's SHA (different commit)
- [ ] On merge, preview subdirectory is cleaned up (step 5 of the PR-preview checklist)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```

(Per the user's global CLAUDE.md: new PRs get `rootulp` as assignee and auto-merge enabled.)

- [ ] **Step 3: Wait for the PR Preview workflow to finish**

Run:
```bash
gh run list --workflow=pr-preview.yml --limit 1
```

Then watch the most recent run until it succeeds:
```bash
gh run watch
```

Expected: `completed  success`.

- [ ] **Step 4: Verify the preview comment + badge**

1. Run `gh pr view --web` and confirm a sticky comment from `github-actions` contains a URL like `https://celestiaorg.github.io/pr-review-dashboard/pr-preview/pr-N/`.
2. Open that URL. The footer should show `build: <7-char-sha>`. Click it — confirm it opens `https://github.com/celestiaorg/pr-review-dashboard/commit/<full-sha>` and matches the head commit of this PR (`gh pr view --json headRefOid`).
3. Open https://celestiaorg.github.io/pr-review-dashboard/ (production). The footer should show the SHA of the latest `main` commit — a different commit from step 2.

If any of these fail: do NOT mark this task complete. Investigate the workflow logs (`gh run view --log`) and fix before continuing.

- [ ] **Step 5: After auto-merge, verify preview cleanup (rollout checklist step 5)**

Once the PR merges, the close event triggers `rossjrw/pr-preview-action` cleanup. Run:

```bash
gh run list --workflow=pr-preview.yml --limit 1
```

Wait for it to succeed, then visit the preview URL from Step 4. Expected: 404 (the `pr-preview/pr-N/` directory has been removed from `gh-pages`).

Confirm production still works: https://celestiaorg.github.io/pr-review-dashboard/ should load and show the newly-merged `main` SHA in the footer.
