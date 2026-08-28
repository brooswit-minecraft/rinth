import { describe, expect, spyOn, test } from "bun:test";
import { parseArgs, run } from "../../src/cli.ts";
import { apiError, createFakeTransport } from "../../src/client/fake.ts";
import { ExitCode } from "../../src/errors.ts";

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
});
