// `rinth project get/edit/icon` — labrinth v2 project reads and writes, via
// Transport#getProject/updateProject/uploadProjectIcon. The live API 404s a
// DRAFT project to an unauthenticated read (see README "Authentication");
// every Transport call always sends the Bearer token (AuthFeature wraps
// every request the real transport's client makes, unconditionally — see
// src/client/real.ts), so a draft the token's identity can see resolves
// here where a hand-rolled unauthenticated curl call would 404. A residual
// 404 goes through the shared diagnosis helper rather than surfacing bare —
// see src/diagnose.ts.
//
// `edit`'s PATCH body deliberately uses the live WRITE shape, which is not
// the same as the shape `getProject` reads back: license is flat
// (`license_id`/`license_url`) on write, a nested `license: {id, name,
// url}` object on read — confirmed against
// https://docs.modrinth.com/api/operations/modifyproject/ (fetched
// directly; see PR body). `Transport#updateProject`'s `patch` parameter is
// a plain `Record<string, unknown>` by epic-level arbitration (shared with
// RINTH-3's `project create`/`project submit`, landing on a parallel
// branch) — see its doc comment in src/client/index.ts. `edit` builds that
// object sparsely, from only the flags actually passed, and never reads the
// project first to build a full one: that would silently clobber every
// field the operator didn't mention, which is the whole failure this
// command exists to prevent.
//
// `icon`'s request shape (`PATCH /project/{id}/icon?ext=<ext>`, raw image
// bytes as the body) is confirmed the same way — see
// https://docs.modrinth.com/api/operations/changeprojecticon/ and
// src/client/real.ts's header comment. Accepted extensions/content-types
// live in `ICON_CONTENT_TYPES` (src/client/index.ts), shared with the real
// transport so the two can never drift apart.
//
// Both writes verify by read-back rather than trusting their own status
// code — the discipline `versions delete` established (src/commands/
// versions.ts) for a live API that can 2xx a write that didn't land. A
// field that didn't land is ExitCode.ApiError (5), matching
// `deleteVersionCommand`'s "X did not take effect" precedent, per epic
// ruling (see PR body) — not a new exit code.

import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import type { Labrinth } from "@modrinth/api-client";
import { ICON_CONTENT_TYPES } from "../client/index.ts";
import { diagnoseNotFound } from "../diagnose.ts";
import { CliError, ExitCode } from "../errors.ts";
import { printHuman, printJson } from "../output.ts";
import type { Command, CommandContext } from "./types.ts";

const USAGE =
  "Usage: rinth project <get|edit|icon> ...\n" +
  "  rinth project get <idOrSlug>\n" +
  "  rinth project edit <idOrSlug> [--description <text>] [--body <text> | --body-file <path>]\n" +
  "    [--client-side required|optional|unsupported] [--server-side required|optional|unsupported]\n" +
  "    [--source-url <url>] [--issues-url <url>] [--license <id>] [--license-url <url>]\n" +
  "    [--category <c>]...\n" +
  "    NOTE: repeated --category REPLACES the project's whole category list, it does not append.\n" +
  "  rinth project icon <idOrSlug> --file <path>";

function formatProject(project: Labrinth.Projects.v2.Project): string {
  return [
    `${project.title} (${project.id})`,
    `  slug:          ${project.slug}`,
    `  status:        ${project.status}`,
    `  project_type:  ${project.project_type}`,
    `  client_side:   ${project.client_side}`,
    `  server_side:   ${project.server_side}`,
    `  categories:    ${project.categories.join(", ") || "none"}`,
    `  license:       ${project.license.id}${project.license.name ? ` (${project.license.name})` : ""}`,
    `  source_url:    ${project.source_url ?? "none"}`,
    `  issues_url:    ${project.issues_url ?? "none"}`,
  ].join("\n");
}

async function get(args: string[], ctx: CommandContext): Promise<number> {
  const [idOrSlug] = args;
  if (!idOrSlug) {
    throw new CliError(USAGE, ExitCode.Usage);
  }

  let project: Labrinth.Projects.v2.Project;
  try {
    project = await ctx.transport.getProject(idOrSlug);
  } catch (err) {
    if (err instanceof CliError) {
      throw diagnoseNotFound(err, `Project ${idOrSlug}`);
    }
    throw err;
  }

  if (ctx.json) {
    printJson(project);
  } else {
    printHuman(formatProject(project));
  }

  return ExitCode.Ok;
}

