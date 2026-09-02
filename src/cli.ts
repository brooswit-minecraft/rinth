#!/usr/bin/env bun
// Dispatch: parses argv, resolves a command, and maps whatever it throws to
// an exit code. All output (including "unknown command") goes through
// src/output.ts so it can never bypass redaction.

import pkg from "../package.json" with { type: "json" };
import { realClock, type Clock } from "./clock.ts";
import { createRealTransport, type Transport } from "./client/index.ts";
import { commands } from "./commands/index.ts";
import { CliError, ExitCode } from "./errors.ts";
import { printError, printHuman, printJsonError } from "./output.ts";

/**
 * Shape of the single JSON value `--json` mode prints to stderr on any
 * error. `reason` is additive (RINTH-6/RINTH-2) — a stable machine-readable
 * string alongside `code`, `null` when no command-specific reason applies —
 * the rest of the shape is unchanged.
 */
function jsonError(
  code: ExitCode,
  status: number | null,
  endpoint: string | null,
  message: string,
  reason: string | null = null,
) {
  return { error: { code, status, endpoint, message, reason } };
}

export interface ParsedArgs {
  json: boolean;
  help: boolean;
  /**
   * The global `rinth --version` flag — deliberately scoped DIFFERENTLY
   * from `--help`/`-h`: it's only recognized BEFORE the command token,
   * never after. `servers upstream` and `publish` each already have their
   * own `--version <...>` flag consumed by their own arg parsing (see
   * commands/servers.ts, commands/publish.ts) — recognizing `--version`
   * "anywhere in argv" the way `--help` is would silently steal that flag
   * from `rinth servers upstream <id> --project <p> --version <v>` and
   * `rinth publish <project> --file <f> --version <v>`, both real,
   * existing, tested invocations. `run()` checks this before anything
   * else and short-circuits when true.
   */
  version: boolean;
  command: string | undefined;
  rest: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  let json = false;
  let help = false;
  let version = false;
  const positional: string[] = [];
  let commandSeen = false;

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--version" && !commandSeen) {
      version = true;
    } else {
      positional.push(arg);
      commandSeen = true;
    }
  }

  const [command, ...rest] = positional;
  return { json, help, version, command, rest };
}

/**
 * Top-level `rinth --help` / `rinth help` / bare `rinth` text. Deliberately
 * keeps the exact original first two lines ("rinth — a Modrinth CLI" / blank
 * / "Usage: rinth [--json] <command> [args]") as a stable prefix — see the
 * PR body's `--help` compatibility statement for why: a fleet install probe
 * greps for that first line and expects exit 0, and neither changes here.
 * The command list is generated FROM `commands` (src/commands/index.ts)
 * rather than hand-copied, so a future registry addition can't silently go
 * missing from this listing.
 */
function topLevelUsage(): string {
  const entries = Object.values(commands);
  const nameWidth = Math.max(...entries.map((c) => c.name.length)) + 2;
  const commandList = entries.map((c) => `  ${c.name.padEnd(nameWidth)}${c.describe}`).join("\n");

  return [
    "rinth — a Modrinth CLI",
    "",
    "Usage: rinth [--json] <command> [args]",
    "",
    "Commands:",
    commandList,
    "",
    "Run 'rinth help <command>' or 'rinth <command> --help' for usage details on one command.",
    "Run 'rinth --version' to print the installed version.",
  ].join("\n");
}

/**
 * Shared by `rinth help [<command> [...]]` and `rinth [<command> [...]] --help`:
 * `args` is whatever followed the help request on the command line — empty
 * for top-level help, or `[<command>, ...rest]` when one was named. Never
 * builds a CommandContext and never reads `ctx.transport`, so this can't
 * accidentally acquire the real transport the way registering "help" as an
 * ordinary registry command could.
 */
function printHelp(args: string[]): number {
  const [group, ...rest] = args;
  if (!group) {
    printHuman(topLevelUsage());
    return ExitCode.Ok;
  }

  const command = commands[group];
  if (!command) {
    printError(`Unknown command: ${group}`);
    return ExitCode.Usage;
  }

  printHuman(command.usage(rest));
  return ExitCode.Ok;
}

export interface RunDeps {
  /** Injected for tests; defaults to the real network transport. */
  transport?: Transport;
  /** Injected for tests; defaults to the real wall-clock/timers (see src/clock.ts). */
  clock?: Clock;
}

export async function run(argv: string[], deps: RunDeps = {}): Promise<number> {
  const parsed = parseArgs(argv);

  // `--version` short-circuits everything else, same as most CLIs: it's
  // the honest successor to the old "--help as an install probe" pattern
  // (see the PR body's compatibility statement), so it must work with no
  // MODRINTH_TOKEN and never build a CommandContext — nothing below this
  // reads `deps` or touches the registry.
  if (parsed.version) {
    printHuman(`rinth ${pkg.version}`);
    return ExitCode.Ok;
  }

  // `rinth help [<command> [...]]` is a real command name, so it's handled
  // before the registry lookup below rather than being added TO the
  // registry — adding it there would mean building a CommandContext (see
  // the `get transport()` accessor further down) to run it, which is
  // exactly the regression the ticket warns about.
  if (parsed.command === "help") {
    return printHelp(parsed.rest);
  }

  // `--help`/`-h` (recognized anywhere in argv by parseArgs) or a bare
  // `rinth` with no command at all: same routing as `rinth help
  // [<command> [...]]` above, just entered from the flag instead of the
  // command name. `parsed.rest` here is whatever followed `parsed.command`
  // on the line (e.g. `rinth project icon --help` -> command "project",
  // rest ["icon"]), which is exactly the shape `printHelp` expects.
  if (parsed.help || !parsed.command) {
    return printHelp(parsed.command ? [parsed.command, ...parsed.rest] : []);
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
      clock: deps.clock ?? realClock,
    };
    return await command.run(parsed.rest, ctx);
  } catch (err) {
    if (err instanceof CliError) {
      if (parsed.json) {
        printJsonError(jsonError(err.exitCode, err.status, err.endpoint, err.message, err.reason));
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
