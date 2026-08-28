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
import type { PublicServer, Transport, VersionFilters } from "./index.ts";

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
    userAgent: "rinth-cli (+https://github.com/brooswit-minecraft/rinth)",
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
  };
}
