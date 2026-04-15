const fs = require("fs");
const path = require("path");
const config = require("../config");
const { getPendingReviews } = require("../github");

async function main({ config, token, outputPath }) {
  const reviews = await getPendingReviews(config, token);
  const payload = {
    reviews,
    teamMembers: config.teamMembers,
    thresholds: config.thresholds,
    fetchedAt: new Date().toISOString(),
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
  const outputPath = path.join(__dirname, "..", "public", "data.json");
  main({ config, token, outputPath })
    .then(() => console.log(`Wrote ${outputPath}`))
    .catch((err) => {
      console.error("Failed to fetch data:", err);
      process.exit(1);
    });
}
