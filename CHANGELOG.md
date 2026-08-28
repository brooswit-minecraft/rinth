# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/). CI
enforces that this file has a `## [<version>]` heading matching the
`version` field in `package.json` — see README.md.

## [0.3.0] - 2026-08-28

### Added

- `rinth servers get <id>`: server details (name, status, game version,
  loader + version, current upstream, net/datacenter) via
  `archon.servers_v0.get()`. Trimmed to an allowlist (`ServerDetail` in
  `src/client/index.ts`) that never includes `sftp_username`,
  `sftp_password`, or the node panel token — see the credential-leak test in
  `test/unit/client/real.test.ts`.
- `rinth servers power <id> start|stop|restart|kill`: maps the lowercase CLI
  action to the capitalized `'Start'|'Stop'|'Restart'|'Kill'` union
  `archon.servers_v0.power()` expects. `--json` prints
  `{"id","action","accepted":true}` (action echoed as typed); an unknown
  action is a usage error (exit 2) listing the four valid actions.
- `rinth servers upstream <id> --project <slug|id> --version <version_id> [--restart]`:
  re-points a server at a modpack version via `archon.servers_v0.reinstall()`
  (there is no separate "upstream" endpoint — reinstall with a
  `{project_id, version_id}` body IS the re-point). `--project` accepts a
  slug or an id — both resolve through labrinth `GET /project/:idOrSlug` via
  the client's `.request()` escape hatch. Reads the server back afterward
  and prints the *resulting* upstream, not just an "accepted" flag.
  `--restart` follows with a `power(id, 'Restart')` call.
- Whether an upstream reinstall already triggers its own restart could not
  be confirmed either from the public docs (they do not say) or live (no
  `MODRINTH_TOKEN` in this environment) — see README "Does upstream
  re-point restart the server?" and the code comment above
  `upstream()` in `src/commands/servers.ts`. `--restart` is implemented as
  an explicit, separate power call so a caller gets a guaranteed bounce
  either way.
- `Transport` gained `getServer`, `power`, `setUpstream`, `resolveProjectId`
  (`src/client/index.ts`), implemented in `src/client/real.ts` (wrapped in
  the existing `call()`/`toCliError()` pipeline) and `src/client/fake.ts`
  (new fixtures, same pattern as the existing ones).
- Unit tests for all three commands: success path and every error path
  (401/403 -> exit 3, 404 -> exit 4, 5xx/426 -> exit 5, network -> exit 6,
  bad usage -> exit 2) via the fake transport, plus the credential-leak
  assertion above.
- Integration tests (`test/integration/servers-manage.integration.test.ts`):
  `servers get` is token-gated only; `servers power`/`servers upstream` are
  additionally gated on `RINTH_TEST_SERVER_ID` (or `MODRINTH_SERVER_ID` as a
  fallback name) since they are destructive — see README.

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
