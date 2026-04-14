# PR Reviews Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a live standup dashboard showing each protocol team member's pending PR review queue with color-coded wait times.

**Architecture:** Single Node.js Express server serving a vanilla HTML/CSS/JS frontend. Server queries GitHub API for open PRs across 13 celestiaorg repos, filters to pending reviews for team members, and returns JSON grouped by reviewer. Frontend renders a responsive card grid with green/yellow/red wait time indicators.

**Tech Stack:** Node.js, Express, dotenv, vanilla HTML/CSS/JS, GitHub REST API

---

## File Structure

```
pr-reviews/
  config.js          # Team members, repos, org, thresholds
  server.js          # Express server + GitHub API logic
  github.js          # GitHub API fetching and filtering logic
  public/
    index.html       # Dashboard HTML shell
    style.css        # Dark theme styles
    app.js           # Frontend fetch + render logic
  package.json
  .env               # GITHUB_TOKEN (gitignored)
  .gitignore
```

- `config.js` — single source of truth for team members (name, handle, defaultHidden), repos, org name, and color thresholds. Imported by `server.js` and `github.js`.
- `github.js` — all GitHub API interaction: fetching PRs, timelines, filtering drafts, determining pending reviews. Exported functions consumed by `server.js`.
- `server.js` — Express app: serves static files from `public/`, exposes `GET /api/reviews` which calls into `github.js`.
- `public/index.html` — HTML shell with header, toggle buttons container, card grid container, footer.
- `public/style.css` — dark theme, card grid layout, color classes for wait times.
- `public/app.js` — fetches `/api/reviews`, renders cards, manages toggle state in localStorage, handles auto-refresh.

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `config.js`
- Create: `.gitignore`

- [ ] **Step 1: Initialize npm project**

```bash
cd /Users/rootulp/git/pr-reviews
npm init -y
```

Expected: `package.json` created with defaults.

- [ ] **Step 2: Install dependencies**

```bash
npm install express dotenv
```

Expected: `express` and `dotenv` in `dependencies`.

- [ ] **Step 3: Update package.json scripts**

In `package.json`, set the `"scripts"` section:

```json
{
  "scripts": {
    "start": "node server.js"
  }
}
```

- [ ] **Step 4: Update .gitignore**

Replace the contents of `.gitignore` with:

```
node_modules/
.env
.superpowers/
```

- [ ] **Step 5: Create config.js**

```js
module.exports = {
  org: "celestiaorg",

  repos: [
    "blobstream-contracts",
    "celestia-app",
    "celestia-core",
    "celestia-node",
    "cosmos-sdk",
    "da-proxy",
    "go-fraud",
    "go-header",
    "go-libp2p-messenger",
    "go-square",
    "lumina",
    "nmt",
    "rsmt2d",
  ],

  teamMembers: [
    { name: "Rootul", github: "rootulp", defaultHidden: false },
    { name: "Nina", github: "ninabarbakadze", defaultHidden: false },
    { name: "Rachid", github: "rach-id", defaultHidden: false },
    { name: "Mikhail", github: "mcrakhman", defaultHidden: false },
    { name: "Slava", github: "vgonkivs", defaultHidden: false },
    { name: "Evan", github: "evan-forbes", defaultHidden: false },
    { name: "Callum", github: "cmwaters", defaultHidden: false },
    { name: "Vlad", github: "walldiss", defaultHidden: true },
    { name: "Hlib", github: "Wondertan", defaultHidden: true },
  ],

  thresholds: {
    greenMaxHours: 12,
    yellowMaxHours: 24,
  },
};
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json config.js .gitignore
git commit -m "feat: scaffold project with config, dependencies, and gitignore"
```

---

### Task 2: GitHub API Module

**Files:**
- Create: `github.js`
- Create: `github.test.js`

- [ ] **Step 1: Write failing test for fetchOpenPRs**

Create `github.test.js`:

