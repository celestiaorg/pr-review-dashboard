# PR Review Dashboard

A live dashboard that shows each protocol team member's pending PR review queue, with color-coded wait times. Designed to be displayed during team stand-ups.

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

3. Start the server:

   ```bash
   npm start
   ```

4. Open http://localhost:3000 in your browser.

## Configuration

Team members, repos, and color thresholds are defined in [`config.js`](./config.js). Edit that file to add/remove members or repos, or adjust the color thresholds.

To change the default-hidden members, set `defaultHidden: true` on their entry. Users can override visibility via toggle buttons in the UI (state is persisted in `localStorage`).

To run on a different port:

```bash
PORT=8080 npm start
```

## Testing

```bash
npx jest
```
