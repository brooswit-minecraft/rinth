import { CliError, ExitCode } from "../errors.ts";
import { printHuman, printJson } from "../output.ts";
import type { Command, CommandContext } from "./types.ts";

async function list(ctx: CommandContext): Promise<number> {
  const servers = await ctx.transport.listServers();

  if (ctx.json) {
    printJson({ servers });
  } else if (servers.length === 0) {
    printHuman("No servers.");
  } else {
    for (const server of servers) {
      printHuman(`${server.id}  ${server.name}  [${server.status}]  ${server.mc_version ?? "unknown version"}`);
    }
  }

  return ExitCode.Ok;
}

export const serversCommand: Command = {
  name: "servers",
  describe: "Manage Modrinth-hosted servers",

  async run(args, ctx) {
    const [sub] = args;

    if (sub === "list") {
      return list(ctx);
    }

    throw new CliError(`Usage: rinth servers list`, ExitCode.Usage);
  },
};
