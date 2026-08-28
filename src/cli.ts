#!/usr/bin/env bun
// Dispatch: parses argv, resolves a command, and maps whatever it throws to
// an exit code. All output (including "unknown command") goes through
// src/output.ts so it can never bypass redaction.

import { createRealTransport, type Transport } from "./client/index.ts";
import { commands } from "./commands/index.ts";
import { CliError, ExitCode } from "./errors.ts";
import { printError, printHuman } from "./output.ts";

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

export interface RunDeps {
  /** Injected for tests; defaults to the real network transport. */
  transport?: Transport;
}

export async function run(argv: string[], deps: RunDeps = {}): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.help || !parsed.command) {
    printHuman("rinth — a Modrinth CLI\n\nUsage: rinth [--json] <command> [args]");
    return ExitCode.Ok;
  }

  const command = commands[parsed.command];
  if (!command) {
    printError(`Unknown command: ${parsed.command}`);
    return ExitCode.Usage;
  }

  try {
    const transport = deps.transport ?? createRealTransport();
    return await command.run(parsed.rest, { json: parsed.json, transport });
  } catch (err) {
    if (err instanceof CliError) {
      printError(err.message);
      return err.exitCode;
    }
    printError(err instanceof Error ? err.message : String(err));
    return ExitCode.Generic;
  }
}

if (import.meta.main) {
  process.exit(await run(process.argv.slice(2)));
}
