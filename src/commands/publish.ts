// `rinth publish` — creates a version with an uploaded `.mrpack` (or other)
// file via labrinth v2 `POST /version` (multipart), through
// `Transport#createVersion`. See src/client/real.ts for why that transport
// method uses a raw `fetch` instead of the API client's own upload support.
//
// DUPLICATE GUARD: before uploading, this calls `Transport#listVersions`
// (the same method `versions list`/`versions latest` use — no second way to
// fetch versions) and matches on `version_number` exactly; no channel
// filtering, per KAN-729's finding that `version_type` isn't a server-side
// filter and is irrelevant to an exact version_number match anyway.
//
// --dry-run intentionally never reads `ctx.transport` (see src/cli.ts): it
// prints the payload that would be sent — including the project identifier
// exactly as typed, NOT resolved to its canonical id, since resolving it
// requires a network call that --dry-run must not make — and exits before
// any project/version lookup or upload is attempted.

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Labrinth } from "@modrinth/api-client";
import type { CreateVersionDependency, CreateVersionFile, CreateVersionRequest } from "../client/index.ts";
import { diagnoseNotFound } from "../diagnose.ts";
import { CliError, ExitCode } from "../errors.ts";
import { printHuman, printJson } from "../output.ts";
import type { Command, CommandContext } from "./types.ts";

type VersionChannel = Labrinth.Versions.v2.VersionType;
const CHANNELS: ReadonlySet<VersionChannel> = new Set(["release", "beta", "alpha"]);

const USAGE =
  "Usage: rinth publish <project> --file <path.mrpack> --version <version_number> " +
  "[--name <n>] [--changelog <text> | --changelog-file <path>] [--game-version <gv>]... " +
  "[--loader <l>]... [--channel release|beta|alpha] [--featured] " +
  "[--dependency <project_id>:<required|optional>]... [--dry-run]";

export interface PublishFlags {
  project: string;
  file: string;
  version: string;
  name: string;
  changelog?: string;
  changelogFile?: string;
  gameVersions: string[];
  loaders: string[];
  channel: VersionChannel;
  featured: boolean;
  dependencies: CreateVersionDependency[];
  dryRun: boolean;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined) {
    throw new CliError(`Usage: ${flag} requires a value`, ExitCode.Usage);
  }
  return value;
}

function parseDependency(raw: string): CreateVersionDependency {
  const sepIndex = raw.lastIndexOf(":");
  const projectId = sepIndex === -1 ? "" : raw.slice(0, sepIndex);
  const type = sepIndex === -1 ? "" : raw.slice(sepIndex + 1);
  if (!projectId || (type !== "required" && type !== "optional")) {
    throw new CliError(`Invalid --dependency: ${raw} (expected <project_id>:<required|optional>)`, ExitCode.Usage);
  }
  return { project_id: projectId, dependency_type: type };
}

/** Pure flag parser, exported for direct unit testing. Throws CliError(Usage) on bad input. Does no file I/O — file existence is checked by `run()`. */
export function parsePublishFlags(args: string[]): PublishFlags {
  const gameVersions: string[] = [];
  const loaders: string[] = [];
  const dependencies: CreateVersionDependency[] = [];
  const positional: string[] = [];
  let file: string | undefined;
  let version: string | undefined;
  let name: string | undefined;
  let changelog: string | undefined;
  let changelogFile: string | undefined;
  let channel: string | undefined;
  let featured = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--file") {
      file = requireValue(args, ++i, "--file");
    } else if (arg === "--version") {
      version = requireValue(args, ++i, "--version");
    } else if (arg === "--name") {
      name = requireValue(args, ++i, "--name");
    } else if (arg === "--changelog") {
      changelog = requireValue(args, ++i, "--changelog");
    } else if (arg === "--changelog-file") {
      changelogFile = requireValue(args, ++i, "--changelog-file");
    } else if (arg === "--game-version") {
      gameVersions.push(requireValue(args, ++i, "--game-version"));
    } else if (arg === "--loader") {
      loaders.push(requireValue(args, ++i, "--loader"));
    } else if (arg === "--channel") {
      channel = requireValue(args, ++i, "--channel");
    } else if (arg === "--dependency") {
      dependencies.push(parseDependency(requireValue(args, ++i, "--dependency")));
    } else if (arg === "--featured") {
      featured = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
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
  if (!project || !file || !version) {
    throw new CliError(USAGE, ExitCode.Usage);
  }

  if (changelog !== undefined && changelogFile !== undefined) {
    throw new CliError("Usage: --changelog and --changelog-file are mutually exclusive", ExitCode.Usage);
  }

  if (channel !== undefined && !CHANNELS.has(channel as VersionChannel)) {
    throw new CliError(`Invalid --channel: ${channel} (expected release, beta, or alpha)`, ExitCode.Usage);
  }

  return {
    project,
    file,
    version,
    name: name ?? version,
    changelog,
    changelogFile,
    gameVersions,
    loaders,
    channel: (channel as VersionChannel | undefined) ?? "release",
    featured,
    dependencies,
    dryRun,
  };
}

