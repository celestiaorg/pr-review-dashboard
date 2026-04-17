const fs = require("fs");
const path = require("path");

function buildInfoPayload({ sha, repo, now }) {
  return {
    sha,
    repo,
    builtAt: now.toISOString(),
  };
}

module.exports = { buildInfoPayload };

if (require.main === module) {
  const sha = process.env.GITHUB_SHA;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!sha || !repo) {
    console.error(
      "Error: GITHUB_SHA and GITHUB_REPOSITORY env vars are required."
    );
    process.exit(1);
  }
  const outputPath = path.join(__dirname, "..", "public", "build-info.json");
  const payload = buildInfoPayload({ sha, repo, now: new Date() });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${outputPath}`);
}
