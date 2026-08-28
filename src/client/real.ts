// The real transport: wraps @modrinth/api-client's GenericModrinthClient.
// Archon (servers) calls go through the client's typed `servers_v0` module;
// labrinth `/user` has no dedicated "current user" module method (the
// client's labrinth.users_v2 module only fetches by id/username), so it
// goes through the client's generic `.request()` escape hatch instead —
// still fully wrapped by the same AuthFeature/retry/error-normalization
// pipeline as every other call, so no separate raw-fetch REST helper is
// needed. (Corrects the ticket's assumption that labrinth needs a
// hand-rolled REST helper — see PR body.)
//
// PanelVersionFeature is NOT applied by default despite existing in the
// package (confirmed by reading dist/index.js): without it, both labrinth
// and archon requests are missing `X-Panel-Version: 1` and the Archon API
// rejects them with HTTP 426 *before* evaluating auth, which would
// otherwise look like an auth failure. Must be added explicitly.

import {
  AuthFeature,
  GenericModrinthClient,
  ModrinthApiError,
  PanelVersionFeature,
} from "@modrinth/api-client";
import type { Archon, AuthConfig, Labrinth } from "@modrinth/api-client";
import { requireToken } from "../auth.ts";
import { CliError, exitCodeForApiError } from "../errors.ts";
import type { ConsoleSocket, PowerAction, PublicServer, ServerDetail, Transport } from "./index.ts";

/**
 * Exported for unit testing offline — maps a caught API error to a CliError
 * with no network I/O. `endpoint` (`"<METHOD> <path>"`) is supplied by the
 * call site below rather than read off the caught error: `GenericModrinthClient`
 * overrides `normalizeError()` with a single-argument signature that drops
 * the request-context second parameter the base class uses to populate
 * `ModrinthApiError.context`, so that field is always empty here (confirmed
 * by reading dist/index.js) — the CLI has to supply method+path itself.
 */
export function toCliError(error: unknown, endpoint?: string): CliError {
  const apiError = error instanceof ModrinthApiError ? error : ModrinthApiError.fromUnknown(error);
  const exitCode = exitCodeForApiError(apiError.statusCode);
  const status = apiError.statusCode ?? null;
  let message =
    apiError.statusCode === 426
      ? `${apiError.message} (missing/unsupported X-Panel-Version header)`
      : apiError.message;
  if (status !== null && endpoint) {
    message = `HTTP ${status} ${endpoint}: ${message}`;
  }
  return new CliError(message, exitCode, { status, endpoint: endpoint ?? null });
}

async function call<T>(fn: () => Promise<T>, endpoint: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toCliError(error, endpoint);
  }
}

/** Exported for unit testing offline — the field trim that keeps server credentials out of output. */
export function toPublicServer(server: Archon.Servers.v0.Server): PublicServer {
  return {
    id: server.server_id,
    name: server.name,
    status: server.status,
    game: server.game,
    loader: server.loader,
    loader_version: server.loader_version,
    mc_version: server.mc_version,
    net: server.net,
  };
}

/**
 * Exported for unit testing offline — the field trim `servers get` uses.
 * Built field by field from the raw `Server` (never spread) so a new
 * credential field added to the API response in the future doesn't reach
 * output just because it wasn't excluded.
 */
export function toServerDetail(server: Archon.Servers.v0.Server): ServerDetail {
  return {
    id: server.server_id,
    name: server.name,
    status: server.status,
    game: server.game,
    loader: server.loader,
    loader_version: server.loader_version,
    mc_version: server.mc_version,
    net: server.net,
    datacenter: server.datacenter,
    upstream: server.upstream,
  };
}

/**
 * Wraps a platform `WebSocket` (Bun/browser standard API) behind the
 * `ConsoleSocket` seam so `servers exec` can be unit-tested against a fake
 * socket instead. Not routed through `call()`/`toCliError` — those map
 * failed *HTTP requests*, but a socket's `error`/`close` events carry no
 * HTTP status to map, so the command itself decides the exit code.
 */
function wrapWebSocket(socket: WebSocket): ConsoleSocket {
  return {
    send(message) {
      socket.send(JSON.stringify(message));
    },
    close() {
      socket.close();
    },
    onOpen(handler) {
      socket.addEventListener("open", () => handler());
    },
    onEvent(handler) {
      socket.addEventListener("message", (messageEvent) => {
        try {
          const event = JSON.parse(String(messageEvent.data)) as Archon.Websocket.v0.WSEvent;
          handler(event);
        } catch {
          // Malformed/unrecognized frame — ignore rather than crash the console session.
        }
      });
    },
    onError(handler) {
      socket.addEventListener("error", (errorEvent) => handler(errorEvent));
    },
    onClose(handler) {
      socket.addEventListener("close", () => handler());
    },
  };
}

export function createRealTransport(): Transport {
  const token = requireToken();
  // AuthFeature's declared constructor type is inherited from
  // AbstractFeature (config?: FeatureConfig), which omits `token` even
  // though AuthFeature documents and uses AuthConfig at runtime — assigning
  // through a typed variable (rather than an object literal) sidesteps that
  // excess-property-check gap in the package's own .d.ts.
  const authConfig: AuthConfig = { token };
  const client = new GenericModrinthClient({
    userAgent: "rinth-cli (+https://github.com/brooswit-minecraft/rinth)",
    features: [new AuthFeature(authConfig), new PanelVersionFeature()],
  });

  return {
    getCurrentUser: () =>
      call(() => client.request<Labrinth.Users.v2.User>("/user", { api: "labrinth", version: 2 }), "GET /v2/user"),

    listServers: () =>
      call(async () => {
        const response = await client.archon.servers_v0.list();
        return response.servers.map(toPublicServer);
      }, "GET /modrinth/v0/servers"),

    getServer: (serverId: string) =>
      call(
        async () => toServerDetail(await client.archon.servers_v0.get(serverId)),
        `GET /modrinth/v0/servers/${serverId}`,
      ),

    power: (serverId: string, action: PowerAction) =>
      call(() => client.archon.servers_v0.power(serverId, action), `POST /modrinth/v0/servers/${serverId}/power`),

    setUpstream: (serverId: string, projectId: string, versionId: string) =>
      call(
        () => client.archon.servers_v0.reinstall(serverId, { project_id: projectId, version_id: versionId }),
        `POST /modrinth/v0/servers/${serverId}/reinstall`,
      ),

    // Labrinth's `GET /project/:idOrSlug` accepts a project id OR its slug
    // interchangeably and returns the same `Project` shape either way, so
    // there is no need to guess whether `projectIdOrSlug` is already an id
    // before resolving it — always resolving is simpler and cannot
    // misclassify an id-shaped slug (or vice versa). Same `.request()`
    // escape hatch `getCurrentUser` uses for labrinth `/user`.
    resolveProjectId: (projectIdOrSlug: string) =>
      call(async () => {
        const project = await client.request<Labrinth.Projects.v2.Project>(
          `/project/${encodeURIComponent(projectIdOrSlug)}`,
          { api: "labrinth", version: 2 },
        );
        return project.id;
      }, `GET /v2/project/${encodeURIComponent(projectIdOrSlug)}`),

    getWebSocketAuth: (serverId) =>
      call(() => client.archon.servers_v0.getWebSocketAuth(serverId), `GET /modrinth/v0/servers/${serverId}/ws`),

    openSocket: (url) => wrapWebSocket(new WebSocket(url)),
  };
}
