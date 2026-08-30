// `rinth project create` against the live Modrinth API. Gated on BOTH
// `MODRINTH_TOKEN` and `RINTH_TEST_CREATE_PROJECT` (see harness.ts) since
// this creates a real project if it runs at all — a slug/title/license the
// ticket's operator would recognize as throwaway. It cleans up after
// itself: the created draft is deleted via `client.labrinth.projects_v2.delete()`
// directly (same pattern as `publish.integration.test.ts`'s version
// cleanup) — `Transport` deliberately has no `deleteProject` method since
// no rinth command needs one.
//
// This environment has no MODRINTH_TOKEN, so this test has NOT been
// exercised live — see the PR body and README. It is written to be correct
// when a token (and the opt-in) are present, not merely to skip cleanly.
//
// `project submit`'s success path is deliberately NOT exercised here or
// anywhere else live: submitting a real project moves it into Modrinth's
// human moderation queue, a side effect on a third party (the moderation
// team) that a throwaway-and-delete pattern cannot undo the way a deleted
// draft or version can. `project submit`'s REFUSAL path (a project that is
// not in a submittable state) has no such side effect and is covered live
// in project-submit.integration.test.ts, against a real public project,
// without ever attempting a write. See README "Known gaps / follow-ups".

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { AuthFeature, GenericModrinthClient } from "@modrinth/api-client";
import type { AuthConfig } from "@modrinth/api-client";
import { run } from "../../src/cli.ts";
import { ExitCode } from "../../src/errors.ts";
import { hasModrinthToken, MODRINTH_TOKEN, RINTH_TEST_CREATE_PROJECT } from "./harness.ts";

const canRun = hasModrinthToken && RINTH_TEST_CREATE_PROJECT;

describe("integration: project create (creates and deletes a real, throwaway draft project)", () => {
  let createdProjectId: string | undefined;

  afterEach(async () => {
    if (createdProjectId && MODRINTH_TOKEN) {
      const authConfig: AuthConfig = { token: MODRINTH_TOKEN };
      const client = new GenericModrinthClient({
        userAgent: "rinth-cli (+https://github.com/brooswit-minecraft/rinth) [integration test cleanup]",
        features: [new AuthFeature(authConfig)],
      });
      await client.labrinth.projects_v2.delete(createdProjectId).catch((err: unknown) => {
        console.error(`INTEGRATION cleanup: failed to delete test project ${createdProjectId}:`, err);
      });
      createdProjectId = undefined;
    }
  });

  test.skipIf(!canRun)("creates a draft project with the full required field set, then deletes it", async () => {
    const slug = `rinth-cli-integration-test-${Date.now()}`;

    const realLog = console.log.bind(console);
    const realError = console.error.bind(console);
    const logSpy = spyOn(console, "log").mockImplementation((...args) => realLog(...args));
    const errSpy = spyOn(console, "error").mockImplementation((...args) => realError(...args));

    const code = await run([
      "--json",
      "project",
      "create",
      "--slug",
      slug,
      "--title",
      "rinth CLI integration test (safe to delete)",
      "--description",
      "Temporary project created by rinth's integration test suite.",
      "--body",
      "Temporary — created and immediately deleted by rinth's integration test suite.",
      "--project-type",
      "mod",
      "--client-side",
      "unsupported",
      "--server-side",
      "unsupported",
      "--license",
      "MIT",
    ]);

    const lastLog = String(logSpy.mock.calls.at(-1)?.[0]);
    const lastErr = String(errSpy.mock.calls.at(-1)?.[0]);
    logSpy.mockRestore();
    errSpy.mockRestore();

    if (code !== ExitCode.Ok) {
      throw new Error(`unexpected exit code from \`rinth project create\`: ${code}: ${lastErr}`);
    }

    const created = JSON.parse(lastLog) as { id: unknown; slug: unknown; status: unknown };
    createdProjectId = String(created.id);

    console.log(`INTEGRATION: project create ${slug} => created project ${created.id} (status: ${created.status})`);
    expect(typeof created.id).toBe("string");
    expect(created.slug).toBe(slug);
    expect(created.status).toBe("draft");
  });
});
