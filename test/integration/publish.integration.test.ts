// `rinth publish` against a real project — gated on BOTH `MODRINTH_TOKEN`
// (the general integration gate) AND `RINTH_TEST_PROJECT`, since this test
// creates a real version on a real project if it runs at all. Neither is
// set in this environment, so this skips cleanly, logging that it needs
// RINTH_TEST_PROJECT (see harness.ts). If it ever does run: it publishes a
// throwaway version numbered `0.0.0-rinth-test-<timestamp>` (never collides
// with a real release) and deletes it afterwards via the API client's
// `versions_v2.deleteVersion(id)` directly — `Transport` deliberately has
// no `deleteVersion` method, since no rinth command needs one; this test's
// cleanup step is the one exception.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { AuthFeature, GenericModrinthClient } from "@modrinth/api-client";
import type { AuthConfig } from "@modrinth/api-client";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli.ts";
import { ExitCode } from "../../src/errors.ts";
import { hasModrinthToken, hasTestProject, MODRINTH_TOKEN, RINTH_TEST_PROJECT } from "./harness.ts";

const canRun = hasModrinthToken && hasTestProject;

describe("integration: publish (creates and deletes a real, throwaway version)", () => {
  let dir: string | undefined;
  let createdVersionId: string | undefined;

  afterEach(async () => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
    if (createdVersionId && MODRINTH_TOKEN) {
      const authConfig: AuthConfig = { token: MODRINTH_TOKEN };
      const client = new GenericModrinthClient({
        userAgent: "rinth-cli (+https://github.com/brooswit-minecraft/rinth) [integration test cleanup]",
        features: [new AuthFeature(authConfig)],
      });
      await client.labrinth.versions_v2.deleteVersion(createdVersionId).catch((err: unknown) => {
        console.error(`INTEGRATION cleanup: failed to delete test version ${createdVersionId}:`, err);
      });
      createdVersionId = undefined;
    }
  });

  test.skipIf(!canRun)("publishes a version with an uploaded file, then deletes it", async () => {
    dir = mkdtempSync(join(tmpdir(), "rinth-publish-integration-"));
    const filePath = join(dir, "rinth-integration-test.mrpack");
    writeFileSync(filePath, "rinth integration test placeholder file contents");

    const versionNumber = `0.0.0-rinth-test-${Date.now()}`;

    const realLog = console.log.bind(console);
    const realError = console.error.bind(console);
    const logSpy = spyOn(console, "log").mockImplementation((...args) => realLog(...args));
    const errSpy = spyOn(console, "error").mockImplementation((...args) => realError(...args));

    const code = await run([
      "--json",
      "publish",
      String(RINTH_TEST_PROJECT),
      "--file",
      filePath,
      "--version",
      versionNumber,
      "--changelog",
      "rinth integration test — safe to delete",
    ]);

    const lastLog = String(logSpy.mock.calls.at(-1)?.[0]);
    const lastErr = String(errSpy.mock.calls.at(-1)?.[0]);
    logSpy.mockRestore();
    errSpy.mockRestore();

    if (code !== ExitCode.Ok) {
      throw new Error(`unexpected exit code from \`rinth publish\`: ${code}: ${lastErr}`);
    }

    const created = JSON.parse(lastLog) as { id: unknown; version_number: unknown };
    createdVersionId = String(created.id);

    console.log(`INTEGRATION: publish ${RINTH_TEST_PROJECT} => created version ${created.id} (${created.version_number})`);
    expect(typeof created.id).toBe("string");
    expect(created.version_number).toBe(versionNumber);
  });
});
