import { describe, expect, test } from "bun:test";
import { CliError, ExitCode } from "../../src/errors.ts";

describe("CliError", () => {
  test("carries a message and exit code", () => {
    const err = new CliError("not found", ExitCode.NotFound);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CliError");
    expect(err.message).toBe("not found");
    expect(err.exitCode).toBe(ExitCode.NotFound);
  });
});
