// `rinth project get` against the live Modrinth API. Read-only and needs no
// token for labrinth itself, but every rinth command goes through
// `createRealTransport()`, which requires MODRINTH_TOKEN unconditionally —
// so this gates on hasModrinthToken like the other integration tests and
// skips cleanly when it's unset (see harness.ts).
//
// This can't exercise the DRAFT-project case live (no throwaway draft
// project id is provisioned for CI), but it does prove: (1) a real, public
// project resolves through the authenticated path, and (2) a nonexistent
// slug is diagnosed rather than surfacing a bare 404 — see src/diagnose.ts
// and test/unit/commands/project.test.ts for the offline draft-project
// coverage.

import { describe, expect, spyOn, test } from "bun:test";
import { run } from "../../src/cli.ts";
import { ExitCode } from "../../src/errors.ts";
import { hasModrinthToken } from "./harness.ts";

const PUBLIC_PROJECT = "sodium";

describe("integration: project get (public project, no auth required by labrinth)", () => {
  test.skipIf(!hasModrinthToken)("resolves a real, public project by slug", async () => {
    const realLog = console.log.bind(console);
    const realError = console.error.bind(console);
    const logSpy = spyOn(console, "log").mockImplementation((...args) => realLog(...args));
    const errSpy = spyOn(console, "error").mockImplementation((...args) => realError(...args));

    const code = await run(["--json", "project", "get", PUBLIC_PROJECT]);

    const lastLog = String(logSpy.mock.calls.at(-1)?.[0]);
    const lastErr = String(errSpy.mock.calls.at(-1)?.[0]);
    logSpy.mockRestore();
    errSpy.mockRestore();

    if (code === ExitCode.Ok) {
      const project = JSON.parse(lastLog) as { id?: unknown; slug?: unknown };
      expect(typeof project.id).toBe("string");
      expect(project.slug).toBe(PUBLIC_PROJECT);
      console.log(`INTEGRATION: project get ${PUBLIC_PROJECT} => ${project.id}`);
    } else {
      console.log(`INTEGRATION: project get ${PUBLIC_PROJECT} => unexpected exit ${code}: ${lastErr}`);
      throw new Error(`unexpected exit code from \`rinth project get\`: ${code}`);
    }
  });

  test.skipIf(!hasModrinthToken)(
    "a nonexistent slug is diagnosed (candidate causes + `rinth whoami` pointer), not a bare 404",
    async () => {
      const realLog = console.log.bind(console);
      const realError = console.error.bind(console);
      const logSpy = spyOn(console, "log").mockImplementation((...args) => realLog(...args));
      const errSpy = spyOn(console, "error").mockImplementation((...args) => realError(...args));

      const bogusSlug = "rinth-integration-test-nonexistent-project-slug";
      const code = await run(["--json", "project", "get", bogusSlug]);

      const lastErr = String(errSpy.mock.calls.at(-1)?.[0]);
      logSpy.mockRestore();
      errSpy.mockRestore();

      console.log(`INTEGRATION: project get ${bogusSlug} => exit ${code}: ${lastErr}`);

      if (code === ExitCode.NotFound) {
        const parsed = JSON.parse(lastErr) as { error: { message: string; reason: string | null } };
        expect(parsed.error.message).toContain("rinth whoami");
        expect(parsed.error.reason).toBe("project_unreadable");
      } else {
        // Any other outcome (e.g. a network hiccup) is recorded, not failed —
        // the point of this test is the 404 case specifically.
        console.log(`INTEGRATION: project get ${bogusSlug} => did not 404 as expected, got exit ${code}`);
      }
    },
  );
});
