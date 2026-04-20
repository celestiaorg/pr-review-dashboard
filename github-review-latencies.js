const {
  START_OF_2026,
  mondayOfWeekUTC,
  firstOfMonthUTC,
  bucketForDate,
} = require("./github-reviews");

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const MAX_PAGES = 10;

const REVIEW_LATENCY_SEARCH_QUERY = `
  query($q: String!, $login: String!, $after: String) {
    search(query: $q, type: ISSUE, first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          repository { nameWithOwner }
          reviews(first: 50, author: $login) {
            nodes { submittedAt state author { login } }
          }
          timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], first: 100) {
            nodes {
              ... on ReviewRequestedEvent {
                createdAt
                requestedReviewer { ... on User { login } }
              }
            }
          }
        }
      }
    }
  }
`;

function earliestRequestMsForReviewer(pr, reviewer) {
  const times = (pr.timelineItems.nodes || [])
    .filter((n) => n.requestedReviewer && n.requestedReviewer.login === reviewer)
    .map((n) => new Date(n.createdAt).getTime())
    .sort((a, b) => a - b);
  return times.length ? times[0] : null;
}

function earliestReviewMsForReviewer(pr, reviewer, notBefore) {
  const times = (pr.reviews.nodes || [])
    .filter((r) => r.author && r.author.login === reviewer)
    .map((r) => new Date(r.submittedAt).getTime())
    .filter((t) => t >= notBefore)
    .sort((a, b) => a - b);
  return times.length ? times[0] : null;
}

function firstReviewLatencyHours(pr, reviewer) {
  const requestMs = earliestRequestMsForReviewer(pr, reviewer);
  if (requestMs == null) return null;
  const reviewMs = earliestReviewMsForReviewer(pr, reviewer, requestMs);
  if (reviewMs == null) return null;
  return (reviewMs - requestMs) / 3_600_000;
}

function firstReviewSubmittedAt(pr, reviewer) {
  const requestMs = earliestRequestMsForReviewer(pr, reviewer);
  if (requestMs == null) return null;
  const reviewMs = earliestReviewMsForReviewer(pr, reviewer, requestMs);
  return reviewMs == null ? null : new Date(reviewMs);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function aggregateSamples(samples) {
  if (!samples.length) {
    return { n: 0, medianHours: null, p90Hours: null };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    medianHours: percentile(sorted, 0.5),
    p90Hours: percentile(sorted, 0.9),
  };
}

async function graphqlSearch(token, q, login, after) {
  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: REVIEW_LATENCY_SEARCH_QUERY,
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

async function collectSamplesForMemberInRepo(token, org, repo, login) {
  const q = `repo:${org}/${repo} is:pr reviewed-by:${login} created:>=2026-01-01`;
  const samples = [];
  let after = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { nodes, pageInfo } = await graphqlSearch(token, q, login, after);

    for (const pr of nodes) {
      const hours = firstReviewLatencyHours(pr, login);
      const reviewedAt = firstReviewSubmittedAt(pr, login);
      if (hours == null || reviewedAt == null) continue;
      samples.push({
        repo,
        number: pr.number,
        hours,
        reviewedAt,
      });
    }

    if (!pageInfo.hasNextPage) return samples;
    after = pageInfo.endCursor;
  }

  console.warn(
    `Hit pagination cap (${MAX_PAGES} pages) for ${login} in ${repo}; samples may be undercounted.`
  );
  return samples;
}

async function getReviewLatencies(config, token, now = new Date()) {
  const { org, repos, teamMembers } = config;

  const perMemberSamples = {};
  for (const m of teamMembers) perMemberSamples[m.github] = [];

  for (const member of teamMembers) {
    for (const repo of repos) {
      try {
        const samples = await collectSamplesForMemberInRepo(
          token, org, repo, member.github
        );
        perMemberSamples[member.github].push(...samples);
      } catch (err) {
        console.warn(
          `Failed to fetch review latencies for ${member.github} in ${repo}: ${err.message}`
        );
      }
    }
  }

  const result = {};
  for (const member of teamMembers) {
    const samples = perMemberSamples[member.github];
    const week = [];
    const month = [];
    const year = [];
    for (const s of samples) {
      const b = bucketForDate(s.reviewedAt, now);
      if (b.year) year.push(s.hours);
      if (b.month) month.push(s.hours);
      if (b.week) week.push(s.hours);
    }
    result[member.github] = {
      week: aggregateSamples(week),
      month: aggregateSamples(month),
      year: aggregateSamples(year),
    };
  }

  return result;
}

module.exports = {
  START_OF_2026,
  mondayOfWeekUTC,
  firstOfMonthUTC,
  bucketForDate,
  firstReviewLatencyHours,
  firstReviewSubmittedAt,
  percentile,
  aggregateSamples,
  getReviewLatencies,
};
