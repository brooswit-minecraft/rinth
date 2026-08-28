// T2 will throw CliError from command implementations; this file only defines
// the taxonomy so the CLI boundary (src/cli.ts) can map errors to exit codes.

export const ExitCode = {
  Ok: 0,
  Generic: 1,
  Usage: 2,
  AuthMissing: 3,
  NotFound: 4,
  ApiError: 5,
  Network: 6,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export interface CliErrorOptions {
  /** The HTTP status the request failed with, or `null` for a non-HTTP/network failure. */
  status?: number | null;
  /** `"<METHOD> <path>"` of the request that failed, or `null` when there is none (e.g. a usage error). */
  endpoint?: string | null;
}

export class CliError extends Error {
  readonly exitCode: ExitCode;
  readonly status: number | null;
  readonly endpoint: string | null;

  constructor(message: string, exitCode: ExitCode, options: CliErrorOptions = {}) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.status = options.status ?? null;
    this.endpoint = options.endpoint ?? null;
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
