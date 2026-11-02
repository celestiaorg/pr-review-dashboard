const { getPendingReviews } = require("./github");

global.fetch = jest.fn();

const MOCK_TOKEN = "ghp_test123";

beforeEach(() => {
  fetch.mockClear();
});

function graphqlOk(nodes) {
  return {
    ok: true,
    json: async () => ({
      data: { repository: { pullRequests: { nodes } } },
    }),
  };
}

describe("getPendingReviews (GraphQL)", () => {
  test("issues one POST per repo against the GraphQL endpoint with Bearer auth", async () => {
    fetch.mockResolvedValueOnce(
      graphqlOk([
        {
          number: 10,
          title: "Add feature",
          url: "https://github.com/celestiaorg/celestia-app/pull/10",
          isDraft: false,
          author: { login: "cmwaters" },
          reviewRequests: {
            nodes: [{ requestedReviewer: { login: "rootulp" } }],
          },
          timelineItems: {
            nodes: [
              {
                createdAt: "2026-04-13T08:00:00Z",
                requestedReviewer: { login: "rootulp" },
              },
            ],
          },
        },
      ])
    );

    const config = {
      org: "celestiaorg",
      repos: ["celestia-app"],
      teamMembers: [
        { name: "Rootul", github: "rootulp", defaultHidden: false },
        { name: "Nina", github: "ninabarbakadze", defaultHidden: false },
      ],
    };

    const result = await getPendingReviews(config, MOCK_TOKEN);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/graphql");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe(`Bearer ${MOCK_TOKEN}`);
    const body = JSON.parse(opts.body);
    expect(body.variables).toEqual({
      owner: "celestiaorg",
      name: "celestia-app",
    });
    expect(typeof body.query).toBe("string");

    expect(result.rootulp).toHaveLength(1);
    expect(result.rootulp[0]).toEqual({
      number: 10,
      title: "Add feature",
      url: "https://github.com/celestiaorg/celestia-app/pull/10",
      repo: "celestia-app",
      author: "cmwaters",
      authorCategory: "external",
      reviewer: "rootulp",
      requestedAt: "2026-04-13T08:00:00Z",
    });
    expect(result.ninabarbakadze).toEqual([]);
  });

  test("filters out draft PRs", async () => {
    fetch.mockResolvedValueOnce(
      graphqlOk([
        {
          number: 1,
          title: "Draft work",
          url: "https://github.com/celestiaorg/celestia-app/pull/1",
          isDraft: true,
          author: { login: "cmwaters" },
          reviewRequests: {
            nodes: [{ requestedReviewer: { login: "rootulp" } }],
          },
          timelineItems: {
            nodes: [
              {
                createdAt: "2026-04-13T08:00:00Z",
                requestedReviewer: { login: "rootulp" },
              },
            ],
          },
        },
      ])
    );

    const config = {
      org: "celestiaorg",
      repos: ["celestia-app"],
      teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
    };

    const result = await getPendingReviews(config, MOCK_TOKEN);
    expect(result.rootulp).toEqual([]);
  });

  test("ignores requested reviewers not on the team", async () => {
    fetch.mockResolvedValueOnce(
      graphqlOk([
        {
          number: 1,
          title: "External reviewer",
          url: "https://github.com/celestiaorg/celestia-app/pull/1",
          isDraft: false,
          author: { login: "cmwaters" },
          reviewRequests: {
            nodes: [{ requestedReviewer: { login: "external-dev" } }],
          },
          timelineItems: { nodes: [] },
        },
      ])
    );

    const config = {
      org: "celestiaorg",
      repos: ["celestia-app"],
      teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
    };

    const result = await getPendingReviews(config, MOCK_TOKEN);
    expect(result.rootulp).toEqual([]);
  });

  test("picks the most recent review_requested timestamp when re-requested", async () => {
    fetch.mockResolvedValueOnce(
      graphqlOk([
        {
          number: 1,
          title: "Re-requested",
          url: "https://github.com/celestiaorg/celestia-app/pull/1",
          isDraft: false,
          author: { login: "cmwaters" },
          reviewRequests: {
            nodes: [{ requestedReviewer: { login: "rootulp" } }],
          },
          timelineItems: {
            nodes: [
              {
                createdAt: "2026-04-10T10:00:00Z",
                requestedReviewer: { login: "rootulp" },
              },
              {
                createdAt: "2026-04-11T09:00:00Z",
                requestedReviewer: { login: "rootulp" },
              },
            ],
          },
        },
      ])
    );

    const config = {
      org: "celestiaorg",
      repos: ["celestia-app"],
      teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
    };

    const result = await getPendingReviews(config, MOCK_TOKEN);
    expect(result.rootulp).toHaveLength(1);
    expect(result.rootulp[0].requestedAt).toBe("2026-04-11T09:00:00Z");
  });

  test("tolerates per-repo failures and still returns successful repos", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: "server error" }),
      })
      .mockResolvedValueOnce(
        graphqlOk([
          {
            number: 2,
            title: "OK",
            url: "https://github.com/celestiaorg/celestia-core/pull/2",
            isDraft: false,
            author: { login: "cmwaters" },
            reviewRequests: {
              nodes: [{ requestedReviewer: { login: "rootulp" } }],
            },
            timelineItems: {
              nodes: [
                {
                  createdAt: "2026-04-13T08:00:00Z",
                  requestedReviewer: { login: "rootulp" },
                },
              ],
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
      const result = await getPendingReviews(config, MOCK_TOKEN);
      expect(result.rootulp).toHaveLength(1);
      expect(result.rootulp[0].number).toBe(2);
      expect(result.rootulp[0].repo).toBe("celestia-core");
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("annotates an unreachable repo when running in GitHub Actions", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { repository: null },
        errors: [
          {
            type: "NOT_FOUND",
            message:
              "Could not resolve to a Repository with the name 'celestiaorg/infrastructure'.",
          },
        ],
      }),
    });

    const config = {
      org: "celestiaorg",
      repos: ["infrastructure"],
      teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
    };

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const previous = process.env.GITHUB_ACTIONS;
    process.env.GITHUB_ACTIONS = "true";
    try {
      await getPendingReviews(config, MOCK_TOKEN);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const message = warnSpy.mock.calls[0][0];
      expect(message).toMatch(/^::warning::/);
      expect(message).toContain("infrastructure");
    } finally {
      if (previous === undefined) delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS = previous;
      warnSpy.mockRestore();
    }
  });

  test("logs a plain warning for an unreachable repo outside GitHub Actions", async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ message: "server error" }),
    });

    const config = {
      org: "celestiaorg",
      repos: ["infrastructure"],
      teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
    };

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const previous = process.env.GITHUB_ACTIONS;
    delete process.env.GITHUB_ACTIONS;
    try {
      await getPendingReviews(config, MOCK_TOKEN);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).not.toMatch(/^::warning::/);
      expect(warnSpy.mock.calls[0][0]).toContain("infrastructure");
    } finally {
      if (previous !== undefined) process.env.GITHUB_ACTIONS = previous;
      warnSpy.mockRestore();
    }
  });
});