// ===== `rinth project edit` =====

const EDIT_USAGE =
  "Usage: rinth project edit <idOrSlug> [--description <text>] [--body <text> | --body-file <path>] " +
  "[--client-side required|optional|unsupported] [--server-side required|optional|unsupported] " +
  "[--source-url <url>] [--issues-url <url>] [--license <id>] [--license-url <url>] [--category <c>]... " +
  "(repeated --category REPLACES the whole category list, it does not append; at least one field is required)";

/** The three values the live API accepts for `client_side`/`server_side` on write — see README. */
const ENVIRONMENTS = new Set(["required", "optional", "unsupported"]);

export interface EditFlags {
  idOrSlug: string;
  description?: string;
  body?: string;
  bodyFile?: string;
  clientSide?: string;
  serverSide?: string;
  sourceUrl?: string;
  issuesUrl?: string;
  license?: string;
  licenseUrl?: string;
  /** Repeated `--category` values, in order given. Empty when `--category` was never passed. */
  categories: string[];
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined) {
    throw new CliError(`Usage: ${flag} requires a value`, ExitCode.Usage);
  }
  return value;
}

/** Pure flag parser, exported for direct unit testing. Throws CliError(Usage) on bad input. Does no file I/O — `--body-file`'s existence is checked by `edit()`. */
export function parseEditFlags(args: string[]): EditFlags {
  const categories: string[] = [];
  const positional: string[] = [];
  let description: string | undefined;
  let body: string | undefined;
  let bodyFile: string | undefined;
  let clientSide: string | undefined;
  let serverSide: string | undefined;
  let sourceUrl: string | undefined;
  let issuesUrl: string | undefined;
  let license: string | undefined;
  let licenseUrl: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--description") {
      description = requireValue(args, ++i, "--description");
    } else if (arg === "--body") {
      body = requireValue(args, ++i, "--body");
    } else if (arg === "--body-file") {
      bodyFile = requireValue(args, ++i, "--body-file");
    } else if (arg === "--client-side") {
      clientSide = requireValue(args, ++i, "--client-side");
    } else if (arg === "--server-side") {
      serverSide = requireValue(args, ++i, "--server-side");
    } else if (arg === "--source-url") {
      sourceUrl = requireValue(args, ++i, "--source-url");
    } else if (arg === "--issues-url") {
      issuesUrl = requireValue(args, ++i, "--issues-url");
    } else if (arg === "--license") {
      license = requireValue(args, ++i, "--license");
    } else if (arg === "--license-url") {
      licenseUrl = requireValue(args, ++i, "--license-url");
    } else if (arg === "--category") {
      categories.push(requireValue(args, ++i, "--category"));
    } else if (arg !== undefined && arg.startsWith("--")) {
      throw new CliError(`Usage: unrecognized flag ${arg}`, ExitCode.Usage);
    } else if (arg !== undefined) {
      positional.push(arg);
      if (positional.length > 1) {
        throw new CliError(EDIT_USAGE, ExitCode.Usage);
      }
    }
  }

  const idOrSlug = positional[0];
  if (!idOrSlug) {
    throw new CliError(EDIT_USAGE, ExitCode.Usage);
  }

  if (body !== undefined && bodyFile !== undefined) {
    throw new CliError("Usage: --body and --body-file are mutually exclusive", ExitCode.Usage);
  }

  if (clientSide !== undefined && !ENVIRONMENTS.has(clientSide)) {
    throw new CliError(
      `Invalid --client-side: ${clientSide} (expected required, optional, or unsupported)`,
      ExitCode.Usage,
    );
  }
  if (serverSide !== undefined && !ENVIRONMENTS.has(serverSide)) {
    throw new CliError(
      `Invalid --server-side: ${serverSide} (expected required, optional, or unsupported)`,
      ExitCode.Usage,
    );
  }

  const hasAnyEditableField =
    description !== undefined ||
    body !== undefined ||
    bodyFile !== undefined ||
    clientSide !== undefined ||
    serverSide !== undefined ||
    sourceUrl !== undefined ||
    issuesUrl !== undefined ||
    license !== undefined ||
    licenseUrl !== undefined ||
    categories.length > 0;

  if (!hasAnyEditableField) {
    throw new CliError(`Usage: at least one editable field is required.\n${EDIT_USAGE}`, ExitCode.Usage);
  }

  return {
    idOrSlug,
    description,
    body,
    bodyFile,
    clientSide,
    serverSide,
    sourceUrl,
    issuesUrl,
    license,
    licenseUrl,
    categories,
  };
}

