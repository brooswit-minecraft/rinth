import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Labrinth } from "@modrinth/api-client";
import { run } from "../../../src/cli.ts";
import { apiError, createFakeTransport } from "../../../src/client/fake.ts";
import type { CreateVersionFile, CreateVersionRequest } from "../../../src/client/index.ts";
import { parsePublishFlags } from "../../../src/commands/publish.ts";
import { ExitCode } from "../../../src/errors.ts";

function fixtureProject(overrides: Partial<Labrinth.Projects.v2.Project> = {}): Labrinth.Projects.v2.Project {
  return {
    id: "proj_1",
    slug: "sodium",
    project_type: "mod",
    actualProjectType: "mod",
    team: "team_1",
    organization: null,
    title: "Sodium",
    description: "A performance mod",
    body: "",
    published: "2024-01-01T00:00:00Z",
    updated: "2024-01-01T00:00:00Z",
    status: "approved",
    license: { id: "LGPL-3.0", name: "GNU LGPL v3" },
    client_side: "required",
    server_side: "unsupported",
    downloads: 0,
    followers: 0,
    categories: [],
    additional_categories: [],
    game_versions: [],
    loaders: [],
    versions: [],
    thread_id: "thread_1",
    monetization_status: "monetized",
    ...overrides,
  };
}

function fixtureVersion(overrides: Partial<Labrinth.Versions.v2.Version> = {}): Labrinth.Versions.v2.Version {
  return {
    id: "v1",
    project_id: "proj_1",
    author_id: "author_1",
    featured: false,
    name: "1.0.0",
    version_number: "1.0.0",
    changelog: "",
    date_published: "2026-01-01T00:00:00Z",
    downloads: 0,
    version_type: "release",
    status: "listed",
    files: [],
    dependencies: [],
    game_versions: [],
    loaders: [],
    ...overrides,
  };
}

