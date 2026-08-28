# rinth

A Modrinth CLI (servers management + publish) wrapping [`@modrinth/api-client`](https://www.npmjs.com/package/@modrinth/api-client).
One tested surface usable both by a human at a shell and by CI — there is no
official Modrinth CLI.

Status: client core + `whoami`/`servers list` (KAN-726), plus
`servers get|power|upstream` (KAN-728) and `servers exec` (KAN-730), on top
of the scaffold and CI gate stack from KAN-725.

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
to stderr, in both modes; on success, stdout carries exactly one JSON value
and stderr is empty, and on failure stdout is left empty (there was no
result to print) while stderr carries the error — see "Errors under
`--json`" below for that error's exact shape.

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
reinstall. Live behavior could not settle this either — see the blocker
below. Absent evidence that reinstall self-restarts, `--restart` is
implemented as an explicit, separate `power(id, 'Restart')` call made
*after* the upstream is set, so a caller who passes it gets a guaranteed
bounce onto the new upstream regardless of what `reinstall` does on its
own — the safe default until this is confirmed live one way or the other
(see the code comment above `upstream()` in `src/commands/servers.ts`).

**Known live blocker (KAN-735), measured against a real server:** with the
org's `MODRINTH_TOKEN` PAT, `servers list` succeeds (200) but every
per-server endpoint this CLI calls is denied — `get`/`power`/the console
WebSocket auth all return 403 Forbidden with an empty body, while
`upstream`'s `reinstall` call returns 404 Not Found with a small JSON body
(not 403; `resolveProjectId` against labrinth succeeded first, so the 404
is from Archon's `/reinstall` route itself, not project/slug resolution).
This is not fixable by editing the PAT's scopes — labrinth's PAT scope enum
has no `SERVERS_*` scope at all, so per-server access most likely requires
session-level (browser-issued JWT) identity a PAT cannot carry.

Why `reinstall` 404s instead of 403ing like the rest is now confirmed, not
just inferred: the identical request repeated with a deliberately invalid,
never-real token still returned the exact same 404 "not found" — meaning
the router never reaches an auth check for this route at all. Combined with
a nonexistent server id and a second, different real modpack both getting
the same byte-identical 404 (ruling out a pair- or server-specific cause),
this is a router-level 404: **the v0 `/reinstall` route this CLI's
`upstream` command targets does not resolve to anything live, regardless of
credentials, server, or modpack.** (Source research on the `modrinth/code`
frontend independently found no current caller of `servers_v0.reinstall`;
installs there go through a newer `content_v1` API instead — consistent
with the v0 route being retired.) `upstream` is kept as built (it's
`@modrinth/api-client`'s documented call, matching the route the live docs
don't cover either way); migrating it to the v1 content API is a follow-up,
not done here — it would need a world id from a per-server `GET` that is
itself 403, so it couldn't be verified live.

### `rinth servers exec <id> <command...>`

Sends one console command to a server over the Archon WebSocket console API
and prints whatever it prints back for a short window. Everything after
`<id>` is the command, joined with spaces:

```sh
rinth servers exec ff783f0f-ec3c-4037-b39f-452ce590891d say hello world
```

Flow: fetch WebSocket auth for the server, open the console socket,
authenticate, send the command, collect `log`/`log4j` lines for the
collection window, then close the socket. **A command that produces no
output within the window is not an error** — it exits `0` with an empty
line list, since plenty of console commands (e.g. `stop`) never print
anything the console socket forwards back.

**`--wait <ms>`** sets the collection window — how long to keep listening
for output after the command is sent. Defaults to `2000`. Anywhere in the
arguments (`--wait <ms>` may come before or after `<id>`, but not inside the
command itself once past `<id>` unless it's the literal command text):

```sh
rinth servers exec ff783f0f-ec3c-4037-b39f-452ce590891d --wait 5000 list
```

Human mode prints each collected line as it arrives, nothing else.
**JSON shape** — a single object printed once, after the window closes, with
nothing else on stdout while streaming:

```json
{ "id": "ff783f0f-ec3c-4037-b39f-452ce590891d", "command": "say hello world", "lines": ["[Server] hello world"] }
```

The console socket is always closed, on every exit path, including a timed-
out authentication handshake — the command can never hang the process. The
WebSocket auth token (fetched per invocation, short-lived) is registered
with the same redaction path as `MODRINTH_TOKEN` and never appears in output.
### `rinth versions list`

`GET https://api.modrinth.com/v2/project/{idOrSlug}/version` (no auth
required by the API itself, but every rinth command goes through the same
token-requiring real transport). `--loader`/`--game-version` are
repeatable and sent as server-side filters; `--channel` (release/beta/alpha)
is **not** a server-side filter on this endpoint, so it is applied
client-side against the returned `version_type` field. `--limit` is
forwarded to the API client's request and **is honored server-side**
(confirmed empirically — undocumented on the live docs, but real), though
the live labrinth docs do not document a `limit`/`offset` param on this
endpoint at all — see "Notes on live-API behavior" below.

**Caveat: `--limit` is applied before `--channel`.** Because `--limit` is a
server-side page size and `--channel` is a client-side filter applied to
whatever that page contains, combining them can return fewer rows than
you'd expect — or none — even when matching versions exist further down
the project's full version history. For example, `--limit 5 --channel
release` on a project whose 5 most recent versions are all beta/alpha
returns zero rows, even if the project has plenty of release versions
overall. If you need a channel-filtered result, prefer omitting `--limit`
(or set it generously) rather than assuming the two compose like two
independent filters.

```sh
rinth versions list sodium --loader fabric --game-version 1.20.4 --channel release
```

**Human output** — an aligned table:

```
id        version_number  channel  loaders  game versions  date                       primary file
4GyXKCLd  mc1.20.4-0.5.8  release  fabric   1.20.4         2024-02-01T20:33:48.832862Z sodium-fabric-0.5.8+mc1.20.4.jar
```

**`--json`** — the array of version objects, **unmodified API shape** (an
array at the top level, not wrapped in an object):

```json
[
  {
    "id": "4GyXKCLd",
    "project_id": "AANobbMI",
    "version_number": "mc1.20.4-0.5.8",
    "version_type": "release",
    "date_published": "2024-02-01T20:33:48.832862Z",
    "game_versions": ["1.20.4"],
    "loaders": ["fabric"],
    "files": [{ "filename": "sodium-fabric-0.5.8+mc1.20.4.jar", "primary": true, "...": "..." }],
    "...": "..."
  }
]
```

An empty result is not an error: it prints `No versions match.` (or `[]`
in `--json` mode) and exits 0.

### `rinth versions latest`

Same filters as `versions list` **except `--limit`, which is not
supported here** (rejected with a usage error, exit 2) — resolves to a
single version: the newest match by `date_published` (compared as parsed
dates, not response order — see "Notes on live-API behavior" below).
`--limit` is deliberately excluded because it's applied server-side while
`--channel` is applied client-side (see the caveat under `versions list`
above): limiting the candidate set before filtering by channel could
silently return a stale version, or no match at all, instead of the
project's actual newest matching version. Since `versions latest` is what
picks the version id handed to a deploy, that failure mode would be
dangerous to allow silently.

```sh
rinth versions latest sodium --loader fabric --game-version 1.20.4
```

**Human output:**

```
4GyXKCLd  mc1.20.4-0.5.8
```

**`--json`** — a single version object (not an array), same shape as one
element of `versions list`'s array.

No match exits 4 (`ExitCode.NotFound`) with a clear message.

**Notes on live-API behavior** (verified against
[docs.modrinth.com](https://docs.modrinth.com) and a real request against
the `sodium` project):

- The endpoint's documented filters are `loaders`, `game_versions`, and
  `featured`; there is no `version_type`/channel filter, so `--channel` is
  applied client-side. `@modrinth/api-client`'s
  `versions_v2.getProjectVersions()` also accepts `limit`/`offset` in its
  TypeScript types and sends them as query params, but the live docs do
  not document either as supported on this endpoint — this contradicts
  the task's assumption that `--limit` is a plain server-side filter, so
  treat it as best-effort until confirmed otherwise.
- The live response for `sodium` came back already sorted descending by
  `date_published`, but this is not documented behavior, so `versions
  latest` does not rely on response order — it parses and compares
  `date_published` explicitly.

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

Note: for `servers exec`, the console socket rejecting the WebSocket auth
token (`auth-incorrect`) or never confirming it within the internal
authentication timeout both map to exit code 3, the same as a rejected
`MODRINTH_TOKEN` elsewhere. A refused/failed/never-established socket
connection maps to exit code 6 (network error).

### Errors under `--json`

Every API-backed command routes its failures through the same `CliError`,
which — in addition to the exit code above — carries the HTTP status (`null`
for a non-HTTP failure, e.g. a usage error or a socket-level failure) and the
`"<METHOD> <path>"` of the request that failed (`null` when there was none).

- **Plain text** (`--json` not set): the stderr message includes both, e.g.

  ```
  HTTP 403 GET /modrinth/v0/servers/<id>: Forbidden
  ```

  When neither a status nor an endpoint applies (e.g. a usage error), the
  message is unprefixed, as before.

- **`--json`**: on any error, stdout is left empty (there was no result to
  print) and a single JSON value is written to stderr:

  ```json
  {"error":{"code":3,"status":403,"endpoint":"GET /modrinth/v0/servers/<id>","message":"HTTP 403 GET /modrinth/v0/servers/<id>: Forbidden"}}
  ```

  `code` is the process exit code (same table as above); `status` is the raw
  HTTP status or `null`; `endpoint` is `"<METHOD> <path>"` or `null`.

This goes through the same `src/output.ts`/`src/redact.ts` path as every
other write — there is no separate write path to the terminal, and a token
embedded in an error message is scrubbed here exactly as it would be
anywhere else (see `test/unit/cli.test.ts`).

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
