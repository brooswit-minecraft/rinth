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
}

export { createRealTransport } from "./real.ts";
export { createFakeTransport } from "./fake.ts";
