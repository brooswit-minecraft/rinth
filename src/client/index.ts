// T2 will implement the real transport here (Archon servers API + labrinth
// REST, both via @modrinth/api-client), wired to src/auth.ts for the token.

export interface Transport {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}
