// The token is read ONLY from the MODRINTH_TOKEN environment variable —
// there is never a --token flag and never a config file. Token value must
// never be logged, flagged, or echoed.

import { CliError, ExitCode } from "./errors.ts";
import { registerSecret } from "./redact.ts";

export function getToken(): string | undefined {
  return process.env["MODRINTH_TOKEN"];
}

/**
 * Read MODRINTH_TOKEN, registering it for redaction, or throw a CliError
 * (exit code 3) with guidance on how to set it. Every command that talks to
 * the Modrinth API calls this before making a request.
 */
export function requireToken(): string {
  const token = getToken();
  if (!token) {
    throw new CliError(
      "MODRINTH_TOKEN is not set. Set it with: export MODRINTH_TOKEN=<your Modrinth API token>",
      ExitCode.AuthMissing,
    );
  }
  registerSecret(token);
  return token;
}
