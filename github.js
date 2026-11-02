const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

const REVIEW_TIMELINE = `
  pageInfo { hasNextPage endCursor }
  nodes {
    ... on ReviewRequestedEvent {
      createdAt
      requestedReviewer { ... on User { login } }
    }
    ... on ReviewDismissedEvent {
      createdAt
      review { submittedAt state author { login } }
    }
    ... on PullRequestReview {
      submittedAt state author { login }
      commit { oid }
    }
  }
`;
const REVIEW_TIMELINE_TYPES =
  "[REVIEW_REQUESTED_EVENT, REVIEW_DISMISSED_EVENT, PULL_REQUEST_REVIEW]";

const PENDING_REVIEWS_QUERY = `
  query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      pullRequests(states: OPEN, first: 100) {
        nodes {
          number
          title
          url
          isDraft
          authorAssociation
          author { login __typename }
          headRefOid
          commits(last: 1) {
            nodes { commit { oid committedDate pushedDate } }
          }
          reviewRequests(first: 20) {
            nodes {
              requestedReviewer {
                ... on User { login }
              }
            }
          }
          timelineItems(itemTypes: ${REVIEW_TIMELINE_TYPES}, first: 100) {
            ${REVIEW_TIMELINE}
          }
        }
      }
    }
  }
`;

const REVIEW_TIMELINE_QUERY = `
  query($owner: String!, $name: String!, $number: Int!, $after: String!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        timelineItems(itemTypes: ${REVIEW_TIMELINE_TYPES}, first: 100, after: $after) {
          ${REVIEW_TIMELINE}
        }
      }
    }
  }
`;

async function graphql(token, query, variables) {
  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables,
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
  return payload.data.repository;
}

async function fetchRepoPRs(org, repo, token) {
  const repository = await graphql(token, PENDING_REVIEWS_QUERY, {
    owner: org, name: repo,
  });
  const prs = repository.pullRequests.nodes;
  for (const pr of prs) {
    if (pr.isDraft) continue;
    let pageInfo = pr.timelineItems.pageInfo;
    while (pageInfo && pageInfo.hasNextPage) {
      const page = await graphql(token, REVIEW_TIMELINE_QUERY, {
        owner: org, name: repo, number: pr.number, after: pageInfo.endCursor,
      });
      const timeline = page.pullRequest.timelineItems;
      pr.timelineItems.nodes.push(...timeline.nodes);
      pageInfo = timeline.pageInfo;
    }
  }
  return prs;
}

