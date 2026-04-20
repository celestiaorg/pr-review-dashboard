const {
  firstReviewLatencyHours,
  percentile,
  aggregateSamples,
  firstReviewSubmittedAt,
  getReviewLatencies,
} = require("./github-review-latencies");

describe("firstReviewLatencyHours", () => {
  test("returns null when reviewer was never individually requested", () => {
    const pr = {
      reviews: {
        nodes: [
          { author: { login: "rootulp" }, submittedAt: "2026-04-13T10:00:00Z", state: "APPROVED" },
        ],
      },
      timelineItems: { nodes: [] },
    };
    expect(firstReviewLatencyHours(pr, "rootulp")).toBeNull();
  });

  test("returns null when reviewer has no reviews", () => {
    const pr = {
      reviews: { nodes: [] },
      timelineItems: {
        nodes: [
          {
            createdAt: "2026-04-13T08:00:00Z",
            requestedReviewer: { login: "rootulp" },
          },
        ],
      },
    };
    expect(firstReviewLatencyHours(pr, "rootulp")).toBeNull();
  });

  test("returns null when all reviews are before the request", () => {
    const pr = {
      reviews: {
        nodes: [
          { author: { login: "rootulp" }, submittedAt: "2026-04-13T05:00:00Z", state: "COMMENTED" },
        ],
      },
      timelineItems: {
        nodes: [
          { createdAt: "2026-04-13T08:00:00Z", requestedReviewer: { login: "rootulp" } },
        ],
      },
    };
    expect(firstReviewLatencyHours(pr, "rootulp")).toBeNull();
  });

  test("uses earliest request and earliest qualifying review", () => {
    const pr = {
      reviews: {
        nodes: [
          { author: { login: "rootulp" }, submittedAt: "2026-04-13T14:00:00Z", state: "APPROVED" },
          { author: { login: "rootulp" }, submittedAt: "2026-04-13T10:30:00Z", state: "COMMENTED" },
        ],
      },
      timelineItems: {
        nodes: [
          { createdAt: "2026-04-13T09:00:00Z", requestedReviewer: { login: "rootulp" } },
          { createdAt: "2026-04-13T12:00:00Z", requestedReviewer: { login: "rootulp" } },
        ],
      },
    };
    // Earliest request 09:00, earliest review 10:30 → 1.5h.
    expect(firstReviewLatencyHours(pr, "rootulp")).toBeCloseTo(1.5, 5);
  });

  test("accepts any review state (APPROVED, CHANGES_REQUESTED, COMMENTED)", () => {
    const base = {
      timelineItems: {
        nodes: [
          { createdAt: "2026-04-13T09:00:00Z", requestedReviewer: { login: "r" } },
        ],
      },
    };
    for (const state of ["APPROVED", "CHANGES_REQUESTED", "COMMENTED"]) {
      const pr = {
        ...base,
        reviews: {
          nodes: [
            { author: { login: "r" }, submittedAt: "2026-04-13T10:00:00Z", state },
          ],
        },
      };
      expect(firstReviewLatencyHours(pr, "r")).toBeCloseTo(1.0, 5);
    }
  });

  test("ignores other reviewers' requests and reviews", () => {
    const pr = {
      reviews: {
        nodes: [
          { author: { login: "other" }, submittedAt: "2026-04-13T10:00:00Z", state: "APPROVED" },
          { author: { login: "rootulp" }, submittedAt: "2026-04-13T12:00:00Z", state: "APPROVED" },
        ],
      },
      timelineItems: {
        nodes: [
          { createdAt: "2026-04-13T08:00:00Z", requestedReviewer: { login: "other" } },
          { createdAt: "2026-04-13T09:00:00Z", requestedReviewer: { login: "rootulp" } },
        ],
      },
    };
    expect(firstReviewLatencyHours(pr, "rootulp")).toBeCloseTo(3.0, 5);
  });
});

describe("firstReviewSubmittedAt", () => {
  test("returns null when reviewer never reviewed after request", () => {
    const pr = {
      reviews: { nodes: [] },
      timelineItems: {
        nodes: [{ createdAt: "2026-04-13T09:00:00Z", requestedReviewer: { login: "r" } }],
      },
    };
    expect(firstReviewSubmittedAt(pr, "r")).toBeNull();
  });

  test("returns earliest qualifying review timestamp as Date", () => {
    const pr = {
      reviews: {
        nodes: [
          { author: { login: "r" }, submittedAt: "2026-04-13T10:30:00Z", state: "COMMENTED" },
          { author: { login: "r" }, submittedAt: "2026-04-13T14:00:00Z", state: "APPROVED" },
        ],
      },
      timelineItems: {
        nodes: [{ createdAt: "2026-04-13T09:00:00Z", requestedReviewer: { login: "r" } }],
      },
    };
    expect(firstReviewSubmittedAt(pr, "r").toISOString()).toBe("2026-04-13T10:30:00.000Z");
  });
});

describe("percentile", () => {
  test("returns null on empty input", () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  test("returns the sole value for singleton", () => {
    expect(percentile([7], 0.5)).toBe(7);
    expect(percentile([7], 0.9)).toBe(7);
  });

  test("returns a value at the target rank for p50 / p90", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 0.5)).toBe(6); // floor(10*0.5)=5 → index 5 → 6
    expect(percentile(sorted, 0.9)).toBe(10); // floor(10*0.9)=9 → index 9 → 10
  });
});

