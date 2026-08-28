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
    // Lazy: `createRealTransport()` calls `requireToken()`, which throws
    // without MODRINTH_TOKEN. Every existing command reads `ctx.transport`
    // as its first action, so this is no different from eager construction
    // for them — but `rinth publish --dry-run` (KAN-731) must run without a
    // token, and never touches `ctx.transport` at all, so deferring
    // construction to first read is what makes that possible without
    // changing `createRealTransport()`'s own unconditional-token behavior.
    let resolvedTransport: Transport | undefined;
    const ctx = {
      json: parsed.json,
      get transport(): Transport {
        return (resolvedTransport ??= deps.transport ?? createRealTransport());
      },
    };
    return await command.run(parsed.rest, ctx);
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
