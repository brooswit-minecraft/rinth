import { describe, expect, spyOn, test } from "bun:test";
import { run } from "../../../src/cli.ts";
import { apiError, createFakeTransport } from "../../../src/client/fake.ts";
import type { PublicServer } from "../../../src/client/index.ts";
import { ExitCode } from "../../../src/errors.ts";

const FIXTURE_SERVER: PublicServer = {
  id: "srv_123",
  name: "My Server",
  status: "available",
  game: "Minecraft",
  loader: "Paper",
  loader_version: "1.20.4-497",
  mc_version: "1.20.4",
  net: { ip: null, port: 25565, domain: "srv-123.modrinth.gg" },
};

describe("rinth servers list", () => {
  test("--json prints { servers } on stdout, never sftp/panel credentials", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ servers: [FIXTURE_SERVER] });

    const code = await run(["--json", "servers", "list"], { transport });

    expect(code).toBe(ExitCode.Ok);
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(printed).toBe(JSON.stringify({ servers: [FIXTURE_SERVER] }));
    expect(printed).not.toContain("sftp_password");
  });

  test("human mode lists each server", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ servers: [FIXTURE_SERVER] });

    const code = await run(["servers", "list"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith("srv_123  My Server  [available]  1.20.4");
    logSpy.mockRestore();
  });

  test("human mode reports no servers cleanly", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ servers: [] });

    const code = await run(["servers", "list"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith("No servers.");
    logSpy.mockRestore();
  });

  test("an unknown servers subcommand is a usage error (exit code 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["servers", "bogus"], { transport });

    expect(code).toBe(ExitCode.Usage);
    errSpy.mockRestore();
  });

  test.each([
    [401, ExitCode.AuthMissing],
    [403, ExitCode.AuthMissing],
    [404, ExitCode.NotFound],
    [500, ExitCode.ApiError],
  ] as const)("HTTP status %d surfaces as exit code %d", async (_status, expectedExitCode) => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ serversError: apiError(expectedExitCode) });

    const code = await run(["servers", "list"], { transport });

    expect(code).toBe(expectedExitCode);
    errSpy.mockRestore();
  });

  test("a network error (no HTTP response) maps to exit code 6", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ serversError: apiError(ExitCode.Network, "fetch failed") });

    const code = await run(["servers", "list"], { transport });

    expect(code).toBe(ExitCode.Network);
    errSpy.mockRestore();
  });
});