```js
const { fetchOpenPRs, getPendingReviews } = require("./github");

// Mock global fetch
global.fetch = jest.fn();

const MOCK_TOKEN = "ghp_test123";

beforeEach(() => {
  fetch.mockClear();
});

describe("fetchOpenPRs", () => {
  test("returns non-draft PRs with requested reviewers", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          number: 1,
          title: "Fix sync",
          html_url: "https://github.com/celestiaorg/celestia-app/pull/1",
          draft: false,
          user: { login: "cmwaters" },
          requested_reviewers: [{ login: "rootulp" }],
        },
        {
          number: 2,
          title: "Draft PR",
          html_url: "https://github.com/celestiaorg/celestia-app/pull/2",
          draft: true,
          user: { login: "cmwaters" },
          requested_reviewers: [{ login: "rootulp" }],
        },
        {
          number: 3,
          title: "No team reviewers",
          html_url: "https://github.com/celestiaorg/celestia-app/pull/3",
          draft: false,
          user: { login: "outsider" },
          requested_reviewers: [{ login: "some-external-dev" }],
        },
      ],
    });

    const teamHandles = new Set(["rootulp", "ninabarbakadze"]);
    const result = await fetchOpenPRs(
      "celestiaorg",
      "celestia-app",
      teamHandles,
      MOCK_TOKEN
    );

    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(1);
    expect(result[0].requestedTeamReviewers).toEqual(["rootulp"]);
  });
});
```

- [ ] **Step 2: Install jest and run test to verify it fails**

```bash
npm install --save-dev jest
npx jest github.test.js --verbose
```

Expected: FAIL — `Cannot find module './github'`

- [ ] **Step 3: Implement fetchOpenPRs**

Create `github.js`:

```js
async function githubFetch(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} for ${url}`);
  }
  return response.json();
}

async function fetchOpenPRs(org, repo, teamHandles, token) {
  const prs = await githubFetch(
    `https://api.github.com/repos/${org}/${repo}/pulls?state=open&per_page=100`,
    token
  );

  return prs
    .filter((pr) => !pr.draft)
    .filter((pr) => {
      const reviewers = pr.requested_reviewers.map((r) => r.login);
      return reviewers.some((r) => teamHandles.has(r));
    })
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      repo,
      author: pr.user.login,
      requestedTeamReviewers: pr.requested_reviewers
        .map((r) => r.login)
        .filter((r) => teamHandles.has(r)),
    }));
}

module.exports = { githubFetch, fetchOpenPRs };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest github.test.js --verbose
```

Expected: PASS — 1 test passing.

- [ ] **Step 5: Write failing test for getReviewRequestedTime**

Add to `github.test.js`:

```js
const { getReviewRequestedTime } = require("./github");

