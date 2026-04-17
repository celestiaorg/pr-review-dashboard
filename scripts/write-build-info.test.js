const { buildInfoPayload } = require("./write-build-info");

describe("buildInfoPayload", () => {
  test("returns sha, repo, and iso builtAt from the injected now", () => {
    const now = new Date("2026-04-17T12:34:56.000Z");
    const result = buildInfoPayload({
      sha: "abc123def456789",
      repo: "celestiaorg/pr-review-dashboard",
      now,
    });
    expect(result).toEqual({
      sha: "abc123def456789",
      repo: "celestiaorg/pr-review-dashboard",
      builtAt: "2026-04-17T12:34:56.000Z",
    });
  });
});
