const fs = require("fs");
const path = require("path");
const os = require("os");

jest.mock("../github-reviews", () => {
  const actual = jest.requireActual("../github-reviews");
  return { ...actual, getReviewCounts: jest.fn() };
});

const { getReviewCounts } = require("../github-reviews");
const { main } = require("./fetch-review-counts");

describe("fetch-review-counts main", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-review-counts-test-"));
  const outputPath = path.join(tmpDir, "review-counts.json");

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("writes review-counts.json with counts, computedAt, and windows", async () => {
    const fakeCounts = { rootulp: { week: 1, month: 2, year: 3 } };
    getReviewCounts.mockResolvedValue(fakeCounts);

    const config = {
      org: "celestiaorg",
      repos: ["celestia-app"],
      teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
      thresholds: { greenMaxHours: 12, yellowMaxHours: 24 },
    };

    const now = new Date("2026-04-15T14:23:00Z");
    await main({ config, token: "ghp_fake", outputPath, now });

    const written = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    expect(written.counts).toEqual(fakeCounts);
    expect(written.computedAt).toBe("2026-04-15T14:23:00.000Z");
    expect(written.windows.weekStart).toBe("2026-04-13T00:00:00.000Z");
    expect(written.windows.monthStart).toBe("2026-04-01T00:00:00.000Z");
    expect(written.windows.yearStart).toBe("2026-01-01T00:00:00.000Z");
    expect(getReviewCounts).toHaveBeenCalledWith(config, "ghp_fake", now);
  });
});
