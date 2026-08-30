import { describe, expect, spyOn, test } from "bun:test";
import type { Labrinth } from "@modrinth/api-client";
import { run } from "../../../src/cli.ts";
import { apiError, createFakeClock, createFakeTransport } from "../../../src/client/fake.ts";
import type { VersionFilters } from "../../../src/client/index.ts";
import { parseVersionsFlags } from "../../../src/commands/versions.ts";
import { ExitCode } from "../../../src/errors.ts";
import { registerSecret, resetSecretsForTesting } from "../../../src/redact.ts";

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

  test("rejects --limit with a usage error (exit 2) when allowLimit is false", () => {
    try {
      parseVersionsFlags(["sodium", "--limit", "5"], { allowLimit: false });
      throw new Error("expected parseVersionsFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("allows --limit by default (allowLimit defaults to true)", () => {
    const flags = parseVersionsFlags(["sodium", "--limit", "5"]);
    expect(flags.limit).toBe(5);
  });

  test("rejects an unrecognized flag with a usage error (exit 2)", () => {
    try {
      parseVersionsFlags(["sodium", "--bogus"]);
      throw new Error("expected parseVersionsFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("rejects an unrecognized flag even when a valid filter is also present (no silent drop)", () => {
    try {
      parseVersionsFlags(["sodium", "--bogus", "--limit", "1"]);
      throw new Error("expected parseVersionsFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("rejects a second bare positional with a usage error (exit 2)", () => {
    try {
      parseVersionsFlags(["sodium", "extra"]);
      throw new Error("expected parseVersionsFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  describe("--wait / --wait-interval (versions latest only)", () => {
    test("rejects --wait with a usage error (exit 2) when allowWait is false (the versions list default)", () => {
      try {
        parseVersionsFlags(["sodium", "--wait", "60"]);
        throw new Error("expected parseVersionsFlags to throw");
      } catch (err) {
        expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
      }
    });

    test("rejects --wait-interval with a usage error (exit 2) when allowWait is false", () => {
      try {
        parseVersionsFlags(["sodium", "--wait-interval", "5"]);
        throw new Error("expected parseVersionsFlags to throw");
      } catch (err) {
        expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
      }
    });

    test("parses --wait and --wait-interval as seconds when allowWait is true", () => {
      const flags = parseVersionsFlags(["sodium", "--wait", "300", "--wait-interval", "15"], {
        allowLimit: false,
        allowWait: true,
      });
      expect(flags.wait).toBe(300);
      expect(flags.waitInterval).toBe(15);
    });

    test("--wait-interval defaults to undefined (the command applies the documented default)", () => {
      const flags = parseVersionsFlags(["sodium", "--wait", "300"], { allowLimit: false, allowWait: true });
      expect(flags.wait).toBe(300);
      expect(flags.waitInterval).toBeUndefined();
    });

    test("--wait accepts 0 (a single attempt through the wait path)", () => {
      const flags = parseVersionsFlags(["sodium", "--wait", "0"], { allowLimit: false, allowWait: true });
      expect(flags.wait).toBe(0);
    });

    test("rejects a negative --wait with a usage error (exit 2)", () => {
      try {
        parseVersionsFlags(["sodium", "--wait", "-1"], { allowLimit: false, allowWait: true });
        throw new Error("expected parseVersionsFlags to throw");
      } catch (err) {
        expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
      }
    });

    test("rejects a non-positive --wait-interval with a usage error (exit 2)", () => {
      try {
        parseVersionsFlags(["sodium", "--wait", "60", "--wait-interval", "0"], { allowLimit: false, allowWait: true });
        throw new Error("expected parseVersionsFlags to throw");
      } catch (err) {
        expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
      }
    });

    test("rejects a non-numeric --wait with a usage error (exit 2)", () => {
      try {
        parseVersionsFlags(["sodium", "--wait", "soon"], { allowLimit: false, allowWait: true });
        throw new Error("expected parseVersionsFlags to throw");
      } catch (err) {
        expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
      }
    });

    test("rejects --wait-interval given without --wait, even when allowWait is true", () => {
      try {
        parseVersionsFlags(["sodium", "--wait-interval", "5"], { allowLimit: false, allowWait: true });
        throw new Error("expected parseVersionsFlags to throw");
      } catch (err) {
        expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
      }
    });

    test.each(["--wait", "--wait-interval"])("rejects %s with no following value as a usage error (exit 2)", (flag) => {
      try {
        parseVersionsFlags(["sodium", flag], { allowLimit: false, allowWait: true });
        throw new Error("expected parseVersionsFlags to throw");
      } catch (err) {
        expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
      }
    });
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

  // RINTH-6/RINTH-2 (breaking change, see CHANGELOG): "no such project" and
  // "no version matched the filters" used to share exit 4 (NotFound). They
  // are now split so a caller like SCHEM-6 can retry the retryable one
  // (NoVersionMatch) and fail fast on the other (NotFound) — see
  // src/diagnose.ts and this file's "rinth versions latest --wait" describe
  // block below for the NotFound (project-unreadable) side of the split.
  test("no match exits 7 (NoVersionMatch), not NotFound", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ versions: [] });

    const code = await run(["versions", "latest", "sodium"], { transport });

    expect(code).toBe(ExitCode.NoVersionMatch);
    errSpy.mockRestore();
  });

  test("no match after client-side --channel filtering exits 7 (NoVersionMatch), not NotFound", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ versions: [fixtureVersion({ version_type: "release" })] });

    const code = await run(["versions", "latest", "sodium", "--channel", "alpha"], { transport });

    expect(code).toBe(ExitCode.NoVersionMatch);
    errSpy.mockRestore();
  });

  test("--limit is rejected with a usage error (exit 2): --limit is server-side, --channel is client-side, so limiting first can silently return a stale or missing match", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ versions: [fixtureVersion()] });

    const code = await run(["versions", "latest", "sodium", "--limit", "5"], { transport });

    expect(code).toBe(ExitCode.Usage);
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

describe("rinth versions list/latest: project 404 diagnosis", () => {
  test("versions list: a 404 is diagnosed, not surfaced bare", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({
      versionsError: apiError(ExitCode.NotFound, "Not Found", {
        status: 404,
        endpoint: "GET /v2/project/does-not-exist/version",
      }),
    });

    const code = await run(["versions", "list", "does-not-exist"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.NotFound);
    expect(message).not.toBe("Not Found");
    expect(message).toContain("does-not-exist");
    expect(message).toContain("rinth whoami");
  });

  test("versions latest: a 404 is diagnosed, not surfaced bare (draft-project 404 case)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({
      versionsError: apiError(ExitCode.NotFound, "Not Found", {
        status: 404,
        endpoint: "GET /v2/project/draft-thing/version",
      }),
    });

    const code = await run(["versions", "latest", "draft-thing"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.NotFound);
    expect(message).not.toBe("Not Found");
    expect(message).toContain("draft-thing");
    expect(message).toContain("not visible to this token's identity");
    expect(message).toContain("rinth whoami");
  });

  test("a non-CliError thrown by the transport passes through resolveMatchingVersions unchanged (not diagnosed)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({
      versions: [],
      onListVersions: () => {
        throw new Error("unexpected transport bug");
      },
    });

    const code = await run(["versions", "list", "sodium"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Generic);
    expect(message).toBe("unexpected transport bug");
  });

  test("versions latest --wait: a project-unreadable 404 aborts on the first attempt — it is never retried", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const clock = createFakeClock();
    let attempts = 0;
    const transport = createFakeTransport({
      versionsError: apiError(ExitCode.NotFound, "Not Found", { status: 404, endpoint: "GET /v2/project/x/version" }),
      onListVersions: () => {
        attempts++;
      },
    });

    const code = await run(["versions", "latest", "draft-thing", "--wait", "60"], { transport, clock });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.NotFound);
    expect(attempts).toBe(1);
  });
});

