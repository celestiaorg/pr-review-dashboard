const fs = require("fs");
const path = require("path");
const config = require("../config");
const {
  getReviewLatencies,
  mondayOfWeekUTC,
  firstOfMonthUTC,
  START_OF_2026,
} = require("../github-review-latencies");

async function main({ config, token, outputPath, now = new Date() }) {
  const latencies = await getReviewLatencies(config, token, now);
  const payload = {
    latencies,
    teamMembers: config.teamMembers,
    computedAt: now.toISOString(),
    windows: {
      weekStart: mondayOfWeekUTC(now).toISOString(),
      monthStart: firstOfMonthUTC(now).toISOString(),
      yearStart: START_OF_2026.toISOString(),
    },
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
  return payload;
}

function fmt(hours) {
  if (hours == null) return "—";
  if (hours < 1) return `${(hours * 60).toFixed(0)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function printSummary(payload) {
  const rows = Object.entries(payload.latencies).map(([handle, windows]) => ({
    handle,
    ...windows,
  }));
  const pad = (s, n) => String(s).padEnd(n);
  const head =
    pad("reviewer", 18) +
    pad("week n/med/p90", 22) +
    pad("month n/med/p90", 22) +
    pad("year n/med/p90", 22);
  console.error();
  console.error(head);
  console.error("-".repeat(head.length));
  for (const r of rows) {
    const cell = (w) =>
      `${w.n}  ${fmt(w.medianHours)} / ${fmt(w.p90Hours)}`;
    console.error(
      pad(r.handle, 18) +
        pad(cell(r.week), 22) +
        pad(cell(r.month), 22) +
        pad(cell(r.year), 22)
    );
  }
  console.error();
}

module.exports = { main };

if (require.main === module) {
  require("dotenv").config();
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("Error: GITHUB_TOKEN environment variable is required.");
    process.exit(1);
  }
  const outputPath = path.join(
    __dirname,
    "..",
    "public",
    "review-latencies.json"
  );
  main({ config, token, outputPath })
    .then((payload) => {
      printSummary(payload);
      console.log(`Wrote ${outputPath}`);
    })
    .catch((err) => {
      console.error("Failed to fetch review latencies:", err);
      process.exit(1);
    });
}
