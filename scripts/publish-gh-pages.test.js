const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { publish, clearDirExcept, KEEP } = require("./publish-gh-pages");

// Run git in throwaway repos with an isolated config, so the tests do not
// depend on (or use) the developer's global git setup.
let tmp;
let gitEnv;

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" }).trim();
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function remoteTree(remote) {
  return git(remote, "ls-tree", "-r", "--name-only", "gh-pages").split("\n").sort();
}

function remoteFile(remote, file) {
  return git(remote, "show", `gh-pages:${file}`);
}

// Set up: a bare "origin" whose gh-pages holds an old site plus a PR preview,
// a shallow clone of main (as actions/checkout makes), and a site to publish.
function setup() {
  const remote = path.join(tmp, "origin.git");
  const seed = path.join(tmp, "seed");
  const work = path.join(tmp, "work");
  git(tmp, "init", "-q", "--bare", "-b", "main", remote);

  git(tmp, "init", "-q", "-b", "main", seed);
  write(path.join(seed, "README.md"), "main\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "main");
  git(seed, "checkout", "-q", "--orphan", "gh-pages");
  git(seed, "rm", "-rqf", ".");
  write(path.join(seed, "index.html"), "old index\n");
  write(path.join(seed, "stale.js"), "removed upstream\n");
  write(path.join(seed, "pr-preview/pr-7/index.html"), "preview 7\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "old deploy");
  git(seed, "push", "-q", remote, "main", "gh-pages");

  git(tmp, "clone", "-q", "--depth=1", `file://${remote}`, work);

  const site = path.join(work, "public");
  write(path.join(site, "index.html"), "new index\n");
  write(path.join(site, "data.json"), '{"n":1}\n');
  return { remote, work, site };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "publish-test-"));
  const gitconfig = path.join(tmp, "gitconfig");
  fs.writeFileSync(gitconfig, "[user]\n\tname = Test\n\temail = test@example.com\n");
  gitEnv = {
    ...process.env,
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: "1",
  };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const silent = () => {};

describe("clearDirExcept", () => {
  test("removes everything at the top level except the kept names", () => {
    const dir = path.join(tmp, "d");
    write(path.join(dir, "a.txt"), "a");
    write(path.join(dir, "sub/b.txt"), "b");
    write(path.join(dir, "pr-preview/pr-1/index.html"), "p");
    write(path.join(dir, ".git"), "gitdir: x");
    clearDirExcept(dir, ["pr-preview", ".git"]);
    expect(fs.readdirSync(dir).sort()).toEqual([".git", "pr-preview"]);
  });
});

describe("publish", () => {
  test("keeps the same preserved paths as the old deploy action", () => {
    expect(KEEP).toEqual(
      expect.arrayContaining([".git", "pr-preview", "CNAME", ".nojekyll"])
    );
  });

  test("replaces the site with sourceDir, keeps PR previews, appends a commit", () => {
    const { remote, work, site } = setup();
    const before = git(remote, "rev-parse", "gh-pages");

    const result = publish({ cwd: work, sourceDir: site, message: "deploy 1", env: gitEnv, log: silent });

    expect(result).toEqual({ pushed: true });
    expect(remoteTree(remote)).toEqual(["data.json", "index.html", "pr-preview/pr-7/index.html"]);
    expect(remoteFile(remote, "index.html")).toBe("new index");
    expect(remoteFile(remote, "pr-preview/pr-7/index.html")).toBe("preview 7");
    expect(git(remote, "rev-parse", "gh-pages^")).toBe(before);
    expect(git(remote, "log", "-1", "--format=%s", "gh-pages")).toBe("deploy 1");
    // The checkout's own working tree is left alone.
    expect(fs.readFileSync(path.join(work, "README.md"), "utf8")).toBe("main\n");
    expect(git(work, "worktree", "list").split("\n")).toHaveLength(1);
  });

  test("makes no commit when the site is unchanged", () => {
    const { remote, work, site } = setup();
    publish({ cwd: work, sourceDir: site, message: "deploy 1", env: gitEnv, log: silent });
    const tip = git(remote, "rev-parse", "gh-pages");

    const result = publish({ cwd: work, sourceDir: site, message: "deploy 2", env: gitEnv, log: silent });

    expect(result).toEqual({ pushed: false });
    expect(git(remote, "rev-parse", "gh-pages")).toBe(tip);
  });

  test("dry run commits locally but does not push", () => {
    const { remote, work, site } = setup();
    const tip = git(remote, "rev-parse", "gh-pages");

    const result = publish({ cwd: work, sourceDir: site, message: "d", env: gitEnv, log: silent, dryRun: true });

    expect(result).toEqual({ pushed: false });
    expect(git(remote, "rev-parse", "gh-pages")).toBe(tip);
  });

  test("retries on a rejected push and keeps a preview pushed in between", () => {
    const { remote, work, site } = setup();
    let raced = false;
    const racePreview = () => {
      if (raced) return;
      raced = true;
      // Another workflow (pr-preview) pushes to gh-pages meanwhile.
      const other = path.join(tmp, "other");
      git(tmp, "clone", "-q", "-b", "gh-pages", `file://${remote}`, other);
      write(path.join(other, "pr-preview/pr-8/index.html"), "preview 8\n");
      git(other, "add", "-A");
      git(other, "commit", "-q", "-m", "Deploy preview for PR 8");
      git(other, "push", "-q", "origin", "gh-pages");
    };

    const result = publish({
      cwd: work,
      sourceDir: site,
      message: "deploy",
      env: gitEnv,
      log: silent,
      beforePush: racePreview,
    });

    expect(result).toEqual({ pushed: true });
    expect(remoteTree(remote)).toEqual([
      "data.json",
      "index.html",
      "pr-preview/pr-7/index.html",
      "pr-preview/pr-8/index.html",
    ]);
    expect(git(remote, "log", "-1", "--format=%s", "gh-pages^")).toBe("Deploy preview for PR 8");
  });

  test("throws after maxAttempts rejected pushes", () => {
    const { work, site } = setup();
    const alwaysRace = () => {
      throw new Error("simulated push failure");
    };
    expect(() =>
      publish({
        cwd: work,
        sourceDir: site,
        message: "deploy",
        env: gitEnv,
        log: silent,
        beforePush: alwaysRace,
        maxAttempts: 2,
      })
    ).toThrow(/simulated push failure/);
    expect(git(work, "worktree", "list").split("\n")).toHaveLength(1);
  });
});
