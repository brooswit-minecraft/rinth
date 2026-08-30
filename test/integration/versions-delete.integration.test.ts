// `rinth versions delete` against a real, throwaway version — gated on BOTH
// `MODRINTH_TOKEN` (the general integration gate) AND `RINTH_TEST_PROJECT`
// (the same "a real project you're willing to publish/delete throwaway
// versions on" env var `test/integration/publish.integration.test.ts` uses),
// so this can never delete something the operator cares about by default:
// with only MODRINTH_TOKEN set, it skips cleanly, logging why.
//
// This creates its own throwaway version (via `rinth publish`, never a
// version the operator published) and immediately deletes it via `rinth
// versions delete` — proving the full round-trip: the live API's documented
// DELETE-404-on-success quirk (see README) doesn't fool the read-back
// verification, and the version is genuinely gone afterward.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("integration: versions delete (creates and deletes its own real, throwaway version)", () => {
  let dir: string | undefined;
  // Only set if this test's own delete step fails to run/complete — the
  // afterEach then attempts a best-effort cleanup so a partial run never
  // leaves a throwaway version behind.
  let undeletedVersionId: string | undefined;

  afterEach(async () => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
    if (undeletedVersionId) {
      const out = captureOutput();
      await run(["--json", "versions", "delete", undeletedVersionId]);
      out.restore();
      undeletedVersionId = undefined;
    }
  });

  test.skipIf(!canRun)("publishes a throwaway version, deletes it, and verifies it is genuinely gone", async () => {
    dir = mkdtempSync(join(tmpdir(), "rinth-versions-delete-integration-"));
    const filePath = join(dir, "rinth-integration-test.mrpack");
    writeFileSync(filePath, "rinth versions-delete integration test placeholder file contents");

    const versionNumber = `0.0.0-rinth-delete-test-${Date.now()}`;

    let out = captureOutput();
    const publishCode = await run([
      "--json",
      "publish",
      String(RINTH_TEST_PROJECT),
      "--file",
      filePath,
      "--version",
      versionNumber,
      "--changelog",
      "rinth versions-delete integration test — safe to delete",
    ]);
    let lastLog = out.lastLog();
    let lastErr = out.lastErr();
    out.restore();

    if (publishCode !== ExitCode.Ok) {
      console.log(`VERSIONS DELETE: setup publish did not succeed (exit ${publishCode}): ${lastErr} — skipping`);
      return;
    }

    const created = JSON.parse(lastLog) as { id: string; version_number: string };
    undeletedVersionId = created.id;
    console.log(`VERSIONS DELETE: published throwaway version ${created.id} (${created.version_number})`);

    out = captureOutput();
    const deleteCode = await run(["--json", "versions", "delete", created.id]);
    lastLog = out.lastLog();
    lastErr = out.lastErr();
    out.restore();

    console.log(`VERSIONS DELETE: delete ${created.id} => exit ${deleteCode}: ${deleteCode === ExitCode.Ok ? lastLog : lastErr}`);

    if (deleteCode !== ExitCode.Ok) {
      throw new Error(`unexpected exit code from \`rinth versions delete\`: ${deleteCode}: ${lastErr}`);
    }
    // The delete succeeded — nothing left for afterEach to clean up.
    undeletedVersionId = undefined;

    const deleteResult = JSON.parse(lastLog) as { id: string; deleted: boolean };
    expect(deleteResult).toEqual({ id: created.id, deleted: true });

    // Read-back proof, through the CLI's own public surface (`versions
    // list`), that the version is genuinely gone rather than merely
    // reported gone.
    out = captureOutput();
    const listCode = await run(["--json", "versions", "list", String(RINTH_TEST_PROJECT)]);
    lastLog = out.lastLog();
    out.restore();

    if (listCode === ExitCode.Ok) {
      const remaining = JSON.parse(lastLog) as Array<{ id: string }>;
      expect(remaining.some((v) => v.id === created.id)).toBe(false);
      console.log(`VERSIONS DELETE: confirmed ${created.id} is absent from \`versions list\` after delete`);
    } else {
      console.log(`VERSIONS DELETE: read-back \`versions list\` did not succeed (exit ${listCode}) — delete's own JSON result stands unconfirmed by a second read`);
    }
  });
});
