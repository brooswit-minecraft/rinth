// Every command routes its output through these so both human-readable and
// `--json` output come from a single call site. Every function here scrubs
// its argument with redact() before printing — this is the ONLY place the
// CLI writes to stdout/stderr, so there is no path to the terminal that can
// bypass redaction (see test/unit/redact.test.ts).

import { redact } from "./redact.ts";

export function printJson(data: unknown): void {
  console.log(redact(JSON.stringify(data)));
}

export function printHuman(message: string): void {
  console.log(redact(message));
}

export function printError(message: string): void {
  console.error(redact(message));
}
