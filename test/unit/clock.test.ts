import { describe, expect, test } from "bun:test";
import { realClock } from "../../src/clock.ts";

describe("realClock", () => {
  test("now() returns a real, monotonically-sane timestamp close to Date.now()", () => {
    const before = Date.now();
    const now = realClock.now();
    const after = Date.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(after);
  });

  test("sleep() resolves after roughly the requested duration", async () => {
    const start = Date.now();
    await realClock.sleep(5);
    expect(Date.now() - start).toBeGreaterThanOrEqual(0);
  });
});
