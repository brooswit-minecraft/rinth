import { describe, expect, test } from "bun:test";
import { CliError, ExitCode, exitCodeForApiError } from "../../src/errors.ts";

describe("CliError", () => {
  test("carries a message and exit code", () => {
    const err = new CliError("not found", ExitCode.NotFound);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CliError");
    expect(err.message).toBe("not found");
    expect(err.exitCode).toBe(ExitCode.NotFound);
  });

  test("defaults status and endpoint to null when not given (e.g. a usage error)", () => {
    const err = new CliError("bad args", ExitCode.Usage);
    expect(err.status).toBeNull();
    expect(err.endpoint).toBeNull();
  });

  test("carries status and endpoint when given", () => {
    const err = new CliError("Forbidden", ExitCode.AuthMissing, {
      status: 403,
      endpoint: "GET /modrinth/v0/servers/srv_123",
    });
    expect(err.status).toBe(403);
    expect(err.endpoint).toBe("GET /modrinth/v0/servers/srv_123");
  });

  test("defaults reason to null when not given", () => {
    const err = new CliError("bad args", ExitCode.Usage);
    expect(err.reason).toBeNull();
  });

  test("carries reason when given", () => {
    const err = new CliError("no match", ExitCode.NoVersionMatch, { reason: "no_version_match" });
    expect(err.reason).toBe("no_version_match");
  });
});

describe("ExitCode", () => {
  // RINTH-6/RINTH-2: `versions latest`'s no-match case moved off NotFound
  // onto two new, distinct codes — see errors.ts's header comment.
  test("NoVersionMatch and WaitTimeout are distinct from every existing code", () => {
    const existing = [
      ExitCode.Ok,
      ExitCode.Generic,
      ExitCode.Usage,
      ExitCode.AuthMissing,
      ExitCode.NotFound,
      ExitCode.ApiError,
      ExitCode.Network,
    ];
    expect(existing).not.toContain(ExitCode.NoVersionMatch);
    expect(existing).not.toContain(ExitCode.WaitTimeout);
    expect(ExitCode.NoVersionMatch).not.toBe(ExitCode.WaitTimeout);
  });
});

describe("exitCodeForApiError", () => {
  test("maps a missing status code (network failure) to Network", () => {
    expect(exitCodeForApiError(undefined)).toBe(ExitCode.Network);
  });

  test("maps 401 and 403 to AuthMissing", () => {
    expect(exitCodeForApiError(401)).toBe(ExitCode.AuthMissing);
    expect(exitCodeForApiError(403)).toBe(ExitCode.AuthMissing);
  });

  test("maps 404 to NotFound", () => {
    expect(exitCodeForApiError(404)).toBe(ExitCode.NotFound);
  });

  test("maps any other 4xx/5xx to ApiError", () => {
    expect(exitCodeForApiError(400)).toBe(ExitCode.ApiError);
    expect(exitCodeForApiError(426)).toBe(ExitCode.ApiError);
    expect(exitCodeForApiError(500)).toBe(ExitCode.ApiError);
    expect(exitCodeForApiError(503)).toBe(ExitCode.ApiError);
  });
});
