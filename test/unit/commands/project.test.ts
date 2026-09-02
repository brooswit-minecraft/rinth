import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Labrinth } from "@modrinth/api-client";
import { run } from "../../../src/cli.ts";
import { apiError, createFakeTransport } from "../../../src/client/fake.ts";
import type { CreateProjectRequest } from "../../../src/client/index.ts";
import { parseEditFlags, parseProjectCreateFlags } from "../../../src/commands/project.ts";
import { ExitCode } from "../../../src/errors.ts";
import { registerSecret, resetSecretsForTesting } from "../../../src/redact.ts";

function fixtureProject(overrides: Partial<Labrinth.Projects.v2.Project> = {}): Labrinth.Projects.v2.Project {
  return {
    id: "proj_1",
    slug: "my-draft-mod",
    project_type: "mod",
    actualProjectType: "mod",
    team: "team_1",
    organization: null,
    title: "My Draft Mod",
    description: "A mod that hasn't been approved yet",
    body: "",
    published: "2024-01-01T00:00:00Z",
    updated: "2024-01-01T00:00:00Z",
    status: "draft",
    license: { id: "MIT", name: "MIT License" },
    client_side: "required",
    server_side: "unsupported",
    downloads: 0,
    followers: 0,
    categories: ["technology"],
    additional_categories: [],
    game_versions: [],
    loaders: [],
    versions: [],
    thread_id: "thread_1",
    monetization_status: "monetized",
    source_url: "https://github.com/example/my-draft-mod",
    issues_url: "https://github.com/example/my-draft-mod/issues",
    ...overrides,
  };
}

/** Removes one `flag <value>` pair from an args array (used to omit --body while keeping the rest of FULL_CREATE_ARGS intact). */
function withoutFlagValue(args: string[], flag: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      i++;
      continue;
    }
    result.push(args[i] as string);
  }
  return result;
}

const FULL_CREATE_ARGS = [
  "project",
  "create",
  "--slug",
  "my-draft-mod",
  "--title",
  "My Draft Mod",
  "--description",
  "A mod that hasn't been approved yet",
  "--body",
  "Long markdown body",
  "--project-type",
  "mod",
  "--client-side",
  "required",
  "--server-side",
  "unsupported",
  "--license",
  "MIT",
];


