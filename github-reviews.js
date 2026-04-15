const START_OF_2026 = new Date("2026-01-01T00:00:00.000Z");

function mondayOfWeekUTC(date) {
  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));
  // JS: getUTCDay() returns 0=Sun, 1=Mon, ..., 6=Sat.
  // Days to subtract to reach Monday:
  //   Sun=6, Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5.
  const dayOfWeek = d.getUTCDay();
  const daysToSubtract = (dayOfWeek + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysToSubtract);
  return d;
}

function firstOfMonthUTC(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function bucketForDate(reviewedAt, now) {
  const inYear = reviewedAt >= START_OF_2026;
  const inMonth = inYear && reviewedAt >= firstOfMonthUTC(now);
  const inWeek = inMonth && reviewedAt >= mondayOfWeekUTC(now);
  return { year: inYear, month: inMonth, week: inWeek };
}

module.exports = {
  START_OF_2026,
  mondayOfWeekUTC,
  firstOfMonthUTC,
  bucketForDate,
};
