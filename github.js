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

async function getReviewRequestedTime(org, repo, prNumber, reviewer, token) {
  const events = await githubFetch(
    `https://api.github.com/repos/${org}/${repo}/issues/${prNumber}/timeline?per_page=100`,
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

async function getPendingReviews(config, token) {
  const { org, repos, teamMembers } = config;
  const teamHandles = new Set(teamMembers.map((m) => m.github));

  const result = {};
  for (const member of teamMembers) {
    result[member.github] = [];
  }

  const repoResults = await Promise.all(
    repos.map((repo) =>
      fetchOpenPRs(org, repo, teamHandles, token).catch((err) => {
        console.warn(`Failed to fetch PRs for ${repo}: ${err.message}`);
        return [];
      })
    )
  );

  const allPRs = repoResults.flat();

  const reviewPromises = [];
  for (const pr of allPRs) {
    for (const reviewer of pr.requestedTeamReviewers) {
      reviewPromises.push(
        getReviewRequestedTime(org, pr.repo, pr.number, reviewer, token)
          .then((requestedAt) => ({
            number: pr.number,
            title: pr.title,
            url: pr.url,
            repo: pr.repo,
            author: pr.author,
            reviewer,
            requestedAt,
          }))
          .catch((err) => {
            console.warn(
              `Failed to get timeline for ${pr.repo}#${pr.number}: ${err.message}`
            );
            return null;
          })
      );
    }
  }

  const reviews = (await Promise.all(reviewPromises)).filter(Boolean);

  for (const review of reviews) {
    if (review.requestedAt && result[review.reviewer]) {
      result[review.reviewer].push(review);
    }
  }

  return result;
}

module.exports = {
  fetchOpenPRs,
  getReviewRequestedTime,
  getPendingReviews,
};