describe("dismissed reviews", () => {
  const config = {
    org: "celestiaorg",
    repos: ["celestia-app"],
    teamMembers: [
      { name: "Rootul", github: "rootulp" },
      { name: "Nina", github: "ninabarbakadze" },
    ],
  };
  const dismissedAt = "2026-04-13T10:00:00Z";
  const original = {
    id: "review-1", author: { login: "rootulp" },
    submittedAt: "2026-04-12T08:00:00Z", state: "DISMISSED",
  };
  const dismissal = { createdAt: dismissedAt, review: original };
  function pr(nodes = [original, dismissal], requested = [], extra = {}) {
    return {
      number: 10, title: "Needs another look", url: "https://example.com/10",
      isDraft: false, author: { login: "cmwaters" }, authorAssociation: "MEMBER",
      reviewRequests: { nodes: requested.map((login) => ({ requestedReviewer: { login } })) },
      timelineItems: { nodes },
      ...extra,
    };
  }

  test("restores a dismissed review without an explicit request, timed from dismissal", async () => {
    fetch.mockResolvedValueOnce(graphqlOk([pr()]));
    const result = await getPendingReviews(config, MOCK_TOKEN);
    expect(result.rootulp).toEqual([expect.objectContaining({
      number: 10, requestedAt: dismissedAt, reviewer: "rootulp", authorCategory: "coworker",
    })]);
    expect(result.ninabarbakadze).toEqual([]);
    const query = JSON.parse(fetch.mock.calls[0][1].body).query;
    expect(query).toContain("REVIEW_DISMISSED_EVENT");
    expect(query).toContain("PULL_REQUEST_REVIEW");
  });

  test.each(["APPROVED", "CHANGES_REQUESTED", "COMMENTED"])(
    "a replacement %s review clears the dismissal", async (state) => {
      fetch.mockResolvedValueOnce(graphqlOk([pr([
        original, dismissal,
        { id: "review-2", author: original.author, submittedAt: "2026-04-13T11:00:00Z", state },
      ])]));
      expect((await getPendingReviews(config, MOCK_TOKEN)).rootulp).toEqual([]);
    }
  );

  test("dismissing an older review does not undo a newer approval", async () => {
    fetch.mockResolvedValueOnce(graphqlOk([pr([
      original,
      { id: "review-2", author: original.author, submittedAt: "2026-04-13T09:00:00Z", state: "APPROVED" },
      dismissal,
    ])]));
    expect((await getPendingReviews(config, MOCK_TOKEN)).rootulp).toEqual([]);
  });

  test("a comment before dismissal does not satisfy the new need to review", async () => {
    fetch.mockResolvedValueOnce(graphqlOk([pr([
      original,
      { id: "comment", author: original.author, submittedAt: "2026-04-13T09:00:00Z", state: "COMMENTED" },
      dismissal,
    ])]));
    expect((await getPendingReviews(config, MOCK_TOKEN)).rootulp[0].requestedAt).toBe(dismissedAt);
  });

  test("an unsubmitted review or another person's review does not clear the dismissal", async () => {
    fetch.mockResolvedValueOnce(graphqlOk([pr([
      original, dismissal,
      { id: "draft", author: original.author, submittedAt: null, state: "PENDING" },
      { id: "other", author: { login: "ninabarbakadze" }, submittedAt: "2026-04-13T11:00:00Z", state: "APPROVED" },
    ])]));
    expect((await getPendingReviews(config, MOCK_TOKEN)).rootulp).toHaveLength(1);
  });

  test.each(["2026-04-13T09:00:00Z", "2026-04-13T11:00:00Z"])(
    "deduplicates an explicit request at %s and uses the latest wait start", async (createdAt) => {
      fetch.mockResolvedValueOnce(graphqlOk([pr([
        original, dismissal, { createdAt, requestedReviewer: original.author },
      ], ["rootulp"])]));
      const result = await getPendingReviews(config, MOCK_TOKEN);
      expect(result.rootulp).toHaveLength(1);
      expect(result.rootulp[0].requestedAt).toBe(createdAt > dismissedAt ? createdAt : dismissedAt);
    }
  );

  test("a replacement review can itself be dismissed and restore the queue again", async () => {
    const replacement = { ...original, id: "review-2", submittedAt: "2026-04-13T11:00:00Z" };
    const again = "2026-04-14T10:00:00Z";
    fetch.mockResolvedValueOnce(graphqlOk([pr([
      original, dismissal, replacement, { createdAt: again, review: replacement },
    ])]));
    expect((await getPendingReviews(config, MOCK_TOKEN)).rootulp[0].requestedAt).toBe(again);
  });

  test("ignores drafts, non-team reviewers, deleted authors and deleted reviews", async () => {
    fetch.mockResolvedValueOnce(graphqlOk([
      pr(undefined, [], { isDraft: true }),
      pr([{ ...dismissal, review: { ...original, author: { login: "external" } } }]),
      pr([{ ...dismissal, review: { ...original, author: null } }]),
      pr([{ ...dismissal, review: null }]),
    ]));
    expect(await getPendingReviews(config, MOCK_TOKEN)).toEqual({ rootulp: [], ninabarbakadze: [] });
  });

  test.each([true, false])("reads later timeline pages (replacement review: %s)", async (replaced) => {
    const node = pr();
    node.timelineItems.pageInfo = { hasNextPage: true, endCursor: "next-page" };
    const later = replaced
      ? [{ id: "review-2", author: original.author, submittedAt: "2026-04-13T11:00:00Z", state: "APPROVED" }]
      : [dismissal];
    node.timelineItems.nodes = [original];
    fetch.mockResolvedValueOnce(graphqlOk([node])).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { repository: { pullRequest: {
        timelineItems: { nodes: later, pageInfo: { hasNextPage: false, endCursor: null } },
      } } } }),
    });
    const result = await getPendingReviews(config, MOCK_TOKEN);
    expect(result.rootulp).toHaveLength(replaced ? 0 : 1);
    expect(JSON.parse(fetch.mock.calls[1][1].body).variables).toEqual({
      owner: "celestiaorg", name: "celestia-app", number: 10, after: "next-page",
    });
  });
});

