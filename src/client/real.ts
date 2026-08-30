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
//
// UPLOAD PATH: `createVersion` does NOT use the API client's own upload
// support, despite KAN-731's ticket suggesting two candidate routes
// (`client.upload()` directly, or `client.labrinth.versions_v3.createVersion()`).
// Both were verified against the actual package (0.60.0) to be unusable
// here: `GenericModrinthClient extends XHRUploadClient`, whose `upload()`
// method (which `versions_v3.createVersion()` also calls internally —
// confirmed by reading dist/index.js) constructs a `new XMLHttpRequest()`.
// That's a browser-only global; `typeof XMLHttpRequest` is `"undefined"` in
// Bun, so BOTH routes throw `ModrinthApiError: XMLHttpRequest is not
// defined` immediately, before any request is sent — reproduced with a
// standalone script calling `client.upload("/version", {api:"labrinth",
// version:2, formData})`. This is a runtime incompatibility, not a live-API
// issue, so per the ticket's own fallback instructions this falls back to
// a single raw `fetch` (`createVersionRaw` below): it sends the same Bearer
// token, User-Agent, and X-Panel-Version header the rest of this file's
// requests carry, and still routes every failure through `toCliError()` via
// `call()`, same as every other transport method. See PR body.

import {
  AuthFeature,
  GenericModrinthClient,
  ModrinthApiError,
  PanelVersionFeature,
} from "@modrinth/api-client";
import type { Archon, AuthConfig, Labrinth } from "@modrinth/api-client";
import { requireToken } from "../auth.ts";
import { CliError, ExitCode, exitCodeForApiError } from "../errors.ts";
import {
  ICON_CONTENT_TYPES,
  type ConsoleSocket,
  type CreateVersionFile,
  type CreateVersionRequest,
  type PowerAction,
  type PublicServer,
  type ServerDetail,
  type Transport,
  type VersionFilters,
} from "./index.ts";

const USER_AGENT = "rinth-cli (+https://github.com/brooswit-minecraft/rinth)";
const LABRINTH_BASE_URL = "https://api.modrinth.com";

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
  // RINTH-6/RINTH-2: token-absent-or-rejected is one machine-readable
  // outcome ("auth") regardless of which of 401/403 the API returned.
  const reason = exitCode === ExitCode.AuthMissing ? "auth" : null;
  return new CliError(message, exitCode, { status, endpoint: endpoint ?? null, reason });
}

async function call<T>(fn: () => Promise<T>, endpoint: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toCliError(error, endpoint);
  }
}

/** Exported for unit testing offline — builds the multipart body labrinth's `POST /version` (v2) expects: a JSON `data` part plus one file part named after `file.name` (must match an entry in `data.file_parts`). */
export function buildCreateVersionFormData(data: CreateVersionRequest, file: CreateVersionFile): FormData {
  const formData = new FormData();
  formData.append("data", JSON.stringify(data));
  formData.append(file.name, new Blob([file.data]), file.name);
  return formData;
}

async function createVersionRaw(
  token: string,
  data: CreateVersionRequest,
  file: CreateVersionFile,
): Promise<Labrinth.Versions.v2.Version> {
  const response = await fetch(`${LABRINTH_BASE_URL}/v2/version`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "X-Panel-Version": "1",
    },
    body: buildCreateVersionFormData(data, file),
  });

  if (!response.ok) {
    const responseData: unknown = await response.json().catch(() => undefined);
    const description =
      responseData && typeof responseData === "object" && "description" in responseData
        ? (responseData as { description?: unknown }).description
        : undefined;
    const message = typeof description === "string" ? description : `Upload failed with status ${response.status}`;
    throw new ModrinthApiError(message, { statusCode: response.status, responseData });
  }

  return (await response.json()) as Labrinth.Versions.v2.Version;
}