function fixtureCreatedProject(overrides: Partial<Labrinth.Projects.v2.Project> = {}): Labrinth.Projects.v2.Project {
  return {
    id: "proj_new",
    slug: "my-draft-mod",
    project_type: "mod",
    actualProjectType: "mod",
    team: "team_1",
    organization: null,
    title: "My Draft Mod",
    description: "A mod that hasn't been approved yet",
    body: "Long markdown body",
    published: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:00Z",
    status: "draft",
    license: { id: "MIT", name: "MIT License" },
    client_side: "required",
    server_side: "unsupported",
    downloads: 0,
    followers: 0,
    categories: [],
    additional_categories: [],
    game_versions: [],
    loaders: [],
    versions: [],
    thread_id: "thread_1",
    monetization_status: "monetized",
    ...overrides,
  };
}
describe("rinth project get", () => {
  test("missing <idOrSlug> is a usage error (exit 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["project", "get"], { transport });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  test("an unknown subcommand is a usage error (exit 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["project", "bogus"], { transport });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  test("resolves a DRAFT project (proves the request is authenticated — a draft 404s to an unauthenticated read)", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let capturedIdOrSlug: string | undefined;
    const transport = createFakeTransport({
      project: fixtureProject({ status: "draft" }),
      onGetProject: (idOrSlug) => {
        capturedIdOrSlug = idOrSlug;
      },
    });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(capturedIdOrSlug).toBe("my-draft-mod");
  });

  test("--json prints the project object, unmodified API shape", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const project = fixtureProject();
    const transport = createFakeTransport({ project });

    const code = await run(["--json", "project", "get", "my-draft-mod"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(project));
    logSpy.mockRestore();
  });

  test("human mode summarizes id, slug, title, status, project_type, client_side/server_side, categories, license, source_url, issues_url", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ project: fixtureProject() });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toContain("proj_1");
    expect(printed).toContain("my-draft-mod");
    expect(printed).toContain("My Draft Mod");
    expect(printed).toContain("draft");
    expect(printed).toContain("mod");
    expect(printed).toContain("required");
    expect(printed).toContain("unsupported");
    expect(printed).toContain("technology");
    expect(printed).toContain("MIT");
    expect(printed).toContain("https://github.com/example/my-draft-mod");
    expect(printed).toContain("https://github.com/example/my-draft-mod/issues");
  });

  test("human mode prints the description in full — it's the short summary field, not the long-form body", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      project: fixtureProject({ description: "A mod that hasn't been approved yet" }),
    });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toContain("description:");
    expect(printed).toContain("A mod that hasn't been approved yet");
  });

  test("human mode prints 'none' for an empty description, not a blank/missing line", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ project: fixtureProject({ description: "" }) });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toMatch(/description:\s+none/);
  });

  test("human mode never dumps the long-form body — it signals length and points at --json instead (THE CONFIRMED DEFECT — RINTH-20)", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const body = "# Heading\n\nA much longer piece of markdown body text describing the project in full.";
    const transport = createFakeTransport({ project: fixtureProject({ body }) });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).not.toContain(body);
    expect(printed).toContain("body:");
    expect(printed).toContain(`${body.length} chars`);
    expect(printed).toContain("--json");
  });

  test("human mode reports an empty body honestly as '0 chars' — does not crash on empty/absent body", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ project: fixtureProject({ body: "" }) });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toContain("body:");
    expect(printed).toContain("0 chars");
  });

  test("human mode omits the moderator_message line entirely when the project carries none", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ project: fixtureProject() });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).not.toContain("moderator_message");
  });

  test("human mode surfaces moderator_message.message in full on a rejected project — the reason a reader is most likely deciding on", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      project: fixtureProject({
        status: "rejected",
        moderator_message: { message: "Please fix the license field before resubmitting." },
      }),
    });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toContain("moderator_message:");
    expect(printed).toContain("Please fix the license field before resubmitting.");
  });

  test("human mode signals length + --json when moderator_message also carries a long-form body", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const details = "A much longer explanation of exactly what needs to change and why.";
    const transport = createFakeTransport({
      project: fixtureProject({
        status: "rejected",
        moderator_message: { message: "Rejected — see details.", body: details },
      }),
    });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).not.toContain(details);
    expect(printed).toContain("Rejected — see details.");
    expect(printed).toContain(`${details.length} chars`);
    expect(printed).toContain("--json");
  });

  test("human mode surfaces requested_status when present (a moderation-queue field the ticket's own reviewer flagged)", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      project: fixtureProject({ status: "draft", requested_status: "approved" }),
    });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toContain("requested_status:");
    expect(printed).toContain("approved");
  });

  test("human mode omits requested_status entirely when absent", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ project: fixtureProject() });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).not.toContain("requested_status");
  });

  test("human mode appends license.url onto the license line when present", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      project: fixtureProject({ license: { id: "MIT", name: "MIT License", url: "https://opensource.org/licenses/MIT" } }),
    });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toContain("https://opensource.org/licenses/MIT");
  });

  test("human mode shows additional_categories (same family as categories), 'none' when empty", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      project: fixtureProject({ additional_categories: ["adventure", "magic"] }),
    });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toContain("additional_categories:");
    expect(printed).toContain("adventure, magic");
  });

  test("human mode shows wiki_url/discord_url/donation_urls/icon_url — same 'external link' family already covered for source_url/issues_url", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      project: fixtureProject({
        wiki_url: "https://wiki.example.com",
        discord_url: "https://discord.gg/example",
        donation_urls: [{ id: "d1", platform: "Patreon", url: "https://patreon.com/example" }],
        icon_url: "https://cdn.modrinth.com/icon.png",
      }),
    });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toContain("https://wiki.example.com");
    expect(printed).toContain("https://discord.gg/example");
    expect(printed).toContain("Patreon (https://patreon.com/example)");
    expect(printed).toContain("https://cdn.modrinth.com/icon.png");
  });

  test("human mode prints 'none' for absent wiki_url/discord_url/icon_url and empty donation_urls", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ project: fixtureProject() });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toMatch(/wiki_url:\s+none/);
    expect(printed).toMatch(/discord_url:\s+none/);
    expect(printed).toMatch(/donation_urls:\s+none/);
    expect(printed).toMatch(/icon_url:\s+none/);
  });

  test("human mode prints 'none' for empty categories and absent source_url/issues_url", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      project: fixtureProject({ categories: [], source_url: undefined, issues_url: undefined }),
    });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toMatch(/\n {2}categories:\s+none\n/);
    expect(printed).toMatch(/source_url:\s+none/);
    expect(printed).toMatch(/issues_url:\s+none/);
  });

  test("a 404 is diagnosed rather than surfaced bare: names the candidate causes and points at `rinth whoami`", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({
      projectError: apiError(ExitCode.NotFound, "Not Found", {
        status: 404,
        endpoint: "GET /v2/project/does-not-exist",
      }),
    });

    const code = await run(["project", "get", "does-not-exist"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.NotFound);
    expect(message).not.toBe("Not Found");
    expect(message).toContain("does-not-exist");
    expect(message).toContain("rinth whoami");
  });

  test.each([
    [401, ExitCode.AuthMissing],
    [500, ExitCode.ApiError],
  ] as const)("a non-404 HTTP status %d surfaces as exit code %d, undiagnosed", async (_status, expectedExitCode) => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ projectError: apiError(expectedExitCode, "boom") });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).toBe(expectedExitCode);
    expect(message).toBe("boom");
  });

  describe("redaction", () => {
    test("a token embedded in the error path never reaches stdout/stderr", async () => {
      resetSecretsForTesting();
      const token = "mrp_project_get_secret_token";
      registerSecret(token);

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        projectError: apiError(ExitCode.ApiError, `upstream rejected Bearer ${token}`),
      });

      const code = await run(["project", "get", "my-draft-mod"], { transport });
      const loggedOut = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
      const loggedErr = errSpy.mock.calls.map((call) => String(call[0])).join("\n");
      logSpy.mockRestore();
      errSpy.mockRestore();
      resetSecretsForTesting();

      expect(code).toBe(ExitCode.ApiError);
      expect(loggedOut).not.toContain(token);
      expect(loggedErr).not.toContain(token);
      expect(loggedErr).toContain("***REDACTED***");
    });
  });
});

