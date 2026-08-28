// T2 will add real integration coverage against live Modrinth APIs on top of
// this harness. It exists so `test/integration` skips cleanly with no
// network access whenever the required env vars aren't set (e.g. local dev,
// forked-PR CI) instead of failing.

export const MODRINTH_TOKEN = process.env["MODRINTH_TOKEN"];
export const hasModrinthToken = Boolean(MODRINTH_TOKEN);

if (!hasModrinthToken) {
  console.log("MODRINTH_TOKEN not set — skipping integration tests");
}

/**
 * Names a real project (id or slug) the token is allowed to publish
 * throwaway versions to — see test/integration/publish.integration.test.ts.
 * Not set in this environment (or CI, by default): publishing creates a
 * real version, so it needs an explicit opt-in project, not just a token.
 */
export const RINTH_TEST_PROJECT = process.env["RINTH_TEST_PROJECT"];
export const hasTestProject = Boolean(RINTH_TEST_PROJECT);

if (!hasTestProject) {
  console.log("RINTH_TEST_PROJECT not set — skipping publish integration test");
}
