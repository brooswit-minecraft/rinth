// `rinth versions list` / `rinth versions latest` / `rinth versions delete` —
// labrinth v2 `GET /project/{idOrSlug}/version`, `GET /version/{id}`, and
// `DELETE /version/{id}`, via Transport#listVersions/getVersion/deleteVersion.
//
// `channel` (release/beta/alpha) is NOT a server-side filter on this
// endpoint (verified against https://docs.modrinth.com and the
// `@modrinth/api-client` request-building code, which never sends it) so
// it is applied client-side against the returned `version_type` field.
// `--version-number` (exact match) is the same story: no such server-side
// filter exists, so it too is applied client-side, against `version_number`.
//
// The live API empirically returns versions pre-sorted descending by
// `date_published` (checked against a real project), but this is not a
// documented guarantee, so `latest` sorts explicitly rather than trusting
// response order.
//
// RINTH-6/RINTH-2 spec amendment (see PR body for the full account): the
// downstream consumer of `latest --wait` (SCHEM-6) needs FOUR
// machine-distinguishable outcomes rather than one generic 404:
//   (i)   token absent or rejected               -> ExitCode.AuthMissing, unchanged
//   (ii)  the project itself couldn't be read     -> ExitCode.NotFound, via diagnoseNotFound (never retried)
//   (iii) project read fine, no version matched   -> ExitCode.NoVersionMatch (NEW, retryable)
//   (iv)  the wait budget expired                 -> ExitCode.WaitTimeout (NEW)
// Only (iii) is retried inside the `--wait` loop; (i)/(ii) abort immediately
// on the first attempt, same as without `--wait` — a stuck auth/draft
// problem does not get better by polling it.

import type { Labrinth } from "@modrinth/api-client";
import type { VersionFilters } from "../client/index.ts";
import { diagnoseNotFound } from "../diagnose.ts";
import { CliError, ExitCode } from "../errors.ts";
import { printHuman, printJson } from "../output.ts";
import type { Command, CommandContext } from "./types.ts";

type VersionChannel = Labrinth.Versions.v2.VersionType;
const CHANNELS: ReadonlySet<VersionChannel> = new Set(["release", "beta", "alpha"]);

/** Documented default for `--wait-interval` when `--wait` is given without it — see README "rinth versions latest". */
export const DEFAULT_WAIT_INTERVAL_SECONDS = 15;

const USAGE =
  "Usage: rinth versions <list|latest|delete> <project|version_id> [--loader <l>] [--game-version <gv>] " +
  "[--channel release|beta|alpha] [--version-number <v>] [--limit <n>] " +
  "[latest only: --wait <seconds> [--wait-interval <seconds>]]";

export interface VersionsFlags {
  project: string;
  loaders: string[];
  gameVersions: string[];
  channel?: VersionChannel;
  /** Exact, case-sensitive match against a version's `version_number` — applied client-side, same as `channel`. See `fetchMatchingVersions`. */
  versionNumber?: string;
  limit?: number;
  /** `latest` only: total polling budget in seconds. Absent means the original fail-fast behavior (exactly one attempt). */
  wait?: number;
  /** `latest` only: poll interval in seconds; defaults to DEFAULT_WAIT_INTERVAL_SECONDS. Only meaningful alongside `--wait`. */
  waitInterval?: number;
}

export interface ParseVersionsFlagsOptions {
  /** `versions latest` doesn't support --limit: it's server-side while --channel/--version-number are client-side, so limiting before filtering can silently return a stale/no match. */
  allowLimit?: boolean;
  /** Only `versions latest` accepts `--wait`/`--wait-interval` — `versions list` has no notion of "waiting for a match". */
  allowWait?: boolean;
}

