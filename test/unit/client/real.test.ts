import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { ModrinthApiError } from "@modrinth/api-client";
import type { Archon, Labrinth } from "@modrinth/api-client";
import { createRealTransport, toCliError, toPublicServer, toServerDetail } from "../../../src/client/real.ts";
import { CliError, ExitCode } from "../../../src/errors.ts";
import { printJson } from "../../../src/output.ts";

/**
 * Stubs global fetch for the duration of one test — no real network egress.
 * Takes a factory (not a Response instance) because ofetch retries certain
 * status codes (500 included) by default, and a Response body can only be
 * read once — reusing one instance across retried calls throws.
 */
function mockFetch(makeResponse: () => Response) {
  return spyOn(globalThis, "fetch").mockImplementation(
    (async () => makeResponse()) as unknown as typeof fetch,
  );
}

const FIXTURE_USER: Labrinth.Users.v2.User = {
  id: "abc",
  username: "test",
  created: "2024-01-01T00:00:00Z",
  role: "developer",
  badges: 0,
};

const FULL_SERVER: Archon.Servers.v0.Server = {
  server_id: "srv_123",
  name: "My Server",
  owner_id: "user_1",
  net: { ip: null, port: 25565, domain: "srv-123.modrinth.gg" },
  game: "Minecraft",
  backup_quota: 5,
  used_backup_quota: 1,
  status: "available",
  suspension_reason: null,
  loader: "Paper",
  loader_version: "1.20.4-497",
  mc_version: "1.20.4",
  upstream: null,
  sftp_username: "very-secret-username",
  sftp_password: "very-secret-password",
  sftp_host: "sftp.modrinth.gg",
  datacenter: "us-east",
  notices: [],
  node: { token: "very-secret-node-token", instance: "node-1" },
  flows: { intro: false },
  is_medal: false,
  current_user_permissions: 0,
};

describe("toCliError", () => {
  test("maps a 401 ModrinthApiError to AuthMissing, message unchanged", () => {
    const err = toCliError(new ModrinthApiError("nope", { statusCode: 401 }));
    expect(err.exitCode).toBe(ExitCode.AuthMissing);
    expect(err.message).toBe("nope");
  });

  test("maps a 404 ModrinthApiError to NotFound", () => {
    const err = toCliError(new ModrinthApiError("missing", { statusCode: 404 }));
    expect(err.exitCode).toBe(ExitCode.NotFound);
  });

  test("maps a missing status code (network failure) to Network", () => {
    const err = toCliError(new ModrinthApiError("connect failed", {}));
    expect(err.exitCode).toBe(ExitCode.Network);
  });

  test("names the X-Panel-Version header when the status is 426", () => {
    const err = toCliError(new ModrinthApiError("unsupported archon request version", { statusCode: 426 }));
    expect(err.exitCode).toBe(ExitCode.ApiError);
    expect(err.message).toContain("X-Panel-Version");
  });

  test("wraps a non-ModrinthApiError via ModrinthApiError.fromUnknown", () => {
    const err = toCliError(new Error("boom"));
    expect(err.exitCode).toBe(ExitCode.Network);
  });

  test("carries status and endpoint onto the CliError when an endpoint is given", () => {
    const err = toCliError(new ModrinthApiError("Forbidden", { statusCode: 403 }), "GET /modrinth/v0/servers/srv_123");
    expect(err.status).toBe(403);
    expect(err.endpoint).toBe("GET /modrinth/v0/servers/srv_123");
  });

  test("prefixes the plain-text message with 'HTTP <status> <endpoint>:' when an endpoint is given", () => {
    const err = toCliError(new ModrinthApiError("Forbidden", { statusCode: 403 }), "GET /modrinth/v0/servers/srv_123");
    expect(err.message).toBe("HTTP 403 GET /modrinth/v0/servers/srv_123: Forbidden");
  });

  test("leaves the message unprefixed when no endpoint is given (existing callers)", () => {
    const err = toCliError(new ModrinthApiError("Forbidden", { statusCode: 403 }));
    expect(err.message).toBe("Forbidden");
  });

  test("has a null status but still carries the endpoint on a network failure (no HTTP response to attribute a status to)", () => {
    const err = toCliError(new ModrinthApiError("connect failed", {}), "GET /modrinth/v0/servers/srv_123");
    expect(err.status).toBeNull();
    expect(err.endpoint).toBe("GET /modrinth/v0/servers/srv_123");
    expect(err.message).toBe("connect failed");
  });
});

