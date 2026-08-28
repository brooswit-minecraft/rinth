import { describe, expect, spyOn, test } from "bun:test";
import { run } from "../../../src/cli.ts";
import { apiError, createFakeTransport } from "../../../src/client/fake.ts";
import type { PublicServer, ServerDetail } from "../../../src/client/index.ts";
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

const FIXTURE_SERVER_DETAIL: ServerDetail = {
  ...FIXTURE_SERVER,
  datacenter: "us-east",
  upstream: { kind: "modpack", project_id: "AABBCCDD", version_id: "version_1" },
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

describe("rinth servers get", () => {
  test("--json prints the trimmed server, never sftp/panel credentials", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ server: FIXTURE_SERVER_DETAIL });

    const code = await run(["--json", "servers", "get", "srv_123"], { transport });

    expect(code).toBe(ExitCode.Ok);
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(printed).toBe(JSON.stringify(FIXTURE_SERVER_DETAIL));
    expect(printed).not.toContain("sftp_password");
  });

  test("human mode prints a readable multi-line block", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ server: FIXTURE_SERVER_DETAIL });

    const code = await run(["servers", "get", "srv_123"], { transport });

    expect(code).toBe(ExitCode.Ok);
    const printedLines = logSpy.mock.calls.map((call) => String(call[0]));
    logSpy.mockRestore();

    expect(printedLines[0]).toBe("My Server (srv_123)");
    expect(printedLines.some((line) => line.includes("available"))).toBe(true);
    expect(printedLines.some((line) => line.includes("modpack AABBCCDD@version_1"))).toBe(true);
    expect(printedLines.some((line) => line.includes("us-east"))).toBe(true);
  });

  test("missing <id> is a usage error (exit code 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["servers", "get"], { transport });

    expect(code).toBe(ExitCode.Usage);
    errSpy.mockRestore();
  });

  test("human mode reports 'none' for a server with no upstream configured", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ server: { ...FIXTURE_SERVER_DETAIL, upstream: null } });

    const code = await run(["servers", "get", "srv_123"], { transport });

    expect(code).toBe(ExitCode.Ok);
    const printedLines = logSpy.mock.calls.map((call) => String(call[0]));
    logSpy.mockRestore();

    expect(printedLines.some((line) => line.includes("upstream:    none"))).toBe(true);
  });

  test.each([
    [401, ExitCode.AuthMissing],
    [403, ExitCode.AuthMissing],
    [404, ExitCode.NotFound],
    [500, ExitCode.ApiError],
    [426, ExitCode.ApiError],
  ] as const)("HTTP status %d surfaces as exit code %d", async (_status, expectedExitCode) => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ serverError: apiError(expectedExitCode) });

    const code = await run(["servers", "get", "srv_123"], { transport });

    expect(code).toBe(expectedExitCode);
    errSpy.mockRestore();
  });

  test("a network error (no HTTP response) maps to exit code 6", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ serverError: apiError(ExitCode.Network, "fetch failed") });

    const code = await run(["servers", "get", "srv_123"], { transport });

    expect(code).toBe(ExitCode.Network);
    errSpy.mockRestore();
  });
});

describe("rinth servers power", () => {
  test.each(["start", "stop", "restart", "kill"] as const)(
    "--json prints {id, action, accepted:true} for '%s'",
    async (action) => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const transport = createFakeTransport();

      const code = await run(["--json", "servers", "power", "srv_123", action], { transport });

      expect(code).toBe(ExitCode.Ok);
      const printed = String(logSpy.mock.calls[0]?.[0]);
      logSpy.mockRestore();

      expect(printed).toBe(JSON.stringify({ id: "srv_123", action, accepted: true }));
    },
  );

  test("human mode confirms the action was sent", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["servers", "power", "srv_123", "restart"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith("restart sent to srv_123.");
    logSpy.mockRestore();
  });

  test("missing <id> is a usage error (exit code 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["servers", "power"], { transport });

    expect(code).toBe(ExitCode.Usage);
    errSpy.mockRestore();
  });

  test("missing action is a usage error (exit code 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["servers", "power", "srv_123"], { transport });

    expect(code).toBe(ExitCode.Usage);
    errSpy.mockRestore();
  });

  test("an unknown action is a usage error (exit code 2) listing the four valid actions", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["servers", "power", "srv_123", "bogus"], { transport });

    expect(code).toBe(ExitCode.Usage);
    const printedError = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(printedError).toContain("start");
    expect(printedError).toContain("stop");
    expect(printedError).toContain("restart");
    expect(printedError).toContain("kill");
  });

  test.each([
    [401, ExitCode.AuthMissing],
    [403, ExitCode.AuthMissing],
    [404, ExitCode.NotFound],
    [500, ExitCode.ApiError],
    [426, ExitCode.ApiError],
  ] as const)("a rejected action (HTTP %d) surfaces as exit code %d", async (_status, expectedExitCode) => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ powerError: apiError(expectedExitCode) });

    const code = await run(["servers", "power", "srv_123", "restart"], { transport });

    expect(code).toBe(expectedExitCode);
    errSpy.mockRestore();
  });

  test("a network error (no HTTP response) maps to exit code 6", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ powerError: apiError(ExitCode.Network, "fetch failed") });

    const code = await run(["servers", "power", "srv_123", "restart"], { transport });

    expect(code).toBe(ExitCode.Network);
    errSpy.mockRestore();
  });
});

