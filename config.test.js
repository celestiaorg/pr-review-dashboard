const config = require("./config");

describe("teamMembers", () => {
  const byName = Object.fromEntries(config.teamMembers.map((m) => [m.name, m]));

  test.each(["Evan", "Vlad", "Hlib"])("%s is alumni and hidden by default", (name) => {
    expect(byName[name].alumni).toBe(true);
    expect(byName[name].defaultHidden).toBe(true);
  });

  test("active members are not flagged alumni", () => {
    const active = config.teamMembers.filter(
      (m) => !["Evan", "Vlad", "Hlib"].includes(m.name)
    );
    expect(active.length).toBeGreaterThan(0);
    for (const member of active) {
      expect(member.alumni).toBeUndefined();
    }
  });
});
