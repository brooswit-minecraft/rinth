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
import { CliError, exitCodeForApiError } from "../errors.ts";
import type { CreateVersionFile, CreateVersionRequest, PublicServer, Transport, VersionFilters } from "./index.ts";

const USER_AGENT = "rinth-cli (+https://github.com/brooswit-minecraft/rinth)";
const LABRINTH_BASE_URL = "https://api.modrinth.com";

/** Exported for unit testing offline — maps a caught API error to a CliError with no network I/O. */
export function toCliError(error: unknown): CliError {
  const apiError = error instanceof ModrinthApiError ? error : ModrinthApiError.fromUnknown(error);
  const exitCode = exitCodeForApiError(apiError.statusCode);
  const message =
    apiError.statusCode === 426
      ? `${apiError.message} (missing/unsupported X-Panel-Version header)`
      : apiError.message;
  return new CliError(message, exitCode);
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toCliError(error);
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
      call(() => client.request<Labrinth.Users.v2.User>("/user", { api: "labrinth", version: 2 })),

    listServers: () =>
      call(async () => {
        const response = await client.archon.servers_v0.list();
        return response.servers.map(toPublicServer);
      }),

    listVersions: (project: string, filters?: VersionFilters) =>
      call(() => client.labrinth.versions_v2.getProjectVersions(project, filters)),

    getProject: (idOrSlug: string) => call(() => client.labrinth.projects_v2.get(idOrSlug)),

    createVersion: (data: CreateVersionRequest, file: CreateVersionFile) =>
      call(() => createVersionRaw(token, data, file)),
  };
}
