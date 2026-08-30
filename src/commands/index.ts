// The command registry. Future commands (server start/stop, publish, etc.)
// register here alongside whoami/servers.

import { projectCommand } from "./project.ts";
import { publishCommand } from "./publish.ts";
import { serversCommand } from "./servers.ts";
import type { Command } from "./types.ts";
import { versionsCommand } from "./versions.ts";
import { whoamiCommand } from "./whoami.ts";

export type { Command, CommandContext } from "./types.ts";

export const commands: Readonly<Record<string, Command>> = {
  whoami: whoamiCommand,
  servers: serversCommand,
  versions: versionsCommand,
  publish: publishCommand,
  project: projectCommand,
};