describe("getReviewRequestedTime", () => {
  test("returns the most recent review_requested event time for a reviewer", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          event: "review_requested",
          requested_reviewer: { login: "rootulp" },
          created_at: "2026-04-10T10:00:00Z",
        },
        {
          event: "reviewed",
          user: { login: "rootulp" },
          submitted_at: "2026-04-10T14:00:00Z",
        },
        {
          event: "review_requested",
          requested_reviewer: { login: "rootulp" },
          created_at: "2026-04-11T09:00:00Z",
        },
      ],
    });

    const result = await getReviewRequestedTime(
      "celestiaorg",
      "celestia-app",
      42,
      "rootulp",
      MOCK_TOKEN
    );

    expect(result).toBe("2026-04-11T09:00:00Z");
  });

  test("returns null when no review_requested event found", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { event: "labeled", created_at: "2026-04-10T10:00:00Z" },
      ],
    });

    const result = await getReviewRequestedTime(
      "celestiaorg",
      "celestia-app",
      42,
      "rootulp",
      MOCK_TOKEN
    );

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
npx jest github.test.js --verbose
```

Expected: FAIL — `getReviewRequestedTime is not a function`

- [ ] **Step 7: Implement getReviewRequestedTime**

Add to `github.js` before `module.exports`:

```js
async function getReviewRequestedTime(org, repo, prNumber, reviewer, token) {
  const events = await githubFetch(
    `https://api.github.com/repos/${org}/${repo}/issues/${prNumber}/timeline`,
    token
  );

  const reviewRequestEvents = events.filter(
    (e) =>
      e.event === "review_requested" &&
      e.requested_reviewer &&
      e.requested_reviewer.login === reviewer
  );

  if (reviewRequestEvents.length === 0) {
    return null;
  }

  // Return the most recent review_requested event
  return reviewRequestEvents[reviewRequestEvents.length - 1].created_at;
}
```

Update `module.exports`:

```js
module.exports = { githubFetch, fetchOpenPRs, getReviewRequestedTime };
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npx jest github.test.js --verbose
```

Expected: PASS — 3 tests passing.

- [ ] **Step 9: Write failing test for getPendingReviews**

Add to `github.test.js`:

```js
describe("getPendingReviews", () => {
  test("returns pending reviews grouped by reviewer", async () => {
    // Mock fetchOpenPRs response (first call for repo)
    fetch
      // celestia-app pulls
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            number: 10,
            title: "Add feature",
            html_url: "https://github.com/celestiaorg/celestia-app/pull/10",
            draft: false,
            user: { login: "cmwaters" },
            requested_reviewers: [{ login: "rootulp" }],
          },
        ],
      })
      // timeline for PR 10
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            event: "review_requested",
            requested_reviewer: { login: "rootulp" },
            created_at: "2026-04-13T08:00:00Z",
          },
        ],
      });

    const config = {
      org: "celestiaorg",
      repos: ["celestia-app"],
      teamMembers: [
        { name: "Rootul", github: "rootulp", defaultHidden: false },
        { name: "Nina", github: "ninabarbakadze", defaultHidden: false },
      ],
    };

    const result = await getPendingReviews(config, MOCK_TOKEN);

    expect(result.rootulp).toHaveLength(1);
    expect(result.rootulp[0]).toEqual({
      number: 10,
      title: "Add feature",
      url: "https://github.com/celestiaorg/celestia-app/pull/10",
      repo: "celestia-app",
      author: "cmwaters",
      reviewer: "rootulp",
      requestedAt: "2026-04-13T08:00:00Z",
    });
    expect(result.ninabarbakadze).toEqual([]);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

```bash
npx jest github.test.js --verbose
```

Expected: FAIL — `getPendingReviews is not a function` (or wrong shape).

- [ ] **Step 11: Implement getPendingReviews**

Add to `github.js` before `module.exports`:

```js
async function getPendingReviews(config, token) {
  const { org, repos, teamMembers } = config;
  const teamHandles = new Set(teamMembers.map((m) => m.github));

  // Initialize result with empty arrays for each team member
  const result = {};
  for (const member of teamMembers) {
    result[member.github] = [];
  }

  // Fetch PRs from all repos in parallel
  const repoResults = await Promise.all(
    repos.map((repo) => fetchOpenPRs(org, repo, teamHandles, token))
  );

  // Flatten all PRs
  const allPRs = repoResults.flat();

  // For each PR and each requested reviewer, get the review request time
  const reviewPromises = [];
  for (const pr of allPRs) {
    for (const reviewer of pr.requestedTeamReviewers) {
      reviewPromises.push(
        getReviewRequestedTime(org, pr.repo, pr.number, reviewer, token).then(
          (requestedAt) => ({
            number: pr.number,
            title: pr.title,
            url: pr.url,
            repo: pr.repo,
            author: pr.author,
            reviewer,
            requestedAt,
          })
        )
      );
    }
  }

  const reviews = await Promise.all(reviewPromises);

  for (const review of reviews) {
    if (review.requestedAt && result[review.reviewer]) {
      result[review.reviewer].push(review);
    }
  }

  return result;
}
```

Update `module.exports`:

```js
module.exports = {
  githubFetch,
  fetchOpenPRs,
  getReviewRequestedTime,
  getPendingReviews,
};
```

- [ ] **Step 12: Run all tests to verify they pass**

