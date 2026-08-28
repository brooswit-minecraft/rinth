// The empirical auth spike (half 2/2): does the Archon servers API accept
// the same PAT as its Bearer token, and does it reveal the real, live
// server that was purchased on this account? Runs for real, read-only
// (list only — no power actions), only when MODRINTH_TOKEN is set.
//
// Like the whoami spike, a clean rejection (401/403 -> AuthMissing) is a
// valid recorded outcome and does not fail this test.

import { describe, expect, spyOn, test } from "bun:test";
import { run } from "../../src/cli.ts";
import { ExitCode } from "../../src/errors.ts";
import { hasModrinthToken } from "./harness.ts";

describe("integration: servers list (Archon auth spike)", () => {
  test.skipIf(!hasModrinthToken)(
    "reports whether the PAT is accepted by the Archon servers API, and the live server id if any",
    async () => {
      // mockImplementation forwards to the real console methods (so CI logs
      // still show the output) while also recording calls for inspection —
      // a bare spyOn() with no mockImplementation records nothing here.
      const realLog = console.log.bind(console);
      const realError = console.error.bind(console);
      const logSpy = spyOn(console, "log").mockImplementation((...args) => realLog(...args));
      const errSpy = spyOn(console, "error").mockImplementation((...args) => realError(...args));

      const code = await run(["--json", "servers", "list"]);

      const lastLog = String(logSpy.mock.calls.at(-1)?.[0]);
      const lastErr = String(errSpy.mock.calls.at(-1)?.[0]);
      logSpy.mockRestore();
      errSpy.mockRestore();

      if (code === ExitCode.Ok) {
        const { servers } = JSON.parse(lastLog) as { servers: Array<{ id: unknown }> };
        console.log(
          `AUTH SPIKE: Archon GET /v0/servers (Bearer PAT + X-Panel-Version: 1) => accepted (200), ${servers.length} server(s)`,
        );
        for (const server of servers) {
          console.log(`AUTH SPIKE: live server id = ${server.id}`);
        }
        expect(Array.isArray(servers)).toBe(true);
      } else if (code === ExitCode.AuthMissing) {
        console.log(`AUTH SPIKE: Archon GET /v0/servers (Bearer PAT) => rejected (401/403). ${lastErr}`);
        expect(code).toBe(ExitCode.AuthMissing);
      } else if (code === ExitCode.ApiError || code === ExitCode.NotFound || code === ExitCode.Network) {
        console.log(`AUTH SPIKE: Archon GET /v0/servers => unexpected API/network response, exit ${code}: ${lastErr}`);
      } else {
        throw new Error(`unexpected exit code from \`rinth servers list\`: ${code}`);
      }
    },
  );
});
