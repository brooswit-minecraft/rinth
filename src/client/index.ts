// The injectable transport boundary: every command talks to the Modrinth
// API only through this interface, so every command is unit-testable
// offline against fixtures (see ./fake.ts) with zero network access. The
// real implementation (./real.ts) wraps @modrinth/api-client.
//
// NOTE on shape: the original stub sketched a raw `request<T>(path, init)`
// transport. @modrinth/api-client's Archon methods (e.g. servers_v0.list())
// are typed module calls rather than caller-built paths, so a raw-fetch
// shape can't wrap them cleanly. This is a command-shaped transport instead
// (one method per API call a command needs) — still fully fake-able offline,
// which is the actual requirement. See PR body for more detail.

import type { Archon, Labrinth } from "@modrinth/api-client";

/**
 * A server as exposed by `rinth servers list`, trimmed to fields that are
 * safe to print. Deliberately excludes `sftp_username`/`sftp_password` and
 * the node panel token that the Archon API returns alongside each server —
 * those are credentials for the user's real, live server and must never
 * reach stdout, logs, or CI output.
 */
export interface PublicServer {
  id: string;
  name: string;
  status: Archon.Servers.v0.Status;
  game: Archon.Servers.v0.Game;
  loader: Archon.Servers.v0.Loader | null;
  loader_version: string | null;
  mc_version: string | null;
  net: Archon.Servers.v0.Net;
}

/**
 * Filters for `listVersions`, forwarded to labrinth's
 * `GET /project/{id|slug}/version` (v2). `channel` (release/beta/alpha) is
 * NOT a server-side filter on this endpoint — verified against
 * https://docs.modrinth.com — so it is applied client-side by the command,
 * not sent as a request param.
 */
export interface VersionFilters {
  loaders?: string[];
  game_versions?: string[];
  limit?: number;
}

/** A single `--dependency <project_id>:<required|optional>` entry, in the shape labrinth's `data.dependencies` expects. */
export interface CreateVersionDependency {
  project_id: string;
  dependency_type: "required" | "optional";
}

/**
 * The JSON `data` part of labrinth's `POST /version` (v2) multipart body —
 * see `rinth publish`. Field set matches what the ticket/live docs specify;
 * `project_id` must be the project's canonical id (resolved from a slug via
 * `getProject`, not sent as-typed by the user).
 */
export interface CreateVersionRequest {
  project_id: string;
  version_number: string;
  name: string;
  changelog: string;
  game_versions: string[];
  loaders: string[];
  version_type: Labrinth.Versions.v2.VersionType;
  featured: boolean;
  dependencies: CreateVersionDependency[];
  file_parts: string[];
  primary_file: string;
}

/** The single file uploaded alongside `CreateVersionRequest`. `name` must equal the entry in `file_parts`/`primary_file`. */
export interface CreateVersionFile {
  name: string;
  data: Uint8Array;
}

export interface Transport {
  /** GET labrinth `/user` (v2) — the authenticated user. */
  getCurrentUser(): Promise<Labrinth.Users.v2.User>;
  /** List servers via the Archon `servers_v0` API for the authenticated user. */
  listServers(): Promise<PublicServer[]>;
  /** GET labrinth `/project/{idOrSlug}/version` (v2) — a project's versions, unmodified API shape. */
  listVersions(project: string, filters?: VersionFilters): Promise<Labrinth.Versions.v2.Version[]>;
  /** GET labrinth `/project/{idOrSlug}` (v2) — resolves a slug (or id) to its canonical project, e.g. for `project_id` in `createVersion`. */
  getProject(idOrSlug: string): Promise<Labrinth.Projects.v2.Project>;
  /** POST labrinth `/version` (v2), multipart — creates a version with its file attached. See `src/client/real.ts` for why this bypasses the API client's own upload path. */
  createVersion(data: CreateVersionRequest, file: CreateVersionFile): Promise<Labrinth.Versions.v2.Version>;
}

export { createRealTransport } from "./real.ts";
export { createFakeTransport } from "./fake.ts";
