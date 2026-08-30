import { describe, expect, spyOn, test } from "bun:test";
import { parseArgs, run } from "../../src/cli.ts";
import { apiError, createFakeTransport } from "../../src/client/fake.ts";
import { ExitCode } from "../../src/errors.ts";
import { registerSecret, resetSecretsForTesting } from "../../src/redact.ts";

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
    expect(parsed.command).toBeUndefined();
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
