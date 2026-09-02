// `rinth project get/create/submit/edit/icon` — labrinth v2 project reads
// and writes, via Transport#getProject/createProject/updateProject/
// uploadProjectIcon. The live API 404s a
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
//
// `rinth project create` — labrinth v2 `POST /project` (multipart: a JSON
// `data` part, plus an OPTIONAL icon part this command never sends — see
// `buildCreateProjectFormData` in src/client/real.ts). Every project created
// this way is born a DRAFT (`is_draft: true`, `initial_versions: []`, both
// constants this command supplies itself, never user flags).
//
// The required-flag set enforced by `parseProjectCreateFlags` below is NOT
// the live v2 schema's own "required" list — that list (confirmed from the
// OpenAPI spec at docs.modrinth.com; NOT exercised live, no MODRINTH_TOKEN
// in the agent environment) names only `project_type` as structurally
// required. Enforcing just that would let the CLI create a technically
// valid but useless draft (no title, no slug, no license) and defer the
// real problem to an opaque API error later — exactly what this ticket asks
// the flag parser to prevent. So this command requires the fields needed
// for a legible, submittable-later project: --slug, --title, --description,
// --body/--body-file, --project-type, --client-side, --server-side,
// --license. This is a CLI-level product decision layered on top of a
// verified fact, not a claim that the API itself rejects the narrower set —
// see the README and PR body.
//
// Also confirmed from the same spec: `project_type` accepts only
// `mod`/`modpack` at creation (see `CreateProjectType` in
// src/client/index.ts) — narrower than the ticket's own guess
// (mod/modpack/resourcepack/shader/...), which conflated the create-time
// enum with `Labrinth.Projects.v2.ProjectType`'s broader *display* type.
//
// `rinth project submit <idOrSlug>` — moves a project out of `draft`/
// `rejected` via labrinth v2 `PATCH /project/{idOrSlug}`
// (Transport#updateProject, the general sparse-patch method RINTH-4's
// `project edit` also uses — exact signature fixed by epic arbitration, see
// src/client/index.ts). The discipline: read first, refuse a
// non-submittable state BY NAME, PATCH, read back, and report the
// RESULTING status — never the write's own status code — following exactly
// the read-back pattern `deleteVersionCommand` (src/commands/versions.ts)
// and `servers upstream` (src/commands/servers.ts) established. A residual
// 404 on either read goes through the same `diagnoseNotFound` helper
// `get()` below uses.
//
// The PATCH body is `{ status: "processing" }`, NOT `{ requested_status:
// "approved" }` (an earlier revision of this file used the latter, on a
// spec-only reading — see PR #16's review for the correction). Confirmed
// from labrinth's published server source at github.com/modrinth/code —
// NOT exercised live, no MODRINTH_TOKEN in the agent environment, but this
// is server source, not an inference from the OpenAPI document. Two
// independent branches exist in `apps/labrinth/src/routes/v3/projects.rs`:
// the `requested_status` branch (line 801) is validated against
// `can_be_requested()` (`apps/labrinth/src/models/v3/projects.rs:570` —
// the `ProjectStatus` overload; a distinct `VersionStatus` one exists at
// :957, not this one — which excludes `processing`) and writes ONLY that
// column; the `status` branch's permission check (line 581) explicitly
// allows an ordinary, non-moderator user to set `Processing` on a project
// whose current status is not yet approved (`!status.is_approved() &&
// status == &ProjectStatus::Processing`) — this is the branch that
// actually performs the submit-for-review transition. `processing` being
// unrequestable via `requested_status` means it is settable only through
// the `status` branch, not that it is unsettable altogether. The read-back
// still never hard-codes an assumption beyond "status actually changed
// from before the PATCH" — server source is strong evidence, but this has
// still never been exercised as a live round-trip.
//
// Submittable statuses: `draft` and `rejected`. Confirmed from
// `apps/labrinth/src/models/v3/projects.rs:559`: `is_approved()` matches
// exactly `Approved | Archived | Unlisted | Private` — `Rejected` is not
// among them, so a rejected project passes the same `!is_approved()` guard
// a draft does and can be resubmitted after fixes.
//
// The believed live-API hazard ("submitting a project with no versions is
// refused") is REAL — confirmed from
// `apps/labrinth/src/routes/v3/projects.rs:616`, which refuses exactly the
// draft/rejected -> processing transition this command performs when
// `project.versions` is empty (message: "Project submitted for review with
// no initial versions"). Enforced here as a pre-flight refusal (naming the
// project, before ever PATCHing) rather than left to surface as a raw API
// error.