describe("commits after approval", () => {
  const config = {
    org: "celestiaorg", repos: ["celestia-app"],
    teamMembers: [{ name: "Rootul", github: "rootulp" }],
  };
  const approvedAt = "2026-04-13T09:00:00Z";
  const pushedAt = "2026-04-13T10:00:00Z";
  const approval = {
    author: { login: "rootulp" }, state: "APPROVED", submittedAt: approvedAt,
    commit: { oid: "original" },
  };
  function pr(reviews = [approval], extra = {}) {
    return {
      number: 10, title: "Updated PR", url: "https://example.com/10", isDraft: false,
      author: { login: "cmwaters" }, headRefOid: "new-head",
      commits: { nodes: [{ commit: { oid: "new-head", committedDate: pushedAt, pushedDate: pushedAt } }] },
      reviewRequests: { nodes: [] }, timelineItems: { nodes: reviews }, ...extra,
    };
  }

  test("restores a PR after commits follow an approval without an explicit request", async () => {
    fetch.mockResolvedValueOnce(graphqlOk([pr()]));
    expect((await getPendingReviews(config, MOCK_TOKEN)).rootulp).toEqual([
      expect.objectContaining({ number: 10, requestedAt: pushedAt }),
    ]);
    const query = JSON.parse(fetch.mock.calls[0][1].body).query;
    expect(query).toContain("headRefOid");
    expect(query).toContain("commit { oid }");
  });

  test.each(["APPROVED", "CHANGES_REQUESTED", "COMMENTED"])(
    "a later %s review clears the entry", async (state) => {
      fetch.mockResolvedValueOnce(graphqlOk([pr([
        approval, { ...approval, state, submittedAt: "2026-04-13T11:00:00Z", commit: { oid: "new-head" } },
      ])]));
      expect((await getPendingReviews(config, MOCK_TOKEN)).rootulp).toEqual([]);
    }
  );

  test("does not add an approval of the current head, even with a future commit date", async () => {
    fetch.mockResolvedValueOnce(graphqlOk([pr([{ ...approval, commit: { oid: "new-head" } }])]));
    expect((await getPendingReviews(config, MOCK_TOKEN)).rootulp).toEqual([]);
  });

  test("a comment before the new commits does not satisfy the need to review them", async () => {
    fetch.mockResolvedValueOnce(graphqlOk([pr([
      approval, { ...approval, state: "COMMENTED", submittedAt: "2026-04-13T09:30:00Z" },
    ])]));
    expect((await getPendingReviews(config, MOCK_TOKEN)).rootulp[0].requestedAt).toBe(pushedAt);
  });

  test("detects a newly pushed head even with an old commit date and no push date", async () => {
    fetch.mockResolvedValueOnce(graphqlOk([pr([approval], {
      commits: { nodes: [{ commit: { oid: "new-head", committedDate: "2026-04-12T10:00:00Z", pushedDate: null } }] },
    })]));
    expect((await getPendingReviews(config, MOCK_TOKEN)).rootulp[0].requestedAt).toBe(approvedAt);
  });

  test("ignores unsubmitted drafts, other reviewers, non-approvals and draft PRs", async () => {
    fetch.mockResolvedValueOnce(graphqlOk([
      pr([approval, { ...approval, state: "PENDING", submittedAt: null }]),
      pr([{ ...approval, author: { login: "external" } }]),
      pr([{ ...approval, state: "COMMENTED" }]),
      pr([{ ...approval, state: "CHANGES_REQUESTED" }]),
      pr([approval], { isDraft: true }),
    ]));
    expect((await getPendingReviews(config, MOCK_TOKEN)).rootulp).toHaveLength(1);
  });

  test("combines new commits, dismissal and explicit requests into one queue entry", async () => {
    const dismissed = { ...approval, state: "DISMISSED" };
    fetch.mockResolvedValueOnce(graphqlOk([pr([
      dismissed, { review: dismissed, createdAt: pushedAt },
      { requestedReviewer: approval.author, createdAt: approvedAt },
    ], { reviewRequests: { nodes: [{ requestedReviewer: approval.author }] } })]));
    const result = await getPendingReviews(config, MOCK_TOKEN);
    expect(result.rootulp).toHaveLength(1);
    expect(result.rootulp[0].requestedAt).toBe(pushedAt);
  });

  test("deduplicates a new-commit entry with an explicit request", async () => {
    fetch.mockResolvedValueOnce(graphqlOk([pr([
      approval, { requestedReviewer: approval.author, createdAt: approvedAt },
    ], { reviewRequests: { nodes: [{ requestedReviewer: approval.author }] } })]));
    const result = await getPendingReviews(config, MOCK_TOKEN);
    expect(result.rootulp).toHaveLength(1);
    expect(result.rootulp[0].requestedAt).toBe(pushedAt);
  });
});

