import { afterEach, describe, expect, test } from "bun:test";
import { getToken, requireToken } from "../../src/auth.ts";
import { CliError, ExitCode } from "../../src/errors.ts";

const ORIGINAL = process.env["MODRINTH_TOKEN"];

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env["MODRINTH_TOKEN"];
  } else {
    process.env["MODRINTH_TOKEN"] = ORIGINAL;
  }
});

describe("getToken", () => {
  test("reads MODRINTH_TOKEN from the environment", () => {
    process.env["MODRINTH_TOKEN"] = "unit-test-token";
    expect(getToken()).toBe("unit-test-token");
  });

  test("returns undefined when unset", () => {
    delete process.env["MODRINTH_TOKEN"];
    expect(getToken()).toBeUndefined();
  });
});

describe("requireToken", () => {
  test("returns the token when set", () => {
    process.env["MODRINTH_TOKEN"] = "unit-test-token-xyz";
    expect(requireToken()).toBe("unit-test-token-xyz");
  });

  test("throws a CliError with exit code 3 when unset", () => {
    delete process.env["MODRINTH_TOKEN"];
    expect(() => requireToken()).toThrow(CliError);
    try {
      requireToken();
      throw new Error("expected requireToken to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CliError);
      expect((err as CliError).exitCode).toBe(ExitCode.AuthMissing);
      expect((err as CliError).message).toContain("MODRINTH_TOKEN");
    }
  });

  test("throws when MODRINTH_TOKEN is set but empty", () => {
    process.env["MODRINTH_TOKEN"] = "";
    expect(() => requireToken()).toThrow(CliError);
  });
});
