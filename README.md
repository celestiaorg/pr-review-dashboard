# PR Review Dashboard

A live dashboard that shows each protocol team member's pending PR review queue, with color-coded wait times. Designed to be displayed during team stand-ups.

**Live site:** https://celestiaorg.github.io/pr-review-dashboard/

## Features

- Card grid showing each team member's pending reviews
- Wait times color-coded: green (≤12h), yellow (12-24h), red (>24h)
- Toggle buttons to show/hide members (e.g., when they're on another project), listed alphabetically
- Each queue is ordered by PR author — coworkers (org members and repo collaborators) first, then bots like dependabot, then external contributors — and by longest wait within each group
- Cards with more than 4 pending reviews collapse to the first 3 with a "+N more" expander
- Auto-refreshes every 5 minutes
- Only shows open, non-draft PRs in [protocol repos](https://github.com/celestiaorg/protocol?tab=readme-ov-file#repos)
- **Reviews completed** section at the top of the page with per-teammate bar charts for this week, this month, and YTD

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

The dashboard is deployed to GitHub Pages via [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml):

- Runs every 5 minutes on a cron (plus on every push to `main` and on manual dispatch).
- Fetches PR data using `REVIEW_DASHBOARD_TOKEN` if that secret is set, otherwise the default `GITHUB_TOKEN` provided to the Actions runner.
- Pushes `public/` (including the freshly-generated `data.json`) to the `gh-pages` branch.

To trigger a manual redeploy: `gh workflow run deploy.yml`.

### Private repos require `REVIEW_DASHBOARD_TOKEN`

The default `GITHUB_TOKEN` is scoped to this repository only, so it cannot read
private repos elsewhere in the org — `infrastructure` and `da-proxy` are both
private, and their PRs silently drop out of the dashboard when the fetch runs on
the default token.

To include them, set a `REVIEW_DASHBOARD_TOKEN` repository secret to a token
that can read those repos (a classic PAT with `repo` scope, or a fine-grained
PAT granting `Pull requests: read` and `Metadata: read` on every repo in
[`config.js`](./config.js)):

```bash
gh secret set REVIEW_DASHBOARD_TOKEN -R celestiaorg/pr-review-dashboard
```

Any repo the token cannot read is reported as a warning annotation on the
Actions run rather than failing the deploy, so the rest of the dashboard keeps
updating. Fine-grained PATs expire — if private repos vanish from the dashboard,
check the deploy run's annotations first.

A second workflow ([`.github/workflows/fetch-review-counts.yml`](./.github/workflows/fetch-review-counts.yml)) runs daily at 00:00 UTC to regenerate `public/review-counts.json` (committed to the repo). The regeneration commit triggers the deploy workflow's `push` trigger so the updated file goes live without further coordination.

### PR previews

Every pull request automatically gets a live preview. The [`pr-preview.yml`](./.github/workflows/pr-preview.yml) workflow builds the site from the PR branch and deploys it to a subdirectory on the `gh-pages` branch. A bot comment on the PR links to the preview (e.g. `https://celestiaorg.github.io/pr-review-dashboard/pr-preview/pr-42/`). The preview is cleaned up when the PR is closed or merged.

## Testing

```bash
npm test
```
