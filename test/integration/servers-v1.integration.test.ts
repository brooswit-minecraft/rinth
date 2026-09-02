// RINTH-31/RINTH-32: settles a single open question — does the Archon
// **v1** servers surface (`GET /v1/servers`, distinct from the v0 surface
// probed by servers.integration.test.ts / servers-manage.integration.test.ts)
// accept a labrinth PAT at all? A prior story cut the v1 content-API
// migration as blocked on a per-server GET that 403s; that GET turns out to
// be unnecessary — `servers_v1.list()` takes no server id and returns each
// server's `worlds` array directly. What was never measured is whether v1
// accepts a PAT the same way v0 does.
//
// READ-ONLY: only `list()` is called. `ArchonServersV1Module` also exposes
// `get`/`endIntro`/`resetToOnboarding`; none of those are called here — see
// the ticket's mutating-call refusal.
//
// This is a PROBE, not an assertion: a 401/403/404 from Archon is a
// legitimate, valuable result and must not fail the build. Only a shape the
// client itself shouldn't be able to produce (a non-Error throw, or the
// invalid-token control unexpectedly succeeding) fails a test here.
//
// Reports SHAPES AND COUNTS ONLY. This repo's Actions logs are public: no
// server id, no server name, no world id, no sftp/panel credential is ever
// printed — see servers-manage.integration.test.ts's own comment on this.
// Do not add a field to any log line below without checking it against that
// rule first.

import { describe, expect, test } from "bun:test";
import { AuthFeature, GenericModrinthClient, PanelVersionFeature } from "@modrinth/api-client";
import type { AuthConfig } from "@modrinth/api-client";
import { hasModrinthToken, MODRINTH_TOKEN } from "./harness.ts";

function statusOf(error: unknown): number | undefined {
  return error && typeof error === "object" && "statusCode" in error ? (error as { statusCode?: number }).statusCode : undefined;
}

function messageOf(error: unknown): string {
  return String((error as { message?: unknown })?.message ?? error);
}

function buildClient(token: string): GenericModrinthClient {
  const authConfig: AuthConfig = { token };
  return new GenericModrinthClient({
    userAgent: "rinth-cli-diagnostic-RINTH-31 (+https://github.com/brooswit-minecraft/rinth)",
    features: [new AuthFeature(authConfig), new PanelVersionFeature()],
  });
}

/**
 * Calls `servers_v1.list()` on the given client and reports outcome as
 * either `{ ok: true, status: "2xx", serverCount, worldStats }` or
 * `{ ok: false, status }`. Never throws: a thrown error with no
 * `statusCode` (not a recognized HTTP rejection) is re-thrown, since that is
 * the one shape this probe should fail on.
 */
async function probeV1List(client: GenericModrinthClient): Promise<
  | { ok: true; status: "2xx"; serverCount: number; nonEmptyWorldsCount: number; worldsWithIdCount: number; totalWorldsCount: number }
  | { ok: false; status: number | undefined }
> {
  try {
    const servers = await client.archon.servers_v1.list();
    let nonEmptyWorldsCount = 0;
    let totalWorldsCount = 0;
    let worldsWithIdCount = 0;
    for (const server of servers) {
      if (server.worlds.length > 0) nonEmptyWorldsCount++;
      for (const world of server.worlds) {
        totalWorldsCount++;
        if (typeof world.id === "string" && world.id.length > 0) worldsWithIdCount++;
      }
    }
    return { ok: true, status: "2xx", serverCount: servers.length, nonEmptyWorldsCount, worldsWithIdCount, totalWorldsCount };
  } catch (error) {
    const status = statusOf(error);
    if (status === undefined) {
      // Not a recognized HTTP rejection shape (no statusCode) — a genuine
      // transport/client error, which this probe is allowed to fail on.
      throw error;
    }
    console.log(`SERVERS V1 LIST: rejected => status ${status}: ${messageOf(error)}`);
    return { ok: false, status };
  }
}

