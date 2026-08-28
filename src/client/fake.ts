// The fake transport: lets every command be unit-tested offline against
// fixtures, with zero network access. Use `apiError()` to simulate the
// 401/403/404/5xx/network failure paths and assert they map to the right
// exit code (see errors.ts's exitCodeForApiError, which the real transport
// uses to build these same CliErrors from a live HTTP status).

import { CliError, type CliErrorOptions, type ExitCode } from "../errors.ts";
import type { Archon, Labrinth } from "@modrinth/api-client";
import type {
  ConsoleSocket,
  CreateVersionFile,
  CreateVersionRequest,
  PowerAction,
  PublicServer,
  ServerDetail,
  Transport,
  VersionFilters,
} from "./index.ts";

export interface FakeTransportFixtures {
  user?: Labrinth.Users.v2.User;
  userError?: CliError;
  servers?: PublicServer[];
  serversError?: CliError;
  server?: ServerDetail;
  serverError?: CliError;
  powerError?: CliError;
  setUpstreamError?: CliError;
  /** The id `resolveProjectId` returns; defaults to echoing the input unresolved. */
  resolveProjectId?: string;
  resolveProjectIdError?: CliError;
  wsAuth?: Archon.Websocket.v0.WSAuth;
  wsAuthError?: CliError;
  /** The socket `openSocket` returns — build one with `createFakeConsoleSocket()`. */
  socket?: ConsoleSocket;
  versions?: Labrinth.Versions.v2.Version[];
  versionsError?: CliError;
  /** Called synchronously with the exact args `listVersions` received, so tests can assert filter pass-through. */
  onListVersions?: (project: string, filters: VersionFilters | undefined) => void;
  project?: Labrinth.Projects.v2.Project;
  projectError?: CliError;
  /** Called synchronously with the exact arg `getProject` received. */
  onGetProject?: (idOrSlug: string) => void;
  createdVersion?: Labrinth.Versions.v2.Version;
  createVersionError?: CliError;
  /** Called synchronously with the exact args `createVersion` received, so tests can assert the upload was (or wasn't) attempted, e.g. on the duplicate-version and --dry-run paths. */
  onCreateVersion?: (data: CreateVersionRequest, file: CreateVersionFile) => void;
}

export function createFakeTransport(fixtures: FakeTransportFixtures = {}): Transport {
  return {
    async getCurrentUser() {
      if (fixtures.userError) {
        throw fixtures.userError;
      }
      if (!fixtures.user) {
        throw new Error("createFakeTransport: no `user` fixture provided");
      }
      return fixtures.user;
    },

    async listServers() {
      if (fixtures.serversError) {
        throw fixtures.serversError;
      }
      return fixtures.servers ?? [];
    },

    async getServer(_serverId: string) {
      if (fixtures.serverError) {
        throw fixtures.serverError;
      }
      if (!fixtures.server) {
        throw new Error("createFakeTransport: no `server` fixture provided");
      }
      return fixtures.server;
    },

    async power(_serverId: string, _action: PowerAction) {
      if (fixtures.powerError) {
        throw fixtures.powerError;
      }
    },

    async setUpstream(_serverId: string, _projectId: string, _versionId: string) {
      if (fixtures.setUpstreamError) {
        throw fixtures.setUpstreamError;
      }
    },

    async resolveProjectId(projectIdOrSlug: string) {
      if (fixtures.resolveProjectIdError) {
        throw fixtures.resolveProjectIdError;
      }
      return fixtures.resolveProjectId ?? projectIdOrSlug;
    },

    async getWebSocketAuth() {
      if (fixtures.wsAuthError) {
        throw fixtures.wsAuthError;
      }
      if (!fixtures.wsAuth) {
        throw new Error("createFakeTransport: no `wsAuth` fixture provided");
      }
      return fixtures.wsAuth;
    },

    openSocket() {
      if (!fixtures.socket) {
        throw new Error("createFakeTransport: no `socket` fixture provided");
      }
      return fixtures.socket;
    },

    async listVersions(project, filters) {
      fixtures.onListVersions?.(project, filters);
      if (fixtures.versionsError) {
        throw fixtures.versionsError;
      }
      return fixtures.versions ?? [];
    },

    async getProject(idOrSlug) {
      fixtures.onGetProject?.(idOrSlug);
      if (fixtures.projectError) {
        throw fixtures.projectError;
      }
      if (!fixtures.project) {
        throw new Error("createFakeTransport: no `project` fixture provided");
      }
      return fixtures.project;
    },

    async createVersion(data, file) {
      fixtures.onCreateVersion?.(data, file);
      if (fixtures.createVersionError) {
        throw fixtures.createVersionError;
      }
      if (!fixtures.createdVersion) {
        throw new Error("createFakeTransport: no `createdVersion` fixture provided");
      }
      return fixtures.createdVersion;
    },
  };
}

/**
 * A `ConsoleSocket` fake that unit tests drive by hand: it records every
 * frame `send()` receives (so tests can assert the exact auth/command
 * frames, in order) and exposes `emitOpen`/`emitEvent`/`emitError`/
 * `emitClose` to fire the handlers `servers exec` registered, deterministically
 * and without any real timers or sockets.
 */
export interface FakeConsoleSocket extends ConsoleSocket {
  readonly sent: Archon.Websocket.v0.WSOutgoingMessage[];
  readonly closed: boolean;
  emitOpen(): void;
  emitEvent(event: Archon.Websocket.v0.WSEvent): void;
  emitError(error: unknown): void;
  emitClose(): void;
}

export function createFakeConsoleSocket(): FakeConsoleSocket {
  const openHandlers: Array<() => void> = [];
  const eventHandlers: Array<(event: Archon.Websocket.v0.WSEvent) => void> = [];
  const errorHandlers: Array<(error: unknown) => void> = [];
  const closeHandlers: Array<() => void> = [];
  const sent: Archon.Websocket.v0.WSOutgoingMessage[] = [];
  let closed = false;

  return {
    sent,
    get closed() {
      return closed;
    },
    send(message) {
      sent.push(message);
    },
    close() {
      closed = true;
    },
    onOpen(handler) {
      openHandlers.push(handler);
    },
    onEvent(handler) {
      eventHandlers.push(handler);
    },
    onError(handler) {
      errorHandlers.push(handler);
    },
    onClose(handler) {
      closeHandlers.push(handler);
    },
    emitOpen() {
      for (const handler of openHandlers) handler();
    },
    emitEvent(event) {
      for (const handler of eventHandlers) handler(event);
    },
    emitError(error) {
      for (const handler of errorHandlers) handler(error);
    },
    emitClose() {
      for (const handler of closeHandlers) handler();
    },
  };
}

/** Build a CliError as the real transport would for a given HTTP failure. */
export function apiError(exitCode: ExitCode, message = "simulated API error", options?: CliErrorOptions): CliError {
  return new CliError(message, exitCode, options);
}
