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
 * The `servers get` shape: `PublicServer` plus the fields that command needs
 * (current upstream, datacenter) but `servers list` does not. Same
 * allowlist discipline as `PublicServer` — still excludes
 * `sftp_username`/`sftp_password`/`node.token`.
 */
export interface ServerDetail extends PublicServer {
  datacenter: string;
  upstream: Archon.Servers.v0.Upstream | null;
}

/** The capitalized action union `servers_v0.power()` expects; the CLI accepts lowercase and maps. */
export type PowerAction = "Start" | "Stop" | "Restart" | "Kill";

/**
 * A minimal, injectable wrapper around one WebSocket connection to the
 * Archon console API — thin enough to fake in unit tests (see
 * `createFakeConsoleSocket` in ./fake.ts), so `servers exec` never touches
 * the network in a test. The real implementation (./real.ts) wraps the
 * platform's `WebSocket`.
 */
export interface ConsoleSocket {
  send(message: Archon.Websocket.v0.WSOutgoingMessage): void;
  close(): void;
  onOpen(handler: () => void): void;
  onEvent(handler: (event: Archon.Websocket.v0.WSEvent) => void): void;
  onError(handler: (error: unknown) => void): void;
  onClose(handler: () => void): void;
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

/**
 * Extensions labrinth's `PATCH /project/{id}/icon` accepts, mapped to the
 * Content-Type sent with each byte stream — confirmed against
 * https://docs.modrinth.com/api/operations/changeprojecticon/ (fetched
 * directly; the vendored `@modrinth/api-client` 0.60.0 has no v2 icon
 * method to cross-check this against — only a v3 `projects_v3.changeIcon()`
 * — see `src/client/real.ts`). Shared between the real transport (Content-
 * Type header) and `rinth project icon`'s own extension validation
 * (`src/commands/project.ts`), so the two can never drift apart.
 */
export const ICON_CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  bmp: "image/bmp",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg",
  svgz: "image/svgz",
  rgb: "image/rgb",
};

/**
 * `project_type` accepted by labrinth v2's `POST /project` — confirmed from
 * the OpenAPI spec at docs.modrinth.com ("Create a project"); NOT exercised
 * live (no MODRINTH_TOKEN in the agent environment — see PR body). The
 * create-time enum is only `mod`/`modpack`, narrower than
 * `Labrinth.Projects.v2.ProjectType` (which also covers
 * `resourcepack`/`shader`/`plugin`/`datapack`/`project` as *derived* display
 * types, not creatable top-level types) — see `rinth project create` in the
 * README and the PR body for the source.
 */
export type CreateProjectType = "mod" | "modpack";

/** `client_side`/`server_side` accepted by labrinth v2's `POST /project` (same three values as `rinth publish`'s environment fields; the fourth `Environment` value, `unknown`, is server-assigned and never a valid create-time input). */
export type CreateProjectEnvironment = "required" | "optional" | "unsupported";

/**
 * The JSON `data` part of labrinth's `POST /project` (v2) multipart body —
 * see `rinth project create`. `is_draft`/`initial_versions` are constants
 * the CLI supplies itself (every project this route creates is a draft with
 * no versions yet), not user-facing flags.
 */
export interface CreateProjectRequest {
  title: string;
  project_type: CreateProjectType;
  slug: string;
  description: string;
  body: string;
  categories: string[];
  client_side: CreateProjectEnvironment;
  server_side: CreateProjectEnvironment;
  license_id: string;
  is_draft: true;
  initial_versions: [];
  license_url?: string;
  source_url?: string;
  issues_url?: string;
}

/**
 * Optional icon part for `POST /project`'s multipart body. Not wired to any
 * CLI flag here — RINTH-4 owns `project icon` — but `buildCreateProjectFormData`
 * accepts it so an icon part can be added later without restructuring the
 * form-data builder.
 */
export interface CreateProjectIconFile {
  name: string;
  data: Uint8Array;
}