describe("rinth versions latest --wait", () => {
  test("without --wait, behavior is exactly the original single-attempt path (ADDITIVE ONLY)", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let attempts = 0;
    const transport = createFakeTransport({
      versions: [fixtureVersion({ id: "only" })],
      onListVersions: () => {
        attempts++;
      },
    });

    const code = await run(["versions", "latest", "sodium"], { transport });
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(attempts).toBe(1);
  });

  test("succeeds on a later poll, instantly (no real sleeping) via the injected fake clock", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const clock = createFakeClock();
    const matching = fixtureVersion({ id: "eventually", version_number: "2.0.0" });
    const fixtures: Parameters<typeof createFakeTransport>[0] = { versions: [] };
    let attempts = 0;
    fixtures.onListVersions = () => {
      attempts++;
      if (attempts === 3) {
        fixtures.versions = [matching];
      }
    };
    const transport = createFakeTransport(fixtures);

    const code = await run(["versions", "latest", "sodium", "--wait", "60", "--wait-interval", "10"], {
      transport,
      clock,
    });

    expect(code).toBe(ExitCode.Ok);
    expect(attempts).toBe(3);
    expect(logSpy).toHaveBeenCalledWith("eventually  2.0.0");
    logSpy.mockRestore();
  });

  test("exhausts the budget without ever matching: exit 8 (WaitTimeout), reason 'wait_exhausted', distinct from not-found/no-match", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const clock = createFakeClock();
    let attempts = 0;
    const transport = createFakeTransport({
      versions: [],
      onListVersions: () => {
        attempts++;
      },
    });

    const code = await run(
      ["--json", "versions", "latest", "sodium", "--wait", "30", "--wait-interval", "10"],
      { transport, clock },
    );
    const printed = JSON.parse(String(errSpy.mock.calls[0]?.[0])) as {
      error: { code: number; reason: string | null; message: string };
    };
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.WaitTimeout);
    expect(code).not.toBe(ExitCode.NotFound);
    expect(code).not.toBe(ExitCode.NoVersionMatch);
    expect(printed.error.code).toBe(ExitCode.WaitTimeout);
    expect(printed.error.reason).toBe("wait_exhausted");
    expect(printed.error.message).toContain("30s");
    expect(printed.error.message).toContain("10s");
    expect(attempts).toBeGreaterThan(1);
  });

  describe("redaction on the wait/retry path", () => {
    test("drives --wait to exhaustion across multiple attempts with MODRINTH_TOKEN set to a sentinel: the sentinel never appears anywhere in captured stdout/stderr, on any attempt", async () => {
      resetSecretsForTesting();
      const SENTINEL = "mrp_wait_redaction_sentinel_should_never_print";
      const originalToken = process.env["MODRINTH_TOKEN"];
      process.env["MODRINTH_TOKEN"] = SENTINEL;
      // Mirrors what requireToken() does for the real transport — the fake
      // transport bypasses it entirely, so this proves the wait loop's own
      // output path is silent per-attempt regardless of how the token got
      // registered.
      registerSecret(SENTINEL);

      const clock = createFakeClock();
      let attempts = 0;
      const transport = createFakeTransport({
        versions: [],
        onListVersions: () => {
          attempts++;
        },
      });

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errSpy = spyOn(console, "error").mockImplementation(() => {});

      const code = await run(["versions", "latest", "sodium", "--wait", "45", "--wait-interval", "15"], {
        transport,
        clock,
      });

      const allOutput = [...logSpy.mock.calls, ...errSpy.mock.calls].map((call) => String(call[0])).join("\n");
      logSpy.mockRestore();
      errSpy.mockRestore();
      resetSecretsForTesting();
      if (originalToken === undefined) {
        delete process.env["MODRINTH_TOKEN"];
      } else {
        process.env["MODRINTH_TOKEN"] = originalToken;
      }

      expect(code).toBe(ExitCode.WaitTimeout);
      expect(attempts).toBeGreaterThanOrEqual(3);
      expect(allOutput).not.toContain(SENTINEL);
    });
  });
});