describe("rinth servers upstream", () => {
  test("--json prints {id, upstream, restarted:false} and resolves a project slug to its id", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      resolveProjectId: "AABBCCDD",
      server: FIXTURE_SERVER_DETAIL,
    });

    const code = await run(
      ["--json", "servers", "upstream", "srv_123", "--project", "fabulously-optimized", "--version", "version_1"],
      { transport },
    );

    expect(code).toBe(ExitCode.Ok);
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(printed).toBe(
      JSON.stringify({
        id: "srv_123",
        upstream: { kind: "modpack", project_id: "AABBCCDD", version_id: "version_1" },
        restarted: false,
      }),
    );
  });

  test("--restart follows the upstream re-point with a Restart power call and reports restarted:true", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ server: FIXTURE_SERVER_DETAIL });

    const code = await run(
      [
        "--json",
        "servers",
        "upstream",
        "srv_123",
        "--project",
        "AABBCCDD",
        "--version",
        "version_1",
        "--restart",
      ],
      { transport },
    );

    expect(code).toBe(ExitCode.Ok);
    const printed = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as { restarted: boolean };
    logSpy.mockRestore();

    expect(printed.restarted).toBe(true);
  });

  test("human mode reports the resulting upstream", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ server: FIXTURE_SERVER_DETAIL });

    const code = await run(
      ["servers", "upstream", "srv_123", "--project", "AABBCCDD", "--version", "version_1"],
      { transport },
    );

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith("Upstream set on srv_123: modpack AABBCCDD@version_1");
    logSpy.mockRestore();
  });

  test("missing --project is a usage error (exit code 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["servers", "upstream", "srv_123", "--version", "version_1"], { transport });

    expect(code).toBe(ExitCode.Usage);
    errSpy.mockRestore();
  });

  test("missing --version is a usage error (exit code 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["servers", "upstream", "srv_123", "--project", "AABBCCDD"], { transport });

    expect(code).toBe(ExitCode.Usage);
    errSpy.mockRestore();
  });

  test("missing <id> is a usage error (exit code 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["servers", "upstream"], { transport });

    expect(code).toBe(ExitCode.Usage);
    errSpy.mockRestore();
  });

  test.each([
    [401, ExitCode.AuthMissing],
    [403, ExitCode.AuthMissing],
    [404, ExitCode.NotFound],
    [500, ExitCode.ApiError],
  ] as const)("a resolveProjectId failure (HTTP %d) surfaces as exit code %d", async (_status, expectedExitCode) => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ resolveProjectIdError: apiError(expectedExitCode) });

    const code = await run(
      ["servers", "upstream", "srv_123", "--project", "bogus-slug", "--version", "version_1"],
      { transport },
    );

    expect(code).toBe(expectedExitCode);
    errSpy.mockRestore();
  });

  test.each([
    [401, ExitCode.AuthMissing],
    [403, ExitCode.AuthMissing],
    [404, ExitCode.NotFound],
    [500, ExitCode.ApiError],
  ] as const)("a setUpstream (reinstall) failure (HTTP %d) surfaces as exit code %d", async (_status, expectedExitCode) => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ setUpstreamError: apiError(expectedExitCode) });

    const code = await run(
      ["servers", "upstream", "srv_123", "--project", "AABBCCDD", "--version", "version_1"],
      { transport },
    );

    expect(code).toBe(expectedExitCode);
    errSpy.mockRestore();
  });

  test("a network error (no HTTP response) maps to exit code 6", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ setUpstreamError: apiError(ExitCode.Network, "fetch failed") });

    const code = await run(
      ["servers", "upstream", "srv_123", "--project", "AABBCCDD", "--version", "version_1"],
      { transport },
    );

    expect(code).toBe(ExitCode.Network);
    errSpy.mockRestore();
  });
});
