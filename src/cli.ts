#!/usr/bin/env bun
// Dispatch: parses argv, resolves a command, and maps whatever it throws to
// an exit code. All output (including "unknown command") goes through
// src/output.ts so it can never bypass redaction.

import { createRealTransport, type Transport } from "./client/index.ts";
import { commands } from "./commands/index.ts";
import { CliError, ExitCode } from "./errors.ts";
import { printError, printHuman, printJsonError } from "./output.ts";

/** Shape of the single JSON value `--json` mode prints to stderr on any error. */
function jsonError(code: ExitCode, status: number | null, endpoint: string | null, message: string) {
  return { error: { code, status, endpoint, message } };
}

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
      if (parsed.json) {
        printJsonError(jsonError(err.exitCode, err.status, err.endpoint, err.message));
      } else {
        printError(err.message);
      }
      return err.exitCode;
    }
    const message = err instanceof Error ? err.message : String(err);
    if (parsed.json) {
      printJsonError(jsonError(ExitCode.Generic, null, null, message));
    } else {
      printError(message);
    }
    return ExitCode.Generic;
  }
}

if (import.meta.main) {
  process.exit(await run(process.argv.slice(2)));
}
