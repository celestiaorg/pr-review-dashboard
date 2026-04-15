const { fetchOpenPRs, getPendingReviews } = require("./github");

// Mock global fetch
global.fetch = jest.fn();

const MOCK_TOKEN = "ghp_test123";

beforeEach(() => {
  fetch.mockClear();
});

describe("fetchOpenPRs", () => {
  test("returns non-draft PRs with requested reviewers", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          number: 1,
          title: "Fix sync",
          html_url: "https://github.com/celestiaorg/celestia-app/pull/1",
          draft: false,
          user: { login: "cmwaters" },
          requested_reviewers: [{ login: "rootulp" }],
        },
        {
          number: 2,
          title: "Draft PR",
          html_url: "https://github.com/celestiaorg/celestia-app/pull/2",
          draft: true,
          user: { login: "cmwaters" },
          requested_reviewers: [{ login: "rootulp" }],
        },
        {
          number: 3,
          title: "No team reviewers",
          html_url: "https://github.com/celestiaorg/celestia-app/pull/3",
          draft: false,
          user: { login: "outsider" },
          requested_reviewers: [{ login: "some-external-dev" }],
        },
      ],
    });

    const teamHandles = new Set(["rootulp", "ninabarbakadze"]);
    const result = await fetchOpenPRs(
      "celestiaorg",
      "celestia-app",
      teamHandles,
      MOCK_TOKEN
    );

    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(1);
    expect(result[0].requestedTeamReviewers).toEqual(["rootulp"]);
  });
});

const { getReviewRequestedTime } = require("./github");

describe("getReviewRequestedTime", () => {
  test("returns the most recent review_requested event time for a reviewer", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          event: "review_requested",
          requested_reviewer: { login: "rootulp" },
          created_at: "2026-04-10T10:00:00Z",
        },
        {
          event: "reviewed",
          user: { login: "rootulp" },
          submitted_at: "2026-04-10T14:00:00Z",
        },
        {
          event: "review_requested",
          requested_reviewer: { login: "rootulp" },
          created_at: "2026-04-11T09:00:00Z",
        },
      ],
    });

    const result = await getReviewRequestedTime(
      "celestiaorg",
      "celestia-app",
      42,
      "rootulp",
      MOCK_TOKEN
    );

    expect(result).toBe("2026-04-11T09:00:00Z");
  });

  test("returns null when no review_requested event found", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { event: "labeled", created_at: "2026-04-10T10:00:00Z" },
      ],
    });

    const result = await getReviewRequestedTime(
      "celestiaorg",
      "celestia-app",
      42,
      "rootulp",
      MOCK_TOKEN
    );

    expect(result).toBeNull();
  });
});

describe("getPendingReviews", () => {
  test("returns pending reviews grouped by reviewer", async () => {
    fetch
      // celestia-app pulls
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            number: 10,
            title: "Add feature",
            html_url: "https://github.com/celestiaorg/celestia-app/pull/10",
            draft: false,
            user: { login: "cmwaters" },
            requested_reviewers: [{ login: "rootulp" }],
          },
        ],
      })
      // timeline for PR 10
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            event: "review_requested",
            requested_reviewer: { login: "rootulp" },
            created_at: "2026-04-13T08:00:00Z",
          },
        ],
      });

    const config = {
      org: "celestiaorg",
      repos: ["celestia-app"],
      teamMembers: [
        { name: "Rootul", github: "rootulp", defaultHidden: false },
        { name: "Nina", github: "ninabarbakadze", defaultHidden: false },
      ],
    };

    const result = await getPendingReviews(config, MOCK_TOKEN);

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
});
