# Teammate Review Counts — Design

**Date:** 2026-04-15
**Status:** Design approved, pending spec review

## Problem

The dashboard currently shows each teammate's *pending* PR reviews (open PRs
where they've been requested). We also want to see *completed* reviews — how
many PRs each teammate has reviewed — bucketed by week, month, and year. This
helps the team see review activity and balance. Only 2026-onward data is in
scope.

## Requirements

1. A new section rendered on the same single page (no tab switching), placed at
   the **top** of the page above the existing pending-reviews card grid.
2. Three horizontal bar charts side-by-side:
   - **This Week** (ISO week: Monday 00:00 UTC through now)
   - **This Month** (calendar month in UTC: 1st 00:00 UTC through now)
   - **2026 YTD** (2026-01-01 00:00 UTC through now)
3. One bar per teammate in each chart, sorted descending by that chart's count.
4. The existing header visibility toggles apply to BOTH the new review-counts
   section and the existing cards. Hiding a teammate hides them everywhere.
5. A "reviewed PR" is counted once per teammate per PR, on the date of that
   teammate's **earliest** review (APPROVED, CHANGES_REQUESTED, or COMMENTED).
   Only reviews whose `submittedAt` is on/after 2026-01-01 00:00 UTC count.
6. Each section shows a freshness annotation:
   - Review counts: *"Updated daily · last updated <timestamp>"*
   - Pending reviews: *"Updated every 5 minutes · last refreshed <timestamp>"*
7. The new data path must not slow down the existing 5-minute deploy.

## Non-goals

- Historical week-by-week or month-by-month trend charts.
- Per-repo breakdowns.
- Counting reviews from non-team members.
- Configurable start date — 2026-01-01 UTC is a constant.
- Distinguishing between review states (APPROVED vs COMMENTED).
- Including draft-PR reviews or reviews on bot/automated PRs specially — they
  count if the teammate submitted a review.

## Architecture

Two independent data paths, writing to two files in `public/`:

```
github.js                       getPendingReviews(...)   ← existing, unchanged
github-reviews.js   (NEW)       getReviewCounts(...)

scripts/fetch-data.js           ← existing, unchanged; writes public/data.json
scripts/fetch-review-counts.js  (NEW) writes public/review-counts.json

public/data.json                ← existing (pending reviews)
public/review-counts.json       (NEW, committed to repo by daily workflow)

public/index.html               ← adds <section id="review-counts"> above cards
public/app.js                   ← fetches both files, renders both sections
public/style.css                ← bar-chart styles
```

Independence means the 5-minute deploy keeps running `fetch-data.js` only
(fast), while a new daily workflow runs `fetch-review-counts.js` and commits
its output.

## Data fetching: `github-reviews.js`

### Inputs

- `config` (existing shape: `{ org, repos, teamMembers }`).
- `token` (GitHub API token).
- `now` (injected for testability; defaults to `new Date()`).

### Algorithm

1. For each teammate and each configured repo, run a GraphQL search:

   ```graphql
   query($q: String!, $after: String) {
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
   ```

   where `q = "repo:<org>/<repo> is:pr reviewed-by:<login> created:>=2026-01-01"`.

   The `reviews(author: $login)` sub-query limits returned reviews to that
   teammate, so we only read their timestamps.

2. For each returned PR, pick the **earliest** `submittedAt` across the
   teammate's reviews on that PR (the teammate's first review).

