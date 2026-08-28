// T2 will validate/exchange this token against the Modrinth API; this file
// only reads it. Token value must never be logged, flagged, or echoed.

export function getToken(): string | undefined {
  return process.env["MODRINTH_TOKEN"];
}
