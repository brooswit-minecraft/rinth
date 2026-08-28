import { describe, expect, spyOn, test } from "bun:test";
import { printHuman, printJson } from "../../src/output.ts";

describe("output", () => {
  test("printJson writes a JSON-serialized line", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    printJson({ ok: true });
    expect(spy).toHaveBeenCalledWith('{"ok":true}');
    spy.mockRestore();
  });

  test("printHuman writes the message as-is", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    printHuman("hello");
    expect(spy).toHaveBeenCalledWith("hello");
    spy.mockRestore();
  });
});
