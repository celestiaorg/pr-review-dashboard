require("dotenv").config();
const express = require("express");
const path = require("path");
const config = require("./config");
const { getPendingReviews } = require("./github");

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.GITHUB_TOKEN) {
  console.error("Error: GITHUB_TOKEN environment variable is required.");
  console.error("Create a .env file with: GITHUB_TOKEN=ghp_your_token_here");
  process.exit(1);
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/reviews", async (req, res) => {
  try {
    const reviews = await getPendingReviews(config, process.env.GITHUB_TOKEN);
    res.json({
      reviews,
      teamMembers: config.teamMembers,
      thresholds: config.thresholds,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

app.listen(PORT, () => {
  console.log(`PR Reviews Dashboard running at http://localhost:${PORT}`);
});
