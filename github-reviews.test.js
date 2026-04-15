const {
  mondayOfWeekUTC,
  firstOfMonthUTC,
  START_OF_2026,
  bucketForDate,
} = require("./github-reviews");

describe("mondayOfWeekUTC", () => {
  test("returns Monday 00:00 UTC when given a Wednesday", () => {
    const wed = new Date("2026-04-15T14:23:00Z");
    expect(mondayOfWeekUTC(wed).toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });

  test("returns same day 00:00 UTC when given a Monday", () => {
    const mon = new Date("2026-04-13T09:00:00Z");
    expect(mondayOfWeekUTC(mon).toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });

  test("returns previous Monday when given a Sunday", () => {
    const sun = new Date("2026-04-19T23:59:00Z");
    expect(mondayOfWeekUTC(sun).toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });
});

describe("firstOfMonthUTC", () => {
  test("returns 1st of month 00:00 UTC", () => {
    const d = new Date("2026-04-15T14:23:00Z");
    expect(firstOfMonthUTC(d).toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  test("handles month edge (last day)", () => {
    const d = new Date("2026-01-31T23:59:59Z");
    expect(firstOfMonthUTC(d).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("START_OF_2026", () => {
  test("is 2026-01-01T00:00:00.000Z", () => {
    expect(START_OF_2026.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("bucketForDate", () => {
  const now = new Date("2026-04-15T14:23:00Z"); // Wed

  test("pre-2026 review: no buckets", () => {
    const reviewedAt = new Date("2025-12-31T23:59:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: false, month: false, week: false,
    });
  });

  test("2026-01-01 00:00Z: year only", () => {
    const reviewedAt = new Date("2026-01-01T00:00:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: true, month: false, week: false,
    });
  });

  test("earlier this month: year + month", () => {
    const reviewedAt = new Date("2026-04-05T10:00:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: true, month: true, week: false,
    });
  });

  test("this Monday 00:00Z: year + month + week", () => {
    const reviewedAt = new Date("2026-04-13T00:00:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: true, month: true, week: true,
    });
  });

  test("last Sunday 23:59Z: year + month but not week", () => {
    const reviewedAt = new Date("2026-04-12T23:59:00Z");
    expect(bucketForDate(reviewedAt, now)).toEqual({
      year: true, month: true, week: false,
    });
  });
});
