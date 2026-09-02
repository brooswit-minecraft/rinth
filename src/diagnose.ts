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
//     specific call is proven credential-independent, not resource-
//     dependent: a deliberately invalid token got the exact same 404 (see
//     README "Authentication — what a token can and cannot do"). What
//     inside Archon actually produces the 404 is not visible from outside
//     Modrinth — do not assert a mechanism (router, removed, unmounted).
//   - Every per-server Archon endpoint this CLI calls (`servers get`,
//     `power`, `exec`'s WebSocket auth, and `upstream`'s read-back) rejects
//     a PAT with 403. Confirmed from labrinth's published PAT scope enum
//     (`apps/labrinth/src/models/v3/pats.rs`): there is no SERVER/ARCHON/
//     PYRO scope at all, so no PAT — regardless of its owner or scopes —
//     can ever satisfy this check by acquiring a missing scope. That makes
//     a 403 here an upstream limitation, not a caller misconfiguration —
//     but what Archon's own check actually keys on is undecided: its
//     backend source is not public (see README "Known gaps / follow-ups").
//
// Neither call site can produce the other's status, so — unlike the
// draft-vs-nonexistent 404 above — there is no genuinely ambiguous case to
// name here: the two are already cleanly distinguished by (call site,
// status). Each function below still only ever touches the one status it
// diagnoses, and passes anything else through unchanged, for the same
// reason diagnoseNotFound does: a wrong guess here would be worse than no
// diagnosis at all.

/**
 * The `reason` for a 404 from `servers upstream`'s reinstall call. Keeps
 * the word "dead" even though the prose above and every message below
 * deliberately avoids it (see the comment block above): this is a
 * machine contract a fail-closed CI consumer branches on by exact
 * string, not a claim about why the 404 happens. Do not "helpfully"
 * rename it to match the prose.
 */
export const UPSTREAM_ROUTE_DEAD_REASON = "servers_upstream_route_dead";

/** The `reason` for a 403 from a per-server Archon endpoint. */
export const SERVER_CREDENTIAL_REFUSED_REASON = "servers_credential_refused";

/**
 * Rewrites a 404 from `servers upstream`'s `setUpstream` call (the v0
 * `reinstall` route) into a message naming the failing route explicitly
 * and pointing at where its resolution is tracked, instead of a bare API
 * string. Preserves `exitCode`/`status`/`endpoint` exactly, same contract
 * as `diagnoseNotFound`. Any error that isn't a 404 passes through
 * unchanged.
 */
export function diagnoseUpstreamRouteDead(error: CliError): CliError {
  if (error.status !== 404) {
    return error;
  }

  const message =
    "servers upstream failed: HTTP 404 from the v0 `POST /modrinth/v0/servers/{id}/reinstall` route. " +
    "This call returns this exact same 404 regardless of credentials, server, or project — a " +
    "deliberately invalid token gets it too (see README \"Authentication — what a token can and cannot " +
    "do\") — and what produces it is not visible from outside Modrinth. There is nothing to change on " +
    "your end: this is a known upstream condition whose resolution is undecided — see README \"Known " +
    "gaps / follow-ups\" for the current state of knowledge.";

  return new CliError(message, error.exitCode, {
    status: error.status,
    endpoint: error.endpoint,
    reason: UPSTREAM_ROUTE_DEAD_REASON,
  });
}

/**
 * Rewrites a 403 from a per-server Archon endpoint into a message naming the
 * server and stating this is an upstream limitation, not a caller
 * misconfiguration, instead of a bare API string. Preserves
 * `exitCode`/`status`/`endpoint` exactly, same contract as `diagnoseNotFound`.
 * Any error that isn't a 403 passes through unchanged.
 */
export function diagnoseServerCredentialRefused(error: CliError, serverId: string): CliError {
  if (error.status !== 403) {
    return error;
  }

  const message =
    `Server ${serverId} refused this credential (HTTP 403). This is an upstream limitation, not a ` +
    "misconfiguration on your end — labrinth's PAT scope enum has no SERVER/ARCHON/PYRO scope at all, " +
    "so no PAT can satisfy this check by acquiring a missing scope. What credential (if any) can is " +
    "undecided: Archon's backend is not public, so we do not know what clears it. See README " +
    "\"Authentication — what a token can and cannot do\".";

  return new CliError(message, error.exitCode, {
    status: error.status,
    endpoint: error.endpoint,
    reason: SERVER_CREDENTIAL_REFUSED_REASON,
  });
}
