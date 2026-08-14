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
