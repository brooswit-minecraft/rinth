import { describe, expect, spyOn, test } from "bun:test";
import pkg from "../../package.json" with { type: "json" };
import { parseArgs, run } from "../../src/cli.ts";
import { apiError, createFakeTransport } from "../../src/client/fake.ts";
import { commands } from "../../src/commands/index.ts";
import { ExitCode } from "../../src/errors.ts";
import { registerSecret, resetSecretsForTesting } from "../../src/redact.ts";

/**
 * Runs `run(argv)` with MODRINTH_TOKEN unset and no injected transport, and
 * returns its exit code. If the code under test ever touched `ctx.transport`
 * on this path, `createRealTransport()` would throw for the missing token
 * (see src/auth.ts's `requireToken`) and this would come back
 * `ExitCode.AuthMissing` (3) instead of whatever the caller expects — that
 * divergence IS the assertion RINTH-12 asks for, not a side detail.
 */
async function runWithoutToken(argv: string[]): Promise<number> {
  const originalToken = process.env["MODRINTH_TOKEN"];
  delete process.env["MODRINTH_TOKEN"];
  try {
    return await run(argv);
  } finally {
    if (originalToken === undefined) {
      delete process.env["MODRINTH_TOKEN"];
    } else {
      process.env["MODRINTH_TOKEN"] = originalToken;
    }
  }
}

