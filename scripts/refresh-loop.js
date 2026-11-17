// Keeps the dashboard fresh from one long-running Actions job: every interval
// it pulls the latest daily review data from main, fetches pending reviews,
// and publishes public/ to gh-pages. See .github/workflows/deploy.yml.
const { spawnSync } = require("child_process");
const path = require("path");

// Repeat runIteration every intervalMs until durationMs has elapsed. One
// failed iteration is logged and skipped; maxConsecutiveFailures in a row
// stop the loop with ok: false so the job fails visibly.
async function runLoop({
  runIteration,
  intervalMs,
  durationMs,
  maxConsecutiveFailures,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.log,
}) {
  const deadline = now() + durationMs;
  let iterations = 0;
  let failures = 0;
  let consecutiveFailures = 0;

  for (;;) {
    const started = now();
    iterations += 1;
    try {
      await runIteration();
      consecutiveFailures = 0;
      log(`Iteration ${iterations} succeeded.`);
    } catch (err) {
      failures += 1;
      consecutiveFailures += 1;
      log(
        `Iteration ${iterations} failed (${consecutiveFailures} in a row): ${
          err && err.message ? err.message : err
        }`
      );
      if (consecutiveFailures >= maxConsecutiveFailures) {
        return { ok: false, iterations, failures };
      }
    }

    const next = started + intervalMs;
    if (next >= deadline) return { ok: true, iterations, failures };
    await sleep(Math.max(0, next - now()));
  }
}

const DEFAULTS = {
  REFRESH_INTERVAL_SECONDS: 5 * 60,
  REFRESH_DURATION_SECONDS: 330 * 60,
  REFRESH_MAX_CONSECUTIVE_FAILURES: 3,
  REFRESH_STEP_TIMEOUT_SECONDS: 2 * 60,
};

function readConfig(env) {
  const value = (name) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return DEFAULTS[name];
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${name} must be a positive number, got "${raw}"`);
    }
    return n;
  };
  return {
    intervalMs: value("REFRESH_INTERVAL_SECONDS") * 1000,
    durationMs: value("REFRESH_DURATION_SECONDS") * 1000,
    maxConsecutiveFailures: value("REFRESH_MAX_CONSECUTIVE_FAILURES"),
    stepTimeoutMs: value("REFRESH_STEP_TIMEOUT_SECONDS") * 1000,
  };
}

// Files the daily fetch-review-data workflow commits to main. Its pushes use
// GITHUB_TOKEN, so they do not start a new deploy run; pull them in each
// iteration instead.
const DAILY_FILES = ["public/review-counts.json", "public/review-latencies.json"];

function iterationSteps() {
  return [
    ["git", ["fetch", "--depth=1", "origin", "main"]],
    ["git", ["checkout", "FETCH_HEAD", "--", ...DAILY_FILES]],
    ["node", ["scripts/fetch-data.js"]],
    ["node", ["scripts/write-build-info.js"]],
    ["node", ["scripts/publish-gh-pages.js"]],
  ];
}

function runStep([cmd, args], { cwd, timeoutMs }) {
  const res = spawnSync(cmd, args, { cwd, stdio: "inherit", timeout: timeoutMs });
  const label = [cmd, ...args].join(" ");
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`${label} exited with ${res.status ?? res.signal}`);
  }
}

module.exports = { runLoop, readConfig, DAILY_FILES };

if (require.main === module) {
  const config = readConfig(process.env);
  const cwd = path.join(__dirname, "..");
  runLoop({
    ...config,
    runIteration: async () => {
      for (const step of iterationSteps()) {
        runStep(step, { cwd, timeoutMs: config.stepTimeoutMs });
      }
    },
  }).then((result) => {
    console.log(
      `Loop finished: ${result.iterations} iterations, ${result.failures} failed.`
    );
    if (!result.ok) {
      console.error(
        `::error::${config.maxConsecutiveFailures} consecutive refresh iterations failed`
      );
      process.exit(1);
    }
  });
}