let dir: string;
let mrpackPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rinth-publish-test-"));
  mrpackPath = join(dir, "pack.mrpack");
  writeFileSync(mrpackPath, "fake mrpack bytes");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("parsePublishFlags", () => {
  test("parses the required flags and applies defaults: --name falls back to --version, --channel defaults to release, --featured defaults to false", () => {
    const flags = parsePublishFlags(["sodium", "--file", "pack.mrpack", "--version", "1.0.0"]);

    expect(flags.project).toBe("sodium");
    expect(flags.file).toBe("pack.mrpack");
    expect(flags.version).toBe("1.0.0");
    expect(flags.name).toBe("1.0.0");
    expect(flags.channel).toBe("release");
    expect(flags.featured).toBe(false);
    expect(flags.gameVersions).toEqual([]);
    expect(flags.loaders).toEqual([]);
    expect(flags.dependencies).toEqual([]);
    expect(flags.dryRun).toBe(false);
  });

  test("--name overrides the --version fallback", () => {
    const flags = parsePublishFlags(["sodium", "--file", "pack.mrpack", "--version", "1.0.0", "--name", "My Release"]);
    expect(flags.name).toBe("My Release");
  });

  test("collects repeated --game-version/--loader into arrays", () => {
    const flags = parsePublishFlags([
      "sodium",
      "--file",
      "pack.mrpack",
      "--version",
      "1.0.0",
      "--game-version",
      "1.20.4",
      "--game-version",
      "1.20.3",
      "--loader",
      "fabric",
      "--loader",
      "quilt",
    ]);

    expect(flags.gameVersions).toEqual(["1.20.4", "1.20.3"]);
    expect(flags.loaders).toEqual(["fabric", "quilt"]);
  });

  test("collects repeated --dependency into dependency objects", () => {
    const flags = parsePublishFlags([
      "sodium",
      "--file",
      "pack.mrpack",
      "--version",
      "1.0.0",
      "--dependency",
      "fabric-api:required",
      "--dependency",
      "cloth-config:optional",
    ]);

    expect(flags.dependencies).toEqual([
      { project_id: "fabric-api", dependency_type: "required" },
      { project_id: "cloth-config", dependency_type: "optional" },
    ]);
  });

  test("a malformed --dependency (bad type) is a usage error (exit 2)", () => {
    try {
      parsePublishFlags(["sodium", "--file", "pack.mrpack", "--version", "1.0.0", "--dependency", "fabric-api:maybe"]);
      throw new Error("expected parsePublishFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("a malformed --dependency (no project id) is a usage error (exit 2)", () => {
    try {
      parsePublishFlags(["sodium", "--file", "pack.mrpack", "--version", "1.0.0", "--dependency", ":required"]);
      throw new Error("expected parsePublishFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("--channel accepts beta/alpha and rejects anything else (exit 2)", () => {
    expect(parsePublishFlags(["sodium", "--file", "pack.mrpack", "--version", "1.0.0", "--channel", "beta"]).channel).toBe(
      "beta",
    );
    try {
      parsePublishFlags(["sodium", "--file", "pack.mrpack", "--version", "1.0.0", "--channel", "bogus"]);
      throw new Error("expected parsePublishFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("--featured sets featured to true", () => {
    const flags = parsePublishFlags(["sodium", "--file", "pack.mrpack", "--version", "1.0.0", "--featured"]);
    expect(flags.featured).toBe(true);
  });

  test("--dry-run sets dryRun to true", () => {
    const flags = parsePublishFlags(["sodium", "--file", "pack.mrpack", "--version", "1.0.0", "--dry-run"]);
    expect(flags.dryRun).toBe(true);
  });

  test("--changelog and --changelog-file together is a usage error (exit 2)", () => {
    try {
      parsePublishFlags([
        "sodium",
        "--file",
        "pack.mrpack",
        "--version",
        "1.0.0",
        "--changelog",
        "notes",
        "--changelog-file",
        "notes.md",
      ]);
      throw new Error("expected parsePublishFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("missing --file is a usage error (exit 2)", () => {
    try {
      parsePublishFlags(["sodium", "--version", "1.0.0"]);
      throw new Error("expected parsePublishFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("missing --version is a usage error (exit 2)", () => {
    try {
      parsePublishFlags(["sodium", "--file", "pack.mrpack"]);
      throw new Error("expected parsePublishFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("missing <project> is a usage error (exit 2)", () => {
    try {
      parsePublishFlags(["--file", "pack.mrpack", "--version", "1.0.0"]);
      throw new Error("expected parsePublishFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("rejects an unrecognized flag (exit 2)", () => {
    try {
      parsePublishFlags(["sodium", "--file", "pack.mrpack", "--version", "1.0.0", "--bogus"]);
      throw new Error("expected parsePublishFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("rejects a stray extra positional (exit 2)", () => {
    try {
      parsePublishFlags(["sodium", "extra", "--file", "pack.mrpack", "--version", "1.0.0"]);
      throw new Error("expected parsePublishFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test.each(["--file", "--version", "--name", "--changelog", "--changelog-file", "--game-version", "--loader", "--channel", "--dependency"])(
    "rejects %s with no following value as a usage error (exit 2)",
    (flag) => {
      try {
        parsePublishFlags(["sodium", flag]);
        throw new Error("expected parsePublishFlags to throw");
      } catch (err) {
        expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
      }
    },
  );
});

describe("rinth publish", () => {
  test("builds the multipart request from CLI flags: data JSON has exactly the expected fields, file part matches file_parts", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let capturedData: CreateVersionRequest | undefined;
    let capturedFile: CreateVersionFile | undefined;
    const transport = createFakeTransport({
      project: fixtureProject(),
      versions: [],
      createdVersion: fixtureVersion(),
      onCreateVersion: (data, file) => {
        capturedData = data;
        capturedFile = file;
      },
    });

    const code = await run(
      [
        "publish",
        "sodium",
        "--file",
        mrpackPath,
        "--version",
        "1.2.3",
        "--changelog",
        "release notes",
        "--game-version",
        "1.20.4",
        "--loader",
        "fabric",
        "--channel",
        "beta",
        "--featured",
        "--dependency",
        "fabric-api:required",
      ],
      { transport },
    );
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(capturedData).toEqual({
      project_id: "proj_1",
      version_number: "1.2.3",
      name: "1.2.3",
      changelog: "release notes",
      game_versions: ["1.20.4"],
      loaders: ["fabric"],
      version_type: "beta",
      featured: true,
      dependencies: [{ project_id: "fabric-api", dependency_type: "required" }],
      file_parts: ["pack.mrpack"],
      primary_file: "pack.mrpack",
    });
    expect(capturedFile?.name).toBe("pack.mrpack");
    expect(capturedFile?.data).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(capturedFile?.data)).toBe("fake mrpack bytes");
  });

  test("--changelog-file is read into changelog", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const changelogPath = join(dir, "notes.md");
    writeFileSync(changelogPath, "notes from a file");
    let capturedData: CreateVersionRequest | undefined;
    const transport = createFakeTransport({
      project: fixtureProject(),
      versions: [],
      createdVersion: fixtureVersion(),
      onCreateVersion: (data) => {
        capturedData = data;
      },
    });

    const code = await run(
      ["publish", "sodium", "--file", mrpackPath, "--version", "1.0.0", "--changelog-file", changelogPath],
      { transport },
    );
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(capturedData?.changelog).toBe("notes from a file");
  });

  test("a missing --changelog-file is a clear error", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ project: fixtureProject(), versions: [], createdVersion: fixtureVersion() });

    const code = await run(
      ["publish", "sodium", "--file", mrpackPath, "--version", "1.0.0", "--changelog-file", join(dir, "missing.md")],
      { transport },
    );
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  test("SUCCESS: prints the created version id and its Modrinth URL", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      project: fixtureProject({ slug: "sodium", id: "proj_1" }),
      versions: [],
      createdVersion: fixtureVersion({ id: "v_new" }),
    });

    const code = await run(["publish", "sodium", "--file", mrpackPath, "--version", "1.0.0"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith("v_new  https://modrinth.com/project/sodium/version/v_new");
    logSpy.mockRestore();
  });

  test("--json prints the created version object, unmodified", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const created = fixtureVersion({ id: "v_new" });
    const transport = createFakeTransport({ project: fixtureProject(), versions: [], createdVersion: created });

    const code = await run(["--json", "publish", "sodium", "--file", mrpackPath, "--version", "1.0.0"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(created));
    logSpy.mockRestore();
  });

  test("a missing --file exits 2 without an existing file check needing the transport", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["publish", "sodium", "--version", "1.0.0"], { transport });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  test("a --file that doesn't exist exits 2", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["publish", "sodium", "--file", join(dir, "nope.mrpack"), "--version", "1.0.0"], {
      transport,
    });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  test("a missing --version exits 2", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["publish", "sodium", "--file", mrpackPath], { transport });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  describe("duplicate-version guard", () => {
    test("a version with the same version_number already existing fails with exit 5 and names the existing version, and never attempts the upload", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      let uploadAttempted = false;
      const transport = createFakeTransport({
        project: fixtureProject({ id: "proj_1" }),
        versions: [fixtureVersion({ id: "v_existing", version_number: "1.0.0" })],
        createdVersion: fixtureVersion(),
        onCreateVersion: () => {
          uploadAttempted = true;
        },
      });

      const code = await run(["publish", "sodium", "--file", mrpackPath, "--version", "1.0.0"], { transport });
      const message = String(errSpy.mock.calls[0]?.[0]);
      errSpy.mockRestore();

      expect(code).toBe(ExitCode.ApiError);
      expect(message).toContain("1.0.0");
      expect(message).toContain("v_existing");
      expect(uploadAttempted).toBe(false);
    });

    test("no matching version_number proceeds to upload", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const transport = createFakeTransport({
        project: fixtureProject(),
        versions: [fixtureVersion({ id: "v_other", version_number: "0.9.0" })],
        createdVersion: fixtureVersion({ id: "v_new", version_number: "1.0.0" }),
      });

      const code = await run(["publish", "sodium", "--file", mrpackPath, "--version", "1.0.0"], { transport });
      logSpy.mockRestore();

      expect(code).toBe(ExitCode.Ok);
    });
  });

  describe("--dry-run", () => {
    test("prints the payload, sends nothing (the transport is never touched), and exits 0 without requiring a token", async () => {
      const originalToken = process.env["MODRINTH_TOKEN"];
      delete process.env["MODRINTH_TOKEN"];

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      // No `deps.transport` injected: if publish's --dry-run path touched
      // `ctx.transport` at all, this would call the real transport and
      // throw (exit 3) for the missing token, since `createRealTransport()`
      // requires it unconditionally.
      const code = await run([
        "publish",
        "sodium",
        "--file",
        mrpackPath,
        "--version",
        "1.0.0",
        "--game-version",
        "1.20.4",
        "--dry-run",
      ]);
      const printed = String(logSpy.mock.calls[0]?.[0]);
      logSpy.mockRestore();

      if (originalToken === undefined) {
        delete process.env["MODRINTH_TOKEN"];
      } else {
        process.env["MODRINTH_TOKEN"] = originalToken;
      }

      expect(code).toBe(ExitCode.Ok);
      const payload = JSON.parse(printed) as { data: CreateVersionRequest; file: { part: string; size: number } };
      expect(payload.data.version_number).toBe("1.0.0");
      expect(payload.data.game_versions).toEqual(["1.20.4"]);
      expect(payload.file).toEqual({ part: "pack.mrpack", size: "fake mrpack bytes".length });
    });

    test("never includes a token in its output even when one is set in the environment", async () => {
      const originalToken = process.env["MODRINTH_TOKEN"];
      process.env["MODRINTH_TOKEN"] = "super-secret-token-value";

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const code = await run(["publish", "sodium", "--file", mrpackPath, "--version", "1.0.0", "--dry-run"]);
      const printed = String(logSpy.mock.calls[0]?.[0]);
      logSpy.mockRestore();

      if (originalToken === undefined) {
        delete process.env["MODRINTH_TOKEN"];
      } else {
        process.env["MODRINTH_TOKEN"] = originalToken;
      }

      expect(code).toBe(ExitCode.Ok);
      expect(printed).not.toContain("super-secret-token-value");
    });

    test("--json prints the same payload as JSON", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const code = await run(["--json", "publish", "sodium", "--file", mrpackPath, "--version", "1.0.0", "--dry-run"]);
      const printed = String(logSpy.mock.calls[0]?.[0]);
      logSpy.mockRestore();

      expect(code).toBe(ExitCode.Ok);
      expect(() => JSON.parse(printed)).not.toThrow();
    });
  });

  describe("HTTP error mapping", () => {
    test.each([
      [ExitCode.AuthMissing, "auth"],
      [ExitCode.NotFound, "project"],
    ] as const)("a %d error from getProject surfaces as exit code %d", async (expectedExitCode) => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({ projectError: apiError(expectedExitCode) });

      const code = await run(["publish", "sodium", "--file", mrpackPath, "--version", "1.0.0"], { transport });
      errSpy.mockRestore();

      expect(code).toBe(expectedExitCode);
    });

    test("a 5xx/400 error from createVersion surfaces as exit code 5", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        project: fixtureProject(),
        versions: [],
        createVersionError: apiError(ExitCode.ApiError),
      });

      const code = await run(["publish", "sodium", "--file", mrpackPath, "--version", "1.0.0"], { transport });
      errSpy.mockRestore();

      expect(code).toBe(ExitCode.ApiError);
    });

    test("a 404 from getProject (publish's project resolution) is diagnosed, not surfaced bare", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        projectError: apiError(ExitCode.NotFound, "Not Found", {
          status: 404,
          endpoint: "GET /v2/project/does-not-exist",
        }),
      });

      const code = await run(["publish", "does-not-exist", "--file", mrpackPath, "--version", "1.0.0"], {
        transport,
      });
      const message = String(errSpy.mock.calls[0]?.[0]);
      errSpy.mockRestore();

      expect(code).toBe(ExitCode.NotFound);
      expect(message).not.toBe("Not Found");
      expect(message).toContain("does-not-exist");
      expect(message).toContain("rinth whoami");
    });

    test("a 401 error from createVersion surfaces as exit code 3", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        project: fixtureProject(),
        versions: [],
        createVersionError: apiError(ExitCode.AuthMissing),
      });

      const code = await run(["publish", "sodium", "--file", mrpackPath, "--version", "1.0.0"], { transport });
      errSpy.mockRestore();

      expect(code).toBe(ExitCode.AuthMissing);
    });
  });
});