3. If that earliest timestamp is `>= 2026-01-01T00:00:00Z`, bucket it:
   - `year`: always counted (it's a 2026 review).
   - `month`: counted if `>= firstOfMonth(now)` in UTC.
   - `week`: counted if `>= mondayOfWeek(now)` in UTC (ISO week: Monday).

4. Paginate up to 10 pages (1000 PRs) per teammate per repo. If `hasNextPage`
   is still true after page 10, log a warning and stop.

5. Per-repo-per-teammate failures are tolerated (logged via `console.warn`)
   and do not block other queries, mirroring `github.js`.

### Output shape

```js
{
  rootulp: { week: 3, month: 12, year: 89 },
  ninabarbakadze: { week: 5, month: 18, year: 102 },
  // ... one entry per teammate in config.teamMembers; zeros if no reviews
}
```

### Guard against double-counting

A PR in the `celestia-app` repo queried under Rootul is separate from a PR in
`celestia-core`, so repo-scoped searches never overlap. Within one repo, the
search returns each PR once, and we count it once. No deduplication is needed
beyond "earliest review per PR".

### Date helpers (UTC only)

- `mondayOfWeek(date)`: most-recent Monday at 00:00 UTC. (ISO week starts
  Monday.) If `date` is itself a Monday, returns that Monday at 00:00 UTC.
- `firstOfMonth(date)`: 1st of `date`'s month at 00:00 UTC.
- `startOf2026 = "2026-01-01T00:00:00.000Z"`.

## Data file: `public/review-counts.json`

```json
{
  "counts": {
    "rootulp": { "week": 3, "month": 12, "year": 89 },
    "ninabarbakadze": { "week": 5, "month": 18, "year": 102 }
  },
  "computedAt": "2026-04-15T00:05:12.000Z",
  "windows": {
    "weekStart": "2026-04-13T00:00:00.000Z",
    "monthStart": "2026-04-01T00:00:00.000Z",
    "yearStart": "2026-01-01T00:00:00.000Z"
  }
}
```

The UI uses `windows` to label each chart (e.g. "This Week (Apr 13 – today)"
and "This Month (April)").

## UI

### Layout

```
┌─────────────────────────────────────────────┐
│         PR Reviews Dashboard                │
│   [Rootul] [Nina] [Rachid] ...   ← toggles  │
├─────────────────────────────────────────────┤
│  Reviews completed in 2026                  │
│  Updated daily · last updated 00:05 UTC     │
│                                             │
│  ┌─ This Week ──┐ ┌─ This Month ─┐ ┌─ YTD ─┐│
│  │ Nina    ██ 5 │ │ Nina  ███ 18 │ │ … 102 ││
│  │ Rootul  █ 3  │ │ …            │ │       ││
│  └──────────────┘ └──────────────┘ └───────┘│
├─────────────────────────────────────────────┤
│  Pending reviews                            │
│  Updated every 5 minutes · last 14:35:02    │
│                                             │
│  [teammate card] [teammate card] [card] ... │
└─────────────────────────────────────────────┘
```

### HTML structure

```html
<main>
  <section id="review-counts" class="review-counts-section">
    <div class="section-header">
      <h2>Reviews completed in 2026</h2>
      <span class="freshness" id="review-counts-freshness"></span>
    </div>
    <div id="review-counts-error" class="error" style="display:none;"></div>
    <div class="bar-charts">
      <div class="bar-chart" id="chart-week"><h3></h3><ul></ul></div>
      <div class="bar-chart" id="chart-month"><h3></h3><ul></ul></div>
      <div class="bar-chart" id="chart-year"><h3></h3><ul></ul></div>
    </div>
  </section>

  <section id="pending-reviews">
    <div class="section-header">
      <h2>Pending reviews</h2>
      <span class="freshness" id="pending-freshness"></span>
    </div>
    <div id="loading" class="loading">Loading reviews...</div>
    <div id="error" class="error" style="display:none;"></div>
    <div id="card-grid" class="card-grid"></div>
  </section>
</main>
```

### Bar rendering

Each chart is a `<ul>` of `<li>` rows. Each row is a CSS grid of three cells:

```
[ name (fixed 80px) | bar (flex, background=#2a2a4a, width=N%) | count (28px right-aligned) ]
```

`N% = 100 * count / maxCountInThisChart` (but if max is 0, render rows with
0-width bars so the labels still show). Rows sort descending by count before
rendering.

**Zero-count teammates are still shown** in each chart — they render with a
0-width bar and `0` count. This makes it visually obvious when someone
hasn't reviewed anything in a given window. (Hidden teammates, via the header
toggle, are the only ones fully omitted.)

