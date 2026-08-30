// T2 will throw CliError from command implementations; this file only defines
// the taxonomy so the CLI boundary (src/cli.ts) can map errors to exit codes.
//
// RINTH-6 / RINTH-2 spec amendment (see PR body): `versions latest` used to
// collapse "no such project" and "no version matched the filters" into the
// same exit code 4. SCHEM-6 (a real downstream consumer) needs to retry the
// second case and fail fast on the first, so those are now split into their
// own codes (7, 8) rather than sharing NotFound. This is a documented
// BREAKING CHANGE for `versions latest`'s no-match case — every other exit
// code keeps its existing meaning for every existing scenario.

export const ExitCode = {
  Ok: 0,
  Generic: 1,
  Usage: 2,
  AuthMissing: 3,
  NotFound: 4,
  ApiError: 5,
  Network: 6,
  /** `versions latest` (no `--wait`, or `--wait`'s first attempt): the project resolved fine, but no version matched the filters. Retryable — distinct from NotFound, which means the project itself couldn't be read. */
  NoVersionMatch: 7,
  /** `versions latest --wait`: the wait budget expired without a matching version ever appearing. Distinct from NoVersionMatch (a single failed attempt) and from NotFound ("I gave up waiting" is not "this does not exist"). */
  WaitTimeout: 8,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export interface CliErrorOptions {
  /** The HTTP status the request failed with, or `null` for a non-HTTP/network failure. */
  status?: number | null;
  /** `"<METHOD> <path>"` of the request that failed, or `null` when there is none (e.g. a usage error). */
  endpoint?: string | null;
  /**
   * A stable, machine-readable string for `--json` consumers to switch on
   * instead of memorizing exit codes (e.g. `"auth"`, `"project_unreadable"`,
   * `"no_version_match"`, `"wait_exhausted"`), or `null` when none applies.
   * Additive to the documented `{error:{code,status,endpoint,message}}`
   * shape — see README "Errors under --json".
   */
  reason?: string | null;
}

export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly status: number | null;
  readonly endpoint: string | null;
  readonly reason: string | null;

  constructor(message: string, exitCode: ExitCode, options: CliErrorOptions = {}) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.status = options.status ?? null;
    this.endpoint = options.endpoint ?? null;
    this.reason = options.reason ?? null;
  }
}

/**
 * Maps an HTTP status code (as seen on a failed API request) to the exit
 * code taxonomy above. `undefined` means the request never got a response
 * at all (DNS/connection/timeout failure), i.e. a network error.
 */
export function exitCodeForApiError(statusCode: number | undefined): ExitCode {
  if (statusCode === undefined) {
    return ExitCode.Network;
  }
  if (statusCode === 401 || statusCode === 403) {
    return ExitCode.AuthMissing;
  }
  if (statusCode === 404) {
    return ExitCode.NotFound;
  }
  return ExitCode.ApiError;
}