import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import type { Labrinth } from "@modrinth/api-client";
import { ICON_CONTENT_TYPES } from "../client/index.ts";
import type { CreateProjectEnvironment, CreateProjectRequest, CreateProjectType } from "../client/index.ts";
import { diagnoseNotFound } from "../diagnose.ts";
import { CliError, ExitCode } from "../errors.ts";
import { printHuman, printJson } from "../output.ts";
import type { Command, CommandContext } from "./types.ts";

const USAGE =
  "Usage: rinth project <get|create|submit|edit|icon> ...\n" +
  "  rinth project get <idOrSlug>\n" +
  "  rinth project create --slug <slug> --title <title> --description <text> (--body <text> | --body-file <path>)\n" +
  "    --project-type mod|modpack --client-side <env> --server-side <env> --license <id> [--category <c>]... [--dry-run]\n" +
  "  rinth project submit <idOrSlug>\n" +
  "  rinth project edit <idOrSlug> [--description <text>] [--body <text> | --body-file <path>]\n" +
  "    [--client-side required|optional|unsupported] [--server-side required|optional|unsupported]\n" +
  "    [--source-url <url>] [--issues-url <url>] [--license <id>] [--license-url <url>]\n" +
  "    [--category <c>]...\n" +
  "    NOTE: repeated --category REPLACES the project's whole category list, it does not append.\n" +
  "  rinth project icon <idOrSlug> --file <path>";


/** RINTH-22: aligns a `label:` to a fixed column — wide enough for `additional_categories:`, the longest label this formatter prints. */
function field(label: string, value: string): string {
  return `  ${`${label}:`.padEnd(24)}${value}`;
}

/**
 * A char count plus an actionable pointer at `--json` — never the raw text.
 * Used for every long-form prose field (`body`, `moderator_message.body`)
 * this formatter cannot print in full without flooding the terminal. See
 * RINTH-20/RINTH-22: a truncation with no marker is a NEW instance of the
 * defect this ticket exists to fix, so this never truncates silently —
 * either the full (short) value, or an honest length + where to find it.
 */
function lengthPointer(text: string): string {
  const chars = text.length;
  return chars > 0 ? `${chars} chars (use --json to read the full text)` : "0 chars";
}

/** Formats a moderator's note in full, plus a length pointer for its optional long-form `body` (never dumped, same treatment as the project's own `body`). */
function formatModeratorMessage(mm: NonNullable<Labrinth.Projects.v2.Project["moderator_message"]>): string {
  const message = mm.message ?? "";
  return mm.body ? `${message} (details: ${lengthPointer(mm.body)})` : message;
}

function formatDonationUrls(links: Labrinth.Projects.v2.DonationLink[] | undefined): string {
  return links && links.length > 0 ? links.map((l) => `${l.platform} (${l.url})`).join(", ") : "none";
}

/**
 * RINTH-22 audit — every field this formatter shows or deliberately omits,
 * decided by: (a) is it already covered elsewhere in the human output of
 * this CLI (e.g. `game_versions`/`loaders`/`versions` are covered, at finer
 * per-version granularity, by `rinth versions list`), and (b) does any
 * decision reachable through this CLI's own command surface plausibly turn
 * on it. Shown here: everything from the original 10, plus `description`/
 * `body` (the confirmed defect), `moderator_message`/`requested_status`
 * (same "why was my project rejected" decision `project submit` makes
 * reachable), `license.url` and `additional_categories` (same family as
 * fields already shown), and `wiki_url`/`discord_url`/`donation_urls`/
 * `icon_url` (same "external link" family as the `source_url`/`issues_url`
 * this formatter already printed before this ticket).
 *
 * Deliberately still omitted, as noise no CLI-reachable decision turns on:
 * `downloads`/`followers` (vanity metrics), `team`/`organization`/
 * `thread_id`/`actualProjectType`/`raw_icon_url`/`color`/
 * `monetization_status` (internal/cosmetic/unmanaged-by-this-CLI), and
 * `published`/`updated`/`approved`/`queued` (timestamps). `gallery` is
 * cleared too: a structured list of images with their own titles/
 * descriptions, where even a count would tell a reader nothing actionable
 * that `--json` or the web listing doesn't do far better. See PR body for
 * the full accounting against every field on the type.
 */
