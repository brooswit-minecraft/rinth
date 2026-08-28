// `versions list`/`versions latest` against a real, public Modrinth
// project (Sodium — well-known, has many release versions). Read-only and
// needs no token for labrinth itself, but every rinth command goes through
// `createRealTransport()`, which requires MODRINTH_TOKEN unconditionally
// (see src/auth.ts) — so this still gates on hasModrinthToken, exactly
// like the other integration tests, and skips cleanly with a log line
// when it's unset.

import { describe, expect, spyOn, test } from "bun:test";
import { run } from "../../src/cli.ts";
import { ExitCode } from "../../src/errors.ts";
import { hasModrinthToken } from "./harness.ts";

const PUBLIC_PROJECT = "sodium";

describe("integration: versions list/latest (public project, no auth required by labrinth)", () => {
  test.skipIf(!hasModrinthToken)("versions list returns an array of versions for a public project", async () => {
    const realLog = console.log.bind(console);
    const realError = console.error.bind(console);
    const logSpy = spyOn(console, "log").mockImplementation((...args) => realLog(...args));
    const errSpy = spyOn(console, "error").mockImplementation((...args) => realError(...args));

    const code = await run(["--json", "versions", "list", PUBLIC_PROJECT]);

    const lastLog = String(logSpy.mock.calls.at(-1)?.[0]);
    const lastErr = String(errSpy.mock.calls.at(-1)?.[0]);
    logSpy.mockRestore();
    errSpy.mockRestore();

    if (code === ExitCode.Ok) {
      const versions = JSON.parse(lastLog) as unknown[];
      expect(Array.isArray(versions)).toBe(true);
      console.log(`INTEGRATION: versions list ${PUBLIC_PROJECT} => ${versions.length} version(s)`);
    } else {
      console.log(`INTEGRATION: versions list ${PUBLIC_PROJECT} => unexpected exit ${code}: ${lastErr}`);
      throw new Error(`unexpected exit code from \`rinth versions list\`: ${code}`);
    }
  });

  test.skipIf(!hasModrinthToken)("versions latest returns the newest version for a public project", async () => {
    const realLog = console.log.bind(console);
    const realError = console.error.bind(console);
    const logSpy = spyOn(console, "log").mockImplementation((...args) => realLog(...args));
    const errSpy = spyOn(console, "error").mockImplementation((...args) => realError(...args));

    const code = await run(["--json", "versions", "latest", PUBLIC_PROJECT]);

    const lastLog = String(logSpy.mock.calls.at(-1)?.[0]);
    const lastErr = String(errSpy.mock.calls.at(-1)?.[0]);
    logSpy.mockRestore();
    errSpy.mockRestore();

    if (code === ExitCode.Ok) {
      const version = JSON.parse(lastLog) as { id?: unknown; version_number?: unknown };
      expect(typeof version.id).toBe("string");
      console.log(`INTEGRATION: versions latest ${PUBLIC_PROJECT} => ${version.id} (${version.version_number})`);
    } else {
      console.log(`INTEGRATION: versions latest ${PUBLIC_PROJECT} => unexpected exit ${code}: ${lastErr}`);
      throw new Error(`unexpected exit code from \`rinth versions latest\`: ${code}`);
    }
  });
});