/** Reads `--body-file`'s contents, or returns `--body` as given; does the file-existence check `parseEditFlags` (pure) deliberately doesn't. */
function readBody(flags: EditFlags): string | undefined {
  if (flags.bodyFile === undefined) {
    return flags.body;
  }
  if (!existsSync(flags.bodyFile)) {
    throw new CliError(`--body-file not found: ${flags.bodyFile}`, ExitCode.Usage);
  }
  return readFileSync(flags.bodyFile, "utf8");
}

/**
 * The sparse-body assembler acceptance criterion 2 requires: builds the
 * PATCH body from ONLY the flags actually passed, using the live API's
 * WRITE field names (`license_id`/`license_url`, not the nested `license`
 * object `getProject` reads back) — never a superset, never a default.
 * Narrow and local to `edit`, per epic ruling: no shared validator/builder
 * with RINTH-3's `project create` (see PR body).
 */
function buildPatch(flags: EditFlags, body: string | undefined): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (flags.description !== undefined) {
    patch["description"] = flags.description;
  }
  if (body !== undefined) {
    patch["body"] = body;
  }
  if (flags.clientSide !== undefined) {
    patch["client_side"] = flags.clientSide;
  }
  if (flags.serverSide !== undefined) {
    patch["server_side"] = flags.serverSide;
  }
  if (flags.sourceUrl !== undefined) {
    patch["source_url"] = flags.sourceUrl;
  }
  if (flags.issuesUrl !== undefined) {
    patch["issues_url"] = flags.issuesUrl;
  }
  if (flags.license !== undefined) {
    patch["license_id"] = flags.license;
  }
  if (flags.licenseUrl !== undefined) {
    patch["license_url"] = flags.licenseUrl;
  }
  if (flags.categories.length > 0) {
    patch["categories"] = flags.categories;
  }
  return patch;
}

/** Reads the read-back project's value for a given PATCH key, honoring the write/read shape mismatch on `license_id`/`license_url`. */
function readBackValue(project: Labrinth.Projects.v2.Project, key: string): unknown {
  if (key === "license_id") {
    return project.license.id;
  }
  if (key === "license_url") {
    return project.license.url;
  }
  return (project as unknown as Record<string, unknown>)[key];
}

function sameCategories(expected: string[], actual: unknown): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    return false;
  }
  const sortedExpected = expected.toSorted();
  const sortedActual = (actual as string[]).toSorted();
  return sortedExpected.every((value, i) => value === sortedActual[i]);
}

