const fs = require("fs");
const path = require("path");
const config = require("../config");
const { getReviewCounts, mondayOfWeekUTC, firstOfMonthUTC, START_OF_2026 } =
  require("../github-reviews");

async function main({ config, token, outputPath, now = new Date() }) {
  const counts = await getReviewCounts(config, token, now);
  const payload = {
    counts,
    computedAt: now.toISOString(),
    windows: {
      weekStart: mondayOfWeekUTC(now).toISOString(),
      monthStart: firstOfMonthUTC(now).toISOString(),
      yearStart: START_OF_2026.toISOString(),
    },
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
}

module.exports = { main };

if (require.main === module) {
  require("dotenv").config();
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("Error: GITHUB_TOKEN environment variable is required.");
    process.exit(1);
  }
  const outputPath = path.join(__dirname, "..", "public", "review-counts.json");
  main({ config, token, outputPath })
    .then(() => console.log(`Wrote ${outputPath}`))
    .catch((err) => {
      console.error("Failed to fetch review counts:", err);
      process.exit(1);
    });
}
