// Shared shapes for the command registry. Kept separate from
// commands/index.ts so individual command modules can import the types
// without pulling in the whole registry.

import type { Transport } from "../client/index.ts";

export interface CommandContext {
  readonly json: boolean;
  readonly transport: Transport;
}

export interface Command {
  readonly name: string;
  readonly describe: string;
  run(args: string[], ctx: CommandContext): Promise<number>;
}
