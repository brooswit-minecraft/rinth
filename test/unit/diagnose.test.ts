import { describe, expect, test } from "bun:test";
import {
  diagnoseNotFound,
  diagnoseServerCredentialRefused,
  diagnoseUpstreamRouteDead,
  NOT_FOUND_REASON,
  SERVER_CREDENTIAL_REFUSED_REASON,
  UPSTREAM_ROUTE_DEAD_REASON,
} from "../../src/diagnose.ts";
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

describe("diagnoseUpstreamRouteDead", () => {
  const ENDPOINT = "POST /modrinth/v0/servers/srv_123/reinstall";

  test("rewrites a 404 CliError's message to name the failing reinstall route without asserting a mechanism or a known remedy", () => {
    const original = new CliError("Not Found", ExitCode.NotFound, { status: 404, endpoint: ENDPOINT });

    const diagnosed = diagnoseUpstreamRouteDead(original);

    expect(diagnosed.message).toContain("reinstall");
    expect(diagnosed.message).toContain("regardless of credentials");
    expect(diagnosed.message).toContain("not visible from outside Modrinth");
    expect(diagnosed.message).toContain("undecided");
    expect(diagnosed.message).not.toContain("dead at the router");
    expect(diagnosed.message).not.toContain("migration to the v1 content API, not yet done");
    expect(diagnosed.message).not.toMatch(/^Not Found$/);
  });

  test("preserves exitCode/status/endpoint exactly", () => {
    const original = new CliError("Not Found", ExitCode.NotFound, { status: 404, endpoint: ENDPOINT });

    const diagnosed = diagnoseUpstreamRouteDead(original);

    expect(diagnosed.exitCode).toBe(ExitCode.NotFound);
    expect(diagnosed.status).toBe(404);
    expect(diagnosed.endpoint).toBe(ENDPOINT);
  });

  test("sets a stable machine-readable reason, distinct from diagnoseNotFound's and diagnoseServerCredentialRefused's", () => {
    const original = new CliError("Not Found", ExitCode.NotFound, { status: 404, endpoint: ENDPOINT });
    expect(diagnoseUpstreamRouteDead(original).reason).toBe(UPSTREAM_ROUTE_DEAD_REASON);
    expect(UPSTREAM_ROUTE_DEAD_REASON).not.toBe(NOT_FOUND_REASON);
    expect(UPSTREAM_ROUTE_DEAD_REASON).not.toBe(SERVER_CREDENTIAL_REFUSED_REASON);
  });

  test("passes through any non-404 error unchanged", () => {
    const forbidden = new CliError("Forbidden", ExitCode.AuthMissing, { status: 403, endpoint: ENDPOINT });
    expect(diagnoseUpstreamRouteDead(forbidden)).toBe(forbidden);

    const usage = new CliError("bad args", ExitCode.Usage);
    expect(diagnoseUpstreamRouteDead(usage)).toBe(usage);

    const serverError = new CliError("boom", ExitCode.ApiError, { status: 500, endpoint: ENDPOINT });
    expect(diagnoseUpstreamRouteDead(serverError)).toBe(serverError);
  });

  test("never leaks a token embedded in the original message (redaction proof)", () => {
    const original = new CliError("Not Found: Bearer mrp_leaked_token_value", ExitCode.NotFound, {
      status: 404,
      endpoint: ENDPOINT,
    });

    expect(diagnoseUpstreamRouteDead(original).message).not.toContain("mrp_leaked_token_value");
  });
});

describe("diagnoseServerCredentialRefused", () => {
  const ENDPOINT = "GET /modrinth/v0/servers/srv_123";

  test("rewrites a 403 CliError's message to name the server and state this is an upstream limitation, not a required-credential claim", () => {
    const original = new CliError("Forbidden", ExitCode.AuthMissing, { status: 403, endpoint: ENDPOINT });

    const diagnosed = diagnoseServerCredentialRefused(original, "srv_123");

    expect(diagnosed.message).toContain("srv_123");
    expect(diagnosed.message).toContain("403");
    expect(diagnosed.message).toContain("PAT");
    expect(diagnosed.message).toContain("upstream limitation");
    expect(diagnosed.message).toContain("undecided");
    expect(diagnosed.message).not.toContain("session token");
    expect(diagnosed.message).not.toMatch(/^Forbidden$/);
  });

  test("preserves exitCode/status/endpoint exactly", () => {
    const original = new CliError("Forbidden", ExitCode.AuthMissing, { status: 403, endpoint: ENDPOINT });

    const diagnosed = diagnoseServerCredentialRefused(original, "srv_123");

    expect(diagnosed.exitCode).toBe(ExitCode.AuthMissing);
    expect(diagnosed.status).toBe(403);
    expect(diagnosed.endpoint).toBe(ENDPOINT);
  });

  test("sets a stable machine-readable reason, distinct from the other diagnose reasons", () => {
    const original = new CliError("Forbidden", ExitCode.AuthMissing, { status: 403, endpoint: ENDPOINT });
    expect(diagnoseServerCredentialRefused(original, "srv_123").reason).toBe(SERVER_CREDENTIAL_REFUSED_REASON);
    expect(SERVER_CREDENTIAL_REFUSED_REASON).not.toBe(NOT_FOUND_REASON);
    expect(SERVER_CREDENTIAL_REFUSED_REASON).not.toBe(UPSTREAM_ROUTE_DEAD_REASON);
  });

  test("passes through any non-403 error unchanged", () => {
    const notFound = new CliError("Not Found", ExitCode.NotFound, { status: 404, endpoint: ENDPOINT });
    expect(diagnoseServerCredentialRefused(notFound, "srv_123")).toBe(notFound);

    const usage = new CliError("bad args", ExitCode.Usage);
    expect(diagnoseServerCredentialRefused(usage, "srv_123")).toBe(usage);

    const serverError = new CliError("boom", ExitCode.ApiError, { status: 500, endpoint: ENDPOINT });
    expect(diagnoseServerCredentialRefused(serverError, "srv_123")).toBe(serverError);
  });

  test("never leaks a token embedded in the original message (redaction proof)", () => {
    const original = new CliError("Forbidden: Bearer mrp_leaked_token_value", ExitCode.AuthMissing, {
      status: 403,
      endpoint: ENDPOINT,
    });

    expect(diagnoseServerCredentialRefused(original, "srv_123").message).not.toContain("mrp_leaked_token_value");
  });
});
