#!/usr/bin/env bun
// T2 will flesh out dispatch (auth checks, output formatting, real exit-code
// mapping via src/errors.ts) once src/commands has real commands to run.

import { commands } from "./commands/index.ts";
import { ExitCode } from "./errors.ts";

export interface ParsedArgs {
  json: boolean;
  help: boolean;
  command: string | undefined;
  rest: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  let json = false;
  let help = false;
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else {
      positional.push(arg);
    }
  }

  const [command, ...rest] = positional;
  return { json, help, command, rest };
}

export function run(argv: string[]): number {
  const parsed = parseArgs(argv);

  if (parsed.help || !parsed.command) {
    console.log("rinth — a Modrinth CLI\n\nUsage: rinth [--json] <command> [args]");
    return ExitCode.Ok;
  }

  const command = commands[parsed.command];
  if (!command) {
    console.error(`Unknown command: ${parsed.command}`);
    return ExitCode.Usage;
  }

  // T2: await command.run(parsed.rest) and map thrown CliError -> exit code.
  return ExitCode.Ok;
}

if (import.meta.main) {
  process.exit(run(process.argv.slice(2)));
}
