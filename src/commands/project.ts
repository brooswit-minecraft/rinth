// `rinth project get <idOrSlug>` — labrinth v2 `GET /project/{idOrSlug}`, via
// Transport#getProject. The live API 404s a DRAFT project to an
// unauthenticated read (see README "Authentication"); Transport#getProject
// always sends the Bearer token (AuthFeature wraps every request the real
// transport's client makes, unconditionally — see src/client/real.ts), so a
// draft the token's identity can see resolves here where a hand-rolled
// unauthenticated curl call would 404. A residual 404 goes through the
// shared diagnosis helper rather than surfacing bare — see src/diagnose.ts.
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
import type { Labrinth } from "@modrinth/api-client";
import type { CreateProjectEnvironment, CreateProjectRequest, CreateProjectType } from "../client/index.ts";
import { diagnoseNotFound } from "../diagnose.ts";
import { CliError, ExitCode } from "../errors.ts";
import { printHuman, printJson } from "../output.ts";
import type { Command, CommandContext } from "./types.ts";

const USAGE = "Usage: rinth project <get|create|submit> ...";
const GET_USAGE = "Usage: rinth project get <idOrSlug>";

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
    throw new CliError(GET_USAGE, ExitCode.Usage);
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

const PROJECT_TYPES: ReadonlySet<CreateProjectType> = new Set(["mod", "modpack"]);
const ENVIRONMENTS: ReadonlySet<CreateProjectEnvironment> = new Set(["required", "optional", "unsupported"]);

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

/** Same shape as `requireValue()` in src/commands/publish.ts — duplicated rather than imported per the epic's ruling that these two commands don't share a validation module (see file header). */
function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value === undefined) {
    throw new CliError(`Usage: ${flag} requires a value`, ExitCode.Usage);
  }
  return value;
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
function readBody(flags: ProjectCreateFlags): string {
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
  const body = readBody(flags);

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

  if (after.status === before.status) {
    throw new CliError(
      `Submit did not take effect: ${idOrSlug} is still '${after.status}' after the request.`,
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

export const projectCommand: Command = {
  name: "project",
  describe: "Inspect, create, and submit Modrinth projects",

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
    throw new CliError(USAGE, ExitCode.Usage);
  },
};