describe("pending review ordering", () => {
  const config = {
    org: "celestiaorg",
    repos: ["celestia-app"],
    teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
  };

  // Minimal PR node: always requests a review from rootulp so every PR lands
  // in his queue, with `requestedAt` controlling the within-group order.
  function prNode({ number, author, authorAssociation, requestedAt }) {
    return {
      number,
      title: `PR ${number}`,
      url: `https://github.com/celestiaorg/celestia-app/pull/${number}`,
      isDraft: false,
      author,
      authorAssociation,
      reviewRequests: { nodes: [{ requestedReviewer: { login: "rootulp" } }] },
      timelineItems: {
        nodes: [{ createdAt: requestedAt, requestedReviewer: { login: "rootulp" } }],
      },
    };
  }

  test("labels org members, bots, and outside contributors", async () => {
    fetch.mockResolvedValueOnce(
      graphqlOk([
        prNode({
          number: 1,
          author: { login: "vgonkivs", __typename: "User" },
          authorAssociation: "MEMBER",
          requestedAt: "2026-04-13T08:00:00Z",
        }),
        prNode({
          number: 2,
          author: { login: "dependabot", __typename: "Bot" },
          authorAssociation: "CONTRIBUTOR",
          requestedAt: "2026-04-13T09:00:00Z",
        }),
        prNode({
          number: 3,
          author: { login: "drive-by", __typename: "User" },
          authorAssociation: "FIRST_TIME_CONTRIBUTOR",
          requestedAt: "2026-04-13T10:00:00Z",
        }),
        prNode({
          number: 4,
          author: { login: "contractor", __typename: "User" },
          authorAssociation: "COLLABORATOR",
          requestedAt: "2026-04-13T11:00:00Z",
        }),
      ])
    );

    const result = await getPendingReviews(config, MOCK_TOKEN);

    const byNumber = Object.fromEntries(
      result.rootulp.map((pr) => [pr.number, pr.authorCategory])
    );
    expect(byNumber).toEqual({
      1: "coworker",
      2: "bot",
      3: "external",
      4: "coworker",
    });
  });

  test("treats a `[bot]` login as a bot even when typed as a user", async () => {
    fetch.mockResolvedValueOnce(
      graphqlOk([
        prNode({
          number: 1,
          author: { login: "dependabot[bot]", __typename: "User" },
          authorAssociation: "CONTRIBUTOR",
          requestedAt: "2026-04-13T08:00:00Z",
        }),
      ])
    );

    const result = await getPendingReviews(config, MOCK_TOKEN);
    expect(result.rootulp[0].authorCategory).toBe("bot");
  });

  test("treats configured team members as coworkers regardless of association", async () => {
    fetch.mockResolvedValueOnce(
      graphqlOk([
        prNode({
          number: 1,
          author: { login: "rootulp", __typename: "User" },
          authorAssociation: "NONE",
          requestedAt: "2026-04-13T08:00:00Z",
        }),
      ])
    );

    const result = await getPendingReviews(config, MOCK_TOKEN);
    expect(result.rootulp[0].authorCategory).toBe("coworker");
  });

  test("orders coworkers, then bots, then external contributors", async () => {
    fetch.mockResolvedValueOnce(
      graphqlOk([
        prNode({
          number: 1,
          author: { login: "drive-by", __typename: "User" },
          authorAssociation: "CONTRIBUTOR",
          requestedAt: "2026-04-01T08:00:00Z",
        }),
        prNode({
          number: 2,
          author: { login: "dependabot", __typename: "Bot" },
          authorAssociation: "CONTRIBUTOR",
          requestedAt: "2026-04-02T08:00:00Z",
        }),
        prNode({
          number: 3,
          author: { login: "vgonkivs", __typename: "User" },
          authorAssociation: "MEMBER",
          requestedAt: "2026-04-03T08:00:00Z",
        }),
      ])
    );

    const result = await getPendingReviews(config, MOCK_TOKEN);
    expect(result.rootulp.map((pr) => pr.number)).toEqual([3, 2, 1]);
  });

  test("orders the longest wait first within a group", async () => {
    fetch.mockResolvedValueOnce(
      graphqlOk([
        prNode({
          number: 1,
          author: { login: "renaynay", __typename: "User" },
          authorAssociation: "MEMBER",
          requestedAt: "2026-04-03T08:00:00Z",
        }),
        prNode({
          number: 2,
          author: { login: "vgonkivs", __typename: "User" },
          authorAssociation: "MEMBER",
          requestedAt: "2026-04-01T08:00:00Z",
        }),
        prNode({
          number: 3,
          author: { login: "mcrakhman", __typename: "User" },
          authorAssociation: "MEMBER",
          requestedAt: "2026-04-02T08:00:00Z",
        }),
      ])
    );

    const result = await getPendingReviews(config, MOCK_TOKEN);
    expect(result.rootulp.map((pr) => pr.number)).toEqual([2, 3, 1]);
  });
});