export interface Transport {
  /** GET labrinth `/user` (v2) — the authenticated user. */
  getCurrentUser(): Promise<Labrinth.Users.v2.User>;
  /** List servers via the Archon `servers_v0` API for the authenticated user. */
  listServers(): Promise<PublicServer[]>;
  /** GET a single server's details via `servers_v0.get()`. */
  getServer(serverId: string): Promise<ServerDetail>;
  /** POST a power action via `servers_v0.power()`. */
  power(serverId: string, action: PowerAction): Promise<void>;
  /** POST a modpack re-point via `servers_v0.reinstall()`. */
  setUpstream(serverId: string, projectId: string, versionId: string): Promise<void>;
  /** Resolve a project slug or id to its canonical id via labrinth `GET /project/:idOrSlug`. */
  resolveProjectId(projectIdOrSlug: string): Promise<string>;
  /** GET Archon `servers_v0` WebSocket auth credentials (`{ url, token }`) for the console socket. */
  getWebSocketAuth(serverId: string): Promise<Archon.Websocket.v0.WSAuth>;
  /** Open a socket to a console URL (from `getWebSocketAuth`). Fake-able so `servers exec` is testable offline. */
  openSocket(url: string): ConsoleSocket;
  /** GET labrinth `/project/{idOrSlug}/version` (v2) — a project's versions, unmodified API shape. */
  listVersions(project: string, filters?: VersionFilters): Promise<Labrinth.Versions.v2.Version[]>;
  /** GET labrinth `/project/{idOrSlug}` (v2) — resolves a slug (or id) to its canonical project, e.g. for `project_id` in `createVersion`. */
  getProject(idOrSlug: string): Promise<Labrinth.Projects.v2.Project>;
  /** POST labrinth `/version` (v2), multipart — creates a version with its file attached. See `src/client/real.ts` for why this bypasses the API client's own upload path. */
  createVersion(data: CreateVersionRequest, file: CreateVersionFile): Promise<Labrinth.Versions.v2.Version>;
  /** GET labrinth `/version/{id}` (v2) — a single version, unmodified API shape. Used by `versions delete`'s read-back verification. */
  getVersion(id: string): Promise<Labrinth.Versions.v2.Version>;
  /** POST labrinth `/project` (v2), multipart — creates a DRAFT project. See `src/client/real.ts` for why this bypasses the API client's own upload path, same as `createVersion`. */
  createProject(data: CreateProjectRequest, icon?: CreateProjectIconFile): Promise<Labrinth.Projects.v2.Project>;
  /** DELETE labrinth `/version/{id}` (v2). The live API returns 404 even when the delete succeeds — see `versions delete` in `src/commands/versions.ts`, which never trusts this call's status code on its own and always reads the version back afterward. */
  deleteVersion(id: string): Promise<void>;
  /**
   * PATCH labrinth `/project/{idOrSlug}` (v2) — a SPARSE update. Signature
   * fixed by RINTH-4/RINTH-3 epic-level arbitration so both stories' branches
   * agree on it byte-for-byte (see PR body): `patch` is a plain
   * `Record<string, unknown>`, never a typed `Project`/`Partial<Project>` —
   * the caller (`rinth project edit`, `src/commands/project.ts`) builds it
   * sparsely, from only the flags the operator actually passed, and this
   * method must never fill in a default for a key the caller omitted.
   * Returns `void`, deliberately NOT the updated project: there is nothing
   * in a PATCH response a caller may trust (`versions delete` established
   * why — a live API can 2xx a write that didn't land) so every caller MUST
   * verify via `getProject` afterward rather than being handed a
   * conveniently-shaped shortcut around that.
   */
  updateProject(idOrSlug: string, patch: Record<string, unknown>): Promise<void>;
  /**
   * PATCH labrinth `/project/{idOrSlug}/icon` (v2) with the raw image bytes
   * as the request body and the file extension as the `ext` query param —
   * see `src/client/real.ts` for why this bypasses `@modrinth/api-client`'s
   * own upload path, and `ICON_CONTENT_TYPES` above for the accepted
   * extensions. Returns `void` for the same reason `updateProject` does —
   * callers must verify via `getProject().icon_url` themselves.
   */
  uploadProjectIcon(idOrSlug: string, ext: string, bytes: Uint8Array): Promise<void>;
}

export { createRealTransport } from "./real.ts";
export { createFakeTransport } from "./fake.ts";
