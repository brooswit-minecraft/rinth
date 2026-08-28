// Security core: scrubs the MODRINTH_TOKEN value (and any `Bearer <token>`
// header) out of text before it is printed. src/output.ts routes every
// stdout/stderr write through `redact()` so there is no path to the
// terminal that bypasses it — see test/unit/redact.test.ts for the proof.

export const REDACTED = "***REDACTED***";

const secrets = new Set<string>();

/**
 * Register a value (e.g. the MODRINTH_TOKEN) to be scrubbed from all future
 * output. No-op for empty/undefined values so an unset token can never
 * accidentally register the empty string and redact everything.
 */
export function registerSecret(value: string | undefined | null): void {
  if (value) {
    secrets.add(value);
  }
}

const BEARER_HEADER = /Bearer\s+\S+/gi;

/**
 * Scrub every registered secret, plus any `Bearer <token>` header shape
 * (even for a token that was never explicitly registered), from `text`.
 */
export function redact(text: string): string {
  let out = text;
  for (const secret of secrets) {
    out = out.split(secret).join(REDACTED);
  }
  return out.replace(BEARER_HEADER, `Bearer ${REDACTED}`);
}

/** Test-only: clear the registry so assertions in one test can't leak into another. */
export function resetSecretsForTesting(): void {
  secrets.clear();
}
