# PR Reviews Dashboard — Design Spec

## Purpose

A live dashboard displayed during team stand-ups that shows each protocol team member's pending PR review queue, with color-coded wait times to surface stale reviews.

## Team Members

| Name     | GitHub Handle     | Default Visibility |
|----------|-------------------|--------------------|
| Rootul   | rootulp           | Visible            |
| Nina     | ninabarbakadze    | Visible            |
| Rachid   | rach-id           | Visible            |
| Mikhail  | mcrakhman         | Visible            |
| Slava    | vgonkivs          | Visible            |
| Evan     | evan-forbes       | Visible            |
| Callum   | cmwaters          | Visible            |
| Vlad     | walldiss          | Hidden             |
| Hlib     | Wondertan         | Hidden             |

Members, repos, and default-hidden list are defined in a config file so they can be updated without code changes.

## Repos

All repos are under the `celestiaorg` GitHub organization:

- blobstream-contracts
- celestia-app
- celestia-core
- celestia-node
- cosmos-sdk
- da-proxy
- go-fraud
- go-header
- go-libp2p-messenger
- go-square
- lumina
- nmt
- rsmt2d

## Architecture

A single Node.js Express server with two responsibilities:

1. **API endpoint** (`GET /api/reviews`) — queries the GitHub API for pending reviews across all protocol repos, returns JSON grouped by reviewer.
2. **Static frontend** — serves a single HTML page with vanilla CSS/JS that fetches from the API and renders a card grid.

### Dependencies

- `express` — HTTP server
- `dotenv` — load `GITHUB_TOKEN` from `.env`

No frontend framework. Vanilla HTML/CSS/JS.

## Data Flow

1. Browser loads the page and calls `GET /api/reviews`.
2. Server queries the GitHub API for each repo:
   - `GET /repos/celestiaorg/{repo}/pulls?state=open` — fetch open PRs.
   - Filter out draft PRs (`draft: true`).
   - For each non-draft PR, check `requested_reviewers` for protocol team members.
   - For matching PRs, fetch the timeline (`GET /repos/celestiaorg/{repo}/issues/{number}/timeline`) to find when the review was requested.
   - Filter out PRs where the reviewer has already submitted a review after the most recent review request. (If a reviewer was re-requested after submitting a prior review, the PR should appear with the new request timestamp.)
3. Server returns JSON grouped by reviewer, each entry containing:
   - PR title, number, URL
   - Repo name
   - Author login
   - Review requested timestamp
   - Calculated wait time in hours
4. Frontend renders the card grid with color-coded wait times.
5. Page auto-refreshes every 5 minutes.

## Frontend Design

### Theme
Dark background, light text. Designed for shared-screen visibility.

### Layout
- **Header**: Dashboard title + row of toggle buttons for each team member. Vlad and Hlib are hidden by default. Clicking a toggle shows/hides that member's card. Toggle state persisted in `localStorage`.
- **Card grid**: Responsive CSS grid, one card per visible team member.
- **Footer**: "Last refreshed" timestamp.

### Card Contents
- Team member's display name (header)
- List of pending review PRs, each showing:
  - PR title (linked to GitHub)
  - Repo name and PR number
  - Author name
  - Wait time since review was requested
- If no pending reviews: "No pending reviews" message

### Wait Time Color Coding
- **Green** — 0 to 12 hours
- **Yellow** — 12 to 24 hours
- **Red** — more than 24 hours

## Configuration

### Environment Variables
- `GITHUB_TOKEN` (required) — GitHub personal access token for API access
- `PORT` (optional, default: 3000) — server port

### Config File
A `config.js` file at the project root containing:
- Team members array (name, GitHub handle, default hidden flag)
- Repos array
- GitHub org name
- Color threshold values (12h, 24h)

## File Structure

```
pr-reviews/
  config.js          # Team members, repos, thresholds
  server.js          # Express server + GitHub API logic
  public/
    index.html       # Dashboard page
    style.css        # Dark theme styles
    app.js           # Frontend fetch + render logic
  package.json
  .env               # GITHUB_TOKEN (gitignored)
  .gitignore
```
