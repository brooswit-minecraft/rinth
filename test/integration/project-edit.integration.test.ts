// `rinth project edit` against a real project — gated on BOTH
// `MODRINTH_TOKEN` (the general integration gate) AND `RINTH_TEST_PROJECT`
// (the same "a real project you're willing to mutate" env var
// `publish.integration.test.ts`/`versions-delete.integration.test.ts` use),
// since this MUTATES a real project's metadata. With only `MODRINTH_TOKEN`
// set, it skips cleanly, logging why — see harness.ts.
//
// Per epic-level ruling on RINTH-7 (see PR body): the double-gate above is
// the intentional full extent of the opt-in for this story — no third env
// var exists to unlock this test further, and neither this test nor the
// agent that wrote it attempts to set or discover `RINTH_TEST_PROJECT`.
//
// This reads the project's current `description` first, edits it to a
// distinguishable, timestamped value, verifies the change via `rinth
// project edit`'s own read-back, and restores the original description
// afterward — so a run against a real (if throwaway) project leaves it
// exactly as it found it, the same discipline `versions-delete.integration
// .test.ts` follows for the version it creates and deletes.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { run } from "../../src/cli.ts";
import { ExitCode } from "../../src/errors.ts";
import { hasModrinthToken, hasTestProject, RINTH_TEST_PROJECT } from "./harness.ts";

const canRun = hasModrinthToken && hasTestProject;

function captureOutput() {
  const realLog = console.log.bind(console);
  const realError = console.error.bind(console);
  const logSpy = spyOn(console, "log").mockImplementation((...args) => realLog(...args));
  const errSpy = spyOn(console, "error").mockImplementation((...args) => realError(...args));
  return {
    lastLog: () => String(logSpy.mock.calls.at(-1)?.[0]),
    lastErr: () => String(errSpy.mock.calls.at(-1)?.[0]),
    restore: () => {
      logSpy.mockRestore();
      errSpy.mockRestore();
    },
  };
}

describe("integration: project edit (edits and restores a real project's description)", () => {
  // Set only once the edit under test has actually landed — the afterEach
  // then restores it. Never set on a run that never mutated anything (a
  // clean skip), so a partial/failed run can't accidentally "restore" a
  // value it never changed.
  let originalDescription: string | undefined;

  afterEach(async () => {
    if (originalDescription !== undefined && RINTH_TEST_PROJECT) {
      const out = captureOutput();
      await run(["--json", "project", "edit", RINTH_TEST_PROJECT, "--description", originalDescription]);
      out.restore();
      originalDescription = undefined;
    }
  });

  test.skipIf(!canRun)("edits the description, verifies via read-back, then restores it", async () => {
    let out = captureOutput();
    const getCode = await run(["--json", "project", "get", String(RINTH_TEST_PROJECT)]);
    let lastLog = out.lastLog();
    let lastErr = out.lastErr();
    out.restore();

    if (getCode !== ExitCode.Ok) {
      console.log(`PROJECT EDIT: setup \`project get\` did not succeed (exit ${getCode}): ${lastErr} — skipping`);
      return;
    }

    const before = JSON.parse(lastLog) as { description: string };
    originalDescription = before.description;

    const testDescription = `rinth integration test — safe to overwrite — ${Date.now()}`;

    out = captureOutput();
    const editCode = await run([
      "--json",
      "project",
      "edit",
      String(RINTH_TEST_PROJECT),
      "--description",
      testDescription,
    ]);
    lastLog = out.lastLog();
    lastErr = out.lastErr();
    out.restore();

    console.log(`PROJECT EDIT: edit ${RINTH_TEST_PROJECT} => exit ${editCode}`);

    if (editCode !== ExitCode.Ok) {
      throw new Error(`unexpected exit code from \`rinth project edit\`: ${editCode}: ${lastErr}`);
    }

    const after = JSON.parse(lastLog) as { description: string };
    expect(after.description).toBe(testDescription);
  });
});
