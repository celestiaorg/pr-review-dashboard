const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

const PENDING_REVIEWS_QUERY = `
  query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      pullRequests(states: OPEN, first: 100) {
        nodes {
          number
          title
          url
          isDraft
          author { login }
          reviewRequests(first: 20) {
            nodes {
              requestedReviewer {
                ... on User { login }
              }
            }
          }
          timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], first: 100) {
            nodes {
              ... on ReviewRequestedEvent {
                createdAt
                requestedReviewer {
                  ... on User { login }
                }
              }
            }
          }
        }
      }
    }
  }
`;

async function fetchRepoPRs(org, repo, token) {
  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: PENDING_REVIEWS_QUERY,
      variables: { owner: org, name: repo },
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub GraphQL error: ${response.status}`);
  }
  const payload = await response.json();
  if (payload.errors) {
    throw new Error(
      `GitHub GraphQL error: ${JSON.stringify(payload.errors)}`
    );
  }
  return payload.data.repository.pullRequests.nodes;
}

function mostRecentRequestedAt(timelineNodes, reviewer) {
  const times = timelineNodes
    .filter(
      (n) => n.requestedReviewer && n.requestedReviewer.login === reviewer
    )
    .map((n) => n.createdAt)
    .sort();
  return times.length ? times[times.length - 1] : null;
}

async function getPendingReviews(config, token) {
  const { org, repos, teamMembers } = config;
  const teamHandles = new Set(teamMembers.map((m) => m.github));

  const result = {};
  for (const member of teamMembers) {
    result[member.github] = [];
  }

  const repoResults = await Promise.all(
    repos.map((repo) =>
      fetchRepoPRs(org, repo, token)
        .then((nodes) => ({ repo, nodes }))
        .catch((err) => {
          console.warn(
            `Failed to fetch reviews for ${repo}: ${err.message}`
          );
          return { repo, nodes: [] };
        })
    )
  );

  for (const { repo, nodes } of repoResults) {
    for (const pr of nodes) {
      if (pr.isDraft) continue;
      const requestedReviewers = (pr.reviewRequests.nodes || [])
        .map((r) => r.requestedReviewer && r.requestedReviewer.login)
        .filter((login) => login && teamHandles.has(login));
      for (const reviewer of requestedReviewers) {
        const requestedAt = mostRecentRequestedAt(
          pr.timelineItems.nodes || [],
          reviewer
        );
        if (requestedAt && result[reviewer]) {
          result[reviewer].push({
            number: pr.number,
            title: pr.title,
            url: pr.url,
            repo,
            author: pr.author ? pr.author.login : null,
            reviewer,
            requestedAt,
          });
        }
      }
    }
  }

  return result;
}

module.exports = {
  getPendingReviews,
};
