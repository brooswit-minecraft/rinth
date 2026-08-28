// The fake transport: lets every command be unit-tested offline against
// fixtures, with zero network access. Use `apiError()` to simulate the
// 401/403/404/5xx/network failure paths and assert they map to the right
// exit code (see errors.ts's exitCodeForApiError, which the real transport
// uses to build these same CliErrors from a live HTTP status).

import { CliError, type ExitCode } from "../errors.ts";
import type { Labrinth } from "@modrinth/api-client";
import type { PublicServer, Transport } from "./index.ts";

export interface FakeTransportFixtures {
  user?: Labrinth.Users.v2.User;
  userError?: CliError;
  servers?: PublicServer[];
  serversError?: CliError;
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
  };
}

/** Build a CliError as the real transport would for a given HTTP failure. */
export function apiError(exitCode: ExitCode, message = "simulated API error"): CliError {
  return new CliError(message, exitCode);
}
