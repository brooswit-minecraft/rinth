# rinth

A Modrinth CLI (servers management + publish) wrapping [`@modrinth/api-client`](https://www.npmjs.com/package/@modrinth/api-client).
One tested surface usable both by a human at a shell and by CI — there is no
official Modrinth CLI.

Status: client core + `whoami`/`servers list` (KAN-726), plus
`servers get|power|upstream` (KAN-728), on top of the scaffold and CI gate
stack from KAN-725.

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

`rinth servers list` and `rinth servers get` additionally never include SFTP
credentials or the Archon node panel token in their output — see the JSON
shapes below.

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

### `rinth servers get <id>`

Server details via `archon.servers_v0.get()`: name, status, game version,
loader + version, current upstream, net/datacenter.

```sh
rinth servers get ff783f0f-ec3c-4037-b39f-452ce590891d
```

**JSON shape** — same allowlist discipline as `servers list`, plus
`datacenter` and `upstream`; SFTP credentials and the node panel token are
never included:

```json
{
  "id": "ff783f0f-ec3c-4037-b39f-452ce590891d",
  "name": "...",
  "status": "available",
  "game": "Minecraft",
  "loader": "Paper",
  "loader_version": "...",
  "mc_version": "1.20.4",
  "net": { "ip": null, "port": 25565, "domain": "..." },
  "datacenter": "...",
  "upstream": { "kind": "modpack", "project_id": "...", "version_id": "..." }
}
```

### `rinth servers power <id> start|stop|restart|kill`

Sends a power action via `archon.servers_v0.power()`. Exits non-zero (via
the normal exit-code mapping) if the API rejects the action; an unknown
action is a usage error (exit 2).

```sh
rinth --json servers power ff783f0f-ec3c-4037-b39f-452ce590891d restart
```

**JSON shape** — `action` is echoed back exactly as typed (lowercase):

```json
{ "id": "ff783f0f-ec3c-4037-b39f-452ce590891d", "action": "restart", "accepted": true }
```

### `rinth servers upstream <id> --project <slug|id> --version <version_id> [--restart]`

Re-points a server at a modpack version via `archon.servers_v0.reinstall()`
— there is no separate "upstream" endpoint in `@modrinth/api-client`;
reinstalling with a `{project_id, version_id}` body IS how the upstream is
set. `--project` accepts either a project slug or its id: both are resolved
to a canonical id via labrinth `GET /project/:idOrSlug` first. Both
`--project` and `--version` are required (missing either is a usage error,
exit 2). After the reinstall call, the server is read back and the
*resulting* `upstream` is printed — not just an "accepted" flag — so the
command is observably correct. `--restart` follows with a
`power(id, 'Restart')` call after the upstream is set.

```sh
rinth --json servers upstream ff783f0f-ec3c-4037-b39f-452ce590891d \
  --project fabulously-optimized --version AbCdEfGh --restart
```

**JSON shape**:

```json
{
  "id": "ff783f0f-ec3c-4037-b39f-452ce590891d",
  "upstream": { "kind": "modpack", "project_id": "...", "version_id": "AbCdEfGh" },
  "restarted": true
}
```

**Does upstream re-point restart the server?** Neither
[the servers API docs](https://mintlify.wiki/modrinth/code/api/servers) nor
[modrinth-code.mintlify.app](https://modrinth-code.mintlify.app) documents
whether `POST /modrinth/v0/servers/:id/reinstall` restarts the server as
part of reinstalling, or leaves it in whatever power state it was already
in — **the docs simply do not say**, for either a loader or a modpack
reinstall. This environment has no `MODRINTH_TOKEN`, so live behavior
against the real server (`ff783f0f-ec3c-4037-b39f-452ce590891d`) could not
be observed here either. Absent evidence that reinstall self-restarts,
`--restart` is implemented as an explicit, separate `power(id, 'Restart')`
call made *after* the upstream is set, so a caller who passes it gets a
guaranteed bounce onto the new upstream regardless of what `reinstall` does
on its own — the safe default until this is confirmed live one way or the
other (see the code comment above `upstream()` in
`src/commands/servers.ts`).

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

  `servers power`/`servers upstream` integration tests are **destructive**
  (they send real power actions and can re-point a real server's modpack)
  and are gated on a server id in addition to the token: set
  `RINTH_TEST_SERVER_ID` (or `MODRINTH_SERVER_ID`, honored as a fallback
  name for the org variable an operator may already have set). With only
  `MODRINTH_TOKEN` set, they skip cleanly and log why; `servers get` only
  needs the token (it discovers a server id via `servers list` when neither
  variable is set).

  ```sh
  MODRINTH_TOKEN=... RINTH_TEST_SERVER_ID=... bun run test:integration
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