describe("parseEditFlags", () => {
  test("<idOrSlug> with no editable field is a usage error (exit 2)", () => {
    try {
      parseEditFlags(["my-mod"]);
      throw new Error("expected parseEditFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("missing <idOrSlug> is a usage error (exit 2)", () => {
    try {
      parseEditFlags(["--description", "hi"]);
      throw new Error("expected parseEditFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("--description alone", () => {
    const flags = parseEditFlags(["my-mod", "--description", "New one-liner"]);
    expect(flags.idOrSlug).toBe("my-mod");
    expect(flags.description).toBe("New one-liner");
  });

  test("--body alone", () => {
    const flags = parseEditFlags(["my-mod", "--body", "# New body"]);
    expect(flags.body).toBe("# New body");
    expect(flags.bodyFile).toBeUndefined();
  });

  test("--body-file alone", () => {
    const flags = parseEditFlags(["my-mod", "--body-file", "body.md"]);
    expect(flags.bodyFile).toBe("body.md");
    expect(flags.body).toBeUndefined();
  });

  test("--body and --body-file together is a usage error (exit 2)", () => {
    try {
      parseEditFlags(["my-mod", "--body", "x", "--body-file", "y.md"]);
      throw new Error("expected parseEditFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("--client-side alone accepts required/optional/unsupported", () => {
    expect(parseEditFlags(["my-mod", "--client-side", "required"]).clientSide).toBe("required");
    expect(parseEditFlags(["my-mod", "--client-side", "optional"]).clientSide).toBe("optional");
    expect(parseEditFlags(["my-mod", "--client-side", "unsupported"]).clientSide).toBe("unsupported");
  });

  test("an invalid --client-side is a usage error (exit 2)", () => {
    try {
      parseEditFlags(["my-mod", "--client-side", "bogus"]);
      throw new Error("expected parseEditFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("--server-side alone", () => {
    expect(parseEditFlags(["my-mod", "--server-side", "unsupported"]).serverSide).toBe("unsupported");
  });

  test("an invalid --server-side is a usage error (exit 2)", () => {
    try {
      parseEditFlags(["my-mod", "--server-side", "bogus"]);
      throw new Error("expected parseEditFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("--source-url alone", () => {
    expect(parseEditFlags(["my-mod", "--source-url", "https://example.com/src"]).sourceUrl).toBe(
      "https://example.com/src",
    );
  });

  test("--issues-url alone", () => {
    expect(parseEditFlags(["my-mod", "--issues-url", "https://example.com/issues"]).issuesUrl).toBe(
      "https://example.com/issues",
    );
  });

  test("--license alone", () => {
    expect(parseEditFlags(["my-mod", "--license", "MIT"]).license).toBe("MIT");
  });

  test("--license-url alone", () => {
    expect(parseEditFlags(["my-mod", "--license-url", "https://example.com/license"]).licenseUrl).toBe(
      "https://example.com/license",
    );
  });

  test("--category alone, repeatable, REPLACING semantics documented on the caller side", () => {
    const flags = parseEditFlags(["my-mod", "--category", "technology", "--category", "utility"]);
    expect(flags.categories).toEqual(["technology", "utility"]);
  });

  test("several fields at once", () => {
    const flags = parseEditFlags([
      "my-mod",
      "--description",
      "New desc",
      "--category",
      "technology",
      "--client-side",
      "required",
    ]);
    expect(flags.description).toBe("New desc");
    expect(flags.categories).toEqual(["technology"]);
    expect(flags.clientSide).toBe("required");
  });

  test("rejects an unrecognized flag (exit 2)", () => {
    try {
      parseEditFlags(["my-mod", "--bogus", "x"]);
      throw new Error("expected parseEditFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("rejects a stray extra positional (exit 2)", () => {
    try {
      parseEditFlags(["my-mod", "extra", "--description", "x"]);
      throw new Error("expected parseEditFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test.each([
    "--description",
    "--body",
    "--body-file",
    "--client-side",
    "--server-side",
    "--source-url",
    "--issues-url",
    "--license",
    "--license-url",
    "--category",
  ])("rejects %s with no following value as a usage error (exit 2)", (flag) => {
    try {
      parseEditFlags(["my-mod", flag]);
      throw new Error("expected parseEditFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });
});

describe("rinth project edit", () => {
  test("the exact-body assertion: sends ONLY the passed keys, nothing more", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let captured: { idOrSlug: string; patch: Record<string, unknown> } | undefined;
    const transport = createFakeTransport({
      project: fixtureProject({ description: "New desc", categories: ["technology"] }),
      onUpdateProject: (idOrSlug, patch) => {
        captured = { idOrSlug, patch };
      },
    });

    const code = await run(
      ["project", "edit", "my-draft-mod", "--description", "New desc", "--category", "technology"],
      { transport },
    );
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(captured?.idOrSlug).toBe("my-draft-mod");
    expect(captured?.patch).toStrictEqual({ description: "New desc", categories: ["technology"] });
  });

  test("each field individually lands in the sparse PATCH body and passes read-back verification", async () => {
    const cases: Array<{ args: string[]; expectedPatch: Record<string, unknown>; projectOverrides: Partial<Labrinth.Projects.v2.Project> }> = [
      { args: ["--description", "New desc"], expectedPatch: { description: "New desc" }, projectOverrides: { description: "New desc" } },
      { args: ["--body", "New body"], expectedPatch: { body: "New body" }, projectOverrides: { body: "New body" } },
      { args: ["--client-side", "optional"], expectedPatch: { client_side: "optional" }, projectOverrides: { client_side: "optional" } },
      { args: ["--server-side", "required"], expectedPatch: { server_side: "required" }, projectOverrides: { server_side: "required" } },
      { args: ["--source-url", "https://example.com/s"], expectedPatch: { source_url: "https://example.com/s" }, projectOverrides: { source_url: "https://example.com/s" } },
      { args: ["--issues-url", "https://example.com/i"], expectedPatch: { issues_url: "https://example.com/i" }, projectOverrides: { issues_url: "https://example.com/i" } },
      { args: ["--license", "Apache-2.0"], expectedPatch: { license_id: "Apache-2.0" }, projectOverrides: { license: { id: "Apache-2.0", name: "Apache License 2.0" } } },
      { args: ["--category", "technology"], expectedPatch: { categories: ["technology"] }, projectOverrides: { categories: ["technology"] } },
    ];

    for (const { args, expectedPatch, projectOverrides } of cases) {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      let captured: Record<string, unknown> | undefined;
      const transport = createFakeTransport({
        project: fixtureProject(projectOverrides),
        onUpdateProject: (_id, patch) => {
          captured = patch;
        },
      });

      // eslint-disable-next-line no-await-in-loop
      const code = await run(["project", "edit", "my-draft-mod", ...args], { transport });
      logSpy.mockRestore();

      expect(code).toBe(ExitCode.Ok);
      expect(captured).toStrictEqual(expectedPatch);
    }
  });

  test("--body-file is read into the PATCH body", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "rinth-project-edit-bodyfile-"));
    const bodyPath = join(tmp, "body.md");
    writeFileSync(bodyPath, "# From a file");

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let captured: Record<string, unknown> | undefined;
    const transport = createFakeTransport({
      project: fixtureProject({ body: "# From a file" }),
      onUpdateProject: (_id, patch) => {
        captured = patch;
      },
    });

    const code = await run(["project", "edit", "my-draft-mod", "--body-file", bodyPath], { transport });
    logSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });

    expect(code).toBe(ExitCode.Ok);
    expect(captured).toStrictEqual({ body: "# From a file" });
  });

  test("a missing --body-file is a usage error (exit 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["project", "edit", "my-draft-mod", "--body-file", "/nonexistent/body.md"], { transport });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  test("--body and --body-file together is a usage error (exit 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(
      ["project", "edit", "my-draft-mod", "--body", "x", "--body-file", "y.md"],
      { transport },
    );
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  test("no editable flag at all is a usage error (exit 2), not a no-op PATCH", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    let updateAttempted = false;
    const transport = createFakeTransport({
      onUpdateProject: () => {
        updateAttempted = true;
      },
    });

    const code = await run(["project", "edit", "my-draft-mod"], { transport });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
    expect(updateAttempted).toBe(false);
  });

  test("several fields at once are all sent, and only those", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let captured: Record<string, unknown> | undefined;
    const transport = createFakeTransport({
      project: fixtureProject({
        description: "New desc",
        client_side: "optional",
        categories: ["technology", "utility"],
      }),
      onUpdateProject: (_id, patch) => {
        captured = patch;
      },
    });

    const code = await run(
      [
        "project",
        "edit",
        "my-draft-mod",
        "--description",
        "New desc",
        "--client-side",
        "optional",
        "--category",
        "technology",
        "--category",
        "utility",
      ],
      { transport },
    );
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(captured).toStrictEqual({
      description: "New desc",
      client_side: "optional",
      categories: ["technology", "utility"],
    });
  });

  test("--json prints the resulting (read-back) project object", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const updated = fixtureProject({ description: "New desc" });
    const transport = createFakeTransport({ project: updated });

    const code = await run(["--json", "project", "edit", "my-draft-mod", "--description", "New desc"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(updated));
    logSpy.mockRestore();
  });

  test("human mode prints only the fields that changed", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      project: fixtureProject({ description: "New desc", title: "My Draft Mod" }),
    });

    const code = await run(["project", "edit", "my-draft-mod", "--description", "New desc"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toContain("Updated project");
    expect(printed).toContain("description:");
    expect(printed).toContain("New desc");
    expect(printed).not.toContain("client_side:");
  });

  test("human mode never dumps an edited body's full markdown — same length-pointer treatment as `project get` (RINTH-22 item 2)", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const body = "# From a file\n\nA whole markdown README's worth of long-form text.";
    const transport = createFakeTransport({ project: fixtureProject({ body }) });

    const code = await run(["project", "edit", "my-draft-mod", "--body", body], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).not.toContain(body);
    expect(printed).toContain("body:");
    expect(printed).toContain(`${body.length} chars`);
    expect(printed).toContain("--json");
  });

  test("human mode reports an edited empty body honestly as '0 chars'", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ project: fixtureProject({ body: "" }) });

    const code = await run(["project", "edit", "my-draft-mod", "--body", ""], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toContain("body:");
    expect(printed).toContain("0 chars");
  });

  test("the read-back showing a field did NOT change is a FAILURE: exit 5 (ApiError), message names it", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({
      // The read-back project still has the OLD description — the PATCH didn't land.
      project: fixtureProject({ description: "Old description, unchanged" }),
    });

    const code = await run(["project", "edit", "my-draft-mod", "--description", "New desc"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.ApiError);
    expect(message).toContain("did not take effect");
    expect(message).toContain("description");
  });

  test("the read-back showing categories did NOT change (order-insensitive comparison still catches a genuine mismatch) is a FAILURE", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({
      project: fixtureProject({ categories: ["old-category"] }),
    });

    const code = await run(["project", "edit", "my-draft-mod", "--category", "technology"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.ApiError);
    expect(message).toContain("categories");
  });

  test("categories read back in a different ORDER than sent still count as landed (list-replace, not order-sensitive)", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      project: fixtureProject({ categories: ["utility", "technology"] }),
    });

    const code = await run(
      ["project", "edit", "my-draft-mod", "--category", "technology", "--category", "utility"],
      { transport },
    );
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
  });

  test("a 404 from updateProject is diagnosed, not surfaced bare", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({
      updateProjectError: apiError(ExitCode.NotFound, "Not Found", {
        status: 404,
        endpoint: "PATCH /v2/project/does-not-exist",
      }),
    });

    const code = await run(["project", "edit", "does-not-exist", "--description", "x"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.NotFound);
    expect(message).not.toBe("Not Found");
    expect(message).toContain("does-not-exist");
    expect(message).toContain("rinth whoami");
  });

  test("a 404 from the read-back getProject (after a successful updateProject) is also diagnosed", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({
      projectError: apiError(ExitCode.NotFound, "Not Found", {
        status: 404,
        endpoint: "GET /v2/project/my-draft-mod",
      }),
    });

    const code = await run(["project", "edit", "my-draft-mod", "--description", "x"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.NotFound);
    expect(message).toContain("rinth whoami");
  });

  describe("redaction", () => {
    test("a token embedded in the updateProject error path never reaches stdout/stderr", async () => {
      resetSecretsForTesting();
      const token = "mrp_project_edit_secret_token";
      registerSecret(token);

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        updateProjectError: apiError(ExitCode.ApiError, `upstream rejected Bearer ${token}`),
      });

      const code = await run(["project", "edit", "my-draft-mod", "--description", "x"], { transport });
      const loggedOut = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
      const loggedErr = errSpy.mock.calls.map((call) => String(call[0])).join("\n");
      logSpy.mockRestore();
      errSpy.mockRestore();
      resetSecretsForTesting();

      expect(code).toBe(ExitCode.ApiError);
      expect(loggedOut).not.toContain(token);
      expect(loggedErr).not.toContain(token);
      expect(loggedErr).toContain("***REDACTED***");
    });
  });
});

describe("rinth project icon", () => {
  let dir: string;
  let iconPath: string;

  function setup(): void {
    dir = mkdtempSync(join(tmpdir(), "rinth-project-icon-test-"));
    iconPath = join(dir, "icon.png");
    writeFileSync(iconPath, "fake png bytes");
  }

  function teardown(): void {
    rmSync(dir, { recursive: true, force: true });
  }

  test("a good file succeeds, reports the new icon_url from the read-back", async () => {
    setup();
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let call = 0;
    const projects = [
      fixtureProject({ icon_url: "https://cdn.modrinth.com/old.png" }),
      fixtureProject({ icon_url: "https://cdn.modrinth.com/new.png" }),
    ];
    let capturedUpload: { idOrSlug: string; ext: string; bytes: Uint8Array } | undefined;
    const transport = createFakeTransport({
      project: () => projects[Math.min(call++, projects.length - 1)] ?? fixtureProject(),
      onUploadProjectIcon: (idOrSlug, ext, bytes) => {
        capturedUpload = { idOrSlug, ext, bytes };
      },
    });

    const code = await run(["project", "icon", "my-draft-mod", "--file", iconPath], { transport });
    teardown();

    expect(code).toBe(ExitCode.Ok);
    expect(capturedUpload?.idOrSlug).toBe("my-draft-mod");
    expect(capturedUpload?.ext).toBe("png");
    expect(new TextDecoder().decode(capturedUpload?.bytes)).toBe("fake png bytes");
    expect(logSpy).toHaveBeenCalledWith(
      "Updated icon for My Draft Mod (proj_1): https://cdn.modrinth.com/new.png",
    );
    logSpy.mockRestore();
  });

  test("--json reports {id, icon_url}", async () => {
    setup();
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let call = 0;
    const projects = [
      fixtureProject({ icon_url: "https://cdn.modrinth.com/old.png" }),
      fixtureProject({ icon_url: "https://cdn.modrinth.com/new.png" }),
    ];
    const transport = createFakeTransport({
      project: () => projects[Math.min(call++, projects.length - 1)] ?? fixtureProject(),
    });

    const code = await run(["--json", "project", "icon", "my-draft-mod", "--file", iconPath], { transport });
    teardown();

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ id: "proj_1", icon_url: "https://cdn.modrinth.com/new.png" }),
    );
    logSpy.mockRestore();
  });

  test("an unsupported extension is a usage error (exit 2), message names what IS accepted", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "rinth-project-icon-badext-"));
    const badPath = join(tmp, "icon.exe");
    writeFileSync(badPath, "not an image");
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["project", "icon", "my-draft-mod", "--file", badPath], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();
    rmSync(tmp, { recursive: true, force: true });

    expect(code).toBe(ExitCode.Usage);
    expect(message).toContain("exe");
    expect(message).toContain("png");
  });

  test("a missing/nonexistent --file is a usage error (exit 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["project", "icon", "my-draft-mod", "--file", "/nonexistent/icon.png"], { transport });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  test("missing --file entirely is a usage error (exit 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["project", "icon", "my-draft-mod"], { transport });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  test("missing <idOrSlug> is a usage error (exit 2)", async () => {
    setup();
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["project", "icon", "--file", iconPath], { transport });
    teardown();
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  test("icon_url UNCHANGED after a 2xx is reported as a FAILURE: exit 5 (ApiError)", async () => {
    setup();
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    // Same project (same icon_url) on both the pre-flight read and the read-back.
    const transport = createFakeTransport({
      project: fixtureProject({ icon_url: "https://cdn.modrinth.com/unchanged.png" }),
    });

    const code = await run(["project", "icon", "my-draft-mod", "--file", iconPath], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    teardown();
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.ApiError);
    expect(message).toContain("did not take effect");
    expect(message).toContain("icon_url");
  });

  test("a 404 from the pre-flight read is diagnosed, not surfaced bare", async () => {
    setup();
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({
      projectError: apiError(ExitCode.NotFound, "Not Found", {
        status: 404,
        endpoint: "GET /v2/project/does-not-exist",
      }),
    });

    const code = await run(["project", "icon", "does-not-exist", "--file", iconPath], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    teardown();
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.NotFound);
    expect(message).toContain("rinth whoami");
  });

  test("a 404 from uploadProjectIcon itself is diagnosed, not surfaced bare", async () => {
    setup();
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({
      project: fixtureProject({ icon_url: "https://cdn.modrinth.com/old.png" }),
      uploadProjectIconError: apiError(ExitCode.NotFound, "Not Found", {
        status: 404,
        endpoint: "PATCH /v2/project/does-not-exist/icon",
      }),
    });

    const code = await run(["project", "icon", "does-not-exist", "--file", iconPath], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    teardown();
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.NotFound);
    expect(message).toContain("rinth whoami");
  });

  describe("redaction", () => {
    test("a token embedded in the uploadProjectIcon error path never reaches stdout/stderr", async () => {
      setup();
      resetSecretsForTesting();
      const token = "mrp_project_icon_secret_token";
      registerSecret(token);

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        project: fixtureProject({ icon_url: "https://cdn.modrinth.com/old.png" }),
        uploadProjectIconError: apiError(ExitCode.ApiError, `upstream rejected Bearer ${token}`),
      });

      const code = await run(["project", "icon", "does-not-exist", "--file", iconPath], { transport });
      const loggedOut = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
      const loggedErr = errSpy.mock.calls.map((call) => String(call[0])).join("\n");
      teardown();
      logSpy.mockRestore();
      errSpy.mockRestore();
      resetSecretsForTesting();

      expect(code).toBe(ExitCode.ApiError);
      expect(loggedOut).not.toContain(token);
      expect(loggedErr).not.toContain(token);
      expect(loggedErr).toContain("***REDACTED***");
    });
  });
});


