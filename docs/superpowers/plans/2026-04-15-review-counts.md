# Teammate Review Counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new section at the top of the dashboard showing three horizontal bar charts (This Week / This Month / 2026 YTD) of PRs reviewed per teammate, with data refreshed daily.

**Architecture:** A new module `github-reviews.js` runs GraphQL search queries per teammate × repo, takes each teammate's earliest review per PR, and buckets dates (UTC, ISO Monday week). A new script `scripts/fetch-review-counts.js` writes `public/review-counts.json`, committed to the repo by a new daily GitHub workflow. The existing 5-minute deploy picks up the committed file unchanged. The UI (`public/app.js`, `index.html`, `style.css`) renders a new top section with three CSS-based bar charts that respect the existing teammate-visibility toggles.

**Tech Stack:** Node.js (CommonJS), Jest, vanilla JS / HTML / CSS (no frontend framework), GitHub GraphQL API, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-04-15-review-counts-design.md`

---

## File Structure

### New files
- `github-reviews.js` — exports `getReviewCounts(config, token, now)`; queries GitHub GraphQL search per teammate × repo, buckets earliest review dates.
- `github-reviews.test.js` — Jest unit tests for `github-reviews.js`.
- `scripts/fetch-review-counts.js` — CLI entrypoint; writes `public/review-counts.json`.
- `public/review-counts.json` — daily-regenerated output (committed to repo).
- `.github/workflows/fetch-review-counts.yml` — daily cron that runs the script and pushes the result to `main`.

### Modified files
- `package.json` — new `fetch-review-counts` npm script.
- `public/index.html` — adds `<section id="review-counts">` at top of `<main>`, restructures pending-reviews into its own section with header.
- `public/app.js` — fetches `review-counts.json`, renders new bar-chart section, wires visibility toggles to both sections.
- `public/style.css` — styles for new section header, freshness label, bar charts.

### Unchanged files
- `github.js`, `github.test.js`, `scripts/fetch-data.js`, `scripts/fetch-data.test.js`, `config.js`, `.github/workflows/deploy.yml`, `.gitignore` (already excludes only `public/data.json`).

---

## Task 1: Date-bucketing helpers in `github-reviews.js`

**Files:**
- Create: `github-reviews.js`
- Create: `github-reviews.test.js`

- [ ] **Step 1: Write failing tests for date helpers**

Create `github-reviews.test.js`:

```js
const {
  mondayOfWeekUTC,
  firstOfMonthUTC,
  START_OF_2026,
  bucketForDate,
} = require("./github-reviews");