```bash
npx jest github.test.js --verbose
```

Expected: PASS — 4 tests passing.

- [ ] **Step 13: Commit**

```bash
git add github.js github.test.js package.json package-lock.json
git commit -m "feat: add GitHub API module with pending review fetching"
```

---

### Task 3: Express Server

**Files:**
- Create: `server.js`

- [ ] **Step 1: Create server.js**

```js
require("dotenv").config();
const express = require("express");
const path = require("path");
const config = require("./config");
const { getPendingReviews } = require("./github");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.GITHUB_TOKEN) {
  console.error("Error: GITHUB_TOKEN environment variable is required.");
  console.error("Create a .env file with: GITHUB_TOKEN=ghp_your_token_here");
  process.exit(1);
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/reviews", async (req, res) => {
  try {
    const reviews = await getPendingReviews(config, process.env.GITHUB_TOKEN);
    res.json({
      reviews,
      teamMembers: config.teamMembers,
      thresholds: config.thresholds,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

app.listen(PORT, () => {
  console.log(`PR Reviews Dashboard running at http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Verify server starts (manual smoke test)**

Create a `.env` file:

```
GITHUB_TOKEN=ghp_your_token_here
```

```bash
node server.js &
sleep 1
curl -s http://localhost:3000/api/reviews | head -c 200
kill %1
```

Expected: Either JSON response or 500 error (token is placeholder). The server starts without crashing.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add Express server with /api/reviews endpoint"
```

---

### Task 4: Frontend HTML Shell

**Files:**
- Create: `public/index.html`

- [ ] **Step 1: Create the public directory**

```bash
mkdir -p /Users/rootulp/git/pr-reviews/public
```

- [ ] **Step 2: Create public/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PR Reviews Dashboard</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>PR Reviews Dashboard</h1>
    <div id="toggles" class="toggles"></div>
  </header>
  <main>
    <div id="loading" class="loading">Loading reviews...</div>
    <div id="error" class="error" style="display:none;"></div>
    <div id="card-grid" class="card-grid"></div>
  </main>
  <footer>
    <span id="last-refreshed"></span>
    <span class="legend">
      <span class="legend-item"><span class="dot green"></span> &le;12h</span>
      <span class="legend-item"><span class="dot yellow"></span> 12-24h</span>
      <span class="legend-item"><span class="dot red"></span> &gt;24h</span>
    </span>
  </footer>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add HTML shell for dashboard"
```

---

### Task 5: Frontend CSS

**Files:**
- Create: `public/style.css`

- [ ] **Step 1: Create public/style.css**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #0f0f1a;
  color: #e0e0e0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

header {
  text-align: center;
  padding: 24px 24px 16px;
}

header h1 {
  font-size: 1.8rem;
  color: #ffffff;
  margin-bottom: 16px;
}

