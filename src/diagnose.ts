// Shared 404 diagnosis for project/version lookups. Every rinth request
// already sends the Bearer token unconditionally (see src/client/real.ts),
// so a 404 here is never "you forgot to authenticate" — it is one of three
// things the live API cannot distinguish for us (a DRAFT project 404s to a
// read its own token can't see, byte-identical to a project that simply
// doesn't exist — see README "Authentication"). Per RINTH-6/RINTH-2: this is
// ONE outcome covering multiple candidate causes, not a guess at which one
// applies — inventing a heuristic to pick between them would reintroduce the
// exact class of lie this helper exists to remove.
//
// Route every project/version lookup through this rather than letting a
// bare "404 Not Found" reach the user: `project get`, `versions list`,
// `versions latest`, and `publish`'s project resolution.

import { CliError } from "./errors.ts";

/** The `reason` (see CliErrorOptions) for every error this helper produces. */
export const NOT_FOUND_REASON = "project_unreadable";

/**
 * Rewrites a 404 `CliError` into one whose message names the candidate
 * causes and points at `rinth whoami`, preserving `exitCode`/`status`/
 * `endpoint` exactly (the `--json` error shape must not change shape, only
 * gain a better `message` and the additive `reason`). Any other error
 * (wrong status, or not a CliError at all) passes through unchanged — this
 * only ever touches a 404.
 */
export function diagnoseNotFound(error: CliError, subject: string): CliError {
  if (error.status !== 404) {
    return error;
  }

  const message =
    `${subject} was not found (HTTP 404), even though this request was authenticated. This could mean:\n` +
    "  - no such project/version exists;\n" +
    "  - it exists but is not visible to this token's identity (e.g. a draft owned by someone else); or\n" +
    "  - the token is missing or was rejected.\n" +
    "Run `rinth whoami` to check which identity is in play.";

  return new CliError(message, error.exitCode, {
    status: error.status,
    endpoint: error.endpoint,
    reason: NOT_FOUND_REASON,
  });
}

// ---------------------------------------------------------------------------
// `servers` family diagnosis (RINTH-14). Unlike diagnoseNotFound above, these
// two are NOT a single outcome covering multiple candidate causes — they are
// two causes that currently look identical (a bare API string) but are
// individually unambiguous once you know which call site produced them:
//
//   - `servers upstream`'s reinstall call always hits the v0
//     `POST /modrinth/v0/servers/{id}/reinstall` route. A 404 from THIS
//     specific call is proven router-level, not credential- or
//     resource-dependent: a deliberately invalid token got the exact same
//     404 (see README "Authentication — what a token can and cannot do").
//   - Every per-server Archon endpoint this CLI calls (`servers get`,
//     `power`, `exec`'s WebSocket auth, and `upstream`'s read-back) rejects
//     a PAT with 403. Confirmed from labrinth's published PAT scope enum
//     (`apps/labrinth/src/models/v3/pats.rs`): there is no SERVER/ARCHON/
//     PYRO scope at all, so no PAT — regardless of its owner or scopes —
//     can ever satisfy this check. A 403 from one of these endpoints is
//     therefore always the identity wall, never an ownership/permissions
//     question a different credential of the same kind could fix.
//
// Neither call site can produce the other's status, so — unlike the
// draft-vs-nonexistent 404 above — there is no genuinely ambiguous case to
// name here: the two are already cleanly distinguished by (call site,
// status). Each function below still only ever touches the one status it
// diagnoses, and passes anything else through unchanged, for the same
// reason diagnoseNotFound does: a wrong guess here would be worse than no
// diagnosis at all.

/** The `reason` for a 404 from `servers upstream`'s dead v0 reinstall route. */
export const UPSTREAM_ROUTE_DEAD_REASON = "servers_upstream_route_dead";

/** The `reason` for a 403 from a per-server Archon endpoint. */
export const SERVER_CREDENTIAL_REFUSED_REASON = "servers_credential_refused";

/**
 * Rewrites a 404 from `servers upstream`'s `setUpstream` call (the v0
 * `reinstall` route) into a message naming the dead route explicitly and
 * pointing at the rinth-side remedy, instead of a bare API string. Preserves
 * `exitCode`/`status`/`endpoint` exactly, same contract as `diagnoseNotFound`.
 * Any error that isn't a 404 passes through unchanged.
 */
export function diagnoseUpstreamRouteDead(error: CliError): CliError {
  if (error.status !== 404) {
    return error;
  }

  const message =
    "servers upstream failed: HTTP 404 from the v0 `POST /modrinth/v0/servers/{id}/reinstall` route. " +
    "This route is dead at the router, independent of credentials, server, or project — a deliberately " +
    "invalid token gets this exact same 404 (see README \"Authentication — what a token can and cannot " +
    "do\"). There is nothing to change on your end: the remedy is a rinth-side migration to the v1 " +
    "content API, not yet done (see README \"Known gaps / follow-ups\").";

  return new CliError(message, error.exitCode, {
    status: error.status,
    endpoint: error.endpoint,
    reason: UPSTREAM_ROUTE_DEAD_REASON,
  });
}

/**
 * Rewrites a 403 from a per-server Archon endpoint into a message naming the
 * server and the identity wall, instead of a bare API string. Preserves
 * `exitCode`/`status`/`endpoint` exactly, same contract as `diagnoseNotFound`.
 * Any error that isn't a 403 passes through unchanged.
 */
export function diagnoseServerCredentialRefused(error: CliError, serverId: string): CliError {
  if (error.status !== 403) {
    return error;
  }

  const message =
    `Server ${serverId} refused this credential (HTTP 403). A labrinth PAT cannot carry per-server ` +
    "Archon access — this is an identity wall, not a missing PAT scope (there is no SERVER/ARCHON/PYRO " +
    "scope at all). Only a browser session token works here, and there is no way to obtain one in CI. " +
    "See README \"Authentication — what a token can and cannot do\".";

  return new CliError(message, error.exitCode, {
    status: error.status,
    endpoint: error.endpoint,
    reason: SERVER_CREDENTIAL_REFUSED_REASON,
  });
}
