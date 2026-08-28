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
import { AuthFeature, GenericModrinthClient, PanelVersionFeature } from "@modrinth/api-client";
import type { AuthConfig } from "@modrinth/api-client";
import { run } from "../../src/cli.ts";
import { ExitCode } from "../../src/errors.ts";
import { printHuman } from "../../src/output.ts";
import { hasModrinthToken, hasTestServerId, RINTH_TEST_SERVER_ID } from "./harness.ts";

/**
 * CAPTURES the command's output instead of forwarding it to the real
 * console. Do not restore forwarding: these tests run `servers list` /
 * `servers get`, whose `--json` payload carries the live server's name and
 * `net: { ip, port, domain }`, and this repository's Actions logs are
 * public. Every caller restores before printing its own derived summary, so
 * the diagnostics still reach the log — only the raw payloads are withheld.
 * (Same fix as whoami/servers integration tests; see KAN-721 epic review.)
 */
function captureOutput() {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
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

function statusOf(error: unknown): number | undefined {
  return error && typeof error === "object" && "statusCode" in error ? (error as { statusCode?: number }).statusCode : undefined;
}

function messageOf(error: unknown): string {
  return String((error as { message?: unknown })?.message ?? error);
}

/**
 * KAN-735 item 1(c) final discriminator (epic comments 14607/14608, tightened
 * by 14612/14613): does POST /modrinth/v0/servers/<id>/reinstall 404 even
 * before auth runs (a router-level "no such route", hypothesis A) or only
 * after a real token is checked (route exists, auth gate first)?
 *
 * A garbage-token reinstall call alone proves nothing without a POSITIVE
 * CONTROL on the *same client instance*: without one there is no evidence
 * the invalid token was actually applied on this run rather than, say, a
 * stale/rebuilt feature silently falling back to some other credential —
 * exactly the kind of silent no-op that already slipped through once on
 * this story (the get-precondition that skipped the power call). So this
 * also calls `servers_v0.list()` — proven to return 200 with a REAL token
 * in every run so far — through the *identical* diagnostic client. If the
 * control also 404s here, the token plumbing is unverified and A-vs-C must
 * be recorded as unresolved, not assumed.
 *
 * A literal garbage string that was never a real credential — never the
 * real MODRINTH_TOKEN, never registered for redaction — makes both calls
 * zero-risk regardless of outcome. Bypasses the `Transport`/command layer
 * (same pattern as the other raw diagnostics in this suite) since
 * `createRealTransport()` only ever reads the real `MODRINTH_TOKEN` env var.
 */
async function probeReinstallWithInvalidToken(serverId: string, projectId: string, versionId: string): Promise<void> {
  const authConfig: AuthConfig = { token: "kan735-diagnostic-not-a-real-token" };
  const diagnosticClient = new GenericModrinthClient({
    userAgent: "rinth-cli-diagnostic-KAN-735 (+https://github.com/brooswit-minecraft/rinth)",
    features: [new AuthFeature(authConfig), new PanelVersionFeature()],
  });

  let controlStatus: number | "2xx" | undefined;
  try {
    await diagnosticClient.archon.servers_v0.list();
    controlStatus = "2xx";
  } catch (error) {
    controlStatus = statusOf(error);
    printHuman(
      `SERVERS LIST: same invalid-token client, positive control => status ${controlStatus ?? "unknown"}: ${messageOf(error)}`,
    );
  }
  if (controlStatus === "2xx") {
    printHuman(
      `SERVERS LIST: same invalid-token client, positive control => unexpected 2xx — the invalid token was NOT applied on this run; treat the reinstall result below as inconclusive, not confirmatory, and record A-vs-C as unresolved.`,
    );
  }

  let reinstallStatus: number | "2xx" | undefined;
  try {
    await diagnosticClient.archon.servers_v0.reinstall(serverId, { project_id: projectId, version_id: versionId });
    reinstallStatus = "2xx";
    printHuman(
      `SERVERS UPSTREAM: reinstall with an INVALID token unexpectedly resolved without throwing — treat as a 2xx and report loudly on KAN-735.`,
    );
  } catch (error) {
    reinstallStatus = statusOf(error);
    printHuman(
      `SERVERS UPSTREAM: reinstall with an INVALID token (auth-vs-router control) => status ${reinstallStatus ?? "unknown"}: ${messageOf(error)}`,
    );
  }

  const controlProvesAuthRan = controlStatus === 401 || controlStatus === 403;
  printHuman(
    `SERVERS UPSTREAM: invalid-token probe verdict => positive control ${controlProvesAuthRan ? "confirms" : "does NOT confirm"} the invalid token reached auth (list => ${controlStatus}); reinstall => ${reinstallStatus}. ${controlProvesAuthRan ? "A-vs-C is decidable from this run." : "A-vs-C must be recorded as unresolved."}`,
  );
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

          await probeReinstallWithInvalidToken(id, FORCED_PROBE_PROJECT, FORCED_PROBE_VERSION);

          // A second, DIFFERENT real public modpack ("Fabulously Optimized",
          // 1KVo5zza/8ikTAvpG) against the REAL server was also
          // epic-authorized and already ran once (run 33203193133): same
          // 404 "not found" as the first pack, ruling out a pair-specific
          // cause (recorded on KAN-735). Per the same "don't repeat a
          // real-server write attempt" guardrail as the first probe above,
          // this branch does not re-run it on future dispatches.
          console.log(
            `SERVERS UPSTREAM: the second epic-authorized real-server reinstall probe (a different real modpack) already ran too (see KAN-735); not repeating it`,
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