.toggles {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.toggle-btn {
  padding: 6px 16px;
  border-radius: 20px;
  border: 1px solid #444;
  background: #1a1a2e;
  color: #e0e0e0;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s;
}

.toggle-btn:hover {
  border-color: #666;
}

.toggle-btn.active {
  background: #2a2a4a;
  border-color: #7c6ff7;
  color: #ffffff;
}

.toggle-btn.hidden {
  opacity: 0.4;
  text-decoration: line-through;
}

main {
  flex: 1;
  padding: 16px 24px;
}

.loading {
  text-align: center;
  padding: 60px;
  color: #888;
  font-size: 1.1rem;
}

.error {
  text-align: center;
  padding: 24px;
  color: #ef4444;
  background: #1a1a2e;
  border-radius: 8px;
  margin-bottom: 16px;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.card {
  background: #1a1a2e;
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #2a2a3e;
}

.card-header {
  font-size: 1.1rem;
  font-weight: 600;
  color: #ffffff;
  margin-bottom: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.review-count {
  font-size: 0.8rem;
  color: #888;
  font-weight: 400;
}

.pr-item {
  padding: 10px 0;
  border-top: 1px solid #2a2a3e;
}

.pr-title {
  font-size: 0.9rem;
  margin-bottom: 4px;
}

.pr-title a {
  color: #a5b4fc;
  text-decoration: none;
}

.pr-title a:hover {
  text-decoration: underline;
}

.pr-meta {
  font-size: 0.75rem;
  color: #888;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.pr-repo {
  color: #999;
}

.wait-time {
  font-weight: 600;
  font-size: 0.8rem;
}

.wait-time.green {
  color: #22c55e;
}

.wait-time.yellow {
  color: #eab308;
}

.wait-time.red {
  color: #ef4444;
}

.no-reviews {
  color: #555;
  font-size: 0.85rem;
  text-align: center;
  padding: 20px 0;
}

footer {
  text-align: center;
  padding: 16px 24px;
  font-size: 0.75rem;
  color: #555;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.legend {
  display: flex;
  gap: 12px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

.dot.green {
  background: #22c55e;
}

.dot.yellow {
  background: #eab308;
}

.dot.red {
  background: #ef4444;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat: add dark theme CSS for dashboard"
```

---

### Task 6: Frontend JavaScript

**Files:**
- Create: `public/app.js`

- [ ] **Step 1: Create public/app.js**

```js
(function () {
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

  let teamMembers = [];
  let thresholds = { greenMaxHours: 12, yellowMaxHours: 24 };

  function getVisibility() {
    try {
      return JSON.parse(localStorage.getItem("pr-reviews-visibility")) || {};
    } catch {
      return {};
    }
  }

  function setVisibility(visibility) {
    localStorage.setItem("pr-reviews-visibility", JSON.stringify(visibility));
  }

  function isMemberVisible(member) {
    const saved = getVisibility();
    if (saved.hasOwnProperty(member.github)) {
      return saved[member.github];
    }
    return !member.defaultHidden;
  }

  function toggleMember(member) {
    const saved = getVisibility();
    saved[member.github] = !isMemberVisible(member);
    setVisibility(saved);
  }

  function formatWaitTime(requestedAt) {
    const now = new Date();
    const requested = new Date(requestedAt);
    const diffMs = now - requested;
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 1) {
      const mins = Math.floor(diffMs / (1000 * 60));
      return { text: `${mins}m`, hours: diffHours };
    } else if (diffHours < 24) {
      const hrs = Math.floor(diffHours);
      return { text: `${hrs}h`, hours: diffHours };
    } else {
      const days = Math.floor(diffHours / 24);
      const hrs = Math.floor(diffHours % 24);
      return { text: `${days}d ${hrs}h`, hours: diffHours };
    }
  }

  function getWaitClass(hours) {
    if (hours <= thresholds.greenMaxHours) return "green";
    if (hours <= thresholds.yellowMaxHours) return "yellow";
    return "red";
  }

  function renderToggles() {
    const container = document.getElementById("toggles");
    container.innerHTML = "";

    for (const member of teamMembers) {
      const btn = document.createElement("button");
      btn.className = "toggle-btn";
      btn.textContent = member.name;

      if (isMemberVisible(member)) {
        btn.classList.add("active");
      } else {
        btn.classList.add("hidden");
      }

      btn.addEventListener("click", () => {
        toggleMember(member);
        renderToggles();
        renderCards(lastData);
      });

      container.appendChild(btn);
    }
  }

  let lastData = null;

  function renderCards(data) {
    lastData = data;
    const grid = document.getElementById("card-grid");
    grid.innerHTML = "";

    for (const member of teamMembers) {
      if (!isMemberVisible(member)) continue;

      const reviews = data.reviews[member.github] || [];

      const card = document.createElement("div");
      card.className = "card";

      const header = document.createElement("div");
      header.className = "card-header";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = member.name;

      const countSpan = document.createElement("span");
      countSpan.className = "review-count";
      countSpan.textContent =
        reviews.length === 0
          ? ""
          : `${reviews.length} pending`;

      header.appendChild(nameSpan);
      header.appendChild(countSpan);
      card.appendChild(header);

      if (reviews.length === 0) {
        const noReviews = document.createElement("div");
        noReviews.className = "no-reviews";
        noReviews.textContent = "No pending reviews";
        card.appendChild(noReviews);
      } else {
        // Sort by wait time descending (longest wait first)
        const sorted = [...reviews].sort(
          (a, b) => new Date(a.requestedAt) - new Date(b.requestedAt)
        );

        for (const pr of sorted) {
          const item = document.createElement("div");
          item.className = "pr-item";

          const title = document.createElement("div");
          title.className = "pr-title";
          const link = document.createElement("a");
          link.href = pr.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = pr.title;
          title.appendChild(link);

          const meta = document.createElement("div");
          meta.className = "pr-meta";

          const repoInfo = document.createElement("span");
          repoInfo.className = "pr-repo";
          repoInfo.textContent = `${pr.repo}#${pr.number} by ${pr.author}`;

          const wait = formatWaitTime(pr.requestedAt);
          const waitSpan = document.createElement("span");
          waitSpan.className = `wait-time ${getWaitClass(wait.hours)}`;
          waitSpan.textContent = wait.text;

          meta.appendChild(repoInfo);
          meta.appendChild(waitSpan);

          item.appendChild(title);
          item.appendChild(meta);
          card.appendChild(item);
        }
      }

      grid.appendChild(card);
    }
  }

  function updateLastRefreshed(fetchedAt) {
    const el = document.getElementById("last-refreshed");
    const time = new Date(fetchedAt).toLocaleTimeString();
    el.textContent = `Last refreshed: ${time}`;
  }

  async function fetchAndRender() {
    const loading = document.getElementById("loading");
    const errorEl = document.getElementById("error");

    try {
      const response = await fetch("/api/reviews");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      teamMembers = data.teamMembers;
      thresholds = data.thresholds;

      loading.style.display = "none";
      errorEl.style.display = "none";

      renderToggles();
      renderCards(data);
      updateLastRefreshed(data.fetchedAt);
    } catch (err) {
      loading.style.display = "none";
      errorEl.style.display = "block";
      errorEl.textContent = `Failed to load reviews: ${err.message}`;
    }
  }

  // Initial fetch
  fetchAndRender();

  // Auto-refresh every 5 minutes
  setInterval(fetchAndRender, REFRESH_INTERVAL_MS);
})();
```

- [ ] **Step 2: Start server and verify in browser**

```bash
cd /Users/rootulp/git/pr-reviews
echo "GITHUB_TOKEN=$(gh auth token)" > .env
npm start
```

Open http://localhost:3000 in browser. Verify:
- Dark theme renders
- Toggle buttons appear for all 9 team members
- Vlad and Hlib toggles show as hidden/strikethrough
- Cards appear for visible members
- PRs show with color-coded wait times
- Footer shows last refreshed time and legend

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: add frontend JavaScript for card rendering and toggle state"
```

---

### Task 7: End-to-End Smoke Test

- [ ] **Step 1: Start the server with a real token**

```bash
cd /Users/rootulp/git/pr-reviews
echo "GITHUB_TOKEN=$(gh auth token)" > .env
npm start
```

- [ ] **Step 2: Verify in browser**

Open http://localhost:3000 and check:

1. Page loads with dark theme
2. Header shows "PR Reviews Dashboard"
3. Toggle buttons render for all 9 members
4. Vlad and Hlib are hidden by default (strikethrough/dimmed)
5. Clicking a hidden toggle shows that member's card
6. Clicking a visible toggle hides their card
7. Cards show pending PRs with repo name, PR number, author, title link
8. Wait times are color coded (green/yellow/red)
9. "No pending reviews" shows for members with empty queues
10. Footer shows last refreshed time and color legend
11. Refreshing the page preserves toggle state (localStorage)

- [ ] **Step 3: Commit any fixes**

If any issues found, fix and commit:

```bash
git add -A
git commit -m "fix: address issues found during smoke test"
```
