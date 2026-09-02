import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { run } from "../../../src/cli.ts";
import { apiError, createFakeConsoleSocket, createFakeTransport } from "../../../src/client/fake.ts";
import type { PublicServer, ServerDetail } from "../../../src/client/index.ts";
import { ExitCode } from "../../../src/errors.ts";
import { resetSecretsForTesting } from "../../../src/redact.ts";

/** Lets exec()'s pending `await`s (the `getWebSocketAuth` fake call, the `--wait` timer) settle before the test drives the fake socket. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const FIXTURE_WS_AUTH = { url: "wss://example.test/console", token: "ws-secret-token-xyz" };

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

  describe("RINTH-14: diagnosed failures never reach the user as a bare API string", () => {
    test("a real 404 from the reinstall route names the failing v0 route without a mechanism or a claimed remedy, with a distinct reason under --json", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        setUpstreamError: apiError(ExitCode.NotFound, "Not Found", {
          status: 404,
          endpoint: "POST /modrinth/v0/servers/srv_123/reinstall",
        }),
      });

      const code = await run(
        ["--json", "servers", "upstream", "srv_123", "--project", "AABBCCDD", "--version", "version_1"],
        { transport },
      );

      expect(code).toBe(ExitCode.NotFound);
      const printed = JSON.parse(String(errSpy.mock.calls[0]?.[0])) as {
        error: { message: string; reason: string | null };
      };
      errSpy.mockRestore();

      expect(printed.error.message).not.toBe("HTTP 404 POST /modrinth/v0/servers/srv_123/reinstall: Not Found");
      expect(printed.error.message).toContain("reinstall");
      expect(printed.error.message).toContain("regardless of credentials");
      expect(printed.error.message).not.toContain("dead at the router");
      expect(printed.error.reason).toBe("servers_upstream_route_dead");
    });

    test("a real 403 from the per-server Archon read-back names the server and states an upstream limitation, with a distinct reason under --json", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        resolveProjectId: "AABBCCDD",
        serverError: apiError(ExitCode.AuthMissing, "Forbidden", {
          status: 403,
          endpoint: "GET /modrinth/v0/servers/srv_123",
        }),
      });

      const code = await run(
        ["--json", "servers", "upstream", "srv_123", "--project", "fabulously-optimized", "--version", "version_1"],
        { transport },
      );

      expect(code).toBe(ExitCode.AuthMissing);
      const printed = JSON.parse(String(errSpy.mock.calls[0]?.[0])) as {
        error: { message: string; reason: string | null };
      };
      errSpy.mockRestore();

      expect(printed.error.message).not.toBe("HTTP 403 GET /modrinth/v0/servers/srv_123: Forbidden");
      expect(printed.error.message).toContain("srv_123");
      expect(printed.error.message).toContain("upstream limitation");
      expect(printed.error.message).not.toContain("session token");
      expect(printed.error.reason).toBe("servers_credential_refused");
    });

    test("a 403 from `servers get` is diagnosed the same way as upstream's read-back", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        serverError: apiError(ExitCode.AuthMissing, "Forbidden", {
          status: 403,
          endpoint: "GET /modrinth/v0/servers/srv_123",
        }),
      });

      const code = await run(["--json", "servers", "get", "srv_123"], { transport });

      expect(code).toBe(ExitCode.AuthMissing);
      const printed = JSON.parse(String(errSpy.mock.calls[0]?.[0])) as { error: { reason: string | null } };
      errSpy.mockRestore();

      expect(printed.error.reason).toBe("servers_credential_refused");
    });

    test("a 403 from `servers power` is diagnosed the same way", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        powerError: apiError(ExitCode.AuthMissing, "Forbidden", {
          status: 403,
          endpoint: "POST /modrinth/v0/servers/srv_123/power",
        }),
      });

      const code = await run(["--json", "servers", "power", "srv_123", "restart"], { transport });

      expect(code).toBe(ExitCode.AuthMissing);
      const printed = JSON.parse(String(errSpy.mock.calls[0]?.[0])) as { error: { reason: string | null } };
      errSpy.mockRestore();

      expect(printed.error.reason).toBe("servers_credential_refused");
    });

    test("a 403 from `servers exec`'s WebSocket auth is diagnosed the same way", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        wsAuthError: apiError(ExitCode.AuthMissing, "Forbidden", {
          status: 403,
          endpoint: "GET /modrinth/v0/servers/srv_1/ws",
        }),
      });

      const code = await run(["--json", "servers", "exec", "srv_1", "say", "hello"], { transport });

      expect(code).toBe(ExitCode.AuthMissing);
      const printed = JSON.parse(String(errSpy.mock.calls[0]?.[0])) as { error: { reason: string | null } };
      errSpy.mockRestore();

      expect(printed.error.reason).toBe("servers_credential_refused");
    });

    test("a real 404 from resolveProjectId reuses the existing project-lookup diagnosis (reason 'project_unreadable'), distinct from the two servers-specific reasons", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        resolveProjectIdError: apiError(ExitCode.NotFound, "Not Found", {
          status: 404,
          endpoint: "GET /v2/project/bogus-slug",
        }),
      });

      const code = await run(
        ["--json", "servers", "upstream", "srv_123", "--project", "bogus-slug", "--version", "version_1"],
        { transport },
      );

      expect(code).toBe(ExitCode.NotFound);
      const printed = JSON.parse(String(errSpy.mock.calls[0]?.[0])) as {
        error: { message: string; reason: string | null };
      };
      errSpy.mockRestore();

      expect(printed.error.reason).toBe("project_unreadable");
      expect(printed.error.message).toContain("rinth whoami");
    });
  });
});

describe("rinth servers exec", () => {
  afterEach(() => {
    resetSecretsForTesting();
  });

  test("happy path: auth ok -> command sent -> log lines collected -> exit 0, exact frames in order", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const socket = createFakeConsoleSocket();
    const transport = createFakeTransport({ wsAuth: FIXTURE_WS_AUTH, socket });

    const runPromise = run(["servers", "exec", "srv_1", "--wait", "0", "say", "hello"], { transport });
    await tick();

    socket.emitOpen();
    socket.emitEvent({ event: "auth-ok" });
    socket.emitEvent({ event: "log", stream: "stdout", message: "line one" });
    socket.emitEvent({ event: "log", stream: "stdout", message: "line two" });

    const code = await runPromise;

    expect(code).toBe(ExitCode.Ok);
    expect(socket.sent).toEqual([
      { event: "auth", jwt: "ws-secret-token-xyz" },
      { event: "command", cmd: "say hello" },
    ]);
    expect(socket.closed).toBe(true);
    expect(logSpy.mock.calls.map((call) => String(call[0]))).toEqual(["line one", "line two"]);
    logSpy.mockRestore();
  });

  test("--json prints one object with id, command, and collected lines, and nothing else", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const socket = createFakeConsoleSocket();
    const transport = createFakeTransport({ wsAuth: FIXTURE_WS_AUTH, socket });

    const runPromise = run(["--json", "servers", "exec", "srv_1", "--wait", "0", "say", "hello"], { transport });
    await tick();

    socket.emitOpen();
    socket.emitEvent({ event: "auth-ok" });
    socket.emitEvent({ event: "log", stream: "stdout", message: "line one" });

    const code = await runPromise;

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0]?.[0])).toBe(
      JSON.stringify({ id: "srv_1", command: "say hello", lines: ["line one"] }),
    );
    logSpy.mockRestore();
  });

  test("no output within --wait is not an error: exit 0 with an empty line list", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const socket = createFakeConsoleSocket();
    const transport = createFakeTransport({ wsAuth: FIXTURE_WS_AUTH, socket });

    const runPromise = run(["--json", "servers", "exec", "srv_1", "--wait", "0", "say", "hello"], { transport });
    await tick();

    socket.emitOpen();
    socket.emitEvent({ event: "auth-ok" });
    // No log frames at all.

    const code = await runPromise;

    expect(code).toBe(ExitCode.Ok);
    expect(String(logSpy.mock.calls[0]?.[0])).toBe(JSON.stringify({ id: "srv_1", command: "say hello", lines: [] }));
    logSpy.mockRestore();
  });

  test("auth-incorrect maps to exit code 3 and closes the socket", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const socket = createFakeConsoleSocket();
    const transport = createFakeTransport({ wsAuth: FIXTURE_WS_AUTH, socket });

    const runPromise = run(["servers", "exec", "srv_1", "say", "hello"], { transport });
    await tick();

    socket.emitOpen();
    socket.emitEvent({ event: "auth-incorrect" });

    const code = await runPromise;
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.AuthMissing);
    expect(socket.closed).toBe(true);
  });

  test("a remote close after the command was sent reports the collected output (exit 0), not a failure", async () => {
    // Regression test: an idle console closing the socket right after
    // processing a command is normal, not a connection failure — the
    // reviewer reproduced this against the fake socket (see PR #5 review):
    // open -> auth-ok -> log("there are 2 players") -> close with
    // --wait 500 --json used to exit 6 with an empty `lines`, discarding
    // the line that was already collected.
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const socket = createFakeConsoleSocket();
    const transport = createFakeTransport({ wsAuth: FIXTURE_WS_AUTH, socket });

    const runPromise = run(["--json", "servers", "exec", "srv", "--wait", "500", "list"], { transport });
    await tick();

    socket.emitOpen();
    socket.emitEvent({ event: "auth-ok" });
    socket.emitEvent({ event: "log", stream: "stdout", message: "there are 2 players" });
    socket.emitClose();

    const code = await runPromise;

    expect(code).toBe(ExitCode.Ok);
    expect(String(logSpy.mock.calls[0]?.[0])).toBe(
      JSON.stringify({ id: "srv", command: "list", lines: ["there are 2 players"] }),
    );
    logSpy.mockRestore();
  });

  test("a remote close BEFORE the command is sent (pre auth-ok) still maps to exit code 6", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const socket = createFakeConsoleSocket();
    const transport = createFakeTransport({ wsAuth: FIXTURE_WS_AUTH, socket });

    const runPromise = run(["servers", "exec", "srv_1", "say", "hello"], { transport });
    await tick();

    socket.emitOpen();
    socket.emitClose();

    const code = await runPromise;
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Network);
    expect(socket.closed).toBe(true);
  });

  test("a socket connection failure maps to exit code 6 and closes the socket", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const socket = createFakeConsoleSocket();
    const transport = createFakeTransport({ wsAuth: FIXTURE_WS_AUTH, socket });

    const runPromise = run(["servers", "exec", "srv_1", "say", "hello"], { transport });
    await tick();

    socket.emitError(new Error("connection refused"));

    const code = await runPromise;
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Network);
    expect(socket.closed).toBe(true);
  });

  test.each([
    [404, ExitCode.NotFound],
    [401, ExitCode.AuthMissing],
    [403, ExitCode.AuthMissing],
    [426, ExitCode.ApiError],
    [500, ExitCode.ApiError],
  ] as const)("a getWebSocketAuth failure with HTTP status %d surfaces as exit code %d", async (_status, expectedExitCode) => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ wsAuthError: apiError(expectedExitCode) });

    const code = await run(["servers", "exec", "srv_1", "say", "hello"], { transport });
    errSpy.mockRestore();

    expect(code).toBe(expectedExitCode);
  });

  test("a getWebSocketAuth network failure (no HTTP response) maps to exit code 6", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ wsAuthError: apiError(ExitCode.Network, "fetch failed") });

    const code = await run(["servers", "exec", "srv_1", "say", "hello"], { transport });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Network);
  });

  test.each([
    ["missing id and command", ["servers", "exec"]],
    ["missing command", ["servers", "exec", "srv_1"]],
    ["non-numeric --wait", ["servers", "exec", "srv_1", "--wait", "abc", "say", "hi"]],
    ["negative --wait", ["servers", "exec", "srv_1", "--wait", "-5", "say", "hi"]],
    ["--wait with no value", ["servers", "exec", "srv_1", "--wait"]],
  ] as const)("usage error (exit code 2): %s", async (_label, argv) => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run([...argv], { transport });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  test("the WSAuth token is registered as a secret before the socket does anything, so it never reaches stdout/stderr", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const socket = createFakeConsoleSocket();
    const transport = createFakeTransport({ wsAuth: FIXTURE_WS_AUTH, socket });

    const runPromise = run(["servers", "exec", "srv_1", "--wait", "0", "say", "hello"], { transport });
    await tick();

    socket.emitOpen();
    socket.emitEvent({ event: "auth-ok" });
    // A malicious/misbehaving server echoing the auth token back in a log line must still never reach output.
    socket.emitEvent({ event: "log", stream: "stdout", message: `token was ${FIXTURE_WS_AUTH.token}` });

    await runPromise;

    const printed = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(printed).not.toContain(FIXTURE_WS_AUTH.token);
    expect(printed).toContain("***REDACTED***");
    logSpy.mockRestore();
  });
});
