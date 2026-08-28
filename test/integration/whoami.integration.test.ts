// The empirical auth spike (half 1/2): does labrinth (api.modrinth.com/v2
// /user) accept the org's MODRINTH_TOKEN PAT as a Bearer token? Runs for
// real against the live API — only when MODRINTH_TOKEN is set (see
// harness.ts) — using the real transport (no injected fake).
//
// This test does not require "accepted" to pass: the point is to record
// whichever outcome the live API actually returns. A 401/403 (AuthMissing)
// is a valid, useful answer and keeps the job green; only a shape the CLI
// itself shouldn't be able to produce (Usage/Generic) fails the test.

import { describe, expect, spyOn, test } from "bun:test";
import { run } from "../../src/cli.ts";
import { ExitCode } from "../../src/errors.ts";
import { hasModrinthToken } from "./harness.ts";

describe("integration: whoami (labrinth /user auth spike)", () => {
  test.skipIf(!hasModrinthToken)("reports whether the PAT is accepted by labrinth /user", async () => {
    // These spies CAPTURE the command's output instead of forwarding it to
    // the real console. That is deliberate and load-bearing: the labrinth
    // /user response carries the account's email
    // (`Labrinth.Users.v2.User.email`), `rinth --json whoami` prints that
    // object verbatim, and this repository's Actions logs are public — so
    // forwarding would put the email into a public log. Only the derived,
    // non-PII fields are printed below, after the spies are restored.
    // Do not restore forwarding here.
    // (KAN-720 and KAN-721 fixed this independently; this is the union —
    // stderr is captured too, and its text still reaches the log through
    // the `lastErr` interpolations in the branches below.)
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errSpy = spyOn(console, "error").mockImplementation(() => {});

    const code = await run(["--json", "whoami"]);

    const lastLog = String(logSpy.mock.calls.at(-1)?.[0]);
    const lastErr = String(errSpy.mock.calls.at(-1)?.[0]);
    logSpy.mockRestore();
    errSpy.mockRestore();

    if (code === ExitCode.Ok) {
      const user = JSON.parse(lastLog) as { id?: unknown; username?: unknown };
      expect(typeof user.id).toBe("string");
      // id and username only — never the parsed object or `lastLog` itself.
      console.log(
        `AUTH SPIKE: labrinth GET /v2/user (Bearer PAT) => accepted (200), id ${user.id}, username ${user.username}`,
      );
    } else if (code === ExitCode.AuthMissing) {
      console.log(`AUTH SPIKE: labrinth GET /v2/user (Bearer PAT) => rejected (401/403). ${lastErr}`);
      expect(code).toBe(ExitCode.AuthMissing);
    } else if (code === ExitCode.ApiError || code === ExitCode.NotFound || code === ExitCode.Network) {
      console.log(`AUTH SPIKE: labrinth GET /v2/user (Bearer PAT) => unexpected API/network response, exit ${code}: ${lastErr}`);
    } else {
      throw new Error(`unexpected exit code from \`rinth whoami\`: ${code}`);
    }
  });
});
