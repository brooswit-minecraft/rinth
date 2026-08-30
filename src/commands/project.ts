// `rinth project get <idOrSlug>` — labrinth v2 `GET /project/{idOrSlug}`, via
// Transport#getProject. The live API 404s a DRAFT project to an
// unauthenticated read (see README "Authentication"); Transport#getProject
// always sends the Bearer token (AuthFeature wraps every request the real
// transport's client makes, unconditionally — see src/client/real.ts), so a
// draft the token's identity can see resolves here where a hand-rolled
// unauthenticated curl call would 404. A residual 404 goes through the
// shared diagnosis helper rather than surfacing bare — see src/diagnose.ts.

import type { Labrinth } from "@modrinth/api-client";
import { diagnoseNotFound } from "../diagnose.ts";
import { CliError, ExitCode } from "../errors.ts";
import { printHuman, printJson } from "../output.ts";
import type { Command, CommandContext } from "./types.ts";

const USAGE = "Usage: rinth project get <idOrSlug>";

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

export const projectCommand: Command = {
  name: "project",
  describe: "Inspect a Modrinth project",

  async run(args, ctx) {
    const [sub, ...rest] = args;
    if (sub === "get") {
      return get(rest, ctx);
    }
    throw new CliError(USAGE, ExitCode.Usage);
  },
};