describe("aggregateSamples", () => {
  test("returns zeros for empty samples", () => {
    expect(aggregateSamples([])).toEqual({ n: 0, medianHours: null, p90Hours: null });
  });

  test("computes n, median, p90", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(aggregateSamples(samples)).toEqual({ n: 10, medianHours: 6, p90Hours: 10 });
  });

  test("is order-independent (sorts internally)", () => {
    const samples = [10, 1, 5, 3];
    const out = aggregateSamples(samples);
    expect(out.n).toBe(4);
    expect(out.medianHours).toBe(5); // sorted [1,3,5,10], idx floor(4*0.5)=2 → 5
  });
});

global.fetch = jest.fn();

function searchOk(nodes, pageInfo = { hasNextPage: false, endCursor: null }) {
  return {
    ok: true,
    json: async () => ({ data: { search: { nodes, pageInfo } } }),
  };
}

beforeEach(() => fetch.mockClear());

describe("getReviewLatencies", () => {
  const NOW = new Date("2026-04-15T14:23:00Z"); // Wed; week starts Mon Apr 13
  const CONFIG = {
    org: "celestiaorg",
    repos: ["celestia-app"],
    teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
  };

  test("buckets a single sample into week/month/year based on review time", async () => {
    fetch.mockResolvedValueOnce(
      searchOk([
        {
          number: 10,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [
              { author: { login: "rootulp" }, submittedAt: "2026-04-13T12:00:00Z", state: "APPROVED" },
            ],
          },
          timelineItems: {
            nodes: [
              { createdAt: "2026-04-13T09:00:00Z", requestedReviewer: { login: "rootulp" } },
            ],
          },
        },
      ])
    );

    const result = await getReviewLatencies(CONFIG, "tok", NOW);

    expect(result.rootulp.week).toEqual({ n: 1, medianHours: 3, p90Hours: 3 });
    expect(result.rootulp.month).toEqual({ n: 1, medianHours: 3, p90Hours: 3 });
    expect(result.rootulp.year).toEqual({ n: 1, medianHours: 3, p90Hours: 3 });
  });

  test("sample from earlier this month counts in month+year but not week", async () => {
    fetch.mockResolvedValueOnce(
      searchOk([
        {
          number: 20,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [
              { author: { login: "rootulp" }, submittedAt: "2026-04-05T12:00:00Z", state: "APPROVED" },
            ],
          },
          timelineItems: {
            nodes: [
              { createdAt: "2026-04-05T10:00:00Z", requestedReviewer: { login: "rootulp" } },
            ],
          },
        },
      ])
    );

    const result = await getReviewLatencies(CONFIG, "tok", NOW);

    expect(result.rootulp.week.n).toBe(0);
    expect(result.rootulp.month.n).toBe(1);
    expect(result.rootulp.year.n).toBe(1);
    expect(result.rootulp.month.medianHours).toBe(2);
  });

  test("PR where reviewer was never individually requested is ignored", async () => {
    fetch.mockResolvedValueOnce(
      searchOk([
        {
          number: 30,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [
              { author: { login: "rootulp" }, submittedAt: "2026-04-13T12:00:00Z", state: "APPROVED" },
            ],
          },
          timelineItems: { nodes: [] },
        },
      ])
    );

    const result = await getReviewLatencies(CONFIG, "tok", NOW);
    expect(result.rootulp.year).toEqual({ n: 0, medianHours: null, p90Hours: null });
  });

  test("aggregates median and p90 across multiple samples in year", async () => {
    // Three PRs in 2026, all in year window, with latencies 1h, 2h, 10h.
    fetch.mockResolvedValueOnce(
      searchOk([
        {
          number: 1,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [
              { author: { login: "rootulp" }, submittedAt: "2026-02-01T10:00:00Z", state: "APPROVED" },
            ],
          },
          timelineItems: {
            nodes: [
              { createdAt: "2026-02-01T09:00:00Z", requestedReviewer: { login: "rootulp" } },
            ],
          },
        },
        {
          number: 2,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [
              { author: { login: "rootulp" }, submittedAt: "2026-02-02T11:00:00Z", state: "COMMENTED" },
            ],
          },
          timelineItems: {
            nodes: [
              { createdAt: "2026-02-02T09:00:00Z", requestedReviewer: { login: "rootulp" } },
            ],
          },
        },
        {
          number: 3,
          repository: { nameWithOwner: "celestiaorg/celestia-app" },
          reviews: {
            nodes: [
              { author: { login: "rootulp" }, submittedAt: "2026-02-03T19:00:00Z", state: "APPROVED" },
            ],
          },
          timelineItems: {
            nodes: [
              { createdAt: "2026-02-03T09:00:00Z", requestedReviewer: { login: "rootulp" } },
            ],
          },
        },
      ])
    );

    const result = await getReviewLatencies(CONFIG, "tok", NOW);
    // Sorted latencies: [1, 2, 10]. Median idx=floor(3*0.5)=1 → 2. p90 idx=floor(3*0.9)=2 → 10.
    expect(result.rootulp.year).toEqual({ n: 3, medianHours: 2, p90Hours: 10 });
  });

  test("reviewer with zero matching PRs returns zero counts", async () => {
    fetch.mockResolvedValueOnce(searchOk([]));
    const result = await getReviewLatencies(CONFIG, "tok", NOW);
    expect(result.rootulp.year).toEqual({ n: 0, medianHours: null, p90Hours: null });
  });
});
