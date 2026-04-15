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
