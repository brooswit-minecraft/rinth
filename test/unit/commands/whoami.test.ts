import { describe, expect, spyOn, test } from "bun:test";
import type { Labrinth } from "@modrinth/api-client";
import { run } from "../../../src/cli.ts";
import { apiError, createFakeTransport } from "../../../src/client/fake.ts";
import { ExitCode } from "../../../src/errors.ts";

const FIXTURE_USER: Labrinth.Users.v2.User = {
  id: "abc123",
  username: "testuser",
  created: "2024-01-01T00:00:00Z",
  role: "developer",
  badges: 0,
};

describe("rinth whoami", () => {
  test("--json prints the user as JSON on stdout and nothing else", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ user: FIXTURE_USER });

    const code = await run(["--json", "whoami"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(FIXTURE_USER));
    expect(errSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  test("human mode prints a readable summary", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const transport = createFakeTransport({ user: FIXTURE_USER });

    const code = await run(["whoami"], { transport });

    expect(code).toBe(ExitCode.Ok);
    expect(logSpy).toHaveBeenCalledWith("testuser (abc123)");
    logSpy.mockRestore();
  });

  test.each([
    [401, ExitCode.AuthMissing],
    [403, ExitCode.AuthMissing],
    [404, ExitCode.NotFound],
    [500, ExitCode.ApiError],
    [426, ExitCode.ApiError],
  ] as const)("HTTP status %d surfaces as exit code %d", async (_status, expectedExitCode) => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ userError: apiError(expectedExitCode) });

    const code = await run(["whoami"], { transport });

    expect(code).toBe(expectedExitCode);
    errSpy.mockRestore();
  });

  test("a network error (no HTTP response) maps to exit code 6", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const transport = createFakeTransport({ userError: apiError(ExitCode.Network, "fetch failed") });

    const code = await run(["whoami"], { transport });

    expect(code).toBe(ExitCode.Network);
    expect(errSpy).toHaveBeenCalledWith("fetch failed");
    errSpy.mockRestore();
  });
});