describe("parseProjectCreateFlags", () => {
  test("parses the full field set, applying is_draft/initial_versions constants and defaulting categories to []", () => {
    const flags = parseProjectCreateFlags(FULL_CREATE_ARGS.slice(2));

    expect(flags.slug).toBe("my-draft-mod");
    expect(flags.title).toBe("My Draft Mod");
    expect(flags.description).toBe("A mod that hasn't been approved yet");
    expect(flags.body).toBe("Long markdown body");
    expect(flags.bodyFile).toBeUndefined();
    expect(flags.projectType).toBe("mod");
    expect(flags.clientSide).toBe("required");
    expect(flags.serverSide).toBe("unsupported");
    expect(flags.license).toBe("MIT");
    expect(flags.categories).toEqual([]);
    expect(flags.dryRun).toBe(false);
  });

  test("collects repeated --category into an array", () => {
    const flags = parseProjectCreateFlags([...FULL_CREATE_ARGS.slice(2), "--category", "technology", "--category", "utility"]);
    expect(flags.categories).toEqual(["technology", "utility"]);
  });

  test("--dry-run sets dryRun to true", () => {
    const flags = parseProjectCreateFlags([...FULL_CREATE_ARGS.slice(2), "--dry-run"]);
    expect(flags.dryRun).toBe(true);
  });

  test("--license-url/--source-url/--issues-url are captured when given", () => {
    const flags = parseProjectCreateFlags([
      ...FULL_CREATE_ARGS.slice(2),
      "--license-url",
      "https://example.test/license",
      "--source-url",
      "https://github.com/example/my-draft-mod",
      "--issues-url",
      "https://github.com/example/my-draft-mod/issues",
    ]);
    expect(flags.licenseUrl).toBe("https://example.test/license");
    expect(flags.sourceUrl).toBe("https://github.com/example/my-draft-mod");
    expect(flags.issuesUrl).toBe("https://github.com/example/my-draft-mod/issues");
  });

  test("--body-file is captured separately from --body", () => {
    const args = withoutFlagValue(FULL_CREATE_ARGS.slice(2), "--body");
    const flags = parseProjectCreateFlags([...args, "--body-file", "body.md"]);
    expect(flags.body).toBeUndefined();
    expect(flags.bodyFile).toBe("body.md");
  });

  test("--body and --body-file together is a usage error naming the conflict (exit 2)", () => {
    try {
      parseProjectCreateFlags([...FULL_CREATE_ARGS.slice(2), "--body-file", "body.md"]);
      throw new Error("expected parseProjectCreateFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
      expect((err as Error).message).toContain("mutually exclusive");
    }
  });

  describe("each missing required field is a usage error naming that flag", () => {
    const REQUIRED_FLAG_CASES: Array<{ flag: string; value?: string }> = [
      { flag: "--slug" },
      { flag: "--title" },
      { flag: "--description" },
      { flag: "--project-type" },
      { flag: "--client-side" },
      { flag: "--server-side" },
      { flag: "--license" },
    ];

    test.each(REQUIRED_FLAG_CASES)("missing $flag", ({ flag }) => {
      const args: string[] = [];
      for (let i = 0; i < FULL_CREATE_ARGS.length - 2; i += 2) {
        const [f, v] = [FULL_CREATE_ARGS.slice(2)[i], FULL_CREATE_ARGS.slice(2)[i + 1]];
        if (f === flag) continue;
        if (f !== undefined && v !== undefined) args.push(f, v);
      }

      try {
        parseProjectCreateFlags(args);
        throw new Error(`expected parseProjectCreateFlags to throw for missing ${flag}`);
      } catch (err) {
        expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
        expect((err as Error).message).toContain(flag);
      }
    });

    test("missing --body and --body-file both", () => {
      const args = withoutFlagValue(FULL_CREATE_ARGS.slice(2), "--body");
      try {
        parseProjectCreateFlags(args);
        throw new Error("expected parseProjectCreateFlags to throw");
      } catch (err) {
        expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
        expect((err as Error).message).toContain("--body");
      }
    });
  });

  test("--project-type rejects anything other than mod/modpack, naming the accepted values (exit 2)", () => {
    const args = FULL_CREATE_ARGS.slice(2).map((v, i, arr) => (arr[i - 1] === "--project-type" ? "resourcepack" : v));
    try {
      parseProjectCreateFlags(args);
      throw new Error("expected parseProjectCreateFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
      expect((err as Error).message).toContain("mod");
      expect((err as Error).message).toContain("modpack");
    }
  });

  test("--client-side rejects anything other than required/optional/unsupported, naming the accepted values (exit 2)", () => {
    const args = FULL_CREATE_ARGS.slice(2).map((v, i, arr) => (arr[i - 1] === "--client-side" ? "bogus" : v));
    try {
      parseProjectCreateFlags(args);
      throw new Error("expected parseProjectCreateFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
      expect((err as Error).message).toContain("required, optional, or unsupported");
    }
  });

  test("--server-side rejects anything other than required/optional/unsupported, naming the accepted values (exit 2)", () => {
    const args = FULL_CREATE_ARGS.slice(2).map((v, i, arr) => (arr[i - 1] === "--server-side" ? "bogus" : v));
    try {
      parseProjectCreateFlags(args);
      throw new Error("expected parseProjectCreateFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
      expect((err as Error).message).toContain("required, optional, or unsupported");
    }
  });

  test("rejects an unrecognized flag (exit 2)", () => {
    try {
      parseProjectCreateFlags([...FULL_CREATE_ARGS.slice(2), "--bogus"]);
      throw new Error("expected parseProjectCreateFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test("rejects a stray positional argument (exit 2)", () => {
    try {
      parseProjectCreateFlags([...FULL_CREATE_ARGS.slice(2), "extra"]);
      throw new Error("expected parseProjectCreateFlags to throw");
    } catch (err) {
      expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
    }
  });

  test.each(["--slug", "--title", "--description", "--body", "--body-file", "--project-type", "--category", "--client-side", "--server-side", "--license"])(
    "rejects %s with no following value as a usage error (exit 2)",
    (flag) => {
      try {
        parseProjectCreateFlags([flag]);
        throw new Error("expected parseProjectCreateFlags to throw");
      } catch (err) {
        expect((err as { exitCode?: number }).exitCode).toBe(ExitCode.Usage);
      }
    },
  );
});

describe("rinth project create", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rinth-project-create-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("builds the full create payload from CLI flags, including the is_draft/initial_versions constants", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let capturedData: CreateProjectRequest | undefined;
    const transport = createFakeTransport({
      createdProject: fixtureCreatedProject(),
      onCreateProject: (data) => {
        capturedData = data;
      },
    });

    const code = await run(
      [...FULL_CREATE_ARGS, "--category", "technology", "--source-url", "https://github.com/example/my-draft-mod"],
      { transport },
    );
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(capturedData).toStrictEqual({
      title: "My Draft Mod",
      project_type: "mod",
      slug: "my-draft-mod",
      description: "A mod that hasn't been approved yet",
      body: "Long markdown body",
      categories: ["technology"],
      client_side: "required",
      server_side: "unsupported",
      license_id: "MIT",
      is_draft: true,
      initial_versions: [],
      source_url: "https://github.com/example/my-draft-mod",
    });
  });

  test("--body-file is read into body", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const bodyPath = join(dir, "body.md");
    writeFileSync(bodyPath, "body from a file");
    let capturedData: CreateProjectRequest | undefined;
    const transport = createFakeTransport({
      createdProject: fixtureCreatedProject(),
      onCreateProject: (data) => {
        capturedData = data;
      },
    });

    const args = withoutFlagValue(FULL_CREATE_ARGS, "--body");
    const code = await run([...args, "--body-file", bodyPath], { transport });
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(capturedData?.body).toBe("body from a file");
  });

  test("a missing --body-file is a clear error (exit 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ createdProject: fixtureCreatedProject() });

    const args = withoutFlagValue(FULL_CREATE_ARGS, "--body");
    const code = await run([...args, "--body-file", join(dir, "missing.md")], { transport });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  test("SUCCESS: prints the created project's id, slug, and Modrinth URL", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ createdProject: fixtureCreatedProject({ id: "proj_new", slug: "my-draft-mod" }) });

    const code = await run(FULL_CREATE_ARGS, { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith("proj_new  my-draft-mod  https://modrinth.com/project/my-draft-mod");
    logSpy.mockRestore();
  });

  test("--json prints the created project object, unmodified", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const created = fixtureCreatedProject();
    const transport = createFakeTransport({ createdProject: created });

    const code = await run(["--json", ...FULL_CREATE_ARGS], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(created));
    logSpy.mockRestore();
  });

  test("a missing required flag exits 2 without touching the transport", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["project", "create", "--slug", "my-draft-mod"], { transport });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  describe("--dry-run", () => {
    test("prints the payload, sends nothing (the transport is never touched), and exits 0 without requiring a token", async () => {
      const originalToken = process.env["MODRINTH_TOKEN"];
      delete process.env["MODRINTH_TOKEN"];

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      // No `deps.transport` injected: if create's --dry-run path touched
      // `ctx.transport` at all, this would call the real transport and
      // throw (exit 3) for the missing token.
      const code = await run([...FULL_CREATE_ARGS, "--dry-run"]);
      const printed = String(logSpy.mock.calls[0]?.[0]);
      logSpy.mockRestore();

      if (originalToken === undefined) {
        delete process.env["MODRINTH_TOKEN"];
      } else {
        process.env["MODRINTH_TOKEN"] = originalToken;
      }

      expect(code).toBe(ExitCode.Ok);
      const payload = JSON.parse(printed) as { data: CreateProjectRequest };
      expect(payload.data.slug).toBe("my-draft-mod");
      expect(payload.data.is_draft).toBe(true);
      expect(payload.data.initial_versions).toEqual([]);
    });

    test("never includes a token in its output even when one is set in the environment", async () => {
      const originalToken = process.env["MODRINTH_TOKEN"];
      process.env["MODRINTH_TOKEN"] = "super-secret-token-value";

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const code = await run([...FULL_CREATE_ARGS, "--dry-run"]);
      const printed = String(logSpy.mock.calls[0]?.[0]);
      logSpy.mockRestore();

      if (originalToken === undefined) {
        delete process.env["MODRINTH_TOKEN"];
      } else {
        process.env["MODRINTH_TOKEN"] = originalToken;
      }

      expect(code).toBe(ExitCode.Ok);
      expect(printed).not.toContain("super-secret-token-value");
    });
  });

  describe("HTTP error mapping", () => {
    test("a 400 error from createProject surfaces as exit code 5", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({ createProjectError: apiError(ExitCode.ApiError, "invalid slug") });

      const code = await run(FULL_CREATE_ARGS, { transport });
      errSpy.mockRestore();

      expect(code).toBe(ExitCode.ApiError);
    });

    test("a 401 error from createProject surfaces as exit code 3", async () => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({ createProjectError: apiError(ExitCode.AuthMissing) });

      const code = await run(FULL_CREATE_ARGS, { transport });
      errSpy.mockRestore();

      expect(code).toBe(ExitCode.AuthMissing);
    });
  });

  describe("redaction", () => {
    test("a token embedded in the error path never reaches stdout/stderr", async () => {
      resetSecretsForTesting();
      const token = "mrp_project_create_secret_token";
      registerSecret(token);

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        createProjectError: apiError(ExitCode.ApiError, `upstream rejected Bearer ${token}`),
      });

      const code = await run(FULL_CREATE_ARGS, { transport });
      const loggedOut = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
      const loggedErr = errSpy.mock.calls.map((call) => String(call[0])).join("\n");
      logSpy.mockRestore();
      errSpy.mockRestore();
      resetSecretsForTesting();

      expect(code).toBe(ExitCode.ApiError);
      expect(loggedOut).not.toContain(token);
      expect(loggedErr).not.toContain(token);
      expect(loggedErr).toContain("***REDACTED***");
    });
  });
});

