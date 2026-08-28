import { describe, expect, spyOn, test } from "bun:test";
import { parseArgs, run } from "../../src/cli.ts";

describe("parseArgs", () => {
  test("recognizes --json anywhere in argv", () => {
    const parsed = parseArgs(["--json", "servers", "list"]);
    expect(parsed.json).toBe(true);
    expect(parsed.command).toBe("servers");
    expect(parsed.rest).toEqual(["list"]);
  });

  test("recognizes --help and -h", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("defaults to no flags and no command", () => {
    const parsed = parseArgs([]);
    expect(parsed.json).toBe(false);
    expect(parsed.help).toBe(false);
    expect(parsed.command).toBeUndefined();
  });
});

describe("run", () => {
  test("prints usage and exits 0 when no command is given", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    const code = run([]);
    expect(code).toBe(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("prints usage and exits 0 for --help", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    const code = run(["--help"]);
    spy.mockRestore();
    expect(code).toBe(0);
  });

  test("exits 2 for an unknown command", () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const code = run(["bogus"]);
    expect(code).toBe(2);
    expect(spy).toHaveBeenCalledWith("Unknown command: bogus");
    spy.mockRestore();
  });
});
