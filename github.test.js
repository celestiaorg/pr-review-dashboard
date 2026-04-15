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
