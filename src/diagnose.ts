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
