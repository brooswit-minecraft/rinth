import { describe, expect, spyOn, test } from "bun:test";
import type { Labrinth } from "@modrinth/api-client";
import { run } from "../../../src/cli.ts";
import { apiError, createFakeTransport } from "../../../src/client/fake.ts";
import type { VersionFilters } from "../../../src/client/index.ts";
import { parseVersionsFlags } from "../../../src/commands/versions.ts";
import { ExitCode } from "../../../src/errors.ts";

function fixtureVersion(overrides: Partial<Labrinth.Versions.v2.Version> = {}): Labrinth.Versions.v2.Version {
  return {
    id: "v1",
    project_id: "proj_1",
    author_id: "author_1",
    featured: false,
    name: "Version 1",
    version_number: "1.0.0",
    changelog: "",
    date_published: "2026-01-01T00:00:00Z",
    downloads: 0,
    version_type: "release",
    status: "listed",
    files: [{ hashes: { sha1: "a", sha512: "b" }, url: "https://example.com/f.jar", filename: "f.jar", primary: true, size: 1 }],
    dependencies: [],
    game_versions: ["1.20.4"],
    loaders: ["fabric"],
    ...overrides,
  };
}

describe("parseVersionsFlags", () => {
  test("parses the project and collects repeatable --loader/--game-version into arrays", () => {
    const flags = parseVersionsFlags([
      "sodium",
      "--loader",
      "fabric",
      "--loader",
      "quilt",
      "--game-version",
      "1.20.4",
      "--game-version",
      "1.20.3",
    ]);

    expect(flags.project).toBe("sodium");
    expect(flags.loaders).toEqual(["fabric", "quilt"]);
    expect(flags.gameVersions).toEqual(["1.20.4", "1.20.3"]);
    expect(flags.channel).toBeUndefined();
    expect(flags.limit).toBeUndefined();
  });

  test("parses --channel and --limit as single values", () => {
    const flags = parseVersionsFlags(["sodium", "--channel", "beta", "--limit", "5"]);
    expect(flags.channel).toBe("beta");
    expect(flags.limit).toBe(5);
  });

  test("rejects an invalid --channel with a usage error (exit 2)", () => {
    expect(() => parseVersionsFlags(["sodium", "--channel", "bogus"])).toThrow();
    try {
      parseVersionsFlags(["sodium", "--channel", "bogus"]);
      throw new Error("expected parseVersionsFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("rejects a missing project with a usage error (exit 2)", () => {
    try {
      parseVersionsFlags(["--loader", "fabric"]);
      throw new Error("expected parseVersionsFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test.each(["--loader", "--game-version", "--channel", "--limit"])(
    "rejects %s with no following value as a usage error (exit 2)",
    (flag) => {
      try {
        parseVersionsFlags(["sodium", flag]);
        throw new Error("expected parseVersionsFlags to throw");
      } catch (err) {
        expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
      }
    },
  );

  test("rejects a non-numeric --limit with a usage error (exit 2)", () => {
    try {
      parseVersionsFlags(["sodium", "--limit", "not-a-number"]);
      throw new Error("expected parseVersionsFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });
});

describe("rinth versions list", () => {
  test("human mode renders every column", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ versions: [fixtureVersion()] });

    const code = await run(["versions", "list", "sodium"], { transport });

    expect(code).toBe(ExitCode.Ok);
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(printed).toContain("id");
    expect(printed).toContain("version_number");
    expect(printed).toContain("channel");
    expect(printed).toContain("v1");
    expect(printed).toContain("1.0.0");
    expect(printed).toContain("release");
    expect(printed).toContain("fabric");
    expect(printed).toContain("1.20.4");
    expect(printed).toContain("2026-01-01T00:00:00Z");
    expect(printed).toContain("f.jar");
  });

  test("falls back to the first file when none is primary, and to '-' when there are no files", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const noPrimary = fixtureVersion({
      id: "v-no-primary",
      files: [{ hashes: { sha1: "a", sha512: "b" }, url: "u", filename: "first.jar", primary: false, size: 1 }],
    });
    const noFiles = fixtureVersion({ id: "v-no-files", files: [] });
    const transport = createFakeTransport({ versions: [noPrimary, noFiles] });

    const code = await run(["versions", "list", "sodium"], { transport });

    expect(code).toBe(ExitCode.Ok);
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(printed).toContain("first.jar");
    expect(printed).toContain("-");
  });

  test("--json emits the unmodified array at the top level", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const versions = [fixtureVersion()];
    const transport = createFakeTransport({ versions });

    const code = await run(["--json", "versions", "list", "sodium"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(versions));
    logSpy.mockRestore();
  });

  test("an empty result is not an error: prints a message and exits 0", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ versions: [] });

    const code = await run(["versions", "list", "sodium"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith("No versions match.");
    logSpy.mockRestore();
  });

  test("an empty result in --json mode prints []", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ versions: [] });

    const code = await run(["--json", "versions", "list", "sodium"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith("[]");
    logSpy.mockRestore();
  });

  test("filters are passed through to the transport", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let captured: { project: string; filters: VersionFilters | undefined } | undefined;
    const transport = createFakeTransport({
      versions: [],
      onListVersions: (project, filters) => {
        captured = { project, filters };
      },
    });

    await run(
      [
        "versions",
        "list",
        "sodium",
        "--loader",
        "fabric",
        "--loader",
        "quilt",
        "--game-version",
        "1.20.4",
        "--limit",
        "5",
      ],
      { transport },
    );
    logSpy.mockRestore();

    expect(captured).toEqual({
      project: "sodium",
      filters: { loaders: ["fabric", "quilt"], game_versions: ["1.20.4"], limit: 5 },
    });
  });

  test("--channel filters client-side and is not sent to the transport", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let captured: VersionFilters | undefined;
    const transport = createFakeTransport({
      versions: [fixtureVersion({ id: "release-one", version_type: "release" }), fixtureVersion({ id: "beta-one", version_type: "beta" })],
      onListVersions: (_project, filters) => {
        captured = filters;
      },
    });

    const code = await run(["--json", "versions", "list", "sodium", "--channel", "beta"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(captured).toEqual({});
    const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as Labrinth.Versions.v2.Version[];
    logSpy.mockRestore();

    expect(printed).toHaveLength(1);
    expect(printed[0]?.id).toBe("beta-one");
  });

  test("bad --channel is a usage error (exit 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["versions", "list", "sodium", "--channel", "bogus"], { transport });

    expect(code).toBe(ExitCode.Usage);
    errSpy.mockRestore();
  });

  test("missing <project> is a usage error (exit 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["versions", "list"], { transport });

    expect(code).toBe(ExitCode.Usage);
    errSpy.mockRestore();
  });

  test.each([
    [401, ExitCode.AuthMissing],
    [404, ExitCode.NotFound],
  ] as const)("HTTP status %d surfaces as exit code %d", async (_status, expectedExitCode) => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ versionsError: apiError(expectedExitCode) });

    const code = await run(["versions", "list", "sodium"], { transport });

    expect(code).toBe(expectedExitCode);
    errSpy.mockRestore();
  });
});