describe("mondayOfWeekUTC", () => {
  test("returns Monday 00:00 UTC when given a Wednesday", () => {
    const wed = new Date("2026-04-15T14:23:00Z");
    expect(mondayOfWeekUTC(wed).toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });

  test("returns same day 00:00 UTC when given a Monday", () => {
    const mon = new Date("2026-04-13T09:00:00Z");
    expect(mondayOfWeekUTC(mon).toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });

  test("returns previous Monday when given a Sunday", () => {
    const sun = new Date("2026-04-19T23:59:00Z");
    expect(mondayOfWeekUTC(sun).toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });
});

describe("firstOfMonthUTC", () => {
  test("returns 1st of month 00:00 UTC", () => {
    const d = new Date("2026-04-15T14:23:00Z");
    expect(firstOfMonthUTC(d).toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  test("handles month edge (last day)", () => {
    const d = new Date("2026-01-31T23:59:59Z");
    expect(firstOfMonthUTC(d).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("START_OF_2026", () => {
  test("is 2026-01-01T00:00:00.000Z", () => {
    expect(START_OF_2026.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("bucketForDate", () => {
  const now = new Date("2026-04-15T14:23:00Z"); // Wed

  test("pre-2026 review: no buckets", () => {
    const reviewedAt = new Date("2025-12-31T23:59:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: false, month: false, week: false,
    });
  });

  test("2026-01-01 00:00Z: year only", () => {
    const reviewedAt = new Date("2026-01-01T00:00:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: true, month: false, week: false,
    });
  });

  test("earlier this month: year + month", () => {
    const reviewedAt = new Date("2026-04-05T10:00:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: true, month: true, week: false,
    });
  });

  test("this Monday 00:00Z: year + month + week", () => {
    const reviewedAt = new Date("2026-04-13T00:00:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: true, month: true, week: true,
    });
  });

  test("last Sunday 23:59Z: year + month but not week", () => {
    const reviewedAt = new Date("2026-04-12T23:59:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: true, month: true, week: false,
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx jest github-reviews.test.js`
Expected: FAIL with "Cannot find module './github-reviews'"

- [ ] **Step 3: Implement the date helpers**

Create `github-reviews.js`:

```js
const START_OF_2026 = new Date("2026-01-01T00:00:00.000Z");

function mondayOfWeekUTC(date) {
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
  // JS: getUTCDay() returns 0=Sun, 1=Mon, ..., 6=Sat.
  // Days to subtract to reach Monday:
  //   Sun=6, Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5.
  const dayOfWeek = d.getUTCDay();
  const daysToSubtract = (dayOfWeek + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysToSubtract);
  return d;
}

function firstOfMonthUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function bucketForDate(reviewedAt, now) {
  const inYear = reviewedAt >= START_OF_2026;
  const inMonth = inYear && reviewedAt >= firstOfMonthUTC(now);
  const inWeek = inMonth && reviewedAt >= mondayOfWeekUTC(now);
  return { year: inYear, month: inMonth, week: inWeek };
}

module.exports = {
  START_OF_2026,
  mondayOfWeekUTC,
  firstOfMonthUTC,
  bucketForDate,
};
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx jest github-reviews.test.js`
Expected: PASS, all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add github-reviews.js github-reviews.test.js
git commit -m "feat: add date-bucketing helpers for review counts"
```

---

## Task 2: `getReviewCounts` — single teammate, single repo, single page

**Files:**
- Modify: `github-reviews.js`
- Modify: `github-reviews.test.js`

- [ ] **Step 1: Write failing test for the happy path**

Append to `github-reviews.test.js`:

```js
const { getReviewCounts } = require("./github-reviews");

global.fetch = jest.fn();

function searchOk(nodes, pageInfo = { hasNextPage: false, endCursor: null }) {
  return {
    ok: true,
    json: async () => ({ data: { search: { nodes, pageInfo } } }),
  };
}

beforeEach(() => fetch.mockClear());

describe("getReviewCounts", () => {
  const NOW = new Date("2026-04-15T14:23:00Z"); // Wed
  const CONFIG = {
    org: "celestiaorg",
    repos: ["celestia-app"],
    teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
  };

  test("counts earliest review per PR, buckets week/month/year", async () => {
    // PR 10: Rootul's earliest review is this Monday → week+month+year.
    // PR 11: Rootul's earliest review is Feb 2026 → year only.
    fetch.mockResolvedValueOnce(
      searchOk([
        {
          number: 10,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [
              { submittedAt: "2026-04-13T09:00:00Z", state: "APPROVED" },
              { submittedAt: "2026-04-14T09:00:00Z", state: "COMMENTED" },
            ],
          },
        },
        {
          number: 11,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [{ submittedAt: "2026-02-10T09:00:00Z", state: "APPROVED" }],
          },
        },
      ])
    );

    const result = await getReviewCounts(CONFIG, "tok", NOW);

    expect(result.rootulp).toEqual({ week: 1, month: 1, year: 2 });
  });

  test("pre-2026 reviews are ignored", async () => {
    fetch.mockResolvedValueOnce(
      searchOk([
        {
          number: 1,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [{ submittedAt: "2025-12-31T23:59:00Z", state: "APPROVED" }],
          },
        },
      ])
    );

    const result = await getReviewCounts(CONFIG, "tok", NOW);
    expect(result.rootulp).toEqual({ week: 0, month: 0, year: 0 });
  });

  test("2026-01-01T00:00Z review counts in year", async () => {
    fetch.mockResolvedValueOnce(
      searchOk([
        {
          number: 1,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [{ submittedAt: "2026-01-01T00:00:00Z", state: "APPROVED" }],
          },
        },
      ])
    );

    const result = await getReviewCounts(CONFIG, "tok", NOW);
    expect(result.rootulp).toEqual({ week: 0, month: 0, year: 1 });
  });

  test("PR with multiple reviews counts once at earliest date", async () => {
    // Two reviews, earliest is Feb (year-only), latest is this week.
    // Because we use EARLIEST, this counts in year only, not week.
    fetch.mockResolvedValueOnce(
      searchOk([
        {
          number: 1,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [
              { submittedAt: "2026-04-13T09:00:00Z", state: "APPROVED" },
              { submittedAt: "2026-02-10T09:00:00Z", state: "COMMENTED" },
            ],
          },
        },
      ])
    );

    const result = await getReviewCounts(CONFIG, "tok", NOW);
    expect(result.rootulp).toEqual({ week: 0, month: 0, year: 1 });
  });

  test("PR with no reviews is ignored (defensive)", async () => {
    fetch.mockResolvedValueOnce(
      searchOk([
        {
          number: 1,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: { nodes: [] },
        },
      ])
    );

    const result = await getReviewCounts(CONFIG, "tok", NOW);
    expect(result.rootulp).toEqual({ week: 0, month: 0, year: 0 });
  });

  test("teammate with zero reviews gets zero counts", async () => {
    fetch.mockResolvedValueOnce(searchOk([]));

    const result = await getReviewCounts(CONFIG, "tok", NOW);
    expect(result.rootulp).toEqual({ week: 0, month: 0, year: 0 });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx jest github-reviews.test.js`
Expected: FAIL with "getReviewCounts is not a function"

- [ ] **Step 3: Implement `getReviewCounts` (single-page, no pagination yet)**

Append to `github-reviews.js`:

```js
const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const MAX_PAGES = 10;

const REVIEW_SEARCH_QUERY = `
  query($q: String!, $login: String!, $after: String) {
    search(query: $q, type: ISSUE, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          repository { nameWithOwner }
          reviews(first: 50, author: $login) {
            nodes { submittedAt state }
          }
        }
      }
    }
  }
`;

async function graphqlSearch(token, q, login, after) {
  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: REVIEW_SEARCH_QUERY,
      variables: { q, login, after: after || null },
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub GraphQL error: ${response.status}`);
  }
  const payload = await response.json();
  if (payload.errors) {
    throw new Error(`GitHub GraphQL error: ${JSON.stringify(payload.errors)}`);
  }
  return payload.data.search;
}

function earliestReviewDate(reviews) {
  const times = (reviews || [])
    .map((r) => r.submittedAt)
    .filter(Boolean)
    .sort();
  return times.length ? new Date(times[0]) : null;
}

async function countReviewsForMemberInRepo(token, org, repo, login, now) {
  const q = `repo:${org}/${repo} is:pr reviewed-by:${login} created:>=2026-01-01`;
  const counts = { week: 0, month: 0, year: 0 };
  let after = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { nodes, pageInfo } = await graphqlSearch(token, q, login, after);

    for (const pr of nodes) {
      const earliest = earliestReviewDate(pr.reviews && pr.reviews.nodes);
      if (!earliest) continue;
      const b = bucketForDate(earliest, now);
      if (b.year) counts.year++;
      if (b.month) counts.month++;
      if (b.week) counts.week++;
    }

    if (!pageInfo.hasNextPage) return counts;
    after = pageInfo.endCursor;
  }

  console.warn(
    `Hit pagination cap (${MAX_PAGES} pages) for ${login} in ${repo}; counts may be undercounts.`
  );
  return counts;
}

async function getReviewCounts(config, token, now = new Date()) {
  const { org, repos, teamMembers } = config;
  const result = {};
  for (const member of teamMembers) {
    result[member.github] = { week: 0, month: 0, year: 0 };
  }

  for (const member of teamMembers) {
    for (const repo of repos) {
      try {
        const partial = await countReviewsForMemberInRepo(
          token, org, repo, member.github, now
        );
        result[member.github].week += partial.week;
        result[member.github].month += partial.month;
        result[member.github].year += partial.year;
      } catch (err) {
        console.warn(
          `Failed to fetch review counts for ${member.github} in ${repo}: ${err.message}`
        );
      }
    }
  }

  return result;
}

module.exports.getReviewCounts = getReviewCounts;
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx jest github-reviews.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add github-reviews.js github-reviews.test.js
git commit -m "feat: add getReviewCounts single-page GraphQL search"
```

---

## Task 3: Pagination and per-repo failure tolerance

**Files:**
- Modify: `github-reviews.test.js`

- [ ] **Step 1: Write failing tests for pagination and failure tolerance**

Append to `github-reviews.test.js`:

```js
describe("getReviewCounts — pagination and failure tolerance", () => {
  const NOW = new Date("2026-04-15T14:23:00Z");

  test("paginates when hasNextPage=true", async () => {
    fetch
      .mockResolvedValueOnce(
        searchOk(
          [
            {
              number: 1,
              repository: { nameWithOwner: "celestiaorg/celestia-app" },
              reviews: {
                nodes: [{ submittedAt: "2026-04-13T09:00:00Z", state: "APPROVED" }],
              },
            },
          ],
          { hasNextPage: true, endCursor: "cursor-1" }
        )
      )
      .mockResolvedValueOnce(
        searchOk([
          {
            number: 2,
            repository: { nameWithOwner: "celestiaorg/celestia-app" },
            reviews: {
              nodes: [{ submittedAt: "2026-04-05T09:00:00Z", state: "APPROVED" }],
            },
          },
        ])
      );

    const config = {
      org: "celestiaorg",
      repos: ["celestia-app"],
      teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
    };

    const result = await getReviewCounts(config, "tok", NOW);
    expect(fetch).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(fetch.mock.calls[1][1].body);
    expect(secondCallBody.variables.after).toBe("cursor-1");
    expect(result.rootulp).toEqual({ week: 1, month: 2, year: 2 });
  });

  test("per-repo failures are logged and other repos continue", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: "server error" }),
      })
      .mockResolvedValueOnce(
        searchOk([
          {
            number: 2,
            repository: { nameWithOwner: "celestiaorg/celestia-core" },
            reviews: {
              nodes: [{ submittedAt: "2026-04-13T09:00:00Z", state: "APPROVED" }],
            },
          },
        ])
      );

    const config = {
      org: "celestiaorg",
      repos: ["celestia-app", "celestia-core"],
      teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
    };

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await getReviewCounts(config, "tok", NOW);
      expect(result.rootulp).toEqual({ week: 1, month: 1, year: 1 });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("warns and stops when pagination cap is reached", async () => {
    // Simulate 11 pages where every page reports hasNextPage=true.
    for (let i = 0; i < 11; i++) {
      fetch.mockResolvedValueOnce(
        searchOk(
          [
            {
              number: i + 1,
              repository: { nameWithOwner: "celestiaorg/celestia-app" },
              reviews: {
                nodes: [{ submittedAt: "2026-04-13T09:00:00Z", state: "APPROVED" }],
              },
            },
          ],
          { hasNextPage: true, endCursor: `c-${i}` }
        )
      );
    }

    const config = {
      org: "celestiaorg",
      repos: ["celestia-app"],
      teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
    };

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await getReviewCounts(config, "tok", NOW);
      // Exactly 10 pages fetched, 10 PRs counted.
      expect(fetch).toHaveBeenCalledTimes(10);
      expect(result.rootulp.year).toBe(10);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("pagination cap")
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run tests — verify pagination and failure tests pass (implementation from Task 2 already supports these)**

Run: `npx jest github-reviews.test.js`
Expected: PASS, all tests green. (Task 2's implementation already handles pagination, per-repo try/catch, and the 10-page cap — these tests verify that behavior explicitly.)

If any test fails, fix the implementation in `github-reviews.js` before continuing.

- [ ] **Step 3: Commit**

```bash
git add github-reviews.test.js
git commit -m "test: cover pagination and per-repo failure tolerance"
```

---

## Task 4: `scripts/fetch-review-counts.js`

**Files:**
- Create: `scripts/fetch-review-counts.js`
- Modify: `package.json`

- [ ] **Step 1: Create the script**

Create `scripts/fetch-review-counts.js`:

```js
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { getReviewCounts, mondayOfWeekUTC, firstOfMonthUTC, START_OF_2026 } =
  require("../github-reviews");

async function main({ config, token, outputPath, now = new Date() }) {
  const counts = await getReviewCounts(config, token, now);
  const payload = {
    counts,
    computedAt: now.toISOString(),
    windows: {
      weekStart: mondayOfWeekUTC(now).toISOString(),
      monthStart: firstOfMonthUTC(now).toISOString(),
      yearStart: START_OF_2026.toISOString(),
    },
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
  const outputPath = path.join(__dirname, "..", "public", "review-counts.json");
  main({ config, token, outputPath })
    .then(() => console.log(`Wrote ${outputPath}`))
    .catch((err) => {
      console.error("Failed to fetch review counts:", err);
      process.exit(1);
    });
}
```

- [ ] **Step 2: Add the npm script**

Edit `package.json`. Change:

```json
"scripts": {
  "fetch": "node scripts/fetch-data.js",
  "dev": "serve public",
  "start": "npm run fetch && npm run dev",
  "test": "jest"
},
```

to:

```json
"scripts": {
  "fetch": "node scripts/fetch-data.js",
  "fetch-review-counts": "node scripts/fetch-review-counts.js",
  "dev": "serve public",
  "start": "npm run fetch && npm run dev",
  "test": "jest"
},
```

- [ ] **Step 3: Smoke-check the script is syntactically valid**

Run: `node -e "require('./scripts/fetch-review-counts.js')"`
Expected: exits 0 with no output.

- [ ] **Step 4: Commit**

```bash
git add scripts/fetch-review-counts.js package.json
git commit -m "feat: add fetch-review-counts script"
```

---

## Task 5: New HTML structure

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Rewrite `public/index.html` with new section structure**

Replace the entire contents of `public/index.html` with:

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
    <section id="review-counts" class="page-section">
      <div class="section-header">
        <h2>Reviews completed in 2026</h2>
        <span class="freshness" id="review-counts-freshness"></span>
      </div>
      <div id="review-counts-error" class="error" style="display:none;"></div>
      <div class="bar-charts">
        <div class="bar-chart" id="chart-week">
          <h3 class="bar-chart-title"></h3>
          <ul class="bar-list"></ul>
        </div>
        <div class="bar-chart" id="chart-month">
          <h3 class="bar-chart-title"></h3>
          <ul class="bar-list"></ul>
        </div>
        <div class="bar-chart" id="chart-year">
          <h3 class="bar-chart-title"></h3>
          <ul class="bar-list"></ul>
        </div>
      </div>
    </section>

    <section id="pending-reviews" class="page-section">
      <div class="section-header">
        <h2>Pending reviews</h2>
        <span class="freshness" id="pending-freshness"></span>
      </div>
      <div id="loading" class="loading">Loading reviews...</div>
      <div id="error" class="error" style="display:none;"></div>
      <div id="card-grid" class="card-grid"></div>
    </section>
  </main>
  <footer>
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

Key changes:
- New `<section id="review-counts">` placed FIRST (top of page).
- Existing pending-reviews content wrapped in `<section id="pending-reviews">` with its own header.
- Footer no longer contains `#last-refreshed` — that moves into each section's header as a freshness label.

- [ ] **Step 2: Commit**

```bash
git add public/index.html
git commit -m "feat: add review-counts section to index.html"
```

---

## Task 6: CSS styles for section headers, freshness labels, and bar charts

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Append styles for new section structure**

Append to `public/style.css` (end of file):

```css
.page-section {
  margin-bottom: 32px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #2a2a3e;
}

.section-header h2 {
  font-size: 1.1rem;
  font-weight: 600;
  color: #ffffff;
}

.freshness {
  font-size: 0.75rem;
  color: #888;
}

.bar-charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}

.bar-chart {
  background: #1a1a2e;
  border-radius: 12px;
  padding: 16px;
  border: 1px solid #2a2a3e;
}

.bar-chart-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #ffffff;
  margin-bottom: 12px;
}

.bar-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bar-row {
  display: grid;
  grid-template-columns: 80px 1fr 32px;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
}

.bar-name {
  color: #e0e0e0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bar-track {
  background: #0f0f1a;
  border-radius: 4px;
  height: 16px;
  overflow: hidden;
}

.bar-fill {
  background: #7c6ff7;
  height: 100%;
  border-radius: 4px;
  transition: width 0.2s ease;
}

.bar-count {
  color: #a5b4fc;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/style.css
git commit -m "feat: add styles for review-counts section and bar charts"
```

---

## Task 7: App.js — render review counts and wire freshness labels

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Rewrite `public/app.js` to render both sections**

Replace the entire contents of `public/app.js` with:

```js
(function () {
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  let teamMembers = [];
  let thresholds = { greenMaxHours: 12, yellowMaxHours: 24 };
  let lastData = null;
  let lastReviewCounts = null;

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
        if (lastData) renderCards(lastData);
        if (lastReviewCounts) renderReviewCounts(lastReviewCounts);
      });

      container.appendChild(btn);
    }
  }

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
        reviews.length === 0 ? "" : `${reviews.length} pending`;

      header.appendChild(nameSpan);
      header.appendChild(countSpan);
      card.appendChild(header);

      if (reviews.length === 0) {
        const noReviews = document.createElement("div");
        noReviews.className = "no-reviews";
        noReviews.textContent = "No pending reviews";
        card.appendChild(noReviews);
      } else {
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

  function formatShortDate(iso) {
    const d = new Date(iso);
    const month = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()];
    return `${month} ${d.getUTCDate()}`;
  }

  function renderBarChart(chartId, title, getCount) {
    const chart = document.getElementById(chartId);
    chart.querySelector(".bar-chart-title").textContent = title;
    const list = chart.querySelector(".bar-list");
    list.innerHTML = "";

    const visibleMembers = teamMembers.filter(isMemberVisible);
    const rows = visibleMembers.map((m) => ({
      name: m.name,
      count: getCount(m.github) || 0,
    }));

    rows.sort((a, b) => b.count - a.count);

    const max = rows.reduce((m, r) => Math.max(m, r.count), 0);

    for (const row of rows) {
      const li = document.createElement("li");
      li.className = "bar-row";

      const name = document.createElement("span");
      name.className = "bar-name";
      name.textContent = row.name;

      const track = document.createElement("span");
      track.className = "bar-track";
      const fill = document.createElement("span");
      fill.className = "bar-fill";
      fill.style.width = max > 0 ? `${(100 * row.count) / max}%` : "0%";
      track.appendChild(fill);

      const count = document.createElement("span");
      count.className = "bar-count";
      count.textContent = String(row.count);

      li.appendChild(name);
      li.appendChild(track);
      li.appendChild(count);
      list.appendChild(li);
    }
  }

  function renderReviewCounts(data) {
    lastReviewCounts = data;

    const counts = data.counts || {};
    const windows = data.windows || {};
    const weekLabel = windows.weekStart
      ? `This Week (${formatShortDate(windows.weekStart)} – today)`
      : "This Week";
    const monthLabel = windows.monthStart
      ? `This Month (${MONTH_NAMES[new Date(windows.monthStart).getUTCMonth()]})`
      : "This Month";
    const yearLabel = "2026 YTD";

    renderBarChart("chart-week", weekLabel, (gh) => (counts[gh] && counts[gh].week) || 0);
    renderBarChart("chart-month", monthLabel, (gh) => (counts[gh] && counts[gh].month) || 0);
    renderBarChart("chart-year", yearLabel, (gh) => (counts[gh] && counts[gh].year) || 0);

    const freshness = document.getElementById("review-counts-freshness");
    if (data.computedAt) {
      const ts = new Date(data.computedAt).toUTCString();
      freshness.textContent = `Updated daily · last updated ${ts}`;
    } else {
      freshness.textContent = "Updated daily";
    }
  }

  function updatePendingFreshness(fetchedAt) {
    const el = document.getElementById("pending-freshness");
    const time = new Date(fetchedAt).toLocaleTimeString();
    el.textContent = `Updated every 5 minutes · last refreshed ${time}`;
  }

  async function fetchAndRenderPending() {
    const loading = document.getElementById("loading");
    const errorEl = document.getElementById("error");

    try {
      const response = await fetch("data.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      teamMembers = data.teamMembers;
      thresholds = data.thresholds;

      loading.style.display = "none";
      errorEl.style.display = "none";

      renderToggles();
      renderCards(data);
      updatePendingFreshness(data.fetchedAt);

      // If review counts are already loaded, re-render so they use
      // the authoritative teamMembers list from data.json.
      if (lastReviewCounts) renderReviewCounts(lastReviewCounts);
    } catch (err) {
      loading.style.display = "none";
      errorEl.style.display = "block";
      errorEl.textContent = `Failed to load reviews: ${err.message}`;
    }
  }

  async function fetchAndRenderReviewCounts() {
    const errorEl = document.getElementById("review-counts-error");
    try {
      const response = await fetch("review-counts.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      errorEl.style.display = "none";
      // teamMembers may not be set yet if this resolves before data.json;
      // renderReviewCounts will be re-invoked from fetchAndRenderPending.
      if (teamMembers.length > 0) renderReviewCounts(data);
      else lastReviewCounts = data;
    } catch (err) {
      errorEl.style.display = "block";
      errorEl.textContent = `Failed to load review counts: ${err.message}`;
    }
  }

  // Initial fetches (run in parallel)
  fetchAndRenderPending();
  fetchAndRenderReviewCounts();

  // Auto-refresh pending reviews every 5 minutes.
  // Review counts are regenerated daily server-side, so we don't poll them
  // more often than pending reviews — we just re-fetch on the same cadence.
  setInterval(() => {
    fetchAndRenderPending();
    fetchAndRenderReviewCounts();
  }, REFRESH_INTERVAL_MS);
})();
```

- [ ] **Step 2: Generate a stub `review-counts.json` for local smoke testing ONLY (do NOT commit this file in this task)**

Create `public/review-counts.json` locally as a temporary smoke-test fixture. This file is deliberately NOT committed in this task — Task 10 replaces it with real data from the live GitHub API before committing.

```json
{
  "counts": {
    "rootulp": { "week": 3, "month": 12, "year": 89 },
    "ninabarbakadze": { "week": 5, "month": 18, "year": 102 },
    "rach-id": { "week": 2, "month": 9, "year": 54 },
    "mcrakhman": { "week": 1, "month": 7, "year": 41 },
    "vgonkivs": { "week": 4, "month": 14, "year": 76 },
    "evan-forbes": { "week": 0, "month": 5, "year": 33 },
    "cmwaters": { "week": 2, "month": 11, "year": 67 },
    "walldiss": { "week": 0, "month": 2, "year": 12 },
    "Wondertan": { "week": 0, "month": 3, "year": 15 }
  },
  "computedAt": "2026-04-15T00:05:00.000Z",
  "windows": {
    "weekStart": "2026-04-13T00:00:00.000Z",
    "monthStart": "2026-04-01T00:00:00.000Z",
    "yearStart": "2026-01-01T00:00:00.000Z"
  }
}
```

- [ ] **Step 3: Smoke-test in browser**

Run in one terminal: `npm run dev` (serves `public/` on http://localhost:3000).

In a browser open http://localhost:3000 and verify:
- Top of page shows three bar charts side-by-side (or stacked on narrow screens) labeled "This Week (Apr 13 – today)", "This Month (April)", "2026 YTD".
- Each chart shows teammate names left, horizontal bars centered, counts right.
- Rows sort descending by count per chart.
- Teammates with zero counts still appear (0-width bar, `0` label).
- Clicking a header toggle button hides the teammate from BOTH the bar charts AND the pending-reviews cards.
- Section headers show freshness labels; pending-reviews label shows "Updated every 5 minutes · last refreshed HH:MM:SS".

Stop the dev server with Ctrl-C.

- [ ] **Step 4: Commit `app.js` only (leave `review-counts.json` uncommitted — Task 10 handles it)**

```bash
git add public/app.js
git commit -m "feat: render review-counts bar charts and wire freshness labels"
```

Verify the stub `public/review-counts.json` is still present but untracked:

```bash
git status
```

Expected: `public/review-counts.json` appears under "Untracked files". Do NOT `git add` it yet.

---

## Task 8: Daily workflow to regenerate review counts

**Files:**
- Create: `.github/workflows/fetch-review-counts.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/fetch-review-counts.yml`:

```yaml
name: Fetch Review Counts (daily)

on:
  schedule:
    - cron: "0 0 * * *"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: fetch-review-counts
  cancel-in-progress: false

jobs:
  fetch-and-commit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - uses: actions/setup-node@v6
        with:
          node-version: "20"
          cache: "npm"

      - run: npm ci

      - name: Fetch review counts
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/fetch-review-counts.js

      - name: Commit updated review-counts.json if changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          if git diff --quiet public/review-counts.json; then
            echo "No changes to review-counts.json — skipping commit."
            exit 0
          fi
          git add public/review-counts.json
          git commit -m "chore: update review counts (daily)"
          git push
```

Notes for the reviewer / executor:
- Pushing to `main` triggers the existing `deploy.yml` via its `push: branches: [main]` trigger, which redeploys GitHub Pages. No cross-workflow dispatch needed.
- If the `concurrency` group is removed later, runs may overlap if one takes longer than 24h — unlikely but worth knowing.
- The `token` on `actions/checkout` isn't strictly required (defaults to `GITHUB_TOKEN` with the permissions set on the job), but being explicit makes the intent clear.

- [ ] **Step 2: Validate YAML syntax locally**

Run: `node -e "const yaml=require('fs').readFileSync('.github/workflows/fetch-review-counts.yml','utf8'); console.log('bytes:', yaml.length); if(!yaml.includes('cron:')) throw new Error('missing cron')"`
Expected: prints a byte count and exits 0.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/fetch-review-counts.yml
git commit -m "ci: add daily workflow to regenerate review counts"
```

---

## Task 9: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a Features bullet and a Deployment note**

Edit `README.md`. In the `## Features` section (currently ends at line 14), add a new bullet after the existing ones:

```markdown
- **Reviews completed in 2026** section at the top of the page with per-teammate bar charts for this week, this month, and YTD
```

In the `## Deployment` section, append this paragraph after the existing content:

```markdown
A second workflow ([`.github/workflows/fetch-review-counts.yml`](./.github/workflows/fetch-review-counts.yml)) runs daily at 00:00 UTC to regenerate `public/review-counts.json` (committed to the repo). The regeneration commit triggers the deploy workflow's `push` trigger so the updated file goes live without further coordination.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document review-counts section and daily workflow"
```

---

## Task 10: Generate real data, full-suite verification, commit real `review-counts.json`

**Files:**
- Modify (generate): `public/review-counts.json`

- [ ] **Step 1: Run the complete test suite**

Run: `npm test`
Expected: PASS, all `github.test.js` and `github-reviews.test.js` tests green.

- [ ] **Step 2: Delete the stub `public/review-counts.json` and regenerate from the live GitHub API**

```bash
rm -f public/review-counts.json
```

Make sure a `.env` file exists with `GITHUB_TOKEN=...` (per README §2). Then:

```bash
npm run fetch-review-counts
```

Expected: the script runs for ~30-120 seconds (queries 9 teammates × 13 repos = 117 search calls, plus any pagination) and prints `Wrote <path>/public/review-counts.json`.

If the script fails with a GraphQL rate-limit error, wait and retry. If it hits the pagination warning for a single teammate/repo, the counts may be undercounts — document the warning but continue; this is rare for search queries and can be addressed later if it becomes a real problem.

- [ ] **Step 3: Sanity-check the generated file**

Run: `node -e "const d=require('./public/review-counts.json'); console.log(Object.keys(d.counts).length, 'teammates'); console.log('sample:', Object.entries(d.counts).slice(0,3))"`

Expected: prints `9 teammates` and a sample of realistic counts.

- [ ] **Step 4: Verify file inventory matches plan**

Run: `ls github-reviews.js github-reviews.test.js scripts/fetch-review-counts.js public/review-counts.json .github/workflows/fetch-review-counts.yml`
Expected: all five paths exist.

- [ ] **Step 5: Verify `.gitignore` is unchanged**

Run: `git diff .gitignore`
Expected: no diff (the file already contains only `node_modules/`, `.env`, `.superpowers/`, `.claude/`, `public/data.json`).

- [ ] **Step 6: Commit the real `review-counts.json`**

```bash
git add public/review-counts.json
git commit -m "feat: seed initial review-counts.json from live API"
```

- [ ] **Step 7: Verify clean working tree**

Run: `git status`
Expected: working tree clean, no untracked or modified files.
