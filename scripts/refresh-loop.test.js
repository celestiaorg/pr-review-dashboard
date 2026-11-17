const { runLoop, readConfig } = require("./refresh-loop");

// A fake clock: sleep() and slow iterations advance time instantly.
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    sleep: async (ms) => {
      t += ms;
    },
  };
}

const silent = () => {};

describe("runLoop", () => {
  test("repeats the iteration on the interval until the duration elapses", async () => {
    const clock = fakeClock();
    const starts = [];
    const result = await runLoop({
      runIteration: async () => starts.push(clock.now()),
      intervalMs: 10,
      durationMs: 30,
      maxConsecutiveFailures: 3,
      now: clock.now,
      sleep: clock.sleep,
      log: silent,
    });
    expect(starts).toEqual([0, 10, 20]);
    expect(result).toEqual({ ok: true, iterations: 3, failures: 0 });
  });

  test("subtracts the iteration's own run time from the wait", async () => {
    const clock = fakeClock();
    const starts = [];
    await runLoop({
      runIteration: async () => {
        starts.push(clock.now());
        clock.advance(3);
      },
      intervalMs: 10,
      durationMs: 25,
      maxConsecutiveFailures: 3,
      now: clock.now,
      sleep: clock.sleep,
      log: silent,
    });
    expect(starts).toEqual([0, 10, 20]);
  });

  test("starts the next iteration at once when one overruns the interval", async () => {
    const clock = fakeClock();
    const starts = [];
    await runLoop({
      runIteration: async () => {
        starts.push(clock.now());
        clock.advance(starts.length === 1 ? 15 : 1);
      },
      intervalMs: 10,
      durationMs: 30,
      maxConsecutiveFailures: 3,
      now: clock.now,
      sleep: clock.sleep,
      log: silent,
    });
    expect(starts).toEqual([0, 15, 25]);
  });

  test("a single failed iteration is logged and the loop continues", async () => {
    const clock = fakeClock();
    const logs = [];
    let n = 0;
    const result = await runLoop({
      runIteration: async () => {
        n += 1;
        if (n === 2) throw new Error("API blip");
      },
      intervalMs: 10,
      durationMs: 40,
      maxConsecutiveFailures: 2,
      now: clock.now,
      sleep: clock.sleep,
      log: (msg) => logs.push(msg),
    });
    expect(result).toEqual({ ok: true, iterations: 4, failures: 1 });
    expect(logs.join("\n")).toMatch(/API blip/);
  });

  test("a success resets the consecutive-failure count", async () => {
    const clock = fakeClock();
    let n = 0;
    const result = await runLoop({
      // fail, ok, fail, ok, fail, ok
      runIteration: async () => {
        n += 1;
        if (n % 2 === 1) throw new Error("flaky");
      },
      intervalMs: 10,
      durationMs: 60,
      maxConsecutiveFailures: 2,
      now: clock.now,
      sleep: clock.sleep,
      log: silent,
    });
    expect(result).toEqual({ ok: true, iterations: 6, failures: 3 });
  });

  test("stops early and reports failure after N consecutive failures", async () => {
    const clock = fakeClock();
    let n = 0;
    const result = await runLoop({
      runIteration: async () => {
        n += 1;
        throw new Error("down");
      },
      intervalMs: 10,
      durationMs: 1000,
      maxConsecutiveFailures: 3,
      now: clock.now,
      sleep: clock.sleep,
      log: silent,
    });
    expect(n).toBe(3);
    expect(result).toEqual({ ok: false, iterations: 3, failures: 3 });
  });
});

describe("readConfig", () => {
  test("uses the production defaults when no env vars are set", () => {
    expect(readConfig({})).toEqual({
      intervalMs: 5 * 60 * 1000,
      durationMs: 330 * 60 * 1000,
      maxConsecutiveFailures: 3,
      stepTimeoutMs: 2 * 60 * 1000,
    });
  });

  test("reads overrides in seconds from env vars", () => {
    expect(
      readConfig({
        REFRESH_INTERVAL_SECONDS: "2",
        REFRESH_DURATION_SECONDS: "7",
        REFRESH_MAX_CONSECUTIVE_FAILURES: "5",
        REFRESH_STEP_TIMEOUT_SECONDS: "1",
      })
    ).toEqual({
      intervalMs: 2000,
      durationMs: 7000,
      maxConsecutiveFailures: 5,
      stepTimeoutMs: 1000,
    });
  });

  test("rejects values that are not positive numbers", () => {
    expect(() => readConfig({ REFRESH_INTERVAL_SECONDS: "abc" })).toThrow(
      /REFRESH_INTERVAL_SECONDS/
    );
    expect(() => readConfig({ REFRESH_MAX_CONSECUTIVE_FAILURES: "0" })).toThrow(
      /REFRESH_MAX_CONSECUTIVE_FAILURES/
    );
  });
});
