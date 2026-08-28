import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { printError, printJson } from "../../src/output.ts";
import { resetSecretsForTesting, redact, REDACTED, registerSecret } from "../../src/redact.ts";

afterEach(() => {
  resetSecretsForTesting();
});

describe("redact", () => {
  test("scrubs a registered secret value from text", () => {
    registerSecret("super-secret-token-123");
    expect(redact("token=super-secret-token-123")).toBe(`token=${REDACTED}`);
  });

  test("scrubs every occurrence of a registered secret", () => {
    registerSecret("dupe-token");
    expect(redact("dupe-token ... dupe-token")).toBe(`${REDACTED} ... ${REDACTED}`);
  });

  test("scrubs a Bearer header even for an unregistered token", () => {
    expect(redact("Authorization: Bearer abc.def.ghi")).toBe(`Authorization: Bearer ${REDACTED}`);
  });

  test("registering an empty or undefined value is a no-op", () => {
    registerSecret("");
    registerSecret(undefined);
    expect(redact("")).toBe("");
  });

  test("leaves text with no secrets unchanged", () => {
    expect(redact("hello world")).toBe("hello world");
  });
});

describe("redaction at the print boundary", () => {
  test("a token embedded in a thrown error's message never reaches stderr", () => {
    const token = "mrp_live_abcdef1234567890";
    registerSecret(token);
    const err = new Error(`request failed: Authorization: Bearer ${token}`);

    const spy = spyOn(console, "error").mockImplementation(() => {});
    printError(err.message);
    const printed = spy.mock.calls.map((call) => String(call[0])).join("\n");
    spy.mockRestore();

    expect(printed).not.toContain(token);
    expect(printed).toContain(REDACTED);
  });

  test("printJson redacts a secret embedded anywhere in the serialized value", () => {
    const token = "mrp_live_zzz999";
    registerSecret(token);

    const spy = spyOn(console, "log").mockImplementation(() => {});
    printJson({ note: `token was ${token}` });
    const printed = spy.mock.calls.map((call) => String(call[0])).join("\n");
    spy.mockRestore();

    expect(printed).not.toContain(token);
    expect(printed).toContain(REDACTED);
  });
});
