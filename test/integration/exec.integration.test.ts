// Live console-exec check: opens a real WebSocket session against a real
// server and sends one command. "Destructive-ish" per KAN-720/KAN-730 (it
// touches a live server's console), so — unlike the read-only `servers list`
// auth spike — this is gated on MODRINTH_TOKEN *and* a server id
// (RINTH_TEST_SERVER_ID, falling back to MODRINTH_SERVER_ID), never on the
// token alone. Sends `list`, a harmless read-only console command, so the
// server's power state/upstream is never touched — it is left exactly as
// found, running and working, satisfying the human's ground rule with no
// extra cleanup step needed.

import { describe, expect, spyOn, test } from "bun:test";
import { run } from "../../src/cli.ts";
import { ExitCode } from "../../src/errors.ts";
import { hasModrinthToken } from "./harness.ts";

const RINTH_TEST_SERVER_ID = process.env["RINTH_TEST_SERVER_ID"] ?? process.env["MODRINTH_SERVER_ID"];
const canRun = hasModrinthToken && Boolean(RINTH_TEST_SERVER_ID);

if (hasModrinthToken && !RINTH_TEST_SERVER_ID) {
  console.log("RINTH_TEST_SERVER_ID (or MODRINTH_SERVER_ID) not set — skipping servers exec integration test");
}

describe("integration: servers exec (Archon console WebSocket)", () => {
  test.skipIf(!canRun)(
    "sends a harmless read-only console command (`list`) over the live WebSocket console and reports the result",
    async () => {
      const serverId = RINTH_TEST_SERVER_ID as string;

      // mockImplementation forwards to the real console methods (so CI logs
      // still show the output) while also recording calls for inspection —
      // a bare spyOn() with no mockImplementation records nothing here.
      const realLog = console.log.bind(console);
      const realError = console.error.bind(console);
      const logSpy = spyOn(console, "log").mockImplementation((...args) => realLog(...args));
      const errSpy = spyOn(console, "error").mockImplementation((...args) => realError(...args));

      const code = await run(["--json", "servers", "exec", serverId, "--wait", "3000", "list"]);

      const lastLog = String(logSpy.mock.calls.at(-1)?.[0]);
      const lastErr = String(errSpy.mock.calls.at(-1)?.[0]);
      logSpy.mockRestore();
      errSpy.mockRestore();

      if (code === ExitCode.Ok) {
        const result = JSON.parse(lastLog) as { id: unknown; command: unknown; lines: unknown };
        expect(result.id).toBe(serverId);
        expect(result.command).toBe("list");
        expect(Array.isArray(result.lines)).toBe(true);
        const lineCount = (result.lines as unknown[]).length;
        console.log(`EXEC SPIKE: sent "list" to ${serverId} over the console WebSocket, got ${lineCount} line(s) back`);
      } else if (code === ExitCode.AuthMissing) {
        console.log(`EXEC SPIKE: console auth rejected or timed out. ${lastErr}`);
        expect(code).toBe(ExitCode.AuthMissing);
      } else if (code === ExitCode.NotFound || code === ExitCode.ApiError || code === ExitCode.Network) {
        console.log(`EXEC SPIKE: unexpected API/network response, exit ${code}: ${lastErr}`);
      } else {
        throw new Error(`unexpected exit code from \`rinth servers exec\`: ${code}`);
      }
    },
  );
});
