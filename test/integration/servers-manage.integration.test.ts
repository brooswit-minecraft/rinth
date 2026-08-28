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
        // that currently has NO modpack upstream would ordinarily leave it
        // with no way back if this test were interrupted. Only round-trip
        // (re-apply the SAME project/version) when one is already
        // configured — that still exercises the real `upstream` command end
        // to end while remaining fully restorable by construction.
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
          // KAN-735 item 1(c): `upstream`/`reinstall` was the one per-server
          // endpoint never directly exercised (get/power/ws all 403, but a
          // round-trip needs a known existing modpack to restore, which a
          // blocked `get` can't supply). The epic authorized exactly ONE
          // forced attempt against the real server (KAN-735 comments
          // 14565/14568/14570), using a real public modpack rather than a
          // fake id so a surprise success would leave the server in a valid
          // state — that attempt already ran (run 33202645270) and got
          // HTTP 404 "not found" on POST /modrinth/v0/servers/<id>/reinstall
          // (recorded on KAN-735). Per that guardrail this branch does NOT
          // repeat the real-server attempt on every future run; it only
          // runs the safe disambiguation probe below.
          const FORCED_PROBE_PROJECT = "t1tOiUHZ"; // "Create+" — real, public, ~426k downloads; same project schematic (KAN-717) already used.
          const FORCED_PROBE_VERSION = "BSg2ZS8u"; // "Create+ 6.0.0 Alpha f" — a real version of that project.
          console.log(
            `SERVERS UPSTREAM: ${id} has no known existing modpack to round-trip (${before ? JSON.stringify(before.upstream) : "get was blocked"}) — the one epic-authorized real-server reinstall probe already ran (see KAN-735); not repeating it`,
          );

          // KAN-735 item 1(c) follow-up: the real probe's 404 (not 403) is
          // ambiguous between "our client built the wrong route/body" and
          // "Archon rejected THIS request specifically" (e.g. hides an
          // unauthorized resource behind 404 rather than 403, same family
          // as the other three denials, just a different status).
          // Comparing against an OBVIOUSLY NONEXISTENT server id (same real
          // project/version) disambiguates safely: no real server can ever
          // match this id, on this account or anyone else's, so this can
          // never mutate anything — safe to run on every dispatch.
          const BOGUS_SERVER_ID = "00000000-0000-0000-0000-000000000000";
          const bogusOut = captureOutput();
          const bogusCode = await run([
            "--json",
            "servers",
            "upstream",
            BOGUS_SERVER_ID,
            "--project",
            FORCED_PROBE_PROJECT,
            "--version",
            FORCED_PROBE_VERSION,
          ]);
          const bogusLog = bogusOut.lastLog();
          const bogusErr = bogusOut.lastErr();
          bogusOut.restore();
          console.log(
            `SERVERS UPSTREAM: same probe against a nonexistent server id (route-vs-auth control) => exit ${bogusCode}: ${detailFor(bogusCode, bogusLog, bogusErr)}`,
          );

          // 403-vs-404 baseline on the same bogus id: does `get` (already
          // measured 403 on the real id) behave the same way here, or does
          // Archon distinguish "exists but forbidden" (403) from "doesn't
          // exist" (404) at the routing layer? Also zero risk.
          const bogusGetOut = captureOutput();
          const bogusGetCode = await run(["--json", "servers", "get", BOGUS_SERVER_ID]);
          const bogusGetLog = bogusGetOut.lastLog();
          const bogusGetErr = bogusGetOut.lastErr();
          bogusGetOut.restore();
          console.log(
            `SERVERS GET: same nonexistent server id (403-vs-404 baseline) => exit ${bogusGetCode}: ${detailFor(bogusGetCode, bogusGetLog, bogusGetErr)}`,
          );

          // Second, DIFFERENT real public modpack against the REAL server
          // (epic-authorized, KAN-735 comment on this ticket): tests
          // whether the 404 is specific to the Create+ project/version pair
          // (pair-dependent, e.g. genuinely "that modpack not found") or
          // happens regardless of which real pack is requested
          // (pair-independent — points at the route/identity/first-install
          // hypotheses instead). Still within the human's ground rules: the
          // server is confirmed fresh/empty, and a 2xx here would just
          // install a second real, well-known public modpack — acceptable,
          // not a failure mode. The `finally` below still restarts either way.
          const SECOND_PROBE_PROJECT = "1KVo5zza"; // "Fabulously Optimized" — real, public, well-known.
          const SECOND_PROBE_VERSION = "8ikTAvpG"; // a real version of that project.
          const secondOut = captureOutput();
          const secondCode = await run([
            "--json",
            "servers",
            "upstream",
            id,
            "--project",
            SECOND_PROBE_PROJECT,
            "--version",
            SECOND_PROBE_VERSION,
          ]);
          const secondLog = secondOut.lastLog();
          const secondErr = secondOut.lastErr();
          secondOut.restore();
          console.log(
            `SERVERS UPSTREAM: second real modpack against the real server (pair-dependence check) => exit ${secondCode}: ${detailFor(secondCode, secondLog, secondErr)}`,
          );
          if (secondCode === ExitCode.Ok) {
            console.log(
              `SERVERS UPSTREAM: *** LOUD NOTICE *** the second forced reinstall probe SUCCEEDED on ${id}. Report immediately on KAN-735/KAN-720/KAN-714.`,
            );
          }
          expect([ExitCode.Ok, ExitCode.AuthMissing, ExitCode.NotFound, ExitCode.ApiError] as number[]).toContain(
            secondCode,
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
