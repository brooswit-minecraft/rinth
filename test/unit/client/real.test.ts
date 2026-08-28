import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { ModrinthApiError } from "@modrinth/api-client";
import type { Archon, Labrinth } from "@modrinth/api-client";
import { createRealTransport, toCliError, toPublicServer } from "../../../src/client/real.ts";
import { CliError, ExitCode } from "../../../src/errors.ts";

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
