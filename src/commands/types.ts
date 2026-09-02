// Shared shapes for the command registry. Kept separate from
// commands/index.ts so individual command modules can import the types
// without pulling in the whole registry.

import type { Clock } from "../clock.ts";
import type { Transport } from "../client/index.ts";

export interface CommandContext {
  readonly json: boolean;
  readonly transport: Transport;
  /** The clock/sleep seam `versions latest --wait` polls through — see src/clock.ts. */
  readonly clock: Clock;
}

export interface Command {
  readonly name: string;
  readonly describe: string;
  /**
   * Usage text for `rinth <name> --help` / `rinth help <name>`, given
   * whatever args followed the command name (so a command whose usage
   * text is already split per subcommand — see project.ts/servers.ts/
   * versions.ts — can return the subcommand-specific string). Never
   * throws, never touches `ctx` — this must work identically whether or
   * not a command was ever going to succeed, so cli.ts can call it before
   * building a CommandContext at all.
   */
  usage(args: string[]): string;
  run(args: string[], ctx: CommandContext): Promise<number>;
}
