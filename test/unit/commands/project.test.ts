import { describe, expect, spyOn, test } from "bun:test";
import type { Labrinth } from "@modrinth/api-client";
import { run } from "../../../src/cli.ts";
import { apiError, createFakeTransport } from "../../../src/client/fake.ts";
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

  test("human mode prints 'none' for empty categories and absent source_url/issues_url", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({
      project: fixtureProject({ categories: [], source_url: undefined, issues_url: undefined }),
    });

    const code = await run(["project", "get", "my-draft-mod"], { transport });
    const printed = String(logSpy.mock.calls[0]?.[0]);
    logSpy.mockRestore();

    expect(code).toBe(ExitCode.Ok);
    expect(printed).toContain("categories:    none");
    expect(printed).toContain("source_url:    none");
    expect(printed).toContain("issues_url:    none");
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
