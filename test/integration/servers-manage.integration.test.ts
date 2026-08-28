// Integration coverage for `servers get`/`power`/`upstream` against the
// live Modrinth API. `get` only needs a token (it discovers a server id via
// `servers list` when RINTH_TEST_SERVER_ID/MODRINTH_SERVER_ID isn't set);
// `power`/`upstream` are DESTRUCTIVE and additionally gated on
// RINTH_TEST_SERVER_ID (or MODRINTH_SERVER_ID) so they never run from just a
// token — see README and harness.ts.
//
// A clean rejection (401/403 -> AuthMissing) or any other non-2xx outcome is
// a valid recorded result and does not fail these tests; the point is to
// record what the live API actually does. Only a shape the CLI itself
// shouldn't be able to produce (Usage/Generic) fails a test.

import { describe, expect, spyOn, test } from "bun:test";
import { run } from "../../src/cli.ts";
import { ExitCode } from "../../src/errors.ts";
import { hasModrinthToken, hasTestServerId, RINTH_TEST_SERVER_ID } from "./harness.ts";

/** mockImplementation forwards to the real console methods (so CI logs still show the output) while recording calls. */
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

interface ServerJson {
  status: string;
  upstream: { kind: string; project_id: string; version_id: string } | null;
}

/**
 * On success the result is on stdout (`log`); on failure stdout is left
 * empty by the `--json` contract and the (KAN-735 item 4: now status- and
 * endpoint-carrying) error is on stderr (`err`) instead — pick whichever
 * one actually has the detail worth logging.
 */
function detailFor(code: number, log: string, err: string): string {
  return code === ExitCode.Ok ? log : err;
}

describe("integration: servers get", () => {
  test.skipIf(!hasModrinthToken)(
    "reports server details for a real server id, with no sftp/panel credentials in the output",
    async () => {
      let out = captureOutput();
      const listCode = await run(["--json", "servers", "list"]);
      let lastLog = out.lastLog();
      out.restore();

      if (listCode !== ExitCode.Ok) {
        console.log(`SERVERS GET: \`servers list\` did not succeed (exit ${listCode}) — skipping, nothing to get`);
        return;
      }

      const { servers } = JSON.parse(lastLog) as { servers: Array<{ id: string }> };
      const id = RINTH_TEST_SERVER_ID ?? servers[0]?.id;
      if (!id) {
        console.log("SERVERS GET: no live server on this account — skipping");
        return;
      }

      out = captureOutput();
      const code = await run(["--json", "servers", "get", id]);
      lastLog = out.lastLog();
      const lastErr = out.lastErr();
      out.restore();

      if (code === ExitCode.Ok) {
        expect(lastLog).not.toContain("sftp_password");
        expect(lastLog).not.toContain("sftp_username");
        expect(lastLog).not.toContain("\"token\"");
        console.log(`SERVERS GET: ${id} => accepted (200), no credential fields present`);
      } else if (code === ExitCode.AuthMissing || code === ExitCode.NotFound) {
        console.log(`SERVERS GET: ${id} => exit ${code} (${lastErr}); recorded, not a test failure`);
      } else if (code === ExitCode.ApiError || code === ExitCode.Network) {
        console.log(`SERVERS GET: ${id} => unexpected API/network response, exit ${code}: ${lastErr}`);
      } else {
        throw new Error(`unexpected exit code from \`rinth servers get\`: ${code}`);
      }
    },
  );
});

