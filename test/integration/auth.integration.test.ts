// Placeholder proving the skip path required by CI when no live credentials
// are available. T2 will replace this with a real auth spike against the
// Modrinth API (this is the "empirical PAT auth answer" from KAN-719).

import { describe, expect, test } from "bun:test";
import { hasModrinthToken, MODRINTH_TOKEN } from "./harness.ts";

describe("integration: auth", () => {
  test.skipIf(!hasModrinthToken)("MODRINTH_TOKEN is present and non-empty", () => {
    expect(MODRINTH_TOKEN).toBeTruthy();
  });
});
