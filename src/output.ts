// T2 will route real command results through these so every command supports
// both human-readable and `--json` output from a single call site.

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data));
}

export function printHuman(message: string): void {
  console.log(message);
}