function readChangelog(flags: PublishFlags): string {
  if (flags.changelogFile === undefined) {
    return flags.changelog ?? "";
  }
  if (!existsSync(flags.changelogFile)) {
    throw new CliError(`--changelog-file not found: ${flags.changelogFile}`, ExitCode.Usage);
  }
  return readFileSync(flags.changelogFile, "utf8");
}

async function run(args: string[], ctx: CommandContext): Promise<number> {
  const flags = parsePublishFlags(args);

  if (!existsSync(flags.file)) {
    throw new CliError(`--file not found: ${flags.file}`, ExitCode.Usage);
  }

  const fileBytes = readFileSync(flags.file);
  const fileName = basename(flags.file);
  const changelog = readChangelog(flags);

  if (flags.dryRun) {
    const data: CreateVersionRequest = {
      project_id: flags.project,
      version_number: flags.version,
      name: flags.name,
      changelog,
      game_versions: flags.gameVersions,
      loaders: flags.loaders,
      version_type: flags.channel,
      featured: flags.featured,
      dependencies: flags.dependencies,
      file_parts: [fileName],
      primary_file: fileName,
    };
    const payload = { data, file: { part: fileName, size: fileBytes.length } };

    if (ctx.json) {
      printJson(payload);
    } else {
      printHuman(JSON.stringify(payload, null, 2));
    }
    return ExitCode.Ok;
  }

  let project: Labrinth.Projects.v2.Project;
  try {
    project = await ctx.transport.getProject(flags.project);
  } catch (err) {
    if (err instanceof CliError) {
      throw diagnoseNotFound(err, `Project ${flags.project}`);
    }
    throw err;
  }

  const existingVersions = await ctx.transport.listVersions(project.id);
  const duplicate = existingVersions.find((v) => v.version_number === flags.version);
  if (duplicate) {
    throw new CliError(
      `Version ${flags.version} already exists on ${project.id} (id ${duplicate.id}, version_number ${duplicate.version_number})`,
      ExitCode.ApiError,
    );
  }

  const data: CreateVersionRequest = {
    project_id: project.id,
    version_number: flags.version,
    name: flags.name,
    changelog,
    game_versions: flags.gameVersions,
    loaders: flags.loaders,
    version_type: flags.channel,
    featured: flags.featured,
    dependencies: flags.dependencies,
    file_parts: [fileName],
    primary_file: fileName,
  };
  const file: CreateVersionFile = { name: fileName, data: fileBytes };

  const created = await ctx.transport.createVersion(data, file);

  if (ctx.json) {
    printJson(created);
  } else {
    printHuman(`${created.id}  https://modrinth.com/project/${project.slug}/version/${created.id}`);
  }

  return ExitCode.Ok;
}

export const publishCommand: Command = {
  name: "publish",
  describe: "Create a version by uploading a file (e.g. a .mrpack) to a project",
  run,
};
