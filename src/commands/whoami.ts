import { ExitCode } from "../errors.ts";
import { printHuman, printJson } from "../output.ts";
import type { Command } from "./types.ts";

export const whoamiCommand: Command = {
  name: "whoami",
  describe: "Show the authenticated Modrinth user",

  async run(_args, ctx) {
    const user = await ctx.transport.getCurrentUser();

    if (ctx.json) {
      printJson(user);
    } else {
      printHuman(`${user.username} (${user.id})`);
    }

    return ExitCode.Ok;
  },
};
