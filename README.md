# rinth

A Modrinth CLI (servers management + publish) wrapping [`@modrinth/api-client`](https://www.npmjs.com/package/@modrinth/api-client).
One tested surface usable both by a human at a shell and by CI — there is no
official Modrinth CLI.

Status: client core + two real commands (KAN-726), on top of the scaffold
and CI gate stack from KAN-725.

## Install / run

```sh
bunx github:brooswit-minecraft/rinth
```

For local development:

```sh
bun install
bun run src/cli.ts --help
```

## Authentication

Set `MODRINTH_TOKEN` in the environment. **The token is read from this env
var only — there is no `--token` flag**, so it never ends up in shell
history, process listings, or CI logs by accident.

```sh
export MODRINTH_TOKEN=...
rinth servers list
```

## `--json`

Every command accepts a global `--json` flag. When set, the command writes a
single JSON value to stdout and **nothing else** — no banners, no progress,
no human text — so output is safe to pipe into `jq` or another program.
Human-readable text goes to stdout when `--json` is not set. Errors always go
to stderr, in both modes.

## Redaction

Every write to stdout/stderr goes through a single redaction helper
(`src/redact.ts`) before it is printed: the `MODRINTH_TOKEN` value (and any
`Bearer <token>` header, even for a token the process never saw) is
scrubbed and replaced with `***REDACTED***`. `src/output.ts`'s
`printJson`/`printHuman`/`printError` are the only functions in the CLI that
call `console.log`/`console.error`, so there is no path to the terminal
that can bypass it — see `test/unit/redact.test.ts`, which constructs an
error embedding the token, sends it through the real print path, and
asserts the token value never appears in the captured output.

`rinth servers list` additionally never includes SFTP credentials or the
Archon node panel token in its output — see the JSON shape below.

## Commands

### `rinth whoami`

`GET https://api.modrinth.com/v2/user` (Bearer token). Prints the
authenticated user.

**JSON shape** — the raw Modrinth user object:

```json
{ "id": "...", "username": "...", "name": "...", "email": "...", "role": "developer", "badges": 0, "created": "..." }
```

### `rinth servers list`

Lists servers via `@modrinth/api-client`'s Archon `servers_v0.list()`.

**JSON shape** — trimmed to fields safe to print; SFTP credentials and the
node panel token from the Archon response are never included:

```json
{
  "servers": [
    {
      "id": "...",
      "name": "...",
      "status": "available",
      "game": "Minecraft",
      "loader": "Paper",
      "loader_version": "...",
      "mc_version": "1.20.4",
      "net": { "ip": null, "port": 25565, "domain": "..." }
    }
  ]
}
```

## Exit codes

| Code | Meaning                              |
| ---- | ------------------------------------- |
| 0    | OK                                    |
| 1    | Generic / unexpected error            |
| 2    | Usage error (bad args/command)        |
| 3    | Auth missing or rejected (401/403)    |
| 4    | Not found (404)                       |
| 5    | API error, other 4xx/5xx              |
| 6    | Network error                         |

Note: the Archon (servers) API returns HTTP 426 ("unsupported archon
request version") for any request missing an `X-Panel-Version: 1` header,
*before* it evaluates auth — a missing header would otherwise look
indistinguishable from a rejected token. `@modrinth/api-client` does not
send this header by default (confirmed by reading its source); the real
transport (`src/client/real.ts`) adds it explicitly via the client's
`PanelVersionFeature`. A 426 maps to exit code 5 (API error), not 3.

## Tests

- **Unit** (`test/unit/`): pure logic, no network, runs offline.

  ```sh
  bun run test           # test/unit only
  bun run test:coverage  # unit tests + 80% coverage gate (test/unit only)
  ```

- **Integration** (`test/integration/`): exercises the live Modrinth API, run
  separately from `test`/`test:coverage` (and excluded from the coverage
  gate). Every integration test skips cleanly — logging
  `MODRINTH_TOKEN not set — skipping integration tests` — when
  `MODRINTH_TOKEN` isn't set, so the bare `bun test` (which picks up every
  `*.test.ts` file, unit and integration) always passes offline. The same
  applies to any other env-gated fixture (e.g. `MODRINTH_PROJECT_ID`,
  `MODRINTH_SERVER_ID`): tests that need them skip cleanly, they never fail,
  when those variables are absent.

  ```sh
  MODRINTH_TOKEN=... bun run test:integration
  ```

## Changelog / version gate

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/). CI requires `CHANGELOG.md` to
contain a heading exactly matching the `version` field in `package.json`,
e.g. for `"version": "0.1.0"`:

```markdown
## [0.1.0] - 2026-08-28
```

Bump `package.json`'s `version` and add a matching `## [<version>]` entry to
`CHANGELOG.md` in the same PR, or the `changelog` CI job fails. Check it
locally with:

```sh
bun run changelog:check
```

## Linting

Lint is [`oxlint`](https://oxc.rs/docs/guide/usage/linter.html) (config in
`.oxlintrc.json`), chosen because it needs no extra parser/plugin setup for
TypeScript, runs fast enough to gate CI without adding noticeable latency,
and its defaults (`correctness` as errors) are already a meaningful bar for
a bun/TS project of this size — `eslint` + `typescript-eslint` would need
more configuration for the same coverage.

```sh
bun run lint
```