function formatProject(project: Labrinth.Projects.v2.Project): string {
  const lines = [
    `${project.title} (${project.id})`,
    field("slug", project.slug),
    field("status", project.status),
  ];
  if (project.requested_status) {
    lines.push(field("requested_status", project.requested_status));
  }
  if (project.moderator_message) {
    lines.push(field("moderator_message", formatModeratorMessage(project.moderator_message)));
  }
  lines.push(
    field("project_type", project.project_type),
    field("client_side", project.client_side),
    field("server_side", project.server_side),
    field("categories", project.categories.join(", ") || "none"),
    field("additional_categories", project.additional_categories.join(", ") || "none"),
    field(
      "license",
      `${project.license.id}${project.license.name ? ` (${project.license.name})` : ""}${project.license.url ? ` — ${project.license.url}` : ""}`,
    ),
    field("source_url", project.source_url ?? "none"),
    field("issues_url", project.issues_url ?? "none"),
    field("wiki_url", project.wiki_url ?? "none"),
    field("discord_url", project.discord_url ?? "none"),
    field("donation_urls", formatDonationUrls(project.donation_urls)),
    field("icon_url", project.icon_url ?? "none"),
    // description is Modrinth's short one-line summary — safe to print in
    // full. body is long-form markdown — never dumped; see lengthPointer.
    field("description", (project.description ?? "") || "none"),
    field("body", lengthPointer(project.body ?? "")),
  );
  return lines.join("\n");
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

/**
 * RINTH-22: `body` gets the same treatment `formatProject` gives it — a
 * length pointer at `--json`, never the raw markdown — so `rinth project
 * edit --body-file README.md` doesn't dump an entire file to the terminal.
 * Every other patched key is short enough to print in full, same as before.
 */
function formatEditResult(patch: Record<string, unknown>, project: Labrinth.Projects.v2.Project): string {
  const lines = [`Updated project ${project.title} (${project.id}). Changed fields:`];
  for (const key of Object.keys(patch)) {
    const value = readBackValue(project, key);
    if (key === "body") {
      lines.push(`  body:  ${lengthPointer(typeof value === "string" ? value : "")}`);
      continue;
    }
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

// ===== `rinth project create` =====

const PROJECT_TYPES: ReadonlySet<CreateProjectType> = new Set(["mod", "modpack"]);

const CREATE_USAGE =
  "Usage: rinth project create --slug <slug> --title <title> --description <text> " +
  "(--body <text> | --body-file <path>) --project-type mod|modpack " +
  "--client-side required|optional|unsupported --server-side required|optional|unsupported " +
  "--license <license_id> [--category <c>]... [--license-url <url>] [--source-url <url>] " +
  "[--issues-url <url>] [--dry-run]";

export interface ProjectCreateFlags {
  slug: string;
  title: string;
  description: string;
  body?: string;
  bodyFile?: string;
  projectType: CreateProjectType;
  categories: string[];
  clientSide: CreateProjectEnvironment;
  serverSide: CreateProjectEnvironment;
  license: string;
  licenseUrl?: string;
  sourceUrl?: string;
  issuesUrl?: string;
  dryRun: boolean;
}

/** Pure flag parser, exported for direct unit testing. Throws CliError(Usage) on bad/missing input — see the file header for why this required set is broader than the live schema's own. */
export function parseProjectCreateFlags(args: string[]): ProjectCreateFlags {
  const categories: string[] = [];
  let slug: string | undefined;
  let title: string | undefined;
  let description: string | undefined;
  let body: string | undefined;
  let bodyFile: string | undefined;
  let projectType: string | undefined;
  let clientSide: string | undefined;
  let serverSide: string | undefined;
  let license: string | undefined;
  let licenseUrl: string | undefined;
  let sourceUrl: string | undefined;
  let issuesUrl: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--slug") {
      slug = requireValue(args, ++i, "--slug");
    } else if (arg === "--title") {
      title = requireValue(args, ++i, "--title");
    } else if (arg === "--description") {
      description = requireValue(args, ++i, "--description");
    } else if (arg === "--body") {
      body = requireValue(args, ++i, "--body");
    } else if (arg === "--body-file") {
      bodyFile = requireValue(args, ++i, "--body-file");
    } else if (arg === "--project-type") {
      projectType = requireValue(args, ++i, "--project-type");
    } else if (arg === "--category") {
      categories.push(requireValue(args, ++i, "--category"));
    } else if (arg === "--client-side") {
      clientSide = requireValue(args, ++i, "--client-side");
    } else if (arg === "--server-side") {
      serverSide = requireValue(args, ++i, "--server-side");
    } else if (arg === "--license") {
      license = requireValue(args, ++i, "--license");
    } else if (arg === "--license-url") {
      licenseUrl = requireValue(args, ++i, "--license-url");
    } else if (arg === "--source-url") {
      sourceUrl = requireValue(args, ++i, "--source-url");
    } else if (arg === "--issues-url") {
      issuesUrl = requireValue(args, ++i, "--issues-url");
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg !== undefined && arg.startsWith("--")) {
      throw new CliError(`Usage: unrecognized flag ${arg}`, ExitCode.Usage);
    } else if (arg !== undefined) {
      throw new CliError(CREATE_USAGE, ExitCode.Usage);
    }
  }

  if (body !== undefined && bodyFile !== undefined) {
    throw new CliError("Usage: --body and --body-file are mutually exclusive", ExitCode.Usage);
  }

  if (!slug) {
    throw new CliError("Usage: --slug is required", ExitCode.Usage);
  }
  if (!title) {
    throw new CliError("Usage: --title is required", ExitCode.Usage);
  }
  if (!description) {
    throw new CliError("Usage: --description is required", ExitCode.Usage);
  }
  if (body === undefined && bodyFile === undefined) {
    throw new CliError("Usage: --body or --body-file is required", ExitCode.Usage);
  }
  if (!projectType) {
    throw new CliError("Usage: --project-type is required", ExitCode.Usage);
  }
  if (!PROJECT_TYPES.has(projectType as CreateProjectType)) {
    throw new CliError(`Invalid --project-type: ${projectType} (expected mod or modpack)`, ExitCode.Usage);
  }
  if (!clientSide) {
    throw new CliError("Usage: --client-side is required", ExitCode.Usage);
  }
  if (!ENVIRONMENTS.has(clientSide as CreateProjectEnvironment)) {
    throw new CliError(`Invalid --client-side: ${clientSide} (expected required, optional, or unsupported)`, ExitCode.Usage);
  }
  if (!serverSide) {
    throw new CliError("Usage: --server-side is required", ExitCode.Usage);
  }
  if (!ENVIRONMENTS.has(serverSide as CreateProjectEnvironment)) {
    throw new CliError(`Invalid --server-side: ${serverSide} (expected required, optional, or unsupported)`, ExitCode.Usage);
  }
  if (!license) {
    throw new CliError("Usage: --license is required", ExitCode.Usage);
  }

  return {
    slug,
    title,
    description,
    body,
    bodyFile,
    projectType: projectType as CreateProjectType,
    categories,
    clientSide: clientSide as CreateProjectEnvironment,
    serverSide: serverSide as CreateProjectEnvironment,
    license,
    licenseUrl,
    sourceUrl,
    issuesUrl,
    dryRun,
  };
}


/** Mirrors `readChangelog()` in src/commands/publish.ts: reads --body-file if given (exit 2 if missing), else returns --body's text directly. */
function readCreateBody(flags: ProjectCreateFlags): string {
  if (flags.bodyFile === undefined) {
    return flags.body ?? "";
  }
  if (!existsSync(flags.bodyFile)) {
    throw new CliError(`--body-file not found: ${flags.bodyFile}`, ExitCode.Usage);
  }
  return readFileSync(flags.bodyFile, "utf8");
}

async function create(args: string[], ctx: CommandContext): Promise<number> {
  const flags = parseProjectCreateFlags(args);
  const body = readCreateBody(flags);

  const data: CreateProjectRequest = {
    title: flags.title,
    project_type: flags.projectType,
    slug: flags.slug,
    description: flags.description,
    body,
    categories: flags.categories,
    client_side: flags.clientSide,
    server_side: flags.serverSide,
    license_id: flags.license,
    is_draft: true,
    initial_versions: [],
    ...(flags.licenseUrl !== undefined ? { license_url: flags.licenseUrl } : {}),
    ...(flags.sourceUrl !== undefined ? { source_url: flags.sourceUrl } : {}),
    ...(flags.issuesUrl !== undefined ? { issues_url: flags.issuesUrl } : {}),
  };

  if (flags.dryRun) {
    // Never touches `ctx.transport` — see src/cli.ts's lazy transport
    // construction — so this needs no MODRINTH_TOKEN, matching `publish
    // --dry-run`'s contract exactly. Unlike `publish --dry-run` (which
    // can't resolve a project identifier without a network call), there is
    // nothing left unresolved here: every field in `data` comes straight
    // from the flags/files already read above, so the payload printed is
    // exactly the payload that would be sent.
    const payload = { data };
    if (ctx.json) {
      printJson(payload);
    } else {
      printHuman(JSON.stringify(payload, null, 2));
    }
    return ExitCode.Ok;
  }

  const created = await ctx.transport.createProject(data);

  if (ctx.json) {
    printJson(created);
  } else {
    printHuman(`${created.id}  ${created.slug}  https://modrinth.com/project/${created.slug}`);
  }

  return ExitCode.Ok;
}

// ===== `rinth project submit` =====

const SUBMIT_USAGE = "Usage: rinth project submit <idOrSlug>";

/** See file header: `draft` and `rejected` are both submittable — `apps/labrinth/src/models/v3/projects.rs:559`'s `is_approved()` excludes both. */
const SUBMITTABLE_STATUSES: ReadonlySet<Labrinth.Projects.v2.ProjectStatus> = new Set(["draft", "rejected"]);

async function readProjectOrDiagnose(idOrSlug: string, ctx: CommandContext): Promise<Labrinth.Projects.v2.Project> {
  try {
    return await ctx.transport.getProject(idOrSlug);
  } catch (err) {
    if (err instanceof CliError) {
      throw diagnoseNotFound(err, `Project ${idOrSlug}`);
    }
    throw err;
  }
}

async function submit(args: string[], ctx: CommandContext): Promise<number> {
  const [idOrSlug] = args;
  if (!idOrSlug) {
    throw new CliError(SUBMIT_USAGE, ExitCode.Usage);
  }

  const before = await readProjectOrDiagnose(idOrSlug, ctx);

  if (!SUBMITTABLE_STATUSES.has(before.status)) {
    throw new CliError(
      `Project ${idOrSlug} is not submittable: its status is currently '${before.status}'. Only a 'draft' or 'rejected' project can be submitted for review.`,
      ExitCode.ApiError,
      { reason: "not_submittable" },
    );
  }

  // Confirmed real: apps/labrinth/src/routes/v3/projects.rs:616 — see the
  // file header. Checked here (using the `versions` array `before` already
  // carries, no extra request) rather than left to surface as a raw API
  // error.
  if (before.versions.length === 0) {
    throw new CliError(
      `Project ${idOrSlug} cannot be submitted for review: it has no versions. Publish at least one version first (see \`rinth publish\`).`,
      ExitCode.ApiError,
      { reason: "no_versions" },
    );
  }

  // See the file header for why this PATCHes `status: "processing"` rather
  // than `requested_status: "approved"`.
  await ctx.transport.updateProject(idOrSlug, { status: "processing" });

  const after = await readProjectOrDiagnose(idOrSlug, ctx);

  // Ask the STRONG question, not the weak one: did the status land on
  // `processing` specifically (what this PATCH asked for), not merely
  // "did it change at all". A moderator changing status between the
  // read-first and the read-back would otherwise be reported as a
  // success when the intended outcome never happened.
  if (after.status !== "processing") {
    throw new CliError(
      `Submit did not take effect: ${idOrSlug} is '${after.status}' after the request, expected 'processing'.`,
      ExitCode.ApiError,
      { reason: "submit_unverified" },
    );
  }

  if (ctx.json) {
    printJson({ id: after.id, slug: after.slug, status: after.status });
  } else {
    printHuman(`Submitted ${idOrSlug} for review: ${before.status} -> ${after.status}.`);
  }

  return ExitCode.Ok;
}
/** `args[0]` is the subcommand being asked about (e.g. from `rinth project <sub> --help`); `get` has no usage string of its own, so it falls back to the group-level USAGE like anything unrecognized. */
function usageFor(args: string[]): string {
  const [sub] = args;
  if (sub === "create") return CREATE_USAGE;
  if (sub === "submit") return SUBMIT_USAGE;
  if (sub === "edit") return EDIT_USAGE;
  if (sub === "icon") return ICON_USAGE;
  return USAGE;
}

export const projectCommand: Command = {
  name: "project",
  describe: "Inspect, create, submit, and edit a Modrinth project, and upload its icon",

  usage: usageFor,

  async run(args, ctx) {
    const [sub, ...rest] = args;
    if (sub === "get") {
      return get(rest, ctx);
    }
    if (sub === "create") {
      return create(rest, ctx);
    }
    if (sub === "submit") {
      return submit(rest, ctx);
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
