# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/). CI
enforces that this file has a `## [<version>]` heading matching the
`version` field in `package.json` — see README.md.

## [0.4.0] - 2026-08-28

### Added

- `rinth versions list <project> [--loader <l>] [--game-version <gv>]
  [--channel release|beta|alpha] [--limit <n>]` — labrinth v2 `GET
  /project/{id|slug}/version` via `client.labrinth.versions_v2.getProjectVersions()`.
  `--loader`/`--game-version` are repeatable and forwarded as server-side
  filters; `--channel` is applied client-side against `version_type`
  because the endpoint does not support it as a filter (verified against
  the live docs and the API client's request-building code). Human output
  is an aligned table (id, version_number, channel, loaders, game
  versions, date, primary file name); `--json` prints the unmodified API
  array. An empty result is not an error — it prints a message and exits
  0.
- `rinth versions latest <project> [--loader <l>] [--game-version <gv>]
  [--channel <c>]` — same filtering, then picks the newest match by
  parsing and comparing `date_published` explicitly. The live API
  empirically returns versions pre-sorted descending by `date_published`,
  but that is not documented behavior, so this does not rely on response
  order. No match exits 4 (`ExitCode.NotFound`).
- `Transport#listVersions` (`src/client/index.ts` + `real.ts` + `fake.ts`):
  the new command-shaped transport method both version commands share,
  with a `VersionFilters` shape (`loaders`, `game_versions`, `limit`) that
  maps 1:1 onto the API client's own filter params.

## [0.2.0] - 2026-08-28

### Added

- Client core: `src/auth.ts`'s `requireToken()` (exit code 3, guidance
  message, when `MODRINTH_TOKEN` is missing/empty), a redaction helper
  (`src/redact.ts`) that scrubs the token value and any `Bearer <token>`
  header from every print, and `src/output.ts` now routes `printJson` /
  `printHuman` / a new `printError` through it — there is no output path
  that bypasses redaction.
- Exit-code mapping (`exitCodeForApiError` in `src/errors.ts`): HTTP
  401/403 -> 3, 404 -> 4, any other 4xx/5xx -> 5, no response (network
  failure) -> 6.
- An injectable, command-shaped `Transport` (`src/client/index.ts`): a fake
  implementation (`src/client/fake.ts`) for offline unit tests, and a real
  one (`src/client/real.ts`) wrapping `@modrinth/api-client`'s
  `GenericModrinthClient` — Bearer auth via `AuthFeature`, and
  `PanelVersionFeature` for the `X-Panel-Version: 1` header the Archon API
  requires (confirmed not sent by default; see README).
- `rinth whoami` (GET labrinth `/user`, v2) and `rinth servers list` (via
  `archon.servers_v0.list()`), both with `--json` support, both
  unit-tested offline against the fake transport (success and every
  401/403/404/5xx/network error path), and both in `test/integration`
  (self-skip when `MODRINTH_TOKEN` is unset).
- `servers list` output is trimmed to fields safe to print — SFTP
  credentials and the node panel token returned by the Archon API are
  never included.
- `src/cli.ts` dispatch: async, maps a thrown `CliError` to its exit code,
  supports injecting a `Transport` for tests.

## [0.1.0] - 2026-08-28

### Added

- Bun project scaffold: `package.json`, `tsconfig.json`, oxlint, and the
  `typecheck` / `lint` / `test` / `test:coverage` scripts.
- `@modrinth/api-client` pinned as an exact dependency.
- CLI entrypoint (`src/cli.ts`) with `--json` / `--help` parsing and an
  empty command registry, plus seams for the transport, output, error, and
  auth layers that T2 will implement.
- Unit tests and an integration test harness under `test/integration` that
  skips cleanly when `MODRINTH_TOKEN` is unset.
- GitHub Actions CI: typecheck, lint, unit tests, an 80% coverage gate, a
  changelog/version gate, and a separate integration job.
