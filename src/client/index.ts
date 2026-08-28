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

export interface Transport {
  /** GET labrinth `/user` (v2) — the authenticated user. */
  getCurrentUser(): Promise<Labrinth.Users.v2.User>;
  /** List servers via the Archon `servers_v0` API for the authenticated user. */
  listServers(): Promise<PublicServer[]>;
}

export { createRealTransport } from "./real.ts";
export { createFakeTransport } from "./fake.ts";