/**
 * Exported for unit testing offline — the same raw-`fetch` fallback
 * `createVersionRaw` uses, for the same reason: `PATCH /project/{id}/icon`
 * takes the raw image bytes as its body (confirmed against
 * https://docs.modrinth.com/api/operations/changeprojecticon/ — see the PR
 * body), which is not a shape the API client's typed module methods cover
 * for v2 (`projects_v3.changeIcon()` exists but is v3-only and still goes
 * through the client's broken `upload()`/XMLHttpRequest path — see this
 * file's header). A raw `fetch` sidesteps both problems at once.
 */
async function uploadProjectIconRaw(
  token: string,
  idOrSlug: string,
  ext: string,
  bytes: Uint8Array,
): Promise<void> {
  const contentType = ICON_CONTENT_TYPES[ext] ?? "application/octet-stream";
  const response = await fetch(
    `${LABRINTH_BASE_URL}/v2/project/${encodeURIComponent(idOrSlug)}/icon?ext=${encodeURIComponent(ext)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
        "X-Panel-Version": "1",
        "Content-Type": contentType,
      },
      body: bytes,
    },
  );

  if (!response.ok) {
    const responseData: unknown = await response.json().catch(() => undefined);
    const description =
      responseData && typeof responseData === "object" && "description" in responseData
        ? (responseData as { description?: unknown }).description
        : undefined;
    const message =
      typeof description === "string" ? description : `Icon upload failed with status ${response.status}`;
    throw new ModrinthApiError(message, { statusCode: response.status, responseData });
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
    userAgent: USER_AGENT,
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

    listVersions: (project: string, filters?: VersionFilters) =>
      call(
        () => client.labrinth.versions_v2.getProjectVersions(project, filters),
        `GET /v2/project/${encodeURIComponent(project)}/version`,
      ),

    getProject: (idOrSlug: string) =>
      call(
        () => client.labrinth.projects_v2.get(idOrSlug),
        `GET /v2/project/${encodeURIComponent(idOrSlug)}`,
      ),

    createVersion: (data: CreateVersionRequest, file: CreateVersionFile) =>
      call(() => createVersionRaw(token, data, file), "POST /v2/version"),

    getVersion: (id: string) =>
      call(() => client.labrinth.versions_v2.getVersion(id), `GET /v2/version/${encodeURIComponent(id)}`),

    // `versions_v2.deleteVersion()` resolves on a 2xx; on the live API's
    // documented 404-on-success quirk it throws instead, same as every
    // other failed call here — the command layer (`versions delete`) is
    // what decides whether that 404 means the delete actually happened,
    // via a read-back, not this transport method.
    deleteVersion: (id: string) =>
      call(() => client.labrinth.versions_v2.deleteVersion(id), `DELETE /v2/version/${encodeURIComponent(id)}`),

    // `client.request()` (not `.upload()`) — the same escape hatch
    // `getCurrentUser`/`resolveProjectId` use above. Confirmed safe: it
    // goes through the base client's `executeRequest()`, which is backed by
    // `ofetch` (a fetch wrapper), never `XMLHttpRequest` — only `.upload()`
    // (`XHRUploadClient`) touches that browser-only global. `patch` is
    // passed through untouched (RINTH-3/RINTH-4 epic ruling — see
    // `Transport#updateProject`'s doc comment); `ofetch` JSON-serializes an
    // object body automatically (confirmed in the package's own
    // `RequestOptions.body` doc comment).
    updateProject: (idOrSlug: string, patch: Record<string, unknown>) =>
      call(
        () =>
          client.request<void>(`/project/${encodeURIComponent(idOrSlug)}`, {
            api: "labrinth",
            version: 2,
            method: "PATCH",
            body: patch,
          }),
        `PATCH /v2/project/${encodeURIComponent(idOrSlug)}`,
      ),

    uploadProjectIcon: (idOrSlug: string, ext: string, bytes: Uint8Array) =>
      call(
        () => uploadProjectIconRaw(token, idOrSlug, ext, bytes),
        `PATCH /v2/project/${encodeURIComponent(idOrSlug)}/icon`,
      ),
  };
}
