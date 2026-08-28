import { afterEach, describe, expect, test } from "bun:test";
import { getToken } from "../../src/auth.ts";

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
