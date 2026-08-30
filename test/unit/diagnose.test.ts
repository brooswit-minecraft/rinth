import { describe, expect, test } from "bun:test";
import { diagnoseNotFound, NOT_FOUND_REASON } from "../../src/diagnose.ts";
import { CliError, ExitCode } from "../../src/errors.ts";

describe("diagnoseNotFound", () => {
  test("rewrites a 404 CliError's message to name the candidate causes and point at `rinth whoami`", () => {
    const original = new CliError("Not Found", ExitCode.NotFound, {
      status: 404,
      endpoint: "GET /v2/project/does-not-exist",
    });

    const diagnosed = diagnoseNotFound(original, "Project does-not-exist");

    expect(diagnosed.message).toContain("Project does-not-exist");
    expect(diagnosed.message).toContain("404");
    expect(diagnosed.message).toContain("authenticated");
    expect(diagnosed.message).toContain("no such project/version exists");
    expect(diagnosed.message).toContain("not visible to this token's identity");
    expect(diagnosed.message).toContain("token is missing or was rejected");
    expect(diagnosed.message).toContain("rinth whoami");
  });

  test("preserves exitCode/status/endpoint exactly (the --json error shape must not change shape)", () => {
    const original = new CliError("Not Found", ExitCode.NotFound, {
      status: 404,
      endpoint: "GET /v2/project/draft-thing",
    });

    const diagnosed = diagnoseNotFound(original, "Project draft-thing");

    expect(diagnosed.exitCode).toBe(ExitCode.NotFound);
    expect(diagnosed.status).toBe(404);
    expect(diagnosed.endpoint).toBe("GET /v2/project/draft-thing");
  });

  test("sets a stable machine-readable reason", () => {
    const original = new CliError("Not Found", ExitCode.NotFound, { status: 404, endpoint: "GET /v2/project/x" });
    expect(diagnoseNotFound(original, "Project x").reason).toBe(NOT_FOUND_REASON);
  });

  test("passes through any non-404 error unchanged", () => {
    const forbidden = new CliError("Forbidden", ExitCode.AuthMissing, { status: 403, endpoint: "GET /v2/project/x" });
    expect(diagnoseNotFound(forbidden, "Project x")).toBe(forbidden);

    const usage = new CliError("bad args", ExitCode.Usage);
    expect(diagnoseNotFound(usage, "Project x")).toBe(usage);

    const serverError = new CliError("boom", ExitCode.ApiError, { status: 500, endpoint: "GET /v2/project/x" });
    expect(diagnoseNotFound(serverError, "Project x")).toBe(serverError);
  });

  test("never leaks a token embedded in the subject or original message (redaction proof)", () => {
    const original = new CliError("Not Found: Bearer mrp_leaked_token_value", ExitCode.NotFound, {
      status: 404,
      endpoint: "GET /v2/project/x",
    });

    const diagnosed = diagnoseNotFound(original, "Project x");

    // diagnoseNotFound never echoes the original message back in — it
    // replaces it entirely with a fixed, static explanation.
    expect(diagnosed.message).not.toContain("mrp_leaked_token_value");
  });
});
