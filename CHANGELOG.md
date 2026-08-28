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
- `rinth servers exec <id> <command...>` (KAN-730): sends one console
  command to a server over the Archon WebSocket console API and prints
  whatever it reports back for a short collection window (`--wait <ms>`,
  default `2000`). Human mode prints each collected line as it arrives;
  `--json` prints a single `{ id, command, lines }` object once the window
  closes, and nothing else. No output within the window is not an error —
  exit `0` with an empty `lines` list.
- The `Transport` seam gained `getWebSocketAuth` and an injectable
  `openSocket`/`ConsoleSocket` factory (`src/client/index.ts`), so
  `servers exec`'s auth handshake, command send, and log collection are all
  unit-tested offline against a fake socket (`createFakeConsoleSocket` in
  `src/client/fake.ts`) with zero network access.
- Error mapping for `servers exec`: the console rejecting the WebSocket
  auth token (`auth-incorrect`) or never confirming it in time both map to
  exit code 3; a refused/failed/DNS-failed socket connection maps to exit
  code 6; WS-auth fetch failures use the existing HTTP-status mapping
  (404 -> 4, 401/403 -> 3, other 4xx/5xx incl. 426 -> 5). The console socket
  is always closed, on every exit path, and the whole operation has a hard
  overall time ceiling so a wedged socket can never hang the CLI. A remote
  close *after* the command was sent reports whatever output was collected
  (exit 0), matching an ordinary console hanging up post-command, rather
  than being treated as a connection failure — only a close before that
  point (e.g. auth never completing) maps to exit 6.
- The WebSocket auth token is registered with `src/redact.ts` as soon as
  it's fetched, before the socket does anything else, so it can never reach
  stdout/stderr — even if a server echoed it back in a console log line.
- `test/integration/exec.integration.test.ts`: a live console-exec check,
  gated on `MODRINTH_TOKEN` *and* `RINTH_TEST_SERVER_ID` (falling back to
  `MODRINTH_SERVER_ID`) so it never runs from just a token, since it opens a
  real console session against a real server. Sends the harmless read-only
  `list` command, so the server's power state/upstream is never touched.
- `CliError` (`src/errors.ts`) now carries the HTTP `status` (`null` for a
  non-HTTP failure) and the `"<METHOD> <path>"` `endpoint` of the request
  that failed (`null` when there was none, e.g. a usage error), populated by
  `toCliError()` in `src/client/real.ts` at each transport call site. The
  plain-text stderr message is prefixed with both when present (e.g.
  `HTTP 403 GET /modrinth/v0/servers/<id>: Forbidden`), and `--json` mode
  prints a single JSON error object to stderr —
  `{"error":{"code","status","endpoint","message"}}` — instead of plain
  text, with stdout left empty; both go through the existing
  `src/output.ts`/`src/redact.ts` path. See README "Errors under `--json`".
- Fixed a PII leak in `test/integration/whoami.integration.test.ts`: it was
  forwarding the raw labrinth `/user` `--json` body (which includes the
  account's email) to the real console, landing it in this public repo's
  Actions log. The spy no longer forwards; only `id`/`username` are ever
  printed for real.
- `.github/workflows/ci.yml`: `workflow_dispatch` gained a `server_id`
  input, passed to the `integration` job as `RINTH_TEST_SERVER_ID`, so the
  destructive `servers power`/`servers upstream`/`servers exec` integration
  tests can be run on demand against a real server without a repo/org
  variable (opt-in per dispatch).
- `test/integration/servers.integration.test.ts` additionally logs each
  live server's raw `current_user_permissions` (KAN-735 item 1(d)
  diagnosis) via a one-off `@modrinth/api-client` call that bypasses the
  `Transport`/command layer entirely — `PublicServer`/`ServerDetail` still
  never expose this field.

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
