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
import { createHash } from "node:crypto";
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
  "[--dependency <project_id>:<required|optional>]... [--source-revision <revision>] [--verify-existing] [--dry-run]";

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
  sourceRevision?: string;
  verifyExisting: boolean;
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
  let sourceRevision: string | undefined;
  let verifyExisting = false;

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
    } else if (arg === "--source-revision") {
      sourceRevision = requireValue(args, ++i, "--source-revision");
    } else if (arg === "--verify-existing") {
      verifyExisting = true;
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
    sourceRevision,
    verifyExisting,
    dryRun,
  };
}

const SOURCE_REVISION_PREFIX = "Source-Revision: ";

function withSourceRevision(changelog: string, sourceRevision: string | undefined): string {
  if (!sourceRevision) return changelog;
  return `${changelog}${changelog ? "\n\n" : ""}${SOURCE_REVISION_PREFIX}${sourceRevision}`;
}

function hasSourceRevision(changelog: string, sourceRevision: string | undefined): boolean {
  return sourceRevision === undefined || changelog.split("\n").includes(`${SOURCE_REVISION_PREFIX}${sourceRevision}`);
}

interface PublicationIdentity {
  project: { id: string; slug: string };
  version: { id: string; version_number: string };
  file: { filename: string; sha512: string; size: number };
  outcome: "published" | "verified_existing";
}

function publicationIdentity(
  project: Labrinth.Projects.v2.Project,
  version: Labrinth.Versions.v2.Version,
  filename: string,
  sha512: string,
  outcome: PublicationIdentity["outcome"],
): PublicationIdentity {
  const file = version.files.find((candidate) => candidate.filename === filename && candidate.hashes.sha512 === sha512);
  if (!file) {
    throw new CliError(
      `Publication conflict: version ${version.id} does not contain ${filename} with the intended SHA-512`,
      ExitCode.ApiError,
      { reason: "artifact_mismatch" },
    );
  }
  return {
    project: { id: project.id, slug: project.slug },
    version: { id: version.id, version_number: version.version_number },
    file: { filename: file.filename, sha512: file.hashes.sha512, size: file.size },
    outcome,
  };
}

function printPublication(identity: PublicationIdentity, json: boolean): void {
  if (json) printJson(identity);
  else printHuman(`${identity.outcome}: ${identity.project.id} ${identity.version.id} ${identity.file.filename} sha512=${identity.file.sha512}`);
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
  const changelog = withSourceRevision(readChangelog(flags), flags.sourceRevision);

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
    if (flags.verifyExisting) {
      const sha512 = createHash("sha512").update(fileBytes).digest("hex");
      if (!hasSourceRevision(duplicate.changelog, flags.sourceRevision)) {
        throw new CliError(
          `Publication conflict: version ${flags.version} exists but its source revision does not match`,
          ExitCode.ApiError,
          { reason: "source_revision_mismatch" },
        );
      }
      printPublication(publicationIdentity(project, duplicate, fileName, sha512, "verified_existing"), ctx.json);
      return ExitCode.Ok;
    }
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
  const sha512 = createHash("sha512").update(fileBytes).digest("hex");
  // Do not treat a successful upload response as authoritative identity: the
  // API is the source of truth for the stored file hashes, so read it back.
  const readBack = await ctx.transport.getVersion(created.id);
  printPublication(publicationIdentity(project, readBack, fileName, sha512, "published"), ctx.json);

  return ExitCode.Ok;
}

export const publishCommand: Command = {
  name: "publish",
  describe: "Create a version by uploading a file (e.g. a .mrpack) to a project",
  usage() {
    return USAGE;
  },
  run,
};