/** Pure flag parser, exported for direct unit testing. Throws CliError(Usage) on bad input. */
export function parseVersionsFlags(args: string[], options: ParseVersionsFlagsOptions = {}): VersionsFlags {
  const allowLimit = options.allowLimit ?? true;
  const allowWait = options.allowWait ?? false;
  const loaders: string[] = [];
  const gameVersions: string[] = [];
  const positional: string[] = [];
  let channel: string | undefined;
  let versionNumber: string | undefined;
  let limit: number | undefined;
  let wait: number | undefined;
  let waitInterval: number | undefined;

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
    } else if (arg === "--version-number") {
      const value = args[++i];
      if (value === undefined) {
        throw new CliError("Usage: --version-number requires a value", ExitCode.Usage);
      }
      versionNumber = value;
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
    } else if (arg === "--wait") {
      if (!allowWait) {
        throw new CliError("Usage: rinth versions list does not support --wait", ExitCode.Usage);
      }
      const value = args[++i];
      if (value === undefined) {
        throw new CliError("Usage: --wait requires a value", ExitCode.Usage);
      }
      wait = Number(value);
      if (!Number.isFinite(wait) || wait < 0) {
        throw new CliError(`Invalid --wait: ${value} (expected a non-negative number of seconds)`, ExitCode.Usage);
      }
    } else if (arg === "--wait-interval") {
      if (!allowWait) {
        throw new CliError("Usage: rinth versions list does not support --wait-interval", ExitCode.Usage);
      }
      const value = args[++i];
      if (value === undefined) {
        throw new CliError("Usage: --wait-interval requires a value", ExitCode.Usage);
      }
      waitInterval = Number(value);
      if (!Number.isFinite(waitInterval) || waitInterval <= 0) {
        throw new CliError(
          `Invalid --wait-interval: ${value} (expected a positive number of seconds)`,
          ExitCode.Usage,
        );
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

  if (waitInterval !== undefined && wait === undefined) {
    throw new CliError("Usage: --wait-interval requires --wait", ExitCode.Usage);
  }

  return {
    project,
    loaders,
    gameVersions,
    channel: channel as VersionChannel | undefined,
    versionNumber,
    limit,
    wait,
    waitInterval,
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
  const byChannel = flags.channel ? versions.filter((v) => v.version_type === flags.channel) : versions;
  return flags.versionNumber !== undefined
    ? byChannel.filter((v) => v.version_number === flags.versionNumber)
    : byChannel;
}

/**
 * `fetchMatchingVersions`, with a bare 404 from the project/version lookup
 * routed through the shared diagnosis helper instead of surfacing raw —
 * shared by `list` and `latest` (both fail-fast and `--wait`). See
 * src/diagnose.ts.
 */
async function resolveMatchingVersions(
  flags: VersionsFlags,
  ctx: CommandContext,
): Promise<Labrinth.Versions.v2.Version[]> {
  try {
    return await fetchMatchingVersions(flags, ctx);
  } catch (err) {
    if (err instanceof CliError) {
      throw diagnoseNotFound(err, `Project ${flags.project}`);
    }
    throw err;
  }
}

function primaryFileName(version: Labrinth.Versions.v2.Version): string {
  const primary = version.files.find((f) => f.primary) ?? version.files[0];
  return primary?.filename ?? "-";
}

/**
 * RINTH-22: the old "primary file" column named exactly one file and said
 * nothing about whether there were others — a version CAN carry several
 * files. Now names the primary and, when more exist, how many.
 */
function filesColumn(version: Labrinth.Versions.v2.Version): string {
  const extra = version.files.length - 1;
  return extra > 0 ? `${primaryFileName(version)} (+${extra} more)` : primaryFileName(version);
}

function formatTable(versions: Labrinth.Versions.v2.Version[]): string {
  const headers = ["id", "version_number", "channel", "loaders", "game versions", "date", "files", "changelog", "dependencies"];
  const rows = versions.map((v) => [
    v.id,
    v.version_number,
    v.version_type,
    v.loaders.join(","),
    v.game_versions.join(","),
    v.date_published,
    filesColumn(v),
    // changelog is prose, same family as project.body — never dumped into a
    // table cell, just an honest length so a reader knows there's more (or
    // isn't). versions list's `--json` (or `rinth publish --changelog`'s
    // own source) has the full text.
    `${v.changelog.length} chars`,
    `${v.dependencies.length}`,
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

function printNewest(versions: Labrinth.Versions.v2.Version[], ctx: CommandContext): void {
  const newest = newestByDatePublished(versions);
  if (ctx.json) {
    printJson(newest);
  } else {
    printHuman(`${newest.id}  ${newest.version_number}`);
  }
}

/** Outcome (iii): the project resolved fine, but nothing matched the filters. Retryable under `--wait`; a hard failure without it. */
function noVersionMatchError(flags: VersionsFlags): CliError {
  return new CliError(`Project ${flags.project} resolved, but no version matched the filters.`, ExitCode.NoVersionMatch, {
    reason: "no_version_match",
  });
}

/** Outcome (iv): `--wait`'s budget ran out before a match ever appeared. Distinct from (iii) — "I gave up waiting" is not "this does not exist" and not "nothing matched (yet)". */
function waitTimeoutError(flags: VersionsFlags, intervalSeconds: number): CliError {
  return new CliError(
    `Project ${flags.project} resolved, but no version matched the filters within ${flags.wait}s (polled every ${intervalSeconds}s).`,
    ExitCode.WaitTimeout,
    { reason: "wait_exhausted" },
  );
}

async function list(args: string[], ctx: CommandContext): Promise<number> {
  const flags = parseVersionsFlags(args);
  const versions = await resolveMatchingVersions(flags, ctx);

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
  const flags = parseVersionsFlags(args, { allowLimit: false, allowWait: true });

  if (flags.wait === undefined) {
    // Fail-fast: exactly one attempt — byte-for-byte the original behavior
    // except the no-match outcome now carries its own exit code (7) instead
    // of reusing NotFound (4). See the file header for why.
    const versions = await resolveMatchingVersions(flags, ctx);
    if (versions.length === 0) {
      throw noVersionMatchError(flags);
    }
    printNewest(versions, ctx);
    return ExitCode.Ok;
  }

  const intervalSeconds = flags.waitInterval ?? DEFAULT_WAIT_INTERVAL_SECONDS;
  const budgetMs = flags.wait * 1000;
  const intervalMs = intervalSeconds * 1000;
  const start = ctx.clock.now();

  // Nothing is printed on any attempt but the last (success or exhaustion)
  // — every write still goes through src/output.ts, and a retry loop that
  // logged per-attempt would be the easiest way for a token to reach a
  // public CI log. See test/unit/commands/versions.test.ts's
  // redaction-to-exhaustion test.
  for (;;) {
    // A project-read failure (auth rejected, still 404 after diagnosis,
    // network, ...) is never retried — only "project fine, no version yet"
    // is. Polling past an auth/draft problem cannot make it resolve.
    // oxlint-disable-next-line no-await-in-loop -- a bounded poll loop is inherently sequential: each attempt must see whether the previous one matched before deciding to sleep and retry.
    const versions = await resolveMatchingVersions(flags, ctx);
    if (versions.length > 0) {
      printNewest(versions, ctx);
      return ExitCode.Ok;
    }

    const elapsed = ctx.clock.now() - start;
    if (elapsed >= budgetMs) {
      throw waitTimeoutError(flags, intervalSeconds);
    }

    // oxlint-disable-next-line no-await-in-loop -- see above; this is the poll interval itself.
    await ctx.clock.sleep(Math.min(intervalMs, budgetMs - elapsed));
  }
}

const DELETE_USAGE = "Usage: rinth versions delete <version_id>";

/** `true` if the version is still readable (DELETE did not take effect); `false` once it 404s. */
async function versionStillPresent(id: string, ctx: CommandContext): Promise<boolean> {
  try {
    await ctx.transport.getVersion(id);
    return true;
  } catch (err) {
    if (err instanceof CliError && err.status === 404) {
      return false;
    }
    throw err;
  }
}

/**
 * `DELETE /version/{id}` never trusts its own status code: the live API
 * returns 404 even when the delete actually succeeded (see README). Only a
 * read-back after the call says whether the version is really gone:
 *   DELETE 2xx  + read-back 404 => deleted
 *   DELETE 404  + read-back 404 => deleted (the live API's real behavior)
 *   DELETE 404  + read-back 200 => genuine failure — still present
 *   DELETE other 4xx/5xx        => normal error mapping (rethrown as-is, never reaches the read-back)
 */
async function deleteVersionCommand(args: string[], ctx: CommandContext): Promise<number> {
  const [id] = args;
  if (!id) {
    throw new CliError(DELETE_USAGE, ExitCode.Usage);
  }

  let deleteReturned404 = false;
  try {
    await ctx.transport.deleteVersion(id);
  } catch (err) {
    if (err instanceof CliError && err.status === 404) {
      deleteReturned404 = true;
    } else {
      throw err;
    }
  }

  if (await versionStillPresent(id, ctx)) {
    throw new CliError(`Delete did not take effect: version ${id} is still present after DELETE.`, ExitCode.ApiError);
  }

  if (ctx.json) {
    printJson({ id, deleted: true });
  } else if (deleteReturned404) {
    printHuman(
      `Deleted version ${id}. (The live API's DELETE returned 404 even though the delete succeeded — expected; see README.)`,
    );
  } else {
    printHuman(`Deleted version ${id}.`);
  }

  return ExitCode.Ok;
}

/**
 * `args[0]` is the subcommand being asked about (e.g. from `rinth versions
 * <sub> --help`). Only `delete` has its own usage string — `list`/`latest`
 * share the top-level USAGE (which already documents their differences
 * inline via the "[latest only: ...]" clause), so this is a deliberate
 * group-level floor for those two, not an oversight.
 */
function usageFor(args: string[]): string {
  const [sub] = args;
  if (sub === "delete") return DELETE_USAGE;
  return USAGE;
}

export const versionsCommand: Command = {
  name: "versions",
  describe: "List, inspect, and delete a project's versions",

  usage: usageFor,

  async run(args, ctx) {
    const [sub, ...rest] = args;

    if (sub === "list") {
      return list(rest, ctx);
    }
    if (sub === "latest") {
      return latest(rest, ctx);
    }
    if (sub === "delete") {
      return deleteVersionCommand(rest, ctx);
    }

    throw new CliError(USAGE, ExitCode.Usage);
  },
};
