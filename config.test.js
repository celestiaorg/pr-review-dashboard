const config = require("./config");

describe("teamMembers", () => {
  test("no member is flagged alumni", () => {
    expect(config.teamMembers.length).toBeGreaterThan(0);
    for (const member of config.teamMembers) {
      expect(member.alumni).toBeUndefined();
    }
  });

  test("no member is hidden by default", () => {
    for (const member of config.teamMembers) {
      expect(member.defaultHidden).toBe(false);
    }
  });

  test("members are sorted alphabetically by name", () => {
    const names = config.teamMembers.map((member) => member.name);
    expect(names).toEqual([...names].sort());
  });
});

// Active repos listed in https://github.com/celestiaorg/protocol#repos
const ACTIVE_PROTOCOL_REPOS = [
  "celestia-app",
  "celestia-core",
  "celestia-node",
  "cosmos-sdk",
  "da-proxy",
  "fibre-gateway",
  "fibre-gateway-client",
  "go-header",
  "go-libp2p-messenger",
  "go-square",
  "hyperlane-cosmos",
  "ibc-go",
  "infrastructure",
  "lumina",
  "networks",
  "nmt",
  "rsmt2d",
  "tastora",
];

describe("repos", () => {
  test("includes every active protocol repo", () => {
    for (const repo of ACTIVE_PROTOCOL_REPOS) {
      expect(config.repos).toContain(repo);
    }
  });

  test("includes networks and tastora", () => {
    expect(config.repos).toContain("networks");
    expect(config.repos).toContain("tastora");
  });

  test("repos are sorted alphabetically", () => {
    expect(config.repos).toEqual([...config.repos].sort());
  });
});
