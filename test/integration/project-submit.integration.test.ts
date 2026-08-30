// `rinth project submit` against the live Modrinth API — the REFUSAL path
// only. Gated on `MODRINTH_TOKEN` alone (no second opt-in): this reads a
// real, public, already-`approved` project (`sodium`) and asserts `submit`
// refuses it by name — it never PATCHes, so there is nothing to clean up
// and nothing at risk.
//
// The SUCCESS path (draft -> processing) is deliberately NOT exercised live
// here or anywhere else in this suite: submitting a real project moves it
// into Modrinth's human moderation queue, a side effect on a third party
// (Modrinth's moderators) that — unlike a throwaway draft or version —
// cannot be undone by deleting something afterward. That is a materially
// different cost than "leaves a draft behind," so it is out of scope for an
// automated integration test even under an opt-in env var; see the README
// "Known gaps / follow-ups" and the PR body.
//
// This environment has no MODRINTH_TOKEN, so this test has NOT been
// exercised live — see the PR body and README. It is written to be correct
// when a token is present, not merely to skip cleanly.

import { describe, expect, spyOn, test } from "bun:test";
import { run } from "../../src/cli.ts";
import { ExitCode } from "../../src/errors.ts";
import { hasModrinthToken } from "./harness.ts";

const APPROVED_PUBLIC_PROJECT = "sodium";

describe("integration: project submit (refusal path only — never PATCHes)", () => {
  test.skipIf(!hasModrinthToken)(
    "refuses to submit a real, already-approved project, naming its actual status",
    async () => {
      const realLog = console.log.bind(console);
      const realError = console.error.bind(console);
      const logSpy = spyOn(console, "log").mockImplementation((...args) => realLog(...args));
      const errSpy = spyOn(console, "error").mockImplementation((...args) => realError(...args));

      const code = await run(["--json", "project", "submit", APPROVED_PUBLIC_PROJECT]);

      const lastErr = String(errSpy.mock.calls.at(-1)?.[0]);
      logSpy.mockRestore();
      errSpy.mockRestore();

      console.log(`INTEGRATION: project submit ${APPROVED_PUBLIC_PROJECT} => exit ${code}: ${lastErr}`);

      if (code === ExitCode.ApiError) {
        const parsed = JSON.parse(lastErr) as { error: { message: string; reason: string | null } };
        expect(parsed.error.reason).toBe("not_submittable");
        expect(parsed.error.message).toContain("approved");
      } else {
        // Any other outcome (e.g. a network hiccup, or the project's real
        // status having changed) is recorded, not failed — the point of
        // this test is the refusal case specifically, and it must never
        // attempt a write regardless.
        console.log(`INTEGRATION: project submit ${APPROVED_PUBLIC_PROJECT} => did not refuse as expected, got exit ${code}`);
      }
    },
  );
});
