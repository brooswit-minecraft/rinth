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
  run(args: string[], ctx: CommandContext): Promise<number>;
}
