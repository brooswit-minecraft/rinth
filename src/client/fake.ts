// The fake transport: lets every command be unit-tested offline against
// fixtures, with zero network access. Use `apiError()` to simulate the
// 401/403/404/5xx/network failure paths and assert they map to the right
// exit code (see errors.ts's exitCodeForApiError, which the real transport
// uses to build these same CliErrors from a live HTTP status).

import { CliError, type ExitCode } from "../errors.ts";
import type { Labrinth } from "@modrinth/api-client";
import type { CreateVersionFile, CreateVersionRequest, PublicServer, Transport, VersionFilters } from "./index.ts";

export interface FakeTransportFixtures {
  user?: Labrinth.Users.v2.User;
  userError?: CliError;
  servers?: PublicServer[];
  serversError?: CliError;
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

/** Build a CliError as the real transport would for a given HTTP failure. */
export function apiError(exitCode: ExitCode, message = "simulated API error"): CliError {
  return new CliError(message, exitCode);
}