describe("rinth project submit", () => {
  test("missing <idOrSlug> is a usage error (exit 2)", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport();

    const code = await run(["project", "submit"], { transport });
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.Usage);
  });

  test("SUCCESS: a draft project is patched with status=processing and the read-back status is reported", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let call = 0;
    let capturedPatch: Record<string, unknown> | undefined;
    const transport = createFakeTransport({
      project: () =>
        call++ === 0
          ? fixtureProject({ status: "draft", versions: ["v1"] })
          : fixtureProject({ status: "processing", versions: ["v1"] }),
      onUpdateProject: (_idOrSlug, patch) => {
        capturedPatch = patch;
      },
    });

    const code = await run(["--json", "project", "submit", "my-draft-mod"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(capturedPatch).toStrictEqual({ status: "processing" });
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ id: "proj_1", slug: "my-draft-mod", status: "processing" }));
    logSpy.mockRestore();
  });

  test("SUCCESS: a rejected project can also be resubmitted", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let call = 0;
    const transport = createFakeTransport({
      project: () =>
        call++ === 0
          ? fixtureProject({ status: "rejected", versions: ["v1"] })
          : fixtureProject({ status: "processing", versions: ["v1"] }),
    });

    const code = await run(["project", "submit", "my-draft-mod"], { transport });
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
  });

  test("human mode prints one clear line naming before/after status", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    let call = 0;
    const transport = createFakeTransport({
      project: () =>
        call++ === 0
          ? fixtureProject({ status: "draft", versions: ["v1"] })
          : fixtureProject({ status: "processing", versions: ["v1"] }),
    });

    const code = await run(["project", "submit", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toContain("draft");
    expect(printed).toContain("processing");
  });

  test("refuses to submit a project with no versions, naming the reason, without ever calling updateProject", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    let updateAttempted = false;
    const transport = createFakeTransport({
      project: fixtureProject({ status: "draft", versions: [] }),
      onUpdateProject: () => {
        updateAttempted = true;
      },
    });

    const code = await run(["--json", "project", "submit", "my-draft-mod"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.ApiError);
    const parsed = JSON.parse(message) as { error: { reason: string | null } };
    expect(parsed.error.reason).toBe("no_versions");
    expect(updateAttempted).toBe(false);
  });

  test.each(["processing", "approved"] as const)(
    "refuses to submit an already-%s project, naming the actual state, without ever calling updateProject",
    async (status) => {
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      let updateAttempted = false;
      const transport = createFakeTransport({
        project: fixtureProject({ status }),
        onUpdateProject: () => {
          updateAttempted = true;
        },
      });

      const code = await run(["project", "submit", "my-draft-mod"], { transport });
      const message = String(errSpy.mock.calls[0]?.[0]);
      errSpy.mockRestore();

      expect(code).toBe(ExitCode.ApiError);
      expect(message).toContain(status);
      expect(updateAttempted).toBe(false);
    },
  );

  test("a read-back showing no status change is reported as a failure, not a success", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({
      project: fixtureProject({ status: "draft", versions: ["v1"] }),
    });

    const code = await run(["project", "submit", "my-draft-mod"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.ApiError);
    expect(message).toContain("did not take effect");
  });

  test("a status that changed, but not to 'processing', is reported as a failure — the intended outcome, not merely an outcome", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    let call = 0;
    const transport = createFakeTransport({
      // Simulates a moderator changing the project's status between the
      // read-first and the read-back: the status DID change, just not to
      // what this command's PATCH asked for. The old `after.status ===
      // before.status` check would have reported this as a success.
      project: () =>
        call++ === 0
          ? fixtureProject({ status: "draft", versions: ["v1"] })
          : fixtureProject({ status: "rejected", versions: ["v1"] }),
    });

    const code = await run(["--json", "project", "submit", "my-draft-mod"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.ApiError);
    const parsed = JSON.parse(message) as { error: { reason: string | null; message: string } };
    expect(parsed.error.reason).toBe("submit_unverified");
    expect(parsed.error.message).toContain("rejected");
    expect(parsed.error.message).toContain("processing");
  });

  test("a 404 on the initial read is diagnosed rather than surfaced bare", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({
      projectError: apiError(ExitCode.NotFound, "Not Found", { status: 404, endpoint: "GET /v2/project/does-not-exist" }),
    });

    const code = await run(["project", "submit", "does-not-exist"], { transport });
    const message = String(errSpy.mock.calls[0]?.[0]);
    errSpy.mockRestore();

    expect(code).toBe(ExitCode.NotFound);
    expect(message).toContain("rinth whoami");
  });

  describe("redaction", () => {
    test("a token embedded in the error path never reaches stdout/stderr", async () => {
      resetSecretsForTesting();
      const token = "mrp_project_submit_secret_token";
      registerSecret(token);

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const transport = createFakeTransport({
        projectError: apiError(ExitCode.ApiError, `upstream rejected Bearer ${token}`),
      });

      const code = await run(["project", "submit", "my-draft-mod"], { transport });
      const loggedOut = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
      const loggedErr = errSpy.mock.calls.map((call) => String(call[0])).join("\n");
      logSpy.mockRestore();
      errSpy.mockRestore();
      resetSecretsForTesting();

      expect(code).toBe(ExitCode.ApiError);
      expect(loggedOut).not.toContain(token);
      expect(loggedErr).not.toContain(token);
      expect(loggedErr).toContain("***REDACTED***");
    });
  });
});