// A submitted review after dismissal clears the queue, as does an existing
// approval/change request newer than the dismissed review. Earlier comments
// and unsubmitted drafts cannot satisfy a new need to review.
function dismissedReviewRequests(timelineNodes) {
  const latestReviews = new Map();
  const latestDecisions = new Map();
  for (const node of timelineNodes) {
    const review = node.review || node;
    if (!review.author || !review.submittedAt ||
        !["APPROVED", "CHANGES_REQUESTED", "COMMENTED"].includes(review.state)) continue;
    const login = review.author.login;
    const submittedAt = new Date(review.submittedAt).getTime();
    const latest = latestReviews.get(login);
    if (latest === undefined || submittedAt > latest) latestReviews.set(login, submittedAt);
    if (review.state !== "COMMENTED") {
      const decision = latestDecisions.get(login);
      if (decision === undefined || submittedAt > decision) latestDecisions.set(login, submittedAt);
    }
  }
  const requests = new Map();
  for (const node of timelineNodes) {
    const review = node.review;
    if (!review || !review.author || review.state !== "DISMISSED" || !node.createdAt) continue;
    const login = review.author.login;
    if (latestReviews.get(login) >= new Date(node.createdAt).getTime() ||
        latestDecisions.get(login) > new Date(review.submittedAt).getTime()) continue;
    const previous = requests.get(login);
    if (!previous || new Date(node.createdAt) > new Date(previous)) {
      requests.set(login, node.createdAt);
    }
  }
  return requests;
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

// Compare commit identities as well as dates: a commit can be pushed after an
// approval even if it was authored/committed earlier. A later submitted review
// satisfies the re-review; pending drafts do not.
function updatedApprovalRequests(pr, timelineNodes) {
  const requests = new Map();
  const head = pr.commits?.nodes?.[0]?.commit;
  if (!head) return requests;
  const latestReviews = new Map();
  const latestDecisions = new Map();
  for (const review of timelineNodes) {
    if (!review.author || !review.submittedAt ||
        !["APPROVED", "CHANGES_REQUESTED", "COMMENTED"].includes(review.state)) continue;
    const login = review.author.login;
    const latest = latestReviews.get(login);
    if (!latest || new Date(review.submittedAt) > new Date(latest.submittedAt)) {
      latestReviews.set(login, review);
    }
    if (review.state !== "COMMENTED") {
      const decision = latestDecisions.get(login);
      if (!decision || new Date(review.submittedAt) > new Date(decision.submittedAt)) {
        latestDecisions.set(login, review);
      }
    }
  }
  for (const [login, review] of latestDecisions) {
    if (review.state !== "APPROVED") continue;
    const headOid = pr.headRefOid || head.oid;
    const reviewedOid = review.commit?.oid;
    const changedHead = headOid && reviewedOid && headOid !== reviewedOid;
    const changedAt = head.pushedDate || head.committedDate;
    if (headOid && reviewedOid && headOid === reviewedOid) continue;
    const latest = latestReviews.get(login);
    if (latest !== review && (latest.commit?.oid === headOid ||
        new Date(latest.submittedAt) >= new Date(changedAt))) continue;
    if (changedHead || new Date(changedAt) > new Date(review.submittedAt)) {
      // GitHub can omit pushedDate. Never start the wait before the approval
      // when the only available commit date is older than the reviewed commit.
      requests.set(login, new Date(changedAt) > new Date(review.submittedAt)
        ? changedAt : review.submittedAt);
    }
  }
  return requests;
}

// GraphQL types bot accounts as Bot, but the same accounts show up as a plain
// login suffixed with "[bot]" elsewhere, so check both.
function isBotAuthor(author) {
  if (!author) return false;
  return author.__typename === "Bot" || /\[bot\]$/.test(author.login || "");
}

// GitHub reports MEMBER/OWNER for members of the org that owns the repo and
// COLLABORATOR for anyone else granted push access; everyone else is outside
// the org.
const COWORKER_ASSOCIATIONS = new Set(["MEMBER", "OWNER", "COLLABORATOR"]);

function authorCategory(pr, teamHandles) {
  const login = pr.author ? pr.author.login : null;
  if (login && teamHandles.has(login)) return "coworker";
  if (isBotAuthor(pr.author)) return "bot";
  if (COWORKER_ASSOCIATIONS.has(pr.authorAssociation)) return "coworker";
  return "external";
}

const CATEGORY_RANK = { coworker: 0, bot: 1, external: 2 };

// Coworkers' PRs first, then bots, then external contributors; within a group
// the longest-waiting review comes first.
function comparePendingReviews(a, b) {
  const byCategory =
    CATEGORY_RANK[a.authorCategory] - CATEGORY_RANK[b.authorCategory];
  if (byCategory !== 0) return byCategory;
  return new Date(a.requestedAt) - new Date(b.requestedAt);
}

// A repo the token cannot see — a private repo when the workflow runs on the
// default repo-scoped GITHUB_TOKEN — fails the same way a transient error does:
// its PRs just go missing. Emit an Actions annotation so the run summary shows
// it instead of burying it in the step log.
function warnRepoFetchFailed(repo, message) {
  const text = `Failed to fetch reviews for ${repo}: ${message}`;
  console.warn(process.env.GITHUB_ACTIONS ? `::warning::${text}` : text);
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
          warnRepoFetchFailed(repo, err.message);
          return { repo, nodes: [] };
        })
    )
  );

  for (const { repo, nodes } of repoResults) {
    for (const pr of nodes) {
      if (pr.isDraft) continue;
      const timelineNodes = pr.timelineItems.nodes || [];
      const dismissedRequests = dismissedReviewRequests(timelineNodes);
      const updatedRequests = updatedApprovalRequests(pr, timelineNodes);
      const requestedReviewers = new Set((pr.reviewRequests.nodes || [])
        .map((r) => r.requestedReviewer && r.requestedReviewer.login)
        .filter(Boolean));
      for (const reviewer of dismissedRequests.keys()) requestedReviewers.add(reviewer);
      for (const reviewer of updatedRequests.keys()) requestedReviewers.add(reviewer);
      for (const reviewer of requestedReviewers) {
        if (!teamHandles.has(reviewer)) continue;
        const requestedAt = [
          mostRecentRequestedAt(timelineNodes, reviewer),
          dismissedRequests.get(reviewer),
          updatedRequests.get(reviewer),
        ].filter(Boolean).sort((a, b) => new Date(a) - new Date(b)).pop();
        if (requestedAt && result[reviewer]) {
          result[reviewer].push({
            number: pr.number,
            title: pr.title,
            url: pr.url,
            repo,
            author: pr.author ? pr.author.login : null,
            authorCategory: authorCategory(pr, teamHandles),
            reviewer,
            requestedAt,
          });
        }
      }
    }
  }

  for (const reviews of Object.values(result)) {
    reviews.sort(comparePendingReviews);
  }

  return result;
}

module.exports = {
  getPendingReviews,
};