describe("toPublicServer", () => {
  test("trims to only the fields safe to print", () => {
    expect(toPublicServer(FULL_SERVER)).toEqual({
      id: "srv_123",
      name: "My Server",
      status: "available",
      game: "Minecraft",
      loader: "Paper",
      loader_version: "1.20.4-497",
      mc_version: "1.20.4",
      net: { ip: null, port: 25565, domain: "srv-123.modrinth.gg" },
    });
  });

  test("never carries sftp/node credentials through", () => {
    const serialized = JSON.stringify(toPublicServer(FULL_SERVER));
    expect(serialized).not.toContain("secret");
  });
});

describe("toServerDetail", () => {
  test("trims to only the fields safe to print, including datacenter/upstream", () => {
    expect(toServerDetail(FULL_SERVER)).toEqual({
      id: "srv_123",
      name: "My Server",
      status: "available",
      game: "Minecraft",
      loader: "Paper",
      loader_version: "1.20.4-497",
      mc_version: "1.20.4",
      net: { ip: null, port: 25565, domain: "srv-123.modrinth.gg" },
      datacenter: "us-east",
      upstream: null,
    });
  });

  test("never carries sftp/node credentials through the real print path (printJson)", () => {
    // A full fake Server carrying literal credential values, sent through
    // the actual trim function AND the actual printJson() call path (the
    // only function in the CLI allowed to write to stdout) — proving there
    // is no route from a raw Server to output that leaks these fields.
    const serverWithCredentials: Archon.Servers.v0.Server = {
      ...FULL_SERVER,
      sftp_password: "hunter2",
      node: { token: "secret", instance: "node-1" },
    };

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    printJson(toServerDetail(serverWithCredentials));
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(printed).not.toContain("hunter2");
    expect(printed).not.toContain("secret");
  });
});