describe("rinth versions delete", () => {
  test("missing <version_id> is a usage error (exit 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["versions", "delete"], { transport });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  test("DELETE 2xx + read-back 404 => deleted, exit 0", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      versionError: apiError(ExitCode.NotFound, "Not Found", { status: 404 }),
    });

    const code = await run(["versions", "delete", "v_123"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith("Deleted version v_123.");
    logSpy.mockRestore();
  });

  test("DELETE 404 + read-back 404 => deleted, exit 0 (the live API's real behavior) — human output notes it", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      deleteVersionError: apiError(ExitCode.NotFound, "Not Found", { status: 404 }),
      versionError: apiError(ExitCode.NotFound, "Not Found", { status: 404 }),
    });

    const code = await run(["versions", "delete", "v_123"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toContain("Deleted version v_123");
    expect(printed).toContain("404");
  });

  test("--json prints {id, deleted: true} on success", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      deleteVersionError: apiError(ExitCode.NotFound, "Not Found", { status: 404 }),
      versionError: apiError(ExitCode.NotFound, "Not Found", { status: 404 }),
    });

    const code = await run(["--json", "versions", "delete", "v_123"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ id: "v_123", deleted: true }));
    logSpy.mockRestore();
  });

  test("a non-404 failure on the read-back itself (e.g. 500) propagates as-is, rather than being reported as deleted or still-present", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({
      // DELETE itself reports success (no deleteVersionError)...
      versionError: apiError(ExitCode.ApiError, "read-back exploded", { status: 500 }),
    });

    const code = await run(["versions", "delete", "v_123"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.ApiError);
    expect(message).toBe("read-back exploded");
  });

  test("DELETE 404 + read-back 200 => genuine failure, non-zero exit, message says it did not take effect and is still present", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({
      deleteVersionError: apiError(ExitCode.NotFound, "Not Found", { status: 404 }),
      version: fixtureVersion({ id: "v_123" }),
    });

    const code = await run(["versions", "delete", "v_123"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).not.toBe(ExitCode.Ok);
    expect(message).toContain("did not take effect");
    expect(message).toContain("still present");
  });

  test.each([
    [401, ExitCode.AuthMissing],
    [500, ExitCode.ApiError],
  ] as const)(
    "DELETE other 4xx/5xx (%d) maps normally via exitCodeForApiError, and never reads the version back",
    async (_status, expectedExitCode) => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      let readBackAttempted = false;
      const transport = createFakeTransport({
        deleteVersionError: apiError(expectedExitCode, "boom"),
        onGetVersion: () => {
          readBackAttempted = true;
        },
      });

      const code = await run(["versions", "delete", "v_123"], { transport });
      errSpy.mockRestore();

      expect(code).toBe(expectedExitCode);
      expect(readBackAttempted).toBe(false);
    },
  );

  describe("redaction", () => {
    test("a token embedded in the delete/read-back error path never reaches stdout/stderr", async () => {
      resetSecretsForTesting();
      const token = "mrp_delete_secret_token";
      registerSecret(token);

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        deleteVersionError: apiError(ExitCode.ApiError, `upstream rejected Bearer ${token}`),
      });

      const code = await run(["versions", "delete", "v_123"], { transport });
      const loggedOut = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
      const loggedErr = errSpy.mock.calls.map((call) => String(call[0])).join("\n");
      logSpy.mockRestore();
      errSpy.mockRestore();
      resetSecretsForTesting();

      expect(code).toBe(ExitCode.ApiError);
      expect(loggedOut).not.toContain(token);
      expect(loggedErr).not.toContain(token);
      expect(loggedErr).toContain("***REDACTED***");
    });
  });
});
