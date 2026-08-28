// T2 will add real integration coverage against live Modrinth APIs on top of
// this harness. It exists so `test/integration` skips cleanly with no
// network access whenever the required env vars aren't set (e.g. local dev,
// forked-PR CI) instead of failing.

export const MODRINTH_TOKEN = process.env["MODRINTH_TOKEN"];
export const hasModrinthToken = Boolean(MODRINTH_TOKEN);

if (!hasModrinthToken) {
  console.log("MODRINTH_TOKEN not set — skipping integration tests");
}

// The destructive `servers power`/`servers upstream` integration tests need
// a real, disposable server id in addition to a token — RINTH_TEST_SERVER_ID
// is the CLI-specific name; MODRINTH_SERVER_ID is honored as a fallback
// since that is the org variable name the operator may already have set.
// Neither name being set is a valid, clean-skip outcome (see README).
export const RINTH_TEST_SERVER_ID = process.env["RINTH_TEST_SERVER_ID"] ?? process.env["MODRINTH_SERVER_ID"];
export const hasTestServerId = Boolean(RINTH_TEST_SERVER_ID);

if (hasModrinthToken && !hasTestServerId) {
  console.log(
    "RINTH_TEST_SERVER_ID/MODRINTH_SERVER_ID not set — skipping destructive servers power/upstream integration tests",
  );
}
