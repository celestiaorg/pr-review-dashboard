const fs = require("fs");
const path = require("path");
const os = require("os");

jest.mock("../github", () => ({
  getPendingReviews: jest.fn(),
}));

const { getPendingReviews } = require("../github");
const { main } = require("./fetch-data");

describe("fetch-data main", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-data-test-"));
  const outputPath = path.join(tmpDir, "data.json");

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("writes data.json with reviews, teamMembers, thresholds, and fetchedAt", async () => {
    const fakeReviews = { rootulp: [{ number: 1 }], ninabarbakadze: [] };
    getPendingReviews.mockResolvedValue(fakeReviews);

    const config = {
      org: "celestiaorg",
      repos: ["celestia-app"],
      teamMembers: [{ name: "Rootul", github: "rootulp", defaultHidden: false }],
      thresholds: { greenMaxHours: 12, yellowMaxHours: 24 },
    };

    await main({ config, token: "ghp_fake", outputPath });

    const written = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    expect(written.reviews).toEqual(fakeReviews);
    expect(written.teamMembers).toEqual(config.teamMembers);
    expect(written.thresholds).toEqual(config.thresholds);
    expect(typeof written.fetchedAt).toBe("string");
    expect(new Date(written.fetchedAt).toString()).not.toBe("Invalid Date");
    expect(getPendingReviews).toHaveBeenCalledWith(config, "ghp_fake");
  });
});