describe("rinth versions latest", () => {
  test("picks the newest version by date_published even when the fixture list is out of order", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const oldest = fixtureVersion({ id: "old", version_number: "1.0.0", date_published: "2025-01-01T00:00:00Z" });
    const newest = fixtureVersion({ id: "new", version_number: "2.0.0", date_published: "2026-06-01T00:00:00Z" });
    const middle = fixtureVersion({ id: "mid", version_number: "1.5.0", date_published: "2025-12-01T00:00:00Z" });
    const transport = createFakeTransport({ versions: [oldest, newest, middle] });

    const code = await run(["versions", "latest", "sodium"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith("new  2.0.0");
    logSpy.mockRestore();
  });

  test("--json emits a single object, not an array", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const only = fixtureVersion({ id: "only-one" });
    const transport = createFakeTransport({ versions: [only] });

    const code = await run(["--json", "versions", "latest", "sodium"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(only));
    logSpy.mockRestore();
  });

  test("no match exits 4 (NotFound)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ versions: [] });

    const code = await run(["versions", "latest", "sodium"], { transport });

    expect(code).toBe(ExitCode.NotFound);
    errSpy.mockRestore();
  });

  test("no match after client-side --channel filtering exits 4 (NotFound)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ versions: [fixtureVersion({ version_type: "release" })] });

    const code = await run(["versions", "latest", "sodium", "--channel", "alpha"], { transport });

    expect(code).toBe(ExitCode.NotFound);
    errSpy.mockRestore();
  });

  test("filters are passed through to the transport", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let captured: { project: string; filters: VersionFilters | undefined } | undefined;
    const transport = createFakeTransport({
      versions: [fixtureVersion()],
      onListVersions: (project, filters) => {
        captured = { project, filters };
      },
    });

    await run(["versions", "latest", "sodium", "--game-version", "1.20.4", "--loader", "fabric"], { transport });
    logSpy.mockRestore();

    expect(captured).toEqual({
      project: "sodium",
      filters: { loaders: ["fabric"], game_versions: ["1.20.4"] },
    });
  });

  test.each([
    [401, ExitCode.AuthMissing],
    [404, ExitCode.NotFound],
  ] as const)("HTTP status %d surfaces as exit code %d", async (_status, expectedExitCode) => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ versionsError: apiError(expectedExitCode) });

    const code = await run(["versions", "latest", "sodium"], { transport });

    expect(code).toBe(expectedExitCode);
    errSpy.mockRestore();
  });
});

describe("rinth versions <unknown subcommand>", () => {
  test("is a usage error (exit code 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["versions", "bogus"], { transport });

    expect(code).toBe(ExitCode.Usage);
    errSpy.mockRestore();
  });
});