describe("integration: servers v1 list (Archon v1 auth probe, RINTH-31)", () => {
  const shouldRun = hasModrinthToken;

  test.skipIf(!shouldRun)(
    "reports whether GET /v1/servers accepts a real PAT, with an invalid-token positive control",
    async () => {
      if (!hasModrinthToken) {
        // Unreachable under skipIf, but keeps the loud-skip guarantee even
        // if this test is ever run directly (bun test <file>) bypassing the
        // describe-level skip.
        console.log("SERVERS V1 LIST PROBE: DID NOT RUN — MODRINTH_TOKEN not set");
        return;
      }

      const realClient = buildClient(MODRINTH_TOKEN as string);
      const realResult = await probeV1List(realClient);

      if (realResult.ok) {
        console.log(
          `SERVERS V1 LIST: real PAT => accepted (200), ${realResult.serverCount} server(s), ` +
            `${realResult.nonEmptyWorldsCount} of ${realResult.serverCount} server(s) have a non-empty worlds array, ` +
            `${realResult.worldsWithIdCount} of ${realResult.totalWorldsCount} world(s) have a non-empty string id`,
        );
      }

      // MANDATORY positive control: the identical call on a separate client
      // built with a literal, never-real, never-derived-from-MODRINTH_TOKEN
      // garbage string — never omit this, a bare 403/404 above means little
      // without it. Mirrors probeReinstallWithInvalidToken's client shape in
      // servers-manage.integration.test.ts.
      const invalidClient = buildClient("rinth-v1-diagnostic-not-a-real-token");
      const invalidResult = await probeV1List(invalidClient);
      if (invalidResult.ok) {
        console.log(
          `SERVERS V1 LIST: invalid-token control => unexpected 2xx (${invalidResult.serverCount} server(s)) — ` +
            `the invalid token was NOT applied on this run; treat the real-PAT result above as inconclusive, not confirmatory.`,
        );
      }

      const realStatus = realResult.ok ? "2xx" : realResult.status;
      const invalidStatus = invalidResult.ok ? "2xx" : invalidResult.status;
      const distinguishable = realStatus !== invalidStatus;

      let interpretation: string;
      if (realResult.ok) {
        interpretation = "v1 accepts a PAT; see world-id counts above for whether a world id is obtainable in CI.";
      } else if (distinguishable) {
        interpretation = "the real PAT and the invalid token got DIFFERENT responses — the boundary is real and credential-shaped.";
      } else {
        interpretation = "the real PAT and the invalid token got an IDENTICAL response — the wall is routing, not credentials.";
      }

      console.log(
        `SERVERS V1 LIST COMPARISON: real PAT => ${realStatus}; invalid token => ${invalidStatus}; ` +
          `distinguishable => ${distinguishable}. This run observed (v1 only): ${interpretation}`,
      );

      // Assert only on shapes the client itself shouldn't be able to
      // produce — never on a particular upstream status. A 401/403/404 on
      // either call is a valid, passing outcome.
      expect(typeof realStatus === "number" || realStatus === "2xx").toBe(true);
      expect(typeof invalidStatus === "number" || invalidStatus === "2xx").toBe(true);
      if (invalidResult.ok) {
        // The one genuinely wrong shape: the invalid-token control must
        // never itself succeed, or it isn't a control — this is not "v1
        // returned an unexpected status", it's the control breaking, so it
        // is the one legitimate failure here rather than a recorded finding.
        throw new Error(
          "invalid-token control unexpectedly succeeded (2xx) — the invalid token was not applied, so this run's real-PAT result cannot be trusted",
        );
      }
    },
  );

  if (!shouldRun) {
    // Belt-and-suspenders loud skip at module-evaluation time: harness.ts
    // already logs the generic "MODRINTH_TOKEN not set" line, but that line
    // doesn't name this probe specifically, and this ticket requires this
    // probe's skip to be unmissable on its own.
    console.log("SERVERS V1 LIST PROBE: DID NOT RUN — MODRINTH_TOKEN not set (see test/integration/harness.ts)");
  }
});
