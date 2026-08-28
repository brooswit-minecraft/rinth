import type { PowerAction, ServerDetail } from "../client/index.ts";
import { CliError, ExitCode } from "../errors.ts";
import { printHuman, printJson } from "../output.ts";
import type { Command, CommandContext } from "./types.ts";

const TOP_USAGE =
  "Usage: rinth servers list | get <id> | power <id> start|stop|restart|kill | upstream <id> --project <slug|id> --version <version_id> [--restart]";

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

function formatUpstream(value: ServerDetail["upstream"]): string {
  if (!value || value.kind === "none") {
    return "none";
  }
  return `modpack ${value.project_id}@${value.version_id}`;
}

const GET_USAGE = "Usage: rinth servers get <id>";

async function get(args: string[], ctx: CommandContext): Promise<number> {
  const [id] = args;
  if (!id) {
    throw new CliError(GET_USAGE, ExitCode.Usage);
  }

  const server = await ctx.transport.getServer(id);

  if (ctx.json) {
    printJson(server);
    return ExitCode.Ok;
  }

  printHuman(`${server.name} (${server.id})`);
  printHuman(`  status:      ${server.status}`);
  printHuman(`  game:        ${server.game} ${server.mc_version ?? "unknown version"}`);
  printHuman(`  loader:      ${server.loader ? `${server.loader} ${server.loader_version ?? ""}`.trim() : "none"}`);
  printHuman(`  upstream:    ${formatUpstream(server.upstream)}`);
  printHuman(`  net:         ${server.net.domain}:${server.net.port}${server.net.ip ? ` (${server.net.ip})` : ""}`);
  printHuman(`  datacenter:  ${server.datacenter}`);

  return ExitCode.Ok;
}

const POWER_ACTIONS: Readonly<Record<string, PowerAction>> = {
  start: "Start",
  stop: "Stop",
  restart: "Restart",
  kill: "Kill",
};

const POWER_USAGE = "Usage: rinth servers power <id> start|stop|restart|kill";

async function power(args: string[], ctx: CommandContext): Promise<number> {
  const [id, action] = args;
  if (!id || !action) {
    throw new CliError(POWER_USAGE, ExitCode.Usage);
  }

  const mapped = POWER_ACTIONS[action];
  if (!mapped) {
    throw new CliError(POWER_USAGE, ExitCode.Usage);
  }

  await ctx.transport.power(id, mapped);

  if (ctx.json) {
    printJson({ id, action, accepted: true });
  } else {
    printHuman(`${action} sent to ${id}.`);
  }

  return ExitCode.Ok;
}

interface UpstreamFlags {
  project: string | undefined;
  version: string | undefined;
  restart: boolean;
}

function parseUpstreamFlags(args: string[]): UpstreamFlags {
  const flags: UpstreamFlags = { project: undefined, version: undefined, restart: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--project") {
      flags.project = args[++i];
    } else if (arg === "--version") {
      flags.version = args[++i];
    } else if (arg === "--restart") {
      flags.restart = true;
    }
  }
  return flags;
}

const UPSTREAM_USAGE = "Usage: rinth servers upstream <id> --project <slug|id> --version <version_id> [--restart]";

// RESEARCH (required deliverable, see also README "Does upstream re-point
// restart the server?"): neither
// https://mintlify.wiki/modrinth/code/api/servers nor
// https://modrinth-code.mintlify.app documents whether POST
// /modrinth/v0/servers/:id/reinstall restarts the server as part of the
// reinstall, or leaves it in whatever power state it was already in — the
// docs simply do not say either way, for loader or modpack reinstalls. This
// environment has no MODRINTH_TOKEN, so live behavior against the real
// server (ff783f0f-ec3c-4037-b39f-452ce590891d) could not be observed here
// either (see README + PR body for exactly what that blocks). Absent
// evidence that reinstall self-restarts, `--restart` is kept as an explicit,
// separate `power(id, 'Restart')` call after the upstream is set, so the
// caller gets a guaranteed bounce onto the new upstream regardless of
// whatever reinstall does on its own — the safe default until this is
// confirmed live one way or the other.
async function upstream(args: string[], ctx: CommandContext): Promise<number> {
  const [id, ...rest] = args;
  if (!id) {
    throw new CliError(UPSTREAM_USAGE, ExitCode.Usage);
  }

  const { project, version, restart } = parseUpstreamFlags(rest);
  if (!project || !version) {
    throw new CliError(UPSTREAM_USAGE, ExitCode.Usage);
  }

  const projectId = await ctx.transport.resolveProjectId(project);
  await ctx.transport.setUpstream(id, projectId, version);
  const server = await ctx.transport.getServer(id);

  let restarted = false;
  if (restart) {
    await ctx.transport.power(id, "Restart");
    restarted = true;
  }

  if (ctx.json) {
    printJson({
      id,
      upstream: server.upstream
        ? { kind: server.upstream.kind, project_id: server.upstream.project_id, version_id: server.upstream.version_id }
        : null,
      restarted,
    });
  } else {
    printHuman(`Upstream set on ${id}: ${formatUpstream(server.upstream)}`);
    if (restarted) {
      printHuman("Restart sent.");
    }
  }

  return ExitCode.Ok;
}

export const serversCommand: Command = {
  name: "servers",
  describe: "Manage Modrinth-hosted servers",

  async run(args, ctx) {
    const [sub, ...rest] = args;

    if (sub === "list") {
      return list(ctx);
    }
    if (sub === "get") {
      return get(rest, ctx);
    }
    if (sub === "power") {
      return power(rest, ctx);
    }
    if (sub === "upstream") {
      return upstream(rest, ctx);
    }

    throw new CliError(TOP_USAGE, ExitCode.Usage);
  },
};