describe("parseArgs", () => {
  test("recognizes --json anywhere in argv", () => {
    const parsed = parseArgs(["--json", "servers", "list"]);
    expect(parsed.json).toBe(true);
    expect(parsed.command).toBe("servers");
    expect(parsed.rest).toEqual(["list"]);
  });

  test("recognizes --help and -h", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("defaults to no flags and no command", () => {
    const parsed = parseArgs([]);
    expect(parsed.json).toBe(false);
    expect(parsed.help).toBe(false);
    expect(parsed.version).toBe(false);
    expect(parsed.command).toBeUndefined();
  });

  describe("--version", () => {
    test("recognizes --version before any command", () => {
      expect(parseArgs(["--version"]).version).toBe(true);
      expect(parseArgs(["--json", "--version"]).version).toBe(true);
    });

    test("does NOT recognize --version once a command has started — it belongs to that command's own flags", () => {
      // `servers upstream` and `publish` each have their own `--version
      // <...>` flag, consumed by their own parsers (see
      // commands/servers.ts, commands/publish.ts). Recognizing --version
      // "anywhere in argv" the way --help is would silently steal it from
      // both of those real, existing invocations.
      const upstream = parseArgs(["servers", "upstream", "srv_1", "--project", "p", "--version", "v_1"]);
      expect(upstream.version).toBe(false);
      expect(upstream.command).toBe("servers");
      expect(upstream.rest).toEqual(["upstream", "srv_1", "--project", "p", "--version", "v_1"]);

      const publish = parseArgs(["publish", "sodium", "--file", "pack.mrpack", "--version", "1.0.0"]);
      expect(publish.version).toBe(false);
      expect(publish.rest).toContain("--version");
    });
  });
});

describe("run", () => {
  test("prints usage and exits 0 when no command is given", async () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    const code = await run([]);
    expect(code).toBe(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("prints usage and exits 0 for --help", async () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    const code = await run(["--help"]);
    expect(code).toBe(0);
    spy.mockRestore();
  });

  test("exits 2 for an unknown command", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const code = await run(["bogus"]);
    expect(code).toBe(2);
    expect(spy).toHaveBeenCalledWith("Unknown command: bogus");
    spy.mockRestore();
  });

  // RINTH-12: `--help` was effectively unimplemented — every one of
  // `rinth --help`, `rinth project --help`, `rinth publish --help`,
  // `rinth versions latest --help`, and `rinth servers upstream --help`
  // printed the same two generic top-level lines and nothing else, there
  // was no `rinth help` and no `rinth --version` (both exited 2, "Unknown
  // command"). This block is the fix's test coverage.
  describe("discoverable help (RINTH-12)", () => {
    test("--help compatibility: the top-level banner's first line, and exit 0, are UNCHANGED from before this ticket — a fleet install probe greps for this line", async () => {
      const spy = spyOn(console, "log").mockImplementation(() => {});
      const code = await run(["--help"]);
      const printed = String(spy.mock.calls[0]?.[0]);
      spy.mockRestore();

      expect(code).toBe(ExitCode.Ok);
      const firstLine = printed.split("\n")[0];
      expect(firstLine).toBe("rinth — a Modrinth CLI");
    });

    test("top-level help (bare `rinth`, `rinth --help`, `rinth -h`, and `rinth help` all agree) lists every command group FROM the registry", async () => {
      const variants = [[], ["--help"], ["-h"], ["help"]];
      for (const argv of variants) {
        const spy = spyOn(console, "log").mockImplementation(() => {});
        const code = await run(argv);
        const printed = String(spy.mock.calls[0]?.[0]);
        spy.mockRestore();

        expect(code).toBe(ExitCode.Ok);
        for (const name of Object.keys(commands)) {
          expect(printed).toContain(name);
        }
      }
    });

    test("`rinth <group> --help` and `rinth help <group>` print the SAME group-specific usage — a genuinely failing control before this fix, per project.ts's own USAGE constant", async () => {
      for (const argv of [
        ["project", "--help"],
        ["help", "project"],
      ]) {
        const spy = spyOn(console, "log").mockImplementation(() => {});
        const code = await run(argv);
        const printed = String(spy.mock.calls[0]?.[0]);
        spy.mockRestore();

        expect(code).toBe(ExitCode.Ok);
        // The unfixed behavior (see the "before this fix" control test
        // below) prints ONLY the generic top-level banner and never this
        // string — this is the actual regression guard.
        expect(printed).toContain("Usage: rinth project <get|create|submit|edit|icon>");
        expect(printed).not.toContain("Commands:"); // i.e. not the top-level banner
      }
    });

    test("`rinth <group> <sub> --help` and `rinth help <group> <sub>` both reach subcommand-specific usage where it exists (project icon)", async () => {
      for (const argv of [
        ["project", "icon", "--help"],
        ["help", "project", "icon"],
      ]) {
        const spy = spyOn(console, "log").mockImplementation(() => {});
        const code = await run(argv);
        const printed = String(spy.mock.calls[0]?.[0]);
        spy.mockRestore();

        expect(code).toBe(ExitCode.Ok);
        expect(printed).toBe("Usage: rinth project icon <idOrSlug> --file <path>");
      }
    });

    test("group-level floor: `rinth versions latest --help` gets versions' group usage (no per-subcommand split exists for list/latest), stated as a deliberate floor, not silently generic", async () => {
      const spy = spyOn(console, "log").mockImplementation(() => {});
      const code = await run(["versions", "latest", "--help"]);
      const printed = String(spy.mock.calls[0]?.[0]);
      spy.mockRestore();

      expect(code).toBe(ExitCode.Ok);
      expect(printed).toContain("Usage: rinth versions <list|latest|delete>");
    });

    test("`rinth servers upstream --help` reaches UPSTREAM_USAGE specifically, not the generic banner (this exact example is named in the ticket)", async () => {
      const spy = spyOn(console, "log").mockImplementation(() => {});
      const code = await run(["servers", "upstream", "--help"]);
      const printed = String(spy.mock.calls[0]?.[0]);
      spy.mockRestore();

      expect(code).toBe(ExitCode.Ok);
      expect(printed).toBe("Usage: rinth servers upstream <id> --project <slug|id> --version <version_id> [--restart]");
    });

    test("`rinth publish --help` reaches publish's own usage, not the generic banner (also named in the ticket)", async () => {
      const spy = spyOn(console, "log").mockImplementation(() => {});
      const code = await run(["publish", "--help"]);
      const printed = String(spy.mock.calls[0]?.[0]);
      spy.mockRestore();

      expect(code).toBe(ExitCode.Ok);
      expect(printed).toContain("Usage: rinth publish <project> --file <path.mrpack>");
    });

    test("`rinth whoami --help` reaches whoami's own usage (the simplest command — no subcommands, no per-subcommand split)", async () => {
      const spy = spyOn(console, "log").mockImplementation(() => {});
      const code = await run(["whoami", "--help"]);
      const printed = String(spy.mock.calls[0]?.[0]);
      spy.mockRestore();

      expect(code).toBe(ExitCode.Ok);
      expect(printed).toBe("Usage: rinth whoami");
    });

    test("BEFORE-this-fix control: the fixed behavior differs from the unfixed one described in the ticket — `rinth project --help` output is NOT the bare two-line top-level banner", async () => {
      const spy = spyOn(console, "log").mockImplementation(() => {});
      const code = await run(["project", "--help"]);
      const printed = String(spy.mock.calls[0]?.[0]);
      spy.mockRestore();

      expect(code).toBe(ExitCode.Ok);
      // This is exactly the string the ticket says the UNFIXED build prints
      // for every one of these invocations — asserting it is ABSENT is
      // this test's whole point; if this assertion ever passes on a build
      // that regresses to the old behavior, the regression would show as
      // this string being present, which would fail it.
      expect(printed).not.toBe("rinth — a Modrinth CLI\n\nUsage: rinth [--json] <command> [args]");
    });

    test("`rinth help <bogus>` and `rinth <bogus> --help` both exit 2 naming the bad command — asking for help on a wrong command is still a usage error, not success", async () => {
      for (const argv of [
        ["help", "bogus"],
        ["bogus", "--help"],
      ]) {
        const errSpy = spyOn(console, "error").mockImplementation(() => {});
        const code = await run(argv);

        expect(code).toBe(ExitCode.Usage);
        expect(errSpy).toHaveBeenCalledWith("Unknown command: bogus");
        errSpy.mockRestore();
      }
    });

    test("invalid SUBcommand (not asking for help) still exits 2 — the natural refactor bug this ticket explicitly warns about", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const code = await run(["project", "__bogus__"]);
      errSpy.mockRestore();

      expect(code).toBe(ExitCode.Usage);
    });

    test("plain unknown top-level command (no --help involved) still exits 2, unchanged", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const code = await run(["bogus"]);
      errSpy.mockRestore();

      expect(code).toBe(ExitCode.Usage);
    });

    test("every help/version path works with NO MODRINTH_TOKEN and never constructs the real transport", async () => {
      for (const argv of [
        [],
        ["--help"],
        ["-h"],
        ["help"],
        ["help", "project"],
        ["help", "project", "icon"],
        ["project", "--help"],
        ["project", "icon", "--help"],
        ["servers", "upstream", "--help"],
        ["versions", "latest", "--help"],
        ["publish", "--help"],
        ["whoami", "--help"],
        ["--version"],
      ]) {
        const spy = spyOn(console, "log").mockImplementation(() => {});
        // eslint-disable-next-line no-await-in-loop -- each iteration is independent and cheap; sequential keeps the console spy simple.
        const code = await runWithoutToken(argv);
        spy.mockRestore();

        // If this path had touched `ctx.transport`, createRealTransport()
        // would have thrown for the missing token and this would be
        // ExitCode.AuthMissing (3), not ExitCode.Ok — see runWithoutToken.
        expect(code).toBe(ExitCode.Ok);
      }
    });

    describe("--version", () => {
      test("prints the package.json version and exits 0", async () => {
        const spy = spyOn(console, "log").mockImplementation(() => {});
        const code = await run(["--version"]);

        expect(code).toBe(ExitCode.Ok);
        expect(spy).toHaveBeenCalledWith(expect.stringContaining(pkg.version));
        spy.mockRestore();
      });

      test("works with no MODRINTH_TOKEN set and constructs no transport", async () => {
        const spy = spyOn(console, "log").mockImplementation(() => {});
        const code = await runWithoutToken(["--version"]);
        spy.mockRestore();

        expect(code).toBe(ExitCode.Ok);
      });

      test("does not collide with `servers upstream`'s own --version flag: that command still receives it as its own argument, not the global flag", async () => {
        const transport = createFakeTransport({
          server: {
            id: "srv_1",
            name: "srv",
            status: "available",
            game: "Minecraft",
            mc_version: "1.20.4",
            loader: null,
            loader_version: null,
            upstream: { kind: "modpack", project_id: "proj_1", version_id: "v_1" },
            net: { domain: "example.com", port: 25565, ip: null },
            datacenter: "dc1",
          },
        });
        // resolveProjectId and setUpstream default to succeeding on the fake
        // transport (see src/client/fake.ts), so this proves `--version`
        // reached `servers upstream`'s OWN parser — not the global flag — by
        // checking the command's real output names the version it was
        // actually given (`v_1`) rather than short-circuiting into printing
        // a `rinth <pkg-version>` banner and exiting 0 with no such mention.
        const spy = spyOn(console, "log").mockImplementation(() => {});
        const code = await run(
          ["servers", "upstream", "srv_1", "--project", "proj_1", "--version", "v_1"],
          { transport },
        );

        expect(code).toBe(ExitCode.Ok);
        expect(spy).toHaveBeenCalledWith("Upstream set on srv_1: modpack proj_1@v_1");
        spy.mockRestore();
      });
    });
  });

  test("dispatches to a registered command with an injected transport, bypassing the network", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ servers: [] });

    const code = await run(["servers", "list"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith("No servers.");
    logSpy.mockRestore();
  });

  test("maps a thrown CliError to its exit code and prints its (redacted) message to stderr", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ userError: apiError(ExitCode.AuthMissing, "nope") });

    const code = await run(["whoami"], { transport });

    expect(code).toBe(ExitCode.AuthMissing);
    expect(errSpy).toHaveBeenCalledWith("nope");
    errSpy.mockRestore();
  });

  test("maps an unexpected non-CliError throw to exit code 1", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport(); // no `user` fixture -> throws a plain Error

    const code = await run(["whoami"], { transport });

    expect(code).toBe(ExitCode.Generic);
    errSpy.mockRestore();
  });

  describe("--json error mode", () => {
    test("prints a single JSON error object to stderr, with stdout left empty", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        userError: apiError(ExitCode.AuthMissing, "HTTP 403 GET /modrinth/v0/servers/srv_123: Forbidden", {
          status: 403,
          endpoint: "GET /modrinth/v0/servers/srv_123",
        }),
      });

      const code = await run(["--json", "whoami"], { transport });

      expect(code).toBe(ExitCode.AuthMissing);
      expect(logSpy).not.toHaveBeenCalled();
      expect(errSpy).toHaveBeenCalledTimes(1);
      const printed = JSON.parse(String(errSpy.mock.calls[0]?.[0]));
      expect(printed).toEqual({
        error: {
          code: ExitCode.AuthMissing,
          status: 403,
          endpoint: "GET /modrinth/v0/servers/srv_123",
          message: "HTTP 403 GET /modrinth/v0/servers/srv_123: Forbidden",
          reason: null,
        },
      });
      logSpy.mockRestore();
      errSpy.mockRestore();
    });

    test("prints status: null and endpoint: null for a usage-shaped CliError (no HTTP request involved)", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport();

      // `servers get` with no id throws a usage CliError before ever
      // touching the transport, so it never had status/endpoint to carry.
      const code = await run(["--json", "servers", "get"], { transport });

      expect(code).toBe(ExitCode.Usage);
      const printed = JSON.parse(String(errSpy.mock.calls[0]?.[0]));
      expect(printed.error.status).toBeNull();
      expect(printed.error.endpoint).toBeNull();
      errSpy.mockRestore();
    });

    test("prints a JSON error with code 1, null status/endpoint for an unexpected non-CliError throw", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport(); // no `user` fixture -> throws a plain Error

      const code = await run(["--json", "whoami"], { transport });

      expect(code).toBe(ExitCode.Generic);
      const printed = JSON.parse(String(errSpy.mock.calls[0]?.[0]));
      expect(printed.error.code).toBe(ExitCode.Generic);
      expect(printed.error.status).toBeNull();
      expect(printed.error.endpoint).toBeNull();
      errSpy.mockRestore();
    });

    test("a token embedded in the CliError message never reaches stderr in --json mode (redaction still applies)", async () => {
      resetSecretsForTesting();
      registerSecret("super-secret-token");
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        userError: apiError(
          ExitCode.AuthMissing,
          "HTTP 403 GET /modrinth/v0/servers/srv_123: Forbidden (token super-secret-token rejected)",
          { status: 403, endpoint: "GET /modrinth/v0/servers/srv_123" },
        ),
      });

      await run(["--json", "whoami"], { transport });

      const printed = String(errSpy.mock.calls[0]?.[0]);
      expect(printed).not.toContain("super-secret-token");
      expect(printed).toContain("***REDACTED***");
      errSpy.mockRestore();
      resetSecretsForTesting();
    });
  });
});
