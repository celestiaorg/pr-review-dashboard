const {
  mondayOfWeekUTC,
  firstOfMonthUTC,
  START_OF_2026,
  bucketForDate,
} = require("./github-reviews");

describe("mondayOfWeekUTC", () => {
  test("returns Monday 00:00 UTC when given a Wednesday", () => {
    const wed = new Date("2026-04-15T14:23:00Z");
    expect(mondayOfWeekUTC(wed).toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });

  test("returns same day 00:00 UTC when given a Monday", () => {
    const mon = new Date("2026-04-13T09:00:00Z");
    expect(mondayOfWeekUTC(mon).toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });

  test("returns previous Monday when given a Sunday", () => {
    const sun = new Date("2026-04-19T23:59:00Z");
    expect(mondayOfWeekUTC(sun).toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });
});

describe("firstOfMonthUTC", () => {
  test("returns 1st of month 00:00 UTC", () => {
    const d = new Date("2026-04-15T14:23:00Z");
    expect(firstOfMonthUTC(d).toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  test("handles month edge (last day)", () => {
    const d = new Date("2026-01-31T23:59:59Z");
    expect(firstOfMonthUTC(d).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("START_OF_2026", () => {
  test("is 2026-01-01T00:00:00.000Z", () => {
    expect(START_OF_2026.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("bucketForDate", () => {
  const now = new Date("2026-04-15T14:23:00Z"); // Wed

  test("pre-2026 review: no buckets", () => {
    const reviewedAt = new Date("2025-12-31T23:59:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: false, month: false, week: false,
    });
  });

  test("2026-01-01 00:00Z: year only", () => {
    const reviewedAt = new Date("2026-01-01T00:00:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: true, month: false, week: false,
    });
  });

  test("earlier this month: year + month", () => {
    const reviewedAt = new Date("2026-04-05T10:00:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: true, month: true, week: false,
    });
  });

  test("this Monday 00:00Z: year + month + week", () => {
    const reviewedAt = new Date("2026-04-13T00:00:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: true, month: true, week: true,
    });
  });

  test("last Sunday 23:59Z: year + month but not week", () => {
    const reviewedAt = new Date("2026-04-12T23:59:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: true, month: true, week: false,
    });
  });
});

const { getReviewCounts } = require("./github-reviews");

global.fetch = jest.fn();

function searchOk(nodes, pageInfo = { hasNextPage: false, endCursor: null }) {
  return {
    ok: true,
    json: async () => ({ data: { search: { nodes, pageInfo } } }),
  };
}

beforeEach(() => fetch.mockClear());

describe("getReviewCounts", () => {
  const NOW = new Date("2026-04-15T14:23:00Z"); // Wed
  const CONFIG = {
    org: "celestiaorg",
    repos: ["celestia-app"],
    teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
  };

  test("counts earliest review per PR, buckets week/month/year", async () => {
    // PR 10: Rootul's earliest review is this Monday → week+month+year.
    // PR 11: Rootul's earliest review is Feb 2026 → year only.
    fetch.mockResolvedValueOnce(
      searchOk([
        {
          number: 10,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [
              { submittedAt: "2026-04-13T09:00:00Z", state: "APPROVED" },
              { submittedAt: "2026-04-14T09:00:00Z", state: "COMMENTED" },
            ],
          },
        },
        {
          number: 11,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [{ submittedAt: "2026-02-10T09:00:00Z", state: "APPROVED" }],
          },
        },
      ])
    );

    const result = await getReviewCounts(CONFIG, "tok", NOW);

    expect(result.rootulp).toEqual({ week: 1, month: 1, year: 2 });
  });

  test("pre-2026 reviews are ignored", async () => {
    fetch.mockResolvedValueOnce(
      searchOk([
        {
          number: 1,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [{ submittedAt: "2025-12-31T23:59:00Z", state: "APPROVED" }],
          },
        },
      ])
    );

    const result = await getReviewCounts(CONFIG, "tok", NOW);
    expect(result.rootulp).toEqual({ week: 0, month: 0, year: 0 });
  });

  test("2026-01-01T00:00Z review counts in year", async () => {
    fetch.mockResolvedValueOnce(
      searchOk([
        {
          number: 1,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [{ submittedAt: "2026-01-01T00:00:00Z", state: "APPROVED" }],
          },
        },
      ])
    );

    const result = await getReviewCounts(CONFIG, "tok", NOW);
    expect(result.rootulp).toEqual({ week: 0, month: 0, year: 1 });
  });

  test("PR with multiple reviews counts once at earliest date", async () => {
    // Two reviews, earliest is Feb (year-only), latest is this week.
    // Because we use EARLIEST, this counts in year only, not week.
    fetch.mockResolvedValueOnce(
      searchOk([
        {
          number: 1,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [
              { submittedAt: "2026-04-13T09:00:00Z", state: "APPROVED" },
              { submittedAt: "2026-02-10T09:00:00Z", state: "COMMENTED" },
            ],
          },
        },
      ])
    );

    const result = await getReviewCounts(CONFIG, "tok", NOW);
    expect(result.rootulp).toEqual({ week: 0, month: 0, year: 1 });
  });

  test("PR with no reviews is ignored (defensive)", async () => {
    fetch.mockResolvedValueOnce(
      searchOk([
        {
          number: 1,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: { nodes: [] },
        },
      ])
    );

    const result = await getReviewCounts(CONFIG, "tok", NOW);
    expect(result.rootulp).toEqual({ week: 0, month: 0, year: 0 });
  });

  test("teammate with zero reviews gets zero counts", async () => {
    fetch.mockResolvedValueOnce(searchOk([]));

    const result = await getReviewCounts(CONFIG, "tok", NOW);
    expect(result.rootulp).toEqual({ week: 0, month: 0, year: 0 });
  });
});

describe("getReviewCounts — pagination and failure tolerance", () => {
  const NOW = new Date("2026-04-15T14:23:00Z");

  test("paginates when hasNextPage=true", async () => {
    fetch
      .mockResolvedValueOnce(
        searchOk(
          [
            {
              number: 1,
              repository: { nameWithOwner: "celestiaorg/celestia-app" },
              reviews: {
                nodes: [{ submittedAt: "2026-04-13T09:00:00Z", state: "APPROVED" }],
              },
            },
          ],
          { hasNextPage: true, endCursor: "cursor-1" }
        )
      )
      .mockResolvedValueOnce(
        searchOk([
          {
            number: 2,
            repository: { nameWithOwner: "celestiaorg/celestia-app" },
            reviews: {
              nodes: [{ submittedAt: "2026-04-05T09:00:00Z", state: "APPROVED" }],
            },
          },
        ])
      );

    const config = {
      org: "celestiaorg",
      repos: ["celestia-app"],
      teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
    };

    const result = await getReviewCounts(config, "tok", NOW);
    expect(fetch).toHaveBeenCalledTimes(2);
    const secondCallBody = JSON.parse(fetch.mock.calls[1][1].body);
    expect(secondCallBody.variables.after).toBe("cursor-1");
    expect(result.rootulp).toEqual({ week: 1, month: 2, year: 2 });
  });

  test("per-repo failures are logged and other repos continue", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ message: "server error" }),
      })
      .mockResolvedValueOnce(
        searchOk([
          {
            number: 2,
            repository: { nameWithOwner: "celestiaorg/celestia-core" },
            reviews: {
              nodes: [{ submittedAt: "2026-04-13T09:00:00Z", state: "APPROVED" }],
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
      const result = await getReviewCounts(config, "tok", NOW);
      expect(result.rootulp).toEqual({ week: 1, month: 1, year: 1 });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("warns and stops when pagination cap is reached", async () => {
    // Simulate 11 pages where every page reports hasNextPage=true.
    for (let i = 0; i < 11; i++) {
      fetch.mockResolvedValueOnce(
        searchOk(
          [
            {
              number: i + 1,
              repository: { nameWithOwner: "celestiaorg/celestia-app" },
              reviews: {
                nodes: [{ submittedAt: "2026-04-13T09:00:00Z", state: "APPROVED" }],
              },
            },
          ],
          { hasNextPage: true, endCursor: `c-${i}` }
        )
      );
    }

    const config = {
      org: "celestiaorg",
      repos: ["celestia-app"],
      teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
    };

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await getReviewCounts(config, "tok", NOW);
      // Exactly 10 pages fetched, 10 PRs counted.
      expect(fetch).toHaveBeenCalledTimes(10);
      expect(result.rootulp.year).toBe(10);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("pagination cap")
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