describe("createRealTransport", () => {
  const ORIGINAL = process.env["MODRINTH_TOKEN"];

  beforeEach(() => {
    process.env["MODRINTH_TOKEN"] = "unit-test-real-transport-token";
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env["MODRINTH_TOKEN"];
    } else {
      process.env["MODRINTH_TOKEN"] = ORIGINAL;
    }
  });

  test("throws (exit code 3) instead of constructing a client when the token is missing", () => {
    delete process.env["MODRINTH_TOKEN"];
    expect(() => createRealTransport()).toThrow();
  });

  // These exercise the real request pipeline (feature chain, auth header,
  // JSON parsing, error normalization) with global fetch mocked, so there
  // is no real network egress — offline and deterministic, but real code.
  describe("with fetch mocked (no real network egress)", () => {
    test("getCurrentUser resolves with the parsed user on a 200 response", async () => {
      const fetchSpy = mockFetch(
        () =>
          new Response(JSON.stringify(FIXTURE_USER), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );

      const transport = createRealTransport();
      const user = await transport.getCurrentUser();
      fetchSpy.mockRestore();

      expect(user).toEqual(FIXTURE_USER);
    });

    test("getCurrentUser rejects with a CliError mapped from a 401 response", async () => {
      const fetchSpy = mockFetch(() => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));

      const transport = createRealTransport();
      let caught: unknown;
      try {
        await transport.getCurrentUser();
      } catch (err) {
        caught = err;
      }
      fetchSpy.mockRestore();

      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).exitCode).toBe(ExitCode.AuthMissing);
    });

    test("listServers resolves with trimmed servers on a 200 response", async () => {
      const fetchSpy = mockFetch(
        () =>
          new Response(
            JSON.stringify({
              servers: [FULL_SERVER],
              pagination: { current_page: 1, page_size: 10, total_pages: 1, total_items: 1 },
              users: {},
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      );

      const transport = createRealTransport();
      const servers = await transport.listServers();
      fetchSpy.mockRestore();

      expect(servers).toEqual([toPublicServer(FULL_SERVER)]);
    });

    test("listServers rejects with a CliError mapped from a 500 response", async () => {
      const fetchSpy = mockFetch(() => new Response(JSON.stringify({ error: "internal" }), { status: 500 }));

      const transport = createRealTransport();
      let caught: unknown;
      try {
        await transport.listServers();
      } catch (err) {
        caught = err;
      }
      fetchSpy.mockRestore();

      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).exitCode).toBe(ExitCode.ApiError);
    });

    test("getServer resolves with the trimmed server on a 200 response", async () => {
      const fetchSpy = mockFetch(
        () => new Response(JSON.stringify(FULL_SERVER), { status: 200, headers: { "content-type": "application/json" } }),
      );

      const transport = createRealTransport();
      const server = await transport.getServer("srv_123");
      fetchSpy.mockRestore();

      expect(server).toEqual(toServerDetail(FULL_SERVER));
    });

    test("getServer rejects with a CliError mapped from a 404 response", async () => {
      const fetchSpy = mockFetch(() => new Response(JSON.stringify({ error: "not found" }), { status: 404 }));

      const transport = createRealTransport();
      let caught: unknown;
      try {
        await transport.getServer("nope");
      } catch (err) {
        caught = err;
      }
      fetchSpy.mockRestore();

      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).exitCode).toBe(ExitCode.NotFound);
    });

    test("getServer rejects with a CliError carrying status 403 and the resolved endpoint on a 403 response", async () => {
      const fetchSpy = mockFetch(() => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));

      const transport = createRealTransport();
      let caught: unknown;
      try {
        await transport.getServer("srv_123");
      } catch (err) {
        caught = err;
      }
      fetchSpy.mockRestore();

      expect(caught).toBeInstanceOf(CliError);
      const cliError = caught as CliError;
      expect(cliError.exitCode).toBe(ExitCode.AuthMissing);
      expect(cliError.status).toBe(403);
      expect(cliError.endpoint).toBe("GET /modrinth/v0/servers/srv_123");
      expect(cliError.message).toContain("HTTP 403 GET /modrinth/v0/servers/srv_123:");
    });

    test("getWebSocketAuth resolves with the parsed auth on a 200 response", async () => {
      const fetchSpy = mockFetch(
        () =>
          new Response(JSON.stringify({ url: "wss://example.test/console", token: "jwt-abc" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );

      const transport = createRealTransport();
      const auth = await transport.getWebSocketAuth("srv_1");
      fetchSpy.mockRestore();

      expect(auth).toEqual({ url: "wss://example.test/console", token: "jwt-abc" });
    });

    test("getWebSocketAuth rejects with a CliError mapped from a 404 response", async () => {
      const fetchSpy = mockFetch(() => new Response(JSON.stringify({ error: "not found" }), { status: 404 }));

      const transport = createRealTransport();
      let caught: unknown;
      try {
        await transport.getWebSocketAuth("srv_1");
      } catch (err) {
        caught = err;
      }
      fetchSpy.mockRestore();

      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).exitCode).toBe(ExitCode.NotFound);
    });

    test("power resolves on a 200/204 response", async () => {
      const fetchSpy = mockFetch(() => new Response(null, { status: 204 }));

      const transport = createRealTransport();
      await expect(transport.power("srv_123", "Restart")).resolves.toBeUndefined();
      fetchSpy.mockRestore();
    });

    test("power rejects with a CliError mapped from a 426 response (missing X-Panel-Version)", async () => {
      const fetchSpy = mockFetch(
        () => new Response(JSON.stringify({ error: "unsupported archon request version" }), { status: 426 }),
      );

      const transport = createRealTransport();
      let caught: unknown;
      try {
        await transport.power("srv_123", "Kill");
      } catch (err) {
        caught = err;
      }
      fetchSpy.mockRestore();

      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).exitCode).toBe(ExitCode.ApiError);
      expect((caught as CliError).message).toContain("X-Panel-Version");
    });

    test("setUpstream resolves on a 200/204 response", async () => {
      const fetchSpy = mockFetch(() => new Response(null, { status: 204 }));

      const transport = createRealTransport();
      await expect(transport.setUpstream("srv_123", "AABBCCDD", "version_1")).resolves.toBeUndefined();
      fetchSpy.mockRestore();
    });

    test("setUpstream rejects with a CliError mapped from a 500 response", async () => {
      const fetchSpy = mockFetch(() => new Response(JSON.stringify({ error: "internal" }), { status: 500 }));

      const transport = createRealTransport();
      let caught: unknown;
      try {
        await transport.setUpstream("srv_123", "AABBCCDD", "version_1");
      } catch (err) {
        caught = err;
      }
      fetchSpy.mockRestore();

      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).exitCode).toBe(ExitCode.ApiError);
    });

    test("resolveProjectId resolves the project id from a labrinth project lookup, by slug or id", async () => {
      const PROJECT: Labrinth.Projects.v2.Project = {
        id: "AABBCCDD",
        slug: "fabulously-optimized",
      } as Labrinth.Projects.v2.Project;
      const fetchSpy = mockFetch(
        () => new Response(JSON.stringify(PROJECT), { status: 200, headers: { "content-type": "application/json" } }),
      );

      const transport = createRealTransport();
      const id = await transport.resolveProjectId("fabulously-optimized");
      fetchSpy.mockRestore();

      expect(id).toBe("AABBCCDD");
    });

    test("resolveProjectId rejects with a CliError mapped from a 404 response (unknown slug/id)", async () => {
      const fetchSpy = mockFetch(() => new Response(JSON.stringify({ error: "not found" }), { status: 404 }));

      const transport = createRealTransport();
      let caught: unknown;
      try {
        await transport.resolveProjectId("does-not-exist");
      } catch (err) {
        caught = err;
      }
      fetchSpy.mockRestore();

      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).exitCode).toBe(ExitCode.NotFound);
    });
  });

  describe("openSocket", () => {
    /** Minimal stand-in for the platform `WebSocket` — just enough to prove `wrapWebSocket`'s event wiring and `send()` framing. */
    class StubWebSocket {
      readonly url: string;
      readonly listeners: Record<string, Array<(event?: unknown) => void>> = {};
      readonly sent: string[] = [];
      closeCalled = false;

      constructor(url: string) {
        this.url = url;
      }

      addEventListener(type: string, handler: (event?: unknown) => void): void {
        (this.listeners[type] ??= []).push(handler);
      }

      send(data: string): void {
        this.sent.push(data);
      }

      close(): void {
        this.closeCalled = true;
      }
    }

    function withStubWebSocket<T>(fn: (sockets: StubWebSocket[]) => T): T {
      const sockets: StubWebSocket[] = [];
      const OriginalWebSocket = globalThis.WebSocket;
      class TrackedStubWebSocket extends StubWebSocket {
        constructor(url: string) {
          super(url);
          sockets.push(this);
        }
      }
      // @ts-expect-error -- test stub deliberately narrower than the lib.dom WebSocket type
      globalThis.WebSocket = TrackedStubWebSocket;
      try {
        return fn(sockets);
      } finally {
        globalThis.WebSocket = OriginalWebSocket;
      }
    }

    test("opens a WebSocket to the given URL, and send() JSON-frames outgoing messages", () => {
      withStubWebSocket((sockets) => {
        const transport = createRealTransport();
        const socket = transport.openSocket("wss://example.test/console");
        socket.send({ event: "auth", jwt: "jwt-abc" });

        expect(sockets).toHaveLength(1);
        expect(sockets[0]?.url).toBe("wss://example.test/console");
        expect(sockets[0]?.sent).toEqual([JSON.stringify({ event: "auth", jwt: "jwt-abc" })]);
      });
    });

    test("routes open/message/error/close listener events to the matching ConsoleSocket handler", () => {
      withStubWebSocket((sockets) => {
        const transport = createRealTransport();
        const socket = transport.openSocket("wss://example.test/console");
        const stub = sockets[0];
        if (!stub) throw new Error("expected a stub WebSocket to have been constructed");

        let opened = false;
        socket.onOpen(() => {
          opened = true;
        });
        let receivedEvent: unknown;
        socket.onEvent((event) => {
          receivedEvent = event;
        });
        let receivedError: unknown;
        socket.onError((error) => {
          receivedError = error;
        });
        let closed = false;
        socket.onClose(() => {
          closed = true;
        });

        stub.listeners["open"]?.[0]?.();
        stub.listeners["message"]?.[0]?.({ data: JSON.stringify({ event: "auth-ok" }) });
        const errorEvent = { message: "boom" };
        stub.listeners["error"]?.[0]?.(errorEvent);
        stub.listeners["close"]?.[0]?.();
        socket.close();

        expect(opened).toBe(true);
        expect(receivedEvent).toEqual({ event: "auth-ok" });
        expect(receivedError).toBe(errorEvent);
        expect(closed).toBe(true);
        expect(stub.closeCalled).toBe(true);
      });
    });

    test("ignores a malformed message frame instead of throwing", () => {
      withStubWebSocket((sockets) => {
        const transport = createRealTransport();
        const socket = transport.openSocket("wss://example.test/console");
        const stub = sockets[0];
        if (!stub) throw new Error("expected a stub WebSocket to have been constructed");

        let calls = 0;
        socket.onEvent(() => {
          calls++;
        });

        expect(() => stub.listeners["message"]?.[0]?.({ data: "not json" })).not.toThrow();
        expect(calls).toBe(0);
      });
    });
    test("listVersions resolves with the unmodified version array on a 200 response", async () => {
      const versions: Labrinth.Versions.v2.Version[] = [
        {
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
          files: [],
          dependencies: [],
          game_versions: ["1.20.4"],
          loaders: ["fabric"],
        },
      ];
      const fetchSpy = mockFetch(
        () =>
          new Response(JSON.stringify(versions), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );

      const transport = createRealTransport();
      const result = await transport.listVersions("sodium", { loaders: ["fabric"] });
      fetchSpy.mockRestore();

      expect(result).toEqual(versions);
    });

    test("listVersions rejects with a CliError mapped from a 404 response", async () => {
      const fetchSpy = mockFetch(() => new Response(JSON.stringify({ error: "not found" }), { status: 404 }));

      const transport = createRealTransport();
      let caught: unknown;
      try {
        await transport.listVersions("does-not-exist");
      } catch (err) {
        caught = err;
      }
      fetchSpy.mockRestore();

      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).exitCode).toBe(ExitCode.NotFound);
    });
  });
});