### Visibility toggles

`app.js` already has `isMemberVisible(member)`. Both render functions
(`renderCards(data)` and new `renderReviewCounts(countsData)`) iterate
`teamMembers` and skip hidden members. The `toggleMember` click handler
re-invokes *both* render functions.

### Freshness labels

- Pending-reviews freshness replaces the existing footer `#last-refreshed`
  text. The footer now only contains the color legend.
- Review-counts freshness reads `computedAt` from `review-counts.json` and
  shows it as `new Date(computedAt).toUTCString()` (or similar).

### Chart titles

- Week chart title: `This Week (Mon D – today)` using `windows.weekStart`.
- Month chart title: `This Month (<MonthName>)` using `windows.monthStart`.
- Year chart title: `2026 YTD`.

### Error handling

- If `review-counts.json` fails to load or is malformed, the new section shows
  a small muted error message and the pending-reviews section still renders
  normally. Vice versa for `data.json`.

## Deployment

Add `.github/workflows/fetch-review-counts.yml`:

- Schedule: `cron: "0 0 * * *"` (daily at 00:00 UTC) plus `workflow_dispatch`.
- `permissions: contents: write` (required to push the regenerated file back
  to `main`). The existing `deploy.yml` has `contents: read`, which is
  correct for it and unchanged.
- Runs `npm ci` and `npm run fetch-review-counts`.
- Commits the regenerated `public/review-counts.json` to `main` using the
  default `GITHUB_TOKEN`. Commit step skips (no-op) if the file content is
  unchanged, to avoid empty commits.
- Does NOT trigger deploy explicitly — the commit pushes to `main`, which
  triggers the existing deploy workflow's `push` trigger (verified:
  `deploy.yml` has `push: branches: [main]`).

The existing 5-minute deploy reads the committed `review-counts.json` as-is
and uploads it with the rest of `public/`. It does not regenerate the file.

`public/review-counts.json` is **committed** to the repo (unlike
`public/data.json`, which is gitignored). Verified: `.gitignore` contains
`public/data.json` but not `public/review-counts.json`, so no `.gitignore`
change is required.

### npm scripts

Add to `package.json`:

```json
"fetch-review-counts": "node scripts/fetch-review-counts.js"
```

## Testing

Unit tests for `github-reviews.js` in `github-reviews.test.js`:

1. **Bucketing boundaries:** a review at `2025-12-31T23:59:00Z` is excluded;
   `2026-01-01T00:00:00Z` is counted in year (but not month or week if `now`
   is in April).
2. **Earliest review wins:** a PR with two reviews by the same user at
   different dates counts once, at the earlier date.
3. **ISO week starts Monday:** `now = 2026-04-15 (Wed)` → `weekStart =
   2026-04-13 00:00 UTC (Mon)`. A review at `2026-04-13T00:00Z` counts in
   week; at `2026-04-12T23:59Z` does not.
4. **Per-repo failures tolerated:** one repo's search throws 500, another
   returns data → the successful repo's counts still appear.
5. **Team filter:** reviews submitted by a non-team login (possible via the
   PR's reviews list even though the search is scoped to that login — guard
   with a defensive check) are ignored.
6. **Pagination stop:** if `hasNextPage` still true after 10 pages, a warning
   is logged and function returns what was gathered.
7. **Zero state:** teammate with no reviews gets `{ week: 0, month: 0, year: 0 }`.

No UI tests (existing repo has none for `app.js`).

## Config

No new config keys. 2026 cutoff is a constant in `github-reviews.js`. Team
list, repos, and org are reused from `config.js`.

## Open questions

None. Ready for implementation plan.
