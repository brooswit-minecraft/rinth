import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Labrinth } from "@modrinth/api-client";
import { run } from "../../../src/cli.ts";
import { apiError, createFakeTransport } from "../../../src/client/fake.ts";
import type { CreateProjectRequest } from "../../../src/client/index.ts";
import { parseProjectCreateFlags } from "../../../src/commands/project.ts";
import { ExitCode } from "../../../src/errors.ts";
import { registerSecret, resetSecretsForTesting } from "../../../src/redact.ts";

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
    expect(capturedData).toEqual({
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
    expect(capturedPatch).toEqual({ status: "processing" });
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
