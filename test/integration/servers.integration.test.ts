// The empirical auth spike (half 2/2): does the Archon servers API accept
// the same PAT as its Bearer token, and does it reveal the real, live
// server that was purchased on this account? Runs for real, read-only
// (list only — no power actions), only when MODRINTH_TOKEN is set.
//
// Like the whoami spike, a clean rejection (401/403 -> AuthMissing) is a
// valid recorded outcome and does not fail this test.

import { describe, expect, spyOn, test } from "bun:test";
import { AuthFeature, GenericModrinthClient, PanelVersionFeature } from "@modrinth/api-client";
import type { AuthConfig } from "@modrinth/api-client";
import { run } from "../../src/cli.ts";
import { ExitCode } from "../../src/errors.ts";
import { printHuman } from "../../src/output.ts";
import { hasModrinthToken, MODRINTH_TOKEN } from "./harness.ts";

/**
 * KAN-735 item 1(d) diagnostic: `current_user_permissions` is on the raw
 * Archon `Server` the list endpoint returns, but `toPublicServer()`
 * deliberately drops it (see src/client/index.ts's `PublicServer`) — it is
 * not part of the CLI's public output contract and must stay that way, so
 * it cannot be read off `rinth servers list --json`. This talks to the raw
 * `@modrinth/api-client` client directly (same token, same
 * Auth/PanelVersion features `createRealTransport()` uses), bypassing the
 * `Transport`/command layer entirely, purely to answer the diagnosis — it
 * never feeds into anything the CLI prints for a real user. Printed through
 * `printHuman()` (the same redaction path as everything else) even though a
 * permissions bitmask carries no secret.
 */
async function logCurrentUserPermissions(): Promise<void> {
  if (!MODRINTH_TOKEN) return;
  try {
    const authConfig: AuthConfig = { token: MODRINTH_TOKEN };
    const diagnosticClient = new GenericModrinthClient({
      userAgent: "rinth-cli-diagnostic-KAN-735 (+https://github.com/brooswit-minecraft/rinth)",
      features: [new AuthFeature(authConfig), new PanelVersionFeature()],
    });
    const raw = await diagnosticClient.archon.servers_v0.list();
    for (const server of raw.servers) {
      printHuman(
        `DIAGNOSTIC (KAN-735 item 1d): server ${server.server_id} current_user_permissions=${server.current_user_permissions}`,
      );
    }
  } catch (error) {
    printHuman(`DIAGNOSTIC (KAN-735 item 1d): could not read current_user_permissions: ${String(error)}`);
  }
}

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
        await logCurrentUserPermissions();
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
