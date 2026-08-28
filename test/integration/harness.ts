// T2 will add real integration coverage against live Modrinth APIs on top of
// this harness. It exists so `test/integration` skips cleanly with no
// network access whenever the required env vars aren't set (e.g. local dev,
// forked-PR CI) instead of failing.

export const MODRINTH_TOKEN = process.env["MODRINTH_TOKEN"];
export const hasModrinthToken = Boolean(MODRINTH_TOKEN);

if (!hasModrinthToken) {
  console.log("MODRINTH_TOKEN not set — skipping integration tests");
}
