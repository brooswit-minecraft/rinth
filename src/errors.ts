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

export class CliError extends Error {
  readonly exitCode: ExitCode;

  constructor(message: string, exitCode: ExitCode) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
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
