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
