// The clock/sleep seam `versions latest --wait` polls through — the same
// kind of injectable boundary `Transport` provides for HTTP, so the wait
// loop is testable with no real wall-clock (see test/unit's fake clock).
// Per RINTH-6/RINTH-2's spec amendment, this is deliberately a
// `CommandContext` member, not a hidden CLI flag: a flag that secretly
// shortens a bounded wait would be load-bearing test scaffolding on the
// tool's public surface.

export interface Clock {
  /** Current time in milliseconds, like `Date.now()`. */
  now(): number;
  /** Resolves after `ms` milliseconds. */
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};
