// Publishes public/ to the gh-pages branch the same way the
// JamesIves/github-pages-deploy-action step did (clean: true,
// clean-exclude: pr-preview): replace the site, keep PR previews, and add one
// commit on top of the current gh-pages tip. A rejected push (for example a
// PR preview pushed meanwhile) is retried on the new tip, so it never
// discards other commits.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Top-level paths on gh-pages that a deploy must not delete. pr-preview/ is
// owned by .github/workflows/pr-preview.yml; the rest match the deploy
// action's built-in excludes.
const KEEP = [".git", ".github", ".ssh", "CNAME", ".nojekyll", "pr-preview"];

const BOT_NAME = "github-actions[bot]";
const BOT_EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";

function clearDirExcept(dir, keep) {
  for (const name of fs.readdirSync(dir)) {
    if (keep.includes(name)) continue;
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

function publish({
  cwd,
  sourceDir,
  message,
  branch = "gh-pages",
  remote = "origin",
  dryRun = false,
  maxAttempts = 3,
  env = process.env,
  log = console.log,
  beforePush = () => {},
}) {
  const git = (dir, ...args) =>
    execFileSync("git", args, { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const tryGit = (dir, ...args) => {
    try {
      return git(dir, ...args);
    } catch {
      return "";
    }
  };
  const identity = tryGit(cwd, "config", "user.email")
    ? []
    : ["-c", `user.name=${BOT_NAME}`, "-c", `user.email=${BOT_EMAIL}`];
  const trackingRef = `refs/remotes/${remote}/${branch}`;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    git(cwd, "fetch", "-q", "--depth=1", remote, `+refs/heads/${branch}:${trackingRef}`);
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), `${branch}-`));
    try {
      git(cwd, "worktree", "add", "-q", "--detach", worktree, trackingRef);
      clearDirExcept(worktree, KEEP);
      fs.cpSync(sourceDir, worktree, { recursive: true });
      git(worktree, "add", "-A");
      if (!tryGit(worktree, "status", "--porcelain")) {
        log(`No changes to publish to ${branch}.`);
        return { pushed: false };
      }
      git(worktree, ...identity, "commit", "-q", "-m", message);
      if (dryRun) {
        log(`Dry run: committed ${git(worktree, "rev-parse", "HEAD")} but did not push.`);
        return { pushed: false };
      }
      beforePush();
      git(worktree, "push", "-q", remote, `HEAD:refs/heads/${branch}`);
      log(`Published to ${branch} (attempt ${attempt}).`);
      return { pushed: true };
    } catch (err) {
      lastError = err;
      log(`Publish attempt ${attempt} failed: ${(err.stderr || err.message || "").toString().trim()}`);
    } finally {
      tryGit(cwd, "worktree", "remove", "--force", worktree);
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  }
  throw lastError;
}

module.exports = { publish, clearDirExcept, KEEP };

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const repo = process.env.GITHUB_REPOSITORY || "local";
  const sha = process.env.GITHUB_SHA || "local";
  try {
    publish({
      cwd: root,
      sourceDir: path.join(root, "public"),
      message: `Deploying to gh-pages from @ ${repo}@${sha} 🚀`,
      dryRun: process.env.PUBLISH_DRY_RUN === "1",
    });
  } catch (err) {
    console.error("Publish failed:", (err.stderr || err.message || err).toString().trim());
    process.exit(1);
  }
}