/** Every patched key whose read-back value doesn't match what was sent — empty when the write fully landed. */
function staleFields(patch: Record<string, unknown>, project: Labrinth.Projects.v2.Project): string[] {
  const stale: string[] = [];
  for (const key of Object.keys(patch)) {
    const expected = patch[key];
    const actual = readBackValue(project, key);
    const matches = key === "categories" ? sameCategories(expected as string[], actual) : actual === expected;
    if (!matches) {
      stale.push(`${key} is still ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
    }
  }
  return stale;
}

function formatEditResult(patch: Record<string, unknown>, project: Labrinth.Projects.v2.Project): string {
  const lines = [`Updated project ${project.title} (${project.id}). Changed fields:`];
  for (const key of Object.keys(patch)) {
    const value = readBackValue(project, key);
    const display = Array.isArray(value) ? value.join(", ") || "none" : String(value ?? "none");
    lines.push(`  ${key}:  ${display}`);
  }
  return lines.join("\n");
}

async function edit(args: string[], ctx: CommandContext): Promise<number> {
  const flags = parseEditFlags(args);
  const body = readBody(flags);
  const patch = buildPatch(flags, body);

  try {
    await ctx.transport.updateProject(flags.idOrSlug, patch);
  } catch (err) {
    if (err instanceof CliError) {
      throw diagnoseNotFound(err, `Project ${flags.idOrSlug}`);
    }
    throw err;
  }

  let project: Labrinth.Projects.v2.Project;
  try {
    project = await ctx.transport.getProject(flags.idOrSlug);
  } catch (err) {
    if (err instanceof CliError) {
      throw diagnoseNotFound(err, `Project ${flags.idOrSlug}`);
    }
    throw err;
  }

  const stale = staleFields(patch, project);
  if (stale.length > 0) {
    throw new CliError(`Update did not take effect: ${stale.join("; ")}.`, ExitCode.ApiError, {
      reason: "update_not_landed",
    });
  }

  if (ctx.json) {
    printJson(project);
  } else {
    printHuman(formatEditResult(patch, project));
  }

  return ExitCode.Ok;
}

// ===== `rinth project icon` =====

const ICON_USAGE = "Usage: rinth project icon <idOrSlug> --file <path>";

function inferExtension(filePath: string): string {
  return extname(filePath).slice(1).toLowerCase();
}

async function icon(args: string[], ctx: CommandContext): Promise<number> {
  const positional: string[] = [];
  let file: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--file") {
      file = requireValue(args, ++i, "--file");
    } else if (arg !== undefined && arg.startsWith("--")) {
      throw new CliError(`Usage: unrecognized flag ${arg}`, ExitCode.Usage);
    } else if (arg !== undefined) {
      positional.push(arg);
      if (positional.length > 1) {
        throw new CliError(ICON_USAGE, ExitCode.Usage);
      }
    }
  }

  const idOrSlug = positional[0];
  if (!idOrSlug || !file) {
    throw new CliError(ICON_USAGE, ExitCode.Usage);
  }

  if (!existsSync(file)) {
    throw new CliError(`--file not found: ${file}`, ExitCode.Usage);
  }

  const ext = inferExtension(file);
  if (!(ext in ICON_CONTENT_TYPES)) {
    throw new CliError(
      `Unsupported icon file type: ${ext || "(no extension)"} (accepted: ${Object.keys(ICON_CONTENT_TYPES).join(", ")})`,
      ExitCode.Usage,
    );
  }

  const bytes = new Uint8Array(readFileSync(file));

  // Pre-flight read: captures the icon_url BEFORE the write, so the
  // read-back after the write can prove the write actually changed it — a
  // 2xx alone proves nothing (see file header / README).
  let before: Labrinth.Projects.v2.Project;
  try {
    before = await ctx.transport.getProject(idOrSlug);
  } catch (err) {
    if (err instanceof CliError) {
      throw diagnoseNotFound(err, `Project ${idOrSlug}`);
    }
    throw err;
  }

  try {
    await ctx.transport.uploadProjectIcon(idOrSlug, ext, bytes);
  } catch (err) {
    if (err instanceof CliError) {
      throw diagnoseNotFound(err, `Project ${idOrSlug}`);
    }
    throw err;
  }

  let after: Labrinth.Projects.v2.Project;
  try {
    after = await ctx.transport.getProject(idOrSlug);
  } catch (err) {
    if (err instanceof CliError) {
      throw diagnoseNotFound(err, `Project ${idOrSlug}`);
    }
    throw err;
  }

  if (after.icon_url === before.icon_url) {
    throw new CliError(
      `Icon upload did not take effect: icon_url is still ${JSON.stringify(after.icon_url ?? null)} after PATCH.`,
      ExitCode.ApiError,
      { reason: "icon_not_landed" },
    );
  }

  if (ctx.json) {
    printJson({ id: after.id, icon_url: after.icon_url ?? null });
  } else {
    printHuman(`Updated icon for ${after.title} (${after.id}): ${after.icon_url ?? "none"}`);
  }

  return ExitCode.Ok;
}

export const projectCommand: Command = {
  name: "project",
  describe: "Inspect and edit a Modrinth project, and upload its icon",

  async run(args, ctx) {
    const [sub, ...rest] = args;
    if (sub === "get") {
      return get(rest, ctx);
    }
    if (sub === "edit") {
      return edit(rest, ctx);
    }
    if (sub === "icon") {
      return icon(rest, ctx);
    }
    throw new CliError(USAGE, ExitCode.Usage);
  },
};
