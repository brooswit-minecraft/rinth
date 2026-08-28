// `rinth versions list` / `rinth versions latest` — labrinth v2
// `GET /project/{idOrSlug}/version`, via Transport#listVersions.
//
// `channel` (release/beta/alpha) is NOT a server-side filter on this
// endpoint (verified against https://docs.modrinth.com and the
// `@modrinth/api-client` request-building code, which never sends it) so
// it is applied client-side against the returned `version_type` field.
//
// The live API empirically returns versions pre-sorted descending by
// `date_published` (checked against a real project), but this is not a
// documented guarantee, so `latest` sorts explicitly rather than trusting
// response order.

import type { Labrinth } from "@modrinth/api-client";
import type { VersionFilters } from "../client/index.ts";
import { CliError, ExitCode } from "../errors.ts";
import { printHuman, printJson } from "../output.ts";
import type { Command, CommandContext } from "./types.ts";

type VersionChannel = Labrinth.Versions.v2.VersionType;
const CHANNELS: ReadonlySet<VersionChannel> = new Set(["release", "beta", "alpha"]);

const USAGE =
  "Usage: rinth versions <list|latest> <project> [--loader <l>] [--game-version <gv>] [--channel release|beta|alpha] [--limit <n>]";

export interface VersionsFlags {
  project: string;
  loaders: string[];
  gameVersions: string[];
  channel?: VersionChannel;
  limit?: number;
}

export interface ParseVersionsFlagsOptions {
  /** `versions latest` doesn't support --limit: it's server-side while --channel is client-side, so limiting before filtering can silently return a stale/no match. */
  allowLimit?: boolean;
}

/** Pure flag parser, exported for direct unit testing. Throws CliError(Usage) on bad input. */
export function parseVersionsFlags(args: string[], options: ParseVersionsFlagsOptions = {}): VersionsFlags {
  const allowLimit = options.allowLimit ?? true;
  const loaders: string[] = [];
  const gameVersions: string[] = [];
  const positional: string[] = [];
  let channel: string | undefined;
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--loader") {
      const value = args[++i];
      if (value === undefined) {
        throw new CliError("Usage: --loader requires a value", ExitCode.Usage);
      }
      loaders.push(value);
    } else if (arg === "--game-version") {
      const value = args[++i];
      if (value === undefined) {
        throw new CliError("Usage: --game-version requires a value", ExitCode.Usage);
      }
      gameVersions.push(value);
    } else if (arg === "--channel") {
      const value = args[++i];
      if (value === undefined) {
        throw new CliError("Usage: --channel requires a value", ExitCode.Usage);
      }
      channel = value;
    } else if (arg === "--limit") {
      if (!allowLimit) {
        throw new CliError("Usage: rinth versions latest does not support --limit", ExitCode.Usage);
      }
      const value = args[++i];
      if (value === undefined) {
        throw new CliError("Usage: --limit requires a value", ExitCode.Usage);
      }
      limit = Number(value);
      if (!Number.isFinite(limit)) {
        throw new CliError(`Invalid --limit: ${value} (expected a number)`, ExitCode.Usage);
      }
    } else if (arg !== undefined && arg.startsWith("--")) {
      throw new CliError(`Usage: unrecognized flag ${arg}`, ExitCode.Usage);
    } else if (arg !== undefined) {
      positional.push(arg);
      if (positional.length > 1) {
        throw new CliError(USAGE, ExitCode.Usage);
      }
    }
  }

  const project = positional[0];
  if (!project) {
    throw new CliError(USAGE, ExitCode.Usage);
  }

  if (channel !== undefined && !CHANNELS.has(channel as VersionChannel)) {
    throw new CliError(`Invalid --channel: ${channel} (expected release, beta, or alpha)`, ExitCode.Usage);
  }

  return {
    project,
    loaders,
    gameVersions,
    channel: channel as VersionChannel | undefined,
    limit,
  };
}

function toVersionFilters(flags: VersionsFlags): VersionFilters {
  const filters: VersionFilters = {};
  if (flags.loaders.length > 0) {
    filters.loaders = flags.loaders;
  }
  if (flags.gameVersions.length > 0) {
    filters.game_versions = flags.gameVersions;
  }
  if (flags.limit !== undefined) {
    filters.limit = flags.limit;
  }
  return filters;
}

async function fetchMatchingVersions(
  flags: VersionsFlags,
  ctx: CommandContext,
): Promise<Labrinth.Versions.v2.Version[]> {
  const versions = await ctx.transport.listVersions(flags.project, toVersionFilters(flags));
  return flags.channel ? versions.filter((v) => v.version_type === flags.channel) : versions;
}

function primaryFileName(version: Labrinth.Versions.v2.Version): string {
  const primary = version.files.find((f) => f.primary) ?? version.files[0];
  return primary?.filename ?? "-";
}

function formatTable(versions: Labrinth.Versions.v2.Version[]): string {
  const headers = ["id", "version_number", "channel", "loaders", "game versions", "date", "primary file"];
  const rows = versions.map((v) => [
    v.id,
    v.version_number,
    v.version_type,
    v.loaders.join(","),
    v.game_versions.join(","),
    v.date_published,
    primaryFileName(v),
  ]);

  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const formatRow = (cells: string[]) => cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ");

  return [formatRow(headers), ...rows.map(formatRow)].join("\n");
}

function newestByDatePublished(versions: Labrinth.Versions.v2.Version[]): Labrinth.Versions.v2.Version {
  return versions.reduce((newest, candidate) =>
    Date.parse(candidate.date_published) > Date.parse(newest.date_published) ? candidate : newest,
  );
}

async function list(args: string[], ctx: CommandContext): Promise<number> {
  const flags = parseVersionsFlags(args);
  const versions = await fetchMatchingVersions(flags, ctx);

  if (ctx.json) {
    printJson(versions);
  } else if (versions.length === 0) {
    printHuman("No versions match.");
  } else {
    printHuman(formatTable(versions));
  }

  return ExitCode.Ok;
}

async function latest(args: string[], ctx: CommandContext): Promise<number> {
  const flags = parseVersionsFlags(args, { allowLimit: false });
  const versions = await fetchMatchingVersions(flags, ctx);

  if (versions.length === 0) {
    throw new CliError(`No versions match for project ${flags.project}`, ExitCode.NotFound);
  }

  const newest = newestByDatePublished(versions);

  if (ctx.json) {
    printJson(newest);
  } else {
    printHuman(`${newest.id}  ${newest.version_number}`);
  }

  return ExitCode.Ok;
}

export const versionsCommand: Command = {
  name: "versions",
  describe: "List and inspect a project's versions",

  async run(args, ctx) {
    const [sub, ...rest] = args;

    if (sub === "list") {
      return list(rest, ctx);
    }
    if (sub === "latest") {
      return latest(rest, ctx);
    }

    throw new CliError(USAGE, ExitCode.Usage);
  },
};
