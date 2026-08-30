// `rinth project icon` against a real project — gated on BOTH
// `MODRINTH_TOKEN` (the general integration gate) AND `RINTH_TEST_PROJECT`
// (the same double-gate `project-edit.integration.test.ts` uses), since
// this MUTATES a real project's icon. With only `MODRINTH_TOKEN` set, it
// skips cleanly, logging why — see harness.ts. Per epic-level ruling on
// RINTH-7 (see PR body): this double-gate is the intentional full extent of
// the opt-in; no third env var exists, and this test does not attempt to
// set or discover `RINTH_TEST_PROJECT`.
//
// Uploads a minimal, throwaway 1x1 PNG and verifies `icon_url` changed via
// `rinth project icon`'s own read-back. Restoration is best-effort: if the
// project had an icon before, this downloads those original bytes and
// re-uploads them afterward; if it had none, there is nothing to restore
// to, and that is logged plainly rather than silently left mutated.

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli.ts";
import { ExitCode } from "../../src/errors.ts";
import { hasModrinthToken, hasTestProject, RINTH_TEST_PROJECT } from "./harness.ts";

const canRun = hasModrinthToken && hasTestProject;

// A minimal, valid, transparent 1x1 PNG — small enough to be an obviously
// throwaway test fixture, valid enough that labrinth's image validation
// (it decodes the upload, per the API docs' "up to 256KiB" size note)
// should accept it.
const MINIMAL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

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

function extensionFromUrl(url: string): string | undefined {
  const match = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(url);
  return match?.[1]?.toLowerCase();
}

describe("integration: project icon (uploads and restores a real project's icon)", () => {
  let dir: string | undefined;
  // Bytes/extension to restore the ORIGINAL icon with, captured before the
  // test's own upload — only set once this test's upload has actually
  // landed, so a clean skip never attempts a restore.
  let restore: { ext: string; bytes: Uint8Array } | undefined;
  let hadNoOriginalIcon = false;

  afterEach(async () => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
    if (restore && RINTH_TEST_PROJECT) {
      const restoreDir = mkdtempSync(join(tmpdir(), "rinth-project-icon-restore-"));
      const restorePath = join(restoreDir, `restore.${restore.ext}`);
      writeFileSync(restorePath, restore.bytes);
      const out = captureOutput();
      await run(["--json", "project", "icon", RINTH_TEST_PROJECT, "--file", restorePath]);
      out.restore();
      rmSync(restoreDir, { recursive: true, force: true });
      restore = undefined;
    } else if (hadNoOriginalIcon) {
      console.log(
        `PROJECT ICON: ${RINTH_TEST_PROJECT} had no icon before this test — leaving the test icon in place ` +
          "(nothing to restore to).",
      );
      hadNoOriginalIcon = false;
    }
  });

  test.skipIf(!canRun)("uploads an icon, verifies via read-back, then restores the original", async () => {
    let out = captureOutput();
    const getCode = await run(["--json", "project", "get", String(RINTH_TEST_PROJECT)]);
    let lastLog = out.lastLog();
    let lastErr = out.lastErr();
    out.restore();

    if (getCode !== ExitCode.Ok) {
      console.log(`PROJECT ICON: setup \`project get\` did not succeed (exit ${getCode}): ${lastErr} — skipping`);
      return;
    }

    const before = JSON.parse(lastLog) as { icon_url: string | null };

    if (before.icon_url) {
      const ext = extensionFromUrl(before.icon_url);
      if (ext) {
        const response = await fetch(before.icon_url);
        if (response.ok) {
          restore = { ext, bytes: new Uint8Array(await response.arrayBuffer()) };
        } else {
          console.log(
            `PROJECT ICON: could not download the original icon (HTTP ${response.status}) — will not be able to restore it`,
          );
        }
      } else {
        console.log(`PROJECT ICON: could not infer an extension from ${before.icon_url} — will not restore it`);
      }
    } else {
      hadNoOriginalIcon = true;
    }

    dir = mkdtempSync(join(tmpdir(), "rinth-project-icon-integration-"));
    const iconPath = join(dir, "icon.png");
    writeFileSync(iconPath, Buffer.from(MINIMAL_PNG_BASE64, "base64"));

    out = captureOutput();
    const iconCode = await run(["--json", "project", "icon", String(RINTH_TEST_PROJECT), "--file", iconPath]);
    lastLog = out.lastLog();
    lastErr = out.lastErr();
    out.restore();

    console.log(`PROJECT ICON: icon ${RINTH_TEST_PROJECT} => exit ${iconCode}`);

    if (iconCode !== ExitCode.Ok) {
      throw new Error(`unexpected exit code from \`rinth project icon\`: ${iconCode}: ${lastErr}`);
    }

    const after = JSON.parse(lastLog) as { icon_url: string | null };
    expect(after.icon_url).not.toBe(before.icon_url);
  });
});