describe("integration: servers power / upstream (DESTRUCTIVE — gated on RINTH_TEST_SERVER_ID/MODRINTH_SERVER_ID)", () => {
  test.skipIf(!hasModrinthToken || !hasTestServerId)(
    "power restart is accepted and an existing modpack upstream round-trips, always ending with the server running",
    async () => {
      const id = RINTH_TEST_SERVER_ID as string;

      async function getServer(): Promise<{ code: number; server: ServerJson | undefined }> {
        const out = captureOutput();
        const code = await run(["--json", "servers", "get", id]);
        const lastLog = out.lastLog();
        out.restore();
        return { code, server: code === ExitCode.Ok ? (JSON.parse(lastLog) as ServerJson) : undefined };
      }

      const { code: beforeCode, server: before } = await getServer();
      if (beforeCode !== ExitCode.Ok || !before) {
        // KAN-735 item 1(c): whether `get` being blocked (403) also means
        // `power`/`upstream` are blocked is exactly the open question — so
        // a failed precondition read must NOT skip the rest of this test.
        // `power restart` is safe to attempt unconditionally regardless of
        // starting state (it satisfies the "leave it running" ground rule
        // either way); only the upstream round-trip genuinely needs `before`
        // (to know there IS an existing modpack upstream to safely
        // re-apply), so that part alone still skips without it.
        console.log(
          `SERVERS POWER/UPSTREAM: could not read ${id} before testing (exit ${beforeCode}) — proceeding with power restart anyway to determine whether it 403s too`,
        );
      } else {
        console.log(`SERVERS POWER/UPSTREAM: ${id} starting state: status=${before.status} upstream=${JSON.stringify(before.upstream)}`);
      }

      try {
        const out = captureOutput();
        const powerCode = await run(["--json", "servers", "power", id, "restart"]);
        const powerLog = out.lastLog();
        const powerErr = out.lastErr();
        out.restore();
        console.log(`SERVERS POWER: restart => exit ${powerCode}: ${detailFor(powerCode, powerLog, powerErr)}`);
        expect([ExitCode.Ok, ExitCode.AuthMissing, ExitCode.NotFound, ExitCode.ApiError] as number[]).toContain(
          powerCode,
        );

        // There is no "clear upstream" primitive in this CLI (matching the
        // Archon `reinstall` endpoint it wraps), so re-pointing a server
        // that currently has NO modpack upstream would leave it with no way
        // back if this test were interrupted. Only round-trip (re-apply the
        // SAME project/version) when one is already configured — that still
        // exercises the real `upstream` command end to end while remaining
        // fully restorable by construction. Requires `before` (see above);
        // skip cleanly (do not guess a project/version) when it's missing.
        if (before && before.upstream && before.upstream.kind === "modpack") {
          const upstreamOut = captureOutput();
          const upstreamCode = await run([
            "--json",
            "servers",
            "upstream",
            id,
            "--project",
            before.upstream.project_id,
            "--version",
            before.upstream.version_id,
          ]);
          const upstreamLog = upstreamOut.lastLog();
          const upstreamErr = upstreamOut.lastErr();
          upstreamOut.restore();
          console.log(
            `SERVERS UPSTREAM: round-trip re-point => exit ${upstreamCode}: ${detailFor(upstreamCode, upstreamLog, upstreamErr)}`,
          );
          expect([ExitCode.Ok, ExitCode.AuthMissing, ExitCode.NotFound, ExitCode.ApiError] as number[]).toContain(
            upstreamCode,
          );
        } else {
          console.log(
            before
              ? `SERVERS UPSTREAM: ${id} has no modpack upstream configured (${JSON.stringify(before.upstream)}) — skipping the round-trip so this run never sets one it can't clear back`
              : `SERVERS UPSTREAM: could not read ${id}'s starting upstream — skipping the round-trip (nothing safe to restore to)`,
          );
        }
      } finally {
        // Ground rule from the human: always end with the server running,
        // regardless of what happened above or whether it threw.
        const restoreOut = captureOutput();
        const restoreCode = await run(["--json", "servers", "power", id, "restart"]);
        const restoreLog = restoreOut.lastLog();
        const restoreErr = restoreOut.lastErr();
        restoreOut.restore();
        console.log(
          `SERVERS POWER/UPSTREAM: final restart to leave ${id} running => exit ${restoreCode}: ${detailFor(restoreCode, restoreLog, restoreErr)}`,
        );
      }
    },
  );
});
