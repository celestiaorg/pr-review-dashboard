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
});
