# rinth

A Modrinth CLI (servers management + publish) wrapping [`@modrinth/api-client`](https://www.npmjs.com/package/@modrinth/api-client).
One tested surface usable both by a human at a shell and by CI — there is no
official Modrinth CLI.

Status: v0.9.1. Full command surface: `whoami`; `servers
list|get|power|upstream|exec`; `versions list|latest|delete`; `publish`;
`project get|create|submit|edit|icon`. See "Known gaps / follow-ups" below
for what still doesn't work against the live API.

## Install / run

Pin to a released tag — **not** a branch — so a consumer's install can't
silently change under them:

```sh
bunx --bun github:brooswit-minecraft/rinth#v0.9.1 --help
```

The `--bun` flag is required: it tells `bunx` to run the package's `bin`
entry (`src/cli.ts`) directly under `bun`, not as a Node package. There is
no build step and no committed `dist` — `rinth` runs straight from
TypeScript source under bun.

**GitHub Actions**:

```yaml
- uses: oven-sh/setup-bun@v2
  with:
    bun-version: latest
- run: bunx --bun github:brooswit-minecraft/rinth#v0.9.1 versions latest sodium --loader fabric --json
  env:
    MODRINTH_TOKEN: ${{ secrets.MODRINTH_TOKEN }}
```

Publishing `@brooswit/rinth` to npm is **deferred** (it needs the
maintainer's passkey) — the pinned `bunx --bun github:...#<tag>` install
above is the only supported way to consume `rinth` for now.

For local development:

```sh
bun install
bun run src/cli.ts --help
```

### Fleet install (`brooswit` / `booswrit` / `wroosbit`)

**What these three names actually are:** three separate Unix **user
accounts** (identities), not three separate machines. They are spread
across two physical machines on the same tailnet:

| Account    | Machine                        | Installed?                    |
| ---------- | ------------------------------- | ------------------------------ |
| `wroosbit` | `servyboi`                      | Yes — installed below          |
| `booswrit` | `kchb-thinkpad-x1-carbon-5th`   | Yes — installed below          |
| `brooswit` | `servyboi` **and** `kchb-thinkpad-x1-carbon-5th` | No — see gap below |

Determined by running `hostname`, `whoami`, `ls /home`, and `id` on
`servyboi` as `wroosbit`: its `/home` holds `brooswit` and `wroosbit` only
(no `booswrit`), confirming `wroosbit` and `brooswit` both have accounts on
this box. `tailscale status` lists exactly two machines on the tailnet —
`servyboi` (this box) and `kchb-thinkpad-x1-carbon-5th` — which, combined
with that second box's own `/home` listing (`booswrit`, `brooswit`, no
`wroosbit`, gathered directly on that box by the `booswrit` account itself),
places `booswrit` there and confirms `brooswit` has an account on both
machines.

**Upgrading an existing install? `bun remove -g` FIRST.** Running
`bun install -g "github:...#<newtag>"` over an existing pin of the same
package **silently does nothing**, and reports success while doing it. Both
accounts below were re-pinned from `v0.8.0` to `v0.9.0`, and the first
attempt failed exactly this way:

```
$ bun install -g "github:brooswit-minecraft/rinth#v0.9.0"
installed @brooswit/rinth@github:brooswit-minecraft/rinth#4f11b4d with binaries:
 - rinth
[611.00ms] done
```

Exit 0, and it even names the correct `v0.9.0` commit. But
`~/.bun/install/global/package.json` came out with a **duplicate key** —
the new entry was appended rather than replacing the old one, and the stale
`v0.8.0` entry won resolution:

```json
{
  "dependencies": {
    "@brooswit/rinth": "github:brooswit-minecraft/rinth#v0.8.0",
    "@brooswit/rinth": "github:brooswit-minecraft/rinth#v0.9.0"
  }
}
```

The package left on disk was still `0.8.0`. Remove first:

```sh
bun remove -g @brooswit/rinth   # confirm the manifest entry and ~/.bun/bin/rinth are gone
bun install -g "github:brooswit-minecraft/rinth#v0.9.1"
```

**And check a version-distinguishing flag, not just `--help`.** The two
proofs used below — `rinth --help` and the exit-3 auth check — pass
*identically* on `v0.8.0` and `v0.9.0`, so they would have certified that
failed upgrade. Confirm the manifest has exactly one entry, that
`~/.bun/install/global/node_modules/@brooswit/rinth/package.json` reports
the expected `version`, and that a flag only the new release has is
actually present:

```sh
env -i HOME="$HOME" TERM=xterm /usr/bin/fish -l -c 'rinth versions' 2>&1 | grep -c version-number
```

Note the `2>&1`: `rinth versions` writes its usage string to **stderr**, so
piping stdout alone returns a false-negative `0` while the flag prints in
plain sight. (The flag also appears as `[--version-number <v>]`, so match
the substring rather than splitting on spaces — both of those false
negatives were hit for real while verifying this.)

Both accounts track the current release; the transcripts below were
captured during the `v0.8.0` → `v0.9.0` re-pin, and are reproduced verbatim
because the procedure and the two false negatives they document are
unchanged. The commands show the version to install today.

**Installed on `wroosbit`@`servyboi`:**

```sh
export PATH="$HOME/.bun/bin:$PATH"   # only needed for this one-off install command
bun install -g "github:brooswit-minecraft/rinth#v0.9.1"
```

This resolves the named annotated tag (never a branch) and drops a `rinth` shim, a symlink to the
package's `src/cli.ts`, into `~/.bun/bin`. Chosen over the `bunx --bun`
wrapper-script alternative because it's already how this box installs
sibling tools (e.g. `drovr`) and it was verified to actually run the
TypeScript entrypoint correctly (see verification below) rather than just
exiting 0 — the shim's own `#!/usr/bin/env bun` shebang only resolves if
`bun` itself is also on `PATH`, which the PATH step below guarantees.

**PATH persistence — fish-specific.** The shell here is fish
(`/usr/bin/fish`), and `~/.bun/bin` (needed for both `bun` and `rinth`) was
**not** on the default non-interactive PATH before this change — the same
gap RINTH-1 found on `servyboi`. A `~/.bashrc` edit would not have fixed
this and would have looked like it worked when merely sourced. Fixed with
fish's own persistent mechanism, which writes to the universal
`fish_user_paths` variable (survives across sessions, independent of
`~/.config/fish/config.fish`):

```sh
fish -c 'fish_add_path -m ~/.bun/bin'
```

**Verified from a genuinely fresh fish session with a stripped
environment**, not just `fish -l -c` — a plain `fish -l -c` starts a login
shell but still **inherits `PATH` from its parent process**, so it can pass
even when nothing was actually persisted (a same-session false positive,
caught during review — see the `booswrit`@`kchb-thinkpad-x1-carbon-5th`
verification below, where this exact failure showed up before the fix was
in place). `env -i` strips the environment first, so only what fish itself
resolves (universal variables, `config.fish`) can make the command succeed:

```
$ env -i HOME="$HOME" TERM=xterm /usr/bin/fish -l -c 'rinth --help; echo "EXIT=$status"'
rinth — a Modrinth CLI

Usage: rinth [--json] <command> [args]
EXIT=0
```

```
$ env -i HOME="$HOME" TERM=xterm /usr/bin/fish -l -c 'rinth whoami; echo "EXIT_STATUS=$status"'
MODRINTH_TOKEN is not set. Set it with: export MODRINTH_TOKEN=<your Modrinth API token>
EXIT_STATUS=3
```

And the version-distinguishing check, which is what actually proves the
re-pin landed rather than merely that some `rinth` resolved:

```
$ env -i HOME="$HOME" TERM=xterm /usr/bin/fish -l -c 'rinth versions' 2>&1 | grep -c version-number
1
```

No `MODRINTH_TOKEN` is set in `wroosbit`@`servyboi`'s environment, so the
auth-check failure above (exit 3, naming `MODRINTH_TOKEN`) is the strongest
available proof on this box — it confirms the real binary resolved from
`PATH` and ran its own code. No stronger `whoami --json` proof was
available or attempted here.

**Installed on `booswrit`@`kchb-thinkpad-x1-carbon-5th`:**

`servyboi` cannot reach this machine at all — see the `brooswit` gap below —
so this install was performed and verified by the `booswrit` account
directly, on that box, using the identical mechanism and tag:

```sh
bun install -g "github:brooswit-minecraft/rinth#v0.9.1"
```

```
installed @brooswit/rinth@github:brooswit-minecraft/rinth#<tag object> with binaries:
 - rinth
```

Pinned to the same tag, recorded literally in
`~/.bun/install/global/package.json`:

```json
{ "dependencies": { "@brooswit/rinth": "github:brooswit-minecraft/rinth#v0.9.1" } }
```

PATH persistence needed the same fish fix (`fish_user_paths` was empty on
this box too):

```sh
fish -c 'fish_add_path -m ~/.bun/bin'
```

Verified from a fresh fish login shell with a stripped environment (`env
-i`, per the methodology note above — a plain `fish -l -c` on this box
initially returned a false positive by inheriting `PATH` from the parent
shell before `fish_add_path` had actually run):

```
$ env -i HOME="$HOME" TERM=xterm /usr/bin/fish -l -c 'rinth --help; echo "EXIT=$status"'
rinth — a Modrinth CLI

Usage: rinth [--json] <command> [args]
EXIT=0

$ env -i HOME="$HOME" TERM=xterm /usr/bin/fish -l -c 'rinth whoami; echo "EXIT_STATUS=$status"'
MODRINTH_TOKEN is not set. Set it with: export MODRINTH_TOKEN=<your Modrinth API token>
EXIT_STATUS=3
```

And the same version-distinguishing check:

```
$ env -i HOME="$HOME" TERM=xterm /usr/bin/fish -l -c 'rinth versions'
Usage: rinth versions <list|latest|delete> <project|version_id> [--loader <l>]
[--game-version <gv>] [--channel release|beta|alpha] [--version-number <v>]
[--limit <n>] [latest only: --wait <seconds> [--wait-interval <seconds>]]
```

No `MODRINTH_TOKEN` is set on this box either (`env | grep -i MODRINTH`
empty), so exit-3 is likewise the strongest proof available here.

**Gap — `brooswit` could not be installed, on either machine:**

`brooswit` has an account on both `servyboi` and
`kchb-thinkpad-x1-carbon-5th`, but neither account running an install here
(`wroosbit` or `booswrit`) can become it:

- **`brooswit`@`servyboi`**: `/home/brooswit` exists but is
  `drwxr-x---`, owned by `brooswit:brooswit` — `wroosbit` has no read/write
  access to it. `wroosbit` has `sudo` group membership, but
  `sudo -n -u brooswit whoami` fails with "a password is required"; no
  password is available in this environment, and guessing or otherwise
  obtaining one is out of scope.
- **`brooswit`@`kchb-thinkpad-x1-carbon-5th`**: same `drwxr-x---` home
  directory, and `booswrit` is not even in the `sudo` group there
  (`id -nG` → `booswrit`) — there is no sudo path to try at all on that
  box.

**Unblocked by:** the `brooswit` account's own credentials (run the install
as `brooswit` directly, on either machine), or an admin granting the
relevant account passwordless `sudo` for `brooswit`.

**On `booswrit`@`kchb-thinkpad-x1-carbon-5th` being unreachable from
`servyboi`:** this is a statement about what `servyboi` can reach, not
about whether the account is installable at all — as the install above
demonstrates, it needed a session running directly on that box, not SSH
access from here. Both a direct SSH attempt and `tailscale ssh` from
`servyboi` were refused at the TCP level (no `sshd` listening there):

```
$ ssh -o BatchMode=yes booswrit@kchb-thinkpad-x1-carbon-5th "hostname"
ssh: connect to host kchb-thinkpad-x1-carbon-5th port 22: Connection refused

$ tailscale ssh kchb-thinkpad-x1-carbon-5th "hostname"
Dial(...): dial tcp 100.99.162.116:22: connect: connection refused
```

No task agent running on `servyboi` can bridge that gap — there is no
`sshd` on the other box to reach — which is exactly why this install had to
be performed by a session already running there.

## Releasing

**The README's install literals are bumped IN the release PR, naming the
version that PR is about to become.** A version literal is only correct at
its own tag if it names that tag — and a tag's README is immutable, so a
"repin main afterwards" fix cannot reach the reader who pinned a tag and
read the docs there, which is exactly the behaviour the install contract
above asks for.

This was learned the hard way: `v0.8.0`'s README told readers to install
`v0.5.0`, and `v0.9.0`'s tells them to install `v0.8.0`. Repinning `main`
after tagging fixes the repo front page and abandons the careful reader.

One PR, in this order:

1. Bump `version` in `package.json`.
2. Add the matching `## [x.y.z]` heading to `CHANGELOG.md` (CI enforces this
   — see "Changelog / version gate").
3. Repin **every install literal in this README** to `#vx.y.z` — the version
   this PR is about to become, not the one currently released. `grep -n
   'rinth#v' README.md` finds them.
4. Merge.
5. Tag the merge commit `vx.y.z` and push the tag.

**Never re-point a published tag.** This README's install contract promises
that a pinned tag cannot change under a consumer; moving one would break
precisely the guarantee this tool exists to keep. A published tag with
stale embedded docs is fixed by cutting the next patch release, never by
re-cutting the old one.

Historical transcripts and incident write-ups elsewhere in this file keep
the version they actually happened at — step 3 covers install
*instructions*, not the record of what once occurred.

## Authentication

Set `MODRINTH_TOKEN` in the environment. **The token is read from this env
var only — there is no `--token` flag**, so it never ends up in shell
history, process listings, or CI logs by accident.

```sh
export MODRINTH_TOKEN=...
rinth servers list
```

### Authentication — what a token can and cannot do

Verified against the `modrinth/code` frontend/backend @ `0ab9100` and
`@modrinth/api-client` 0.60.0 (source: KAN-714 comments 14588/14622):

- A labrinth PAT (`mrp_...`) **works** for every labrinth route this CLI
  calls — `whoami`, `versions list/latest`, `publish` (given the relevant
  PAT scopes) — and for the Archon **`servers list`** route.
- A PAT **does not work** for per-server Archon routes (`servers
  get`/`power`/`exec`): they return HTTP 403. This is an identity wall,
  not a missing scope — labrinth's PAT scope enum has no
  servers/archon/hosting scope at all (verified in `models/v3/pats.rs`:
  `SHARED_INSTANCE` scopes exist; no `SERVER`/`ARCHON`/`PYRO` scope
  matches anything). The web panel authenticates to Archon with the
  user's browser *session* token (`mra_...`) instead, which is not a
  CI-appropriate credential, and there is no endpoint that exchanges a
  PAT for one.
- The v0 `POST /servers/{id}/reinstall` route that `servers upstream`
  targets is dead at the router: a deliberately invalid token gets 401 on
  `GET /servers` but 404 on `reinstall`, proving the 404 is
  route-not-found, independent of credentials (KAN-735, run
  33203716833).
- Archon requires an `X-Panel-Version: 1` header on every request; a
  request missing it gets HTTP 426 *before* auth is even evaluated — see
  "Exit codes" below.

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

## From curl to rinth

Six hand-rolled `curl` calls a project maintainer has typed to manage a
Modrinth project — replaced one-for-one by a `rinth` command below. Every
`rinth` invocation's flags are exactly what its own `Usage:` string accepts
(see the linked sections below for the full reference); this is a pitch for
the shape of the replacement, not the reference itself. `$MODRINTH_TOKEN`
is never written as a literal — see "Authentication" above.

**Create a project** — see "[`rinth project
create`](#rinth-project-create)":

```sh
curl -X POST https://api.modrinth.com/v2/project \
  -H "Authorization: $MODRINTH_TOKEN" \
  -F 'data={"slug":"my-mod","title":"My Mod","description":"A short one-liner","body":"...","project_type":"mod","categories":[],"client_side":"required","server_side":"optional","license_id":"MIT","is_draft":true,"initial_versions":[]};type=application/json'
```
```sh
rinth project create --slug my-mod --title "My Mod" --description "A short one-liner" \
  --body-file DESCRIPTION.md --project-type mod \
  --client-side required --server-side optional --license MIT
```

`--slug --title --description`, one of `--body`/`--body-file`,
`--project-type`, `--client-side`, `--server-side`, and `--license` are all
**required** — `rinth` refuses (exit 2) to build the near-empty draft a bare
`{"project_type":"mod"}` would let the raw API accept. `is_draft: true` and
`initial_versions: []` are constants this command supplies itself, same as
the multipart `data` part above; there is no icon part in either — see
`rinth project icon` below for that.

**Edit project metadata** — see "[`rinth project
edit`](#rinth-project-edit-idorslug)":

```sh
curl -X PATCH https://api.modrinth.com/v2/project/my-mod \
  -H "Authorization: $MODRINTH_TOKEN" -H "Content-Type: application/json" \
  -d '{"description":"New one-liner","categories":["technology"]}'
```
```sh
rinth project edit my-mod --description "New one-liner" --category technology
```

Both send the exact same sparse PATCH body — only the flags you pass. **A
repeated `--category` replaces the whole category list; it does not
append**, same as the raw PATCH body above replaces whatever `categories`
already held.

**Read a project, including a DRAFT one** — see "[`rinth project
get`](#rinth-project-get-idorslug)":

```sh
curl https://api.modrinth.com/v2/project/my-draft-mod \
  -H "Authorization: $MODRINTH_TOKEN"
```
```sh
rinth project get my-draft-mod
```

This is the pair where a hand-typed curl most often goes wrong: a bare `GET`
doesn't *feel* like it needs auth, so it's easy to leave the header off —
and a draft this identity can't see 404s byte-identically to a project that
doesn't exist at all (see "404 diagnosis" below), so a dropped header reads
as "no such project," not "forgot to authenticate." `rinth` always sends
`MODRINTH_TOKEN` on every request, including reads, so this class of mistake
can't happen.

**Delete a version** — see "[`rinth versions
delete`](#rinth-versions-delete-version_id)":

```sh
curl -X DELETE https://api.modrinth.com/v2/version/V2Ec5Q1w \
  -H "Authorization: $MODRINTH_TOKEN"
```
```sh
rinth versions delete V2Ec5Q1w
```

The live API returns 404 on this route even when the delete *succeeded* —
`rinth` reads the version back after the call and reports success only when
it's actually gone, regardless of what the `DELETE` itself returned.

**Submit a project for review (draft → processing)** — see "[`rinth project
submit`](#rinth-project-submit-idorslug)":

```sh
curl -X PATCH https://api.modrinth.com/v2/project/my-draft-mod \
  -H "Authorization: $MODRINTH_TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"processing"}'
```
```sh
rinth project submit my-draft-mod
```

`rinth` refuses by name, before ever PATCHing, if the project isn't
`draft`/`rejected` or has no versions yet — and reads the project back
afterward to confirm status actually landed on `processing`, not merely
that it changed.

**Upload a project icon** — see "[`rinth project
icon`](#rinth-project-icon-idorslug---file-path)":

```sh
curl -X PATCH "https://api.modrinth.com/v2/project/my-draft-mod/icon?ext=png" \
  -H "Authorization: $MODRINTH_TOKEN" -H "Content-Type: image/png" \
  --data-binary @icon.png
```
```sh
rinth project icon my-draft-mod --file icon.png
```

The extension goes in the query string, not the filename or a form field —
`rinth` infers it from `--file`'s extension so you never write `?ext=`
yourself. Both sides send the raw image bytes as the body, never multipart.

## Commands

### `rinth whoami`

`GET https://api.modrinth.com/v2/user` (Bearer token). Prints the
authenticated user.

**JSON shape** — the raw Modrinth user object:

```json
{ "id": "...", "username": "...", "name": "...", "email": "...", "role": "developer", "badges": 0, "created": "..." }
```

**Caution:** the raw object includes your account's `email`. Do not print
`whoami --json` unfiltered into a shared CI log — pipe it through `jq
'{id, username}'` if you only need identity:

```sh
rinth whoami --json | jq '{id, username}'
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

This 404 and these 403s no longer reach a caller as bare API strings: see
"`servers` diagnosis" below for the two sibling messages/`reason` values
(`"servers_upstream_route_dead"`, `"servers_credential_refused"`) that
`servers upstream`/`get`/`power`/`exec` now produce instead, and "Known
gaps / follow-ups" for the production evidence (sickos run `33322343392`)
that this is a live, ongoing breakage for a real caller, not just this
research.

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

### `rinth project get <idOrSlug>`

`GET https://api.modrinth.com/v2/project/{idOrSlug}` with the Bearer token
**always attached** — unlike a hand-rolled unauthenticated `curl`, this
resolves a **DRAFT** project the token's identity can see. The live API
404s a draft project to an unauthenticated read, byte-identical to a 404 for
a project that doesn't exist at all — see "Authentication" above and "404
diagnosis" below. A residual 404 (no such project, or a draft this identity
can't see) is diagnosed rather than surfaced bare.

```sh
rinth project get my-draft-modpack
```

**Human output** — a readable summary:

```
My Draft Modpack (AbCdEfGh)
  slug:          my-draft-modpack
  status:        draft
  project_type:  modpack
  client_side:   required
  server_side:   optional
  categories:    technology, utility
  license:       MIT (MIT License)
  source_url:    https://github.com/example/my-draft-modpack
  issues_url:    none
```

**`--json`** — the raw project object, unmodified API shape:

```json
{ "id": "AbCdEfGh", "slug": "my-draft-modpack", "status": "draft", "...": "..." }
```

### `rinth project edit <idOrSlug>`

```
rinth project edit <idOrSlug>
  [--description <text>] [--body <text> | --body-file <path>]
  [--client-side required|optional|unsupported]
  [--server-side required|optional|unsupported]
  [--source-url <url>] [--issues-url <url>]
  [--license <id>] [--license-url <url>]
  [--category <c>]...
```

A **SPARSE** `PATCH https://api.modrinth.com/v2/project/{idOrSlug}`: sends
only the fields you actually pass, and never anything else. This command
never reads the project first to build a full object and PATCH that — doing
so would silently clobber every field you didn't mention, which is the
worst possible failure mode for an "edit" command. Passing **no** editable
flag is a usage error (exit 2), not a no-op PATCH.

`--body`/`--body-file` are mutually exclusive (exit 2 if both are given),
matching `publish`'s `--changelog`/`--changelog-file`; a nonexistent
`--body-file` is a usage error (exit 2).

**⚠️ `--category` is repeatable and REPLACES the whole category list — it
does not append.** `--category technology --category utility` sets the
project's categories to exactly `["technology", "utility"]`, discarding
whatever categories it had before. If you only mean to add one category to
an existing list, you must pass every category you want to keep, every
time. There is no `--add-category`/`--remove-category`.

The live API's **write** shape differs from the shape `project get` reads
back: license is two flat fields here (`license_id`, `license_url`), not
the nested `license: {id, name, url}` object a read returns — confirmed
against
[docs.modrinth.com's "Modify a project"](https://docs.modrinth.com/api/operations/modifyproject/)
(fetched directly). `--license`/`--license-url` map onto exactly those two
write fields.

```sh
rinth project edit my-draft-modpack --description "A better one-liner" --category technology --category utility
```

**VERIFY BY READ-BACK.** After the `PATCH`, this reads the project back
(`project get`'s same authenticated path) and never trusts the `PATCH`'s
own status code. If a field you asked to change did NOT change in the
read-back, that's a genuine failure — **exit 5 (`ApiError`)**, message in
the same "X did not take effect" shape `versions delete` uses for its own
read-back check, plus `reason: "update_not_landed"` under `--json`:

```
Update did not take effect: description is still "Old one-liner" (expected "A better one-liner").
```

`categories` is compared order-insensitively (it's a set from the
operator's point of view; the API is not guaranteed to echo the same order
back), every other field is compared exactly.

**`--json`** on success prints the resulting project object, unmodified API
shape (same as `project get --json`). Human mode prints only the fields
that changed:

```
Updated project My Draft Modpack (AbCdEfGh). Changed fields:
  description:  A better one-liner
  categories:   technology, utility
```

Like every command here, this resolves a **DRAFT** project via the
authenticated path (see "Authentication" above), and a residual 404 (either
from the `PATCH` itself or from the read-back) is diagnosed rather than
surfaced bare — see "404 diagnosis" below.

### `rinth project icon <idOrSlug> --file <path>`

```sh
rinth project icon my-draft-modpack --file assets/icon.png
```

Uploads a project icon: `PATCH
https://api.modrinth.com/v2/project/{idOrSlug}/icon?ext=<ext>` with the
**raw image bytes** as the request body (not multipart). **Confirmed from
labrinth's published server source** —
[`apps/labrinth/src/routes/v3/projects.rs:2076`](https://github.com/modrinth/code/blob/main/apps/labrinth/src/routes/v3/projects.rs#L2076)'s
`#[patch("/{id}/icon")] pub async fn project_icon_edit(web::Query(ext):
web::Query<Extension>, ..., payload: web::Payload, ...)` — `ext` is a query
param and the handler reads the body as a raw `web::Payload`, not a
multipart form, exactly what this command sends. This upgrades the
evidence from "the published docs say" to "labrinth's server source
shows" — it does **not** make it live-verified: **not exercised against a
live authenticated call**, since there is no `MODRINTH_TOKEN` in this
development environment; see "Known gaps / follow-ups" below and the PR
body for the full account of what was and wasn't confirmed.

The extension is inferred from `--file`'s path (case-insensitive). Accepted
extensions (and the `Content-Type` sent with each):

| Extension | Content-Type |
| --------- | ------------ |
| `png` | `image/png` |
| `jpg`, `jpeg` | `image/jpeg` |
| `bmp` | `image/bmp` |
| `gif` | `image/gif` |
| `webp` | `image/webp` |

**Reconciled against the server source, which is narrower than the live
docs this table used to cite.** labrinth's own extension→`Content-Type`
mapping —
[`apps/labrinth/src/util/ext.rs:3-11`](https://github.com/modrinth/code/blob/main/apps/labrinth/src/util/ext.rs#L3-L11)'s
`get_image_content_type()`, the function
[`apps/labrinth/src/util/img.rs:57`](https://github.com/modrinth/code/blob/main/apps/labrinth/src/util/img.rs#L57)'s
`upload_image_optimized()` calls to validate `ext` before ever touching the
uploaded bytes — matches only `bmp`, `gif`, `jpeg`/`jpg`, `png`, and `webp`;
anything else is rejected with `invalid format for image: <ext>` before
upload. The docs-sourced table this replaced also listed `svg`, `svgz`, and
`rgb`; the server source shows those three are **not** accepted by this
route today — `get_image_content_type()`'s match falls through to `None`
for all three, which the caller turns into that same rejection. This
command's own accepted-extension list (`ICON_CONTENT_TYPES` in
`src/client/index.ts`) still includes `svg`/`svgz`/`rgb` from the
docs-sourced reading; that mismatch is real and is not fixed here (a
behavior change, out of scope for a docs-only evidence upgrade) — treat the
table above, not `ICON_CONTENT_TYPES`, as the accurate list until that's
reconciled in code.

An unsupported extension is a usage error (exit 2) naming every extension
`ICON_CONTENT_TYPES` accepts (currently the broader, docs-sourced list —
see the reconciliation note above); a missing or nonexistent `--file` is
also a usage error (exit 2), matching `publish --file`. **Size cap,
confirmed from the server source**:
[`apps/labrinth/src/routes/v3/projects.rs:2172-2176`](https://github.com/modrinth/code/blob/main/apps/labrinth/src/routes/v3/projects.rs#L2172-L2176)
reads the request body through `read_limited_from_payload(&mut payload,
262144, "Icons must be smaller than 256KiB")` — a hard 262144-byte
(256KiB) cap enforced server-side, matching what the live docs already
said. This command does not pre-check the size client-side — an oversized
file surfaces as whatever error labrinth returns for it.

**VERIFY BY READ-BACK.** Since there is no meaningful way to predict the
new `icon_url` client-side, this reads the project back **both before and
after** the upload and compares: a 2xx response that leaves `icon_url`
unchanged is a genuine failure — **exit 5 (`ApiError`)**, `reason:
"icon_not_landed"` under `--json`:

```
Icon upload did not take effect: icon_url is still "https://cdn.modrinth.com/data/AbCdEfGh/icon.png" after PATCH.
```

**`--json`** on success:

```json
{ "id": "AbCdEfGh", "icon_url": "https://cdn.modrinth.com/data/AbCdEfGh/9f8e7d6c.png" }
```

Human mode: `Updated icon for My Draft Modpack (AbCdEfGh): https://cdn.modrinth.com/data/AbCdEfGh/9f8e7d6c.png`.

Resolves a **DRAFT** project via the authenticated path like every other
command here; a 404 from the pre-flight read, the upload itself, or the
read-back is diagnosed rather than surfaced bare.

**Upload path** (see `src/client/real.ts` for the full account): the same
reason `publish`'s `Transport#createVersion` uses a raw `fetch` applies
here — `GenericModrinthClient extends XHRUploadClient`, whose `upload()`
constructs a `new XMLHttpRequest()`, undefined under Bun. The vendored
`@modrinth/api-client` 0.60.0 has no v2 icon method at all to fall back on
(only a v3-only `projects_v3.changeIcon()`, which itself still routes
through that same broken `upload()`), so `Transport#uploadProjectIcon` uses
a single raw `fetch`: the same Bearer token, User-Agent, and
`X-Panel-Version` header every other raw-fetch transport method in this
file carries.

**Integration test**: `test/integration/project-icon.integration.test.ts`
is gated on `RINTH_TEST_PROJECT` on top of the usual `MODRINTH_TOKEN` gate
(the same double-gate `publish`/`versions delete` use) and skips cleanly,
logging why, when unset. If it runs, it uploads a throwaway 1x1 PNG and
restores the project's original icon afterward (downloading the original
bytes first, if it had one).
### `rinth project create`

```
rinth project create --slug <slug> --title <title> --description <text>
  (--body <text> | --body-file <path>) --project-type mod|modpack
  --client-side required|optional|unsupported --server-side required|optional|unsupported
  --license <license_id> [--category <c>]... [--license-url <url>]
  [--source-url <url>] [--issues-url <url>] [--dry-run]
```

`POST https://api.modrinth.com/v2/project` (multipart: a JSON `data` part
plus an OPTIONAL icon part this command never sends — `project icon`, a
separate command, owns icon upload). Every project created this way is born
a **DRAFT**: `is_draft: true` and `initial_versions: []` are constants this
command supplies itself, not user-facing flags.

**Required-field verification, and why the enforced set is broader than the
schema's own**: confirmed from the OpenAPI spec at docs.modrinth.com ("Create
a project") — **not exercised live, no `MODRINTH_TOKEN` in the agent
environment**. The spec's own `required` array for this endpoint's `data`
schema names only `project_type`; every other field, including `slug` and
`title`, is schema-optional. Enforcing only that would let `rinth project
create` produce a technically valid but useless draft (no title, no slug, no
license) and defer the real problem to an opaque API error later. So this
command requires, as a CLI-level product decision layered on top of the
verified schema fact (not a claim that the API itself rejects the narrower
set): `--slug`, `--title`, `--description`, `--body`/`--body-file`,
`--project-type`, `--client-side`, `--server-side`, `--license`. Each
missing required flag is a usage error (exit 2) naming that flag, e.g.:

```
Usage: --title is required
```

`--category` is repeatable and optional, defaulting to `[]`. `--license-url`,
`--source-url`, `--issues-url` are optional.

**`--project-type` accepts only `mod` or `modpack`** — also confirmed from
the same OpenAPI spec. This is narrower than it might look: labrinth's v2
`Project.project_type` response field can show `resourcepack`/`shader`/
`plugin`/`datapack`/`project`, but those are *derived display types* (from a
project's loaders/categories), not values `POST /project` accepts as input.
An invalid value is a usage error (exit 2) naming the two accepted values,
the same pattern `rinth publish`'s `--channel` uses. `--client-side`/
`--server-side` are validated the same way against `required`/`optional`/
`unsupported`.

`--body`/`--body-file` are mutually exclusive (exit 2 if both are given, exit
2 with a clear message if `--body-file` doesn't exist) — identical discipline
to `rinth publish`'s `--changelog`/`--changelog-file`.

```sh
rinth project create --slug my-draft-mod --title "My Draft Mod" \
  --description "A short summary" --body-file README.md \
  --project-type mod --category technology \
  --client-side required --server-side unsupported --license MIT
```

**Human output** — the created project's id, slug, and Modrinth URL:

```
AbCdEfGh  my-draft-mod  https://modrinth.com/project/my-draft-mod
```

**`--json`** — the created project object, unmodified API shape (same
discipline as `rinth publish`'s `--json`).

**`--dry-run`** prints the exact `{ "data": ... }` payload that would be
sent, exits 0, and sends nothing — **without requiring `MODRINTH_TOKEN`**,
matching `rinth publish --dry-run`'s contract. Unlike `publish --dry-run`
(which can't resolve a project identifier without a network call), there is
nothing left unresolved here: every field comes straight from the flags/
files already read, so the printed payload is exactly what would be sent.
This works because the `--dry-run` branch returns before ever reading
`ctx.transport` — see `src/cli.ts`'s lazy transport construction.

```sh
$ rinth project create --slug my-draft-mod --title "My Draft Mod" \
    --description "A short summary" --body "Long description" \
    --project-type mod --client-side required --server-side unsupported \
    --license MIT --dry-run
{
  "data": {
    "title": "My Draft Mod",
    "project_type": "mod",
    "slug": "my-draft-mod",
    "description": "A short summary",
    "body": "Long description",
    "categories": [],
    "client_side": "required",
    "server_side": "unsupported",
    "license_id": "MIT",
    "is_draft": true,
    "initial_versions": []
  }
}
```

**Icon upload**: an icon part is optional on this route and this command
never sends one — `rinth project icon` (a separate command) owns icon
upload. The multipart body builder (`buildCreateProjectFormData` in
`src/client/real.ts`) already accepts an optional icon file so a future
caller can add one without restructuring it.

**Upload path**: like `rinth publish`, this can't go through
`@modrinth/api-client`'s own upload support under Bun (`XMLHttpRequest is
not defined` — see "Upload path" under `rinth publish` below for the full
account), so `Transport#createProject` uses a single raw `fetch`, same
Bearer/User-Agent/`X-Panel-Version` headers, still mapped through
`toCliError()`.

**Integration test**: `test/integration/project-create.integration.test.ts`
is gated on `MODRINTH_TOKEN` **and** `RINTH_TEST_CREATE_PROJECT` (a second,
explicit opt-in — this test creates a real project, unlike a read) and skips
cleanly, logging why, when either is unset. If it runs, it creates a real
throwaway draft project and deletes it afterward via
`client.labrinth.projects_v2.delete()` directly (`Transport` deliberately has
no `deleteProject` method, since no rinth command needs one — same pattern as
`publish.integration.test.ts`'s version cleanup).

### `rinth project submit <idOrSlug>`

Moves a project out of `draft` via `PATCH https://api.modrinth.com/v2/project/{idOrSlug}`.
The discipline, non-negotiable: **read first**, refuse a non-submittable
state **by name**, PATCH, **read the project back**, and verify the
*intended* outcome — not merely *an* outcome. The read-back checks
`after.status !== "processing"` (what this command's PATCH actually asked
for), not just "did status change at all": a moderator changing the
project's status between the read-first and the read-back would otherwise
report a false success (status did change — just not to what was
requested). A read-back that isn't `processing` is reported as a
**failure**, not a success, naming what it actually became. This is the
same "verify the intended outcome" discipline `rinth project edit`'s
`staleFields()` applies to each patched field, applied here to the one
field this command patches; `rinth versions delete` and `rinth servers
upstream` establish the underlying "never trust a write's own status code"
half of it (see their sections above).

```sh
rinth project submit my-draft-mod
```

**Submittable statuses**: `draft` and `rejected` (a rejected project can be
fixed and resubmitted). Confirmed from labrinth's published server source —
[`apps/labrinth/src/models/v3/projects.rs:559`](https://github.com/modrinth/code/blob/main/apps/labrinth/src/models/v3/projects.rs#L559)'s
`is_approved()`, which matches only `Approved|Archived|Unlisted|Private` —
`Rejected` is not among them, so it passes the same non-approved guard a
draft does — **not exercised live**, but this is server source, not an
inference from the OpenAPI document. Submitting anything else is refused
with a non-zero exit (5, `ApiError`) naming the actual state:

```
Project my-draft-mod is not submittable: its status is currently 'processing'. Only a 'draft' or 'rejected' project can be submitted for review.
```

**Why the PATCH body is `{ "status": "processing" }`, not `{
"requested_status": "approved" }`**: an earlier revision of this command
sent `requested_status` instead, on a spec-only reading — the OpenAPI
document's `requested_status` enum (`approved|archived|unlisted|private|draft`)
excludes `processing`, which looked like proof that `status` couldn't be set
directly. Reading labrinth's actual server source corrected this: there are
two independent branches in
[`apps/labrinth/src/routes/v3/projects.rs`](https://github.com/modrinth/code/blob/main/apps/labrinth/src/routes/v3/projects.rs).
The `requested_status` branch
([line 801](https://github.com/modrinth/code/blob/main/apps/labrinth/src/routes/v3/projects.rs#L801))
is validated against `can_be_requested()`
([`apps/labrinth/src/models/v3/projects.rs:570`](https://github.com/modrinth/code/blob/main/apps/labrinth/src/models/v3/projects.rs#L570)
— the `ProjectStatus` overload; a distinct `VersionStatus` one exists at
`:957`, not this one — which does exclude `processing`) and writes *only*
that column, never touching `status`. `status` is validated by a separate
permission check
([line 581](https://github.com/modrinth/code/blob/main/apps/labrinth/src/routes/v3/projects.rs#L581)) —
`!project.status.is_approved() && status == Processing` — that explicitly
allows an ordinary, non-moderator user to set `Processing` on a project
that isn't yet approved. That second branch is the one that actually
performs the submit-for-review transition. `processing` being excluded from
`requested_status` meant it was settable only through the *other* branch,
not that it was unsettable — a correct premise, but an inference that
missed a branch. This is confirmed from labrinth's server source (stronger
evidence than the OpenAPI spec, though still not a live round-trip — no
`MODRINTH_TOKEN` in the agent environment), so the read-back still doesn't
lean on that confirmation alone: it requires that `status` actually became
`processing` — the value this PATCH asked for — not merely that it changed
from what it was before.

**No-versions hazard, confirmed real and enforced as a pre-flight refusal**:
[`apps/labrinth/src/routes/v3/projects.rs:616`](https://github.com/modrinth/code/blob/main/apps/labrinth/src/routes/v3/projects.rs#L616)
refuses exactly the draft/rejected -> `processing` transition this command
performs when the project has no versions (`"Project submitted for review
with no initial versions"`). Since this is the most likely real-world path
through `project create` immediately followed by `project submit`, `rinth
project submit` checks `versions` on the already-fetched project (no extra
request) and refuses by name *before* ever PATCHing:

```
Project my-draft-mod cannot be submitted for review: it has no versions. Publish at least one version first (see `rinth publish`).
```

`reason: "no_versions"` in the `--json` error shape.

**`--json`** on success:

```json
{ "id": "AbCdEfGh", "slug": "my-draft-mod", "status": "processing" }
```

Human mode prints one line naming the before/after status:

```
Submitted my-draft-mod for review: draft -> processing.
```

On failure, the standard `--json` error shape (see "Errors under `--json`"
below); the not-submittable and read-back-unverified failures carry
`reason: "not_submittable"` and `reason: "submit_unverified"` respectively.

**PATCH route used**: `client.labrinth.projects_v2.edit(idOrSlug, patch)` —
confirmed (by reading `node_modules/@modrinth/api-client/dist/index.js`) to
be a typed method that calls `client.request()` with `method: "PATCH"`, so
this goes through the same `call()`/`toCliError()` pipeline as `getProject`
rather than a raw `fetch`. `Transport#updateProject(idOrSlug, patch:
Record<string, unknown>): Promise<void>` is a general, sparse-patch method —
shared with `rinth project edit` — that resolves `void`, never the updated
project: the live API's own write response is never trustworthy on its own
(see `rinth versions delete`'s 404-on-success quirk), so every caller must
read the resource back to learn what actually happened.

**Draft visibility**: like `rinth project get`, both `create`'s implicit
read-back-free write and `submit`'s read/read-back go through the
authenticated path (`Transport#getProject` always sends the Bearer token),
so a draft the token's identity owns resolves correctly; a residual 404 on
either read is routed through `diagnoseNotFound` (see "404 diagnosis"
below) — never a bare "not found".

**Integration test**: `test/integration/project-submit.integration.test.ts`
is gated on `MODRINTH_TOKEN` only and exercises the **refusal path** live,
against a real, public, already-`approved` project (`sodium`) — it asserts
`submit` refuses by name and never attempts a write, so nothing is at risk
and nothing needs cleanup. The **success path** (draft -> processing) is
deliberately not exercised live anywhere in this suite: submitting a real
project enters Modrinth's human moderation queue, a side effect on a third
party that — unlike a throwaway draft or version — a delete-afterward
pattern cannot undo. See "Known gaps / follow-ups".

### `rinth versions list`

`GET https://api.modrinth.com/v2/project/{idOrSlug}/version` (no auth
required by the API itself, but every rinth command goes through the same
token-requiring real transport). `--loader`/`--game-version` are
repeatable and sent as server-side filters; `--channel` (release/beta/alpha)
and `--version-number <v>` are **not** server-side filters on this
endpoint, so both are applied client-side — `--channel` against the
returned `version_type` field, `--version-number` against `version_number`
via exact, case-sensitive string equality (no prefix match, no semver
range). `--limit` is forwarded to the API client's request and **is
honored server-side** (confirmed empirically — undocumented on the live
docs, but real), though the live labrinth docs do not document a
`limit`/`offset` param on this endpoint at all — see "Notes on live-API
behavior" below.

**Caveat: `--limit` is applied before `--channel`/`--version-number`.**
Because `--limit` is a server-side page size and `--channel`/
`--version-number` are client-side filters applied to whatever that page
contains, combining them can return fewer rows than you'd expect — or
none — even when matching versions exist further down the project's full
version history. For example, `--limit 5 --channel release` on a project
whose 5 most recent versions are all beta/alpha returns zero rows, even if
the project has plenty of release versions overall; the same hazard
applies to `--limit 5 --version-number 1.2.3` if the matching version
isn't among the 5 most recent. If you need a channel- or
version-number-filtered result, prefer omitting `--limit` (or set it
generously) rather than assuming these compose like independent filters.

```sh
rinth versions list sodium --loader fabric --game-version 1.20.4 --channel release
rinth versions list sodium --version-number 1.2.3
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
`--channel`/`--version-number` are applied client-side (see the caveat
under `versions list` above): limiting the candidate set before filtering
by channel or version number could silently return a stale version, or no
match at all, instead of the project's actual newest matching version.
Since `versions latest` is what picks the version id handed to a deploy,
that failure mode would be dangerous to allow silently.

`--version-number <v>` matches a version's `version_number` by exact,
case-sensitive string equality — not a prefix, not a semver range. It
carries the same client-side caveat as `--channel`: since it's applied
client-side, it composes cleanly with `--channel`/`--loader`/
`--game-version` (all client- or server-side filters narrow the same
candidate set), but never with `--limit`, which is why `--limit` stays
disallowed here.

```sh
rinth versions latest sodium --loader fabric --game-version 1.20.4
rinth versions latest sodium --version-number 1.2.3
```

**Human output:**

```
4GyXKCLd  mc1.20.4-0.5.8
```

**`--json`** — a single version object (not an array), same shape as one
element of `versions list`'s array.

#### Four distinguishable outcomes (and why `versions latest`'s exit codes changed)

`versions latest` used to exit 4 (`NotFound`) for both "no such project" and
"no version matched the filters" — genuinely different facts a caller (in
particular a CI deploy step) needs to react to differently: the first is
permanent, the second is worth retrying. **This is a breaking change** — see
CHANGELOG.md. There are now four machine-distinguishable outcomes:

| # | Outcome | Exit code | `reason` (`--json`) | Retryable under `--wait`? |
| - | ------- | --------- | -------------------- | -------------------------- |
| i | Token absent or rejected | 3 (`AuthMissing`) | `"auth"` | No |
| ii | The project itself couldn't be read (still 404, authenticated) — no such project **or** a draft this identity can't see; the API returns an identical 404 for both, so this is honestly one outcome, not a guess at which | 4 (`NotFound`) | `"project_unreadable"` | No |
| iii | The project resolved fine, but nothing matched the filters | **7 (`NoVersionMatch`, NEW)** | `"no_version_match"` | Yes — this is the one `--wait` polls on |
| iv | `--wait`'s budget expired before a match ever appeared | **8 (`WaitTimeout`, NEW)** | `"wait_exhausted"` | N/A (already exhausted) |

Outcomes (i) and (ii) abort immediately, with or without `--wait` — polling
past an auth failure or an unreadable project cannot make it resolve. Only
(iii) is retried inside `--wait`'s loop.

#### `--wait <seconds>` / `--wait-interval <seconds>`: bounded polling

Without `--wait`, behavior is **exactly** the original single-attempt,
fail-fast lookup (only the no-match exit code changed, per the table above).
With `--wait`, `versions latest` polls until a matching version appears or
the budget expires — both the total budget **and** the poll interval are the
caller's to set (a fixed internal interval isn't enough for a consumer that
needs a specific cadence, e.g. ~20 attempts at 15s):

```sh
# Fail-fast (unchanged): one lookup, exit 7 immediately if nothing matches yet.
rinth versions latest sodium --loader fabric

# Poll for up to 5 minutes, checking every 15s (the default interval).
rinth versions latest sodium --loader fabric --wait 300

# Poll for up to 5 minutes, checking every 20s.
rinth versions latest sodium --loader fabric --wait 300 --wait-interval 20
```

`--wait-interval` defaults to **15 seconds** when `--wait` is given without
it, and is a usage error (exit 2) if given without `--wait`. On timeout, the
error message states plainly that the project resolved but nothing matched
within the budget — a different message (and a different exit code) from
"the project itself could not be read."

**`--wait 0` exits 8 (`WaitTimeout`), not 7 (`NoVersionMatch`).** `--wait`
with a budget of zero still runs the poll loop's single attempt, but that
attempt's elapsed time (`>= 0`) is immediately `>=` the `0`-second budget,
so a no-match falls into the "budget expired" branch rather than the
fail-fast "nothing matched" branch — even though only one attempt ever ran,
same as omitting `--wait` entirely. This is self-consistent and intentional,
not a bug to fix: `--wait N` always means "the budget expired" on its
last failed attempt, regardless of how small `N` is. It matters to a caller
that *parameterizes* the budget (e.g. invoking this command with
`--wait "$TIMEOUT"`) rather than hard-coding whether to wait at all —
`TIMEOUT=0` silently switches that caller from exit 7 to exit 8 for what is
otherwise the same single-attempt, no-match outcome as leaving `--wait` off
altogether, so a consumer branching on exit code needs to treat 0 as its
own case rather than assuming it degrades to the no-`--wait` path's exit
code.

Nothing is printed on any attempt but the last (success, or the final
timeout error) — every write still goes through `src/output.ts` like every
other command, and a retry loop that logged its request on each attempt
would be the easiest way for a token to reach a public CI log. See
`test/unit/commands/versions.test.ts`'s redaction-to-exhaustion test, which
drives `--wait` to exhaustion across multiple attempts with a sentinel token
and asserts it appears nowhere in captured output, on any attempt.

The wait loop polls through an injectable clock (`CommandContext.clock`,
`src/clock.ts`) rather than calling `setTimeout`/`Date.now()` directly —
deliberately **not** a hidden CLI flag: a flag that secretly shortens a
bounded wait would be undocumented test scaffolding on the public surface of
a tool meant to run unattended in CI. The real implementation uses real
timers; unit tests inject a fake clock (`createFakeClock()` in
`src/client/fake.ts`) whose `sleep()` advances a virtual clock and resolves
on the next microtask, so a multi-attempt wait runs the same budget/elapsed
arithmetic as production but completes instantly, offline, with no real
sleeping.

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

### `rinth versions delete <version_id>`

`DELETE https://api.modrinth.com/v2/version/{id}`.

**The live API returns 404 even when the delete actually succeeds** — this
was directly observed driving Modrinth by hand with `curl`. Trusting that
status code at face value would report a successful delete as a failure, so
this command never does: after the `DELETE` call, it **reads the version
back** and decides purely from that read-back:

| `DELETE` result | Read-back result | Outcome |
| --------------- | ----------------- | ------- |
| 2xx | 404 (gone) | Deleted — exit 0 |
| 404 | 404 (gone) | Deleted — exit 0 (**the live API's real behavior**, see above) |
| 404 | 200 (still there) | Genuine failure — exit 5, message says the delete did not take effect |
| other 4xx/5xx | *(read-back never attempted)* | Normal error mapping via `exitCodeForApiError` |

```sh
rinth versions delete 4GyXKCLd
```

Human mode prints one clear line — and when the `DELETE` itself returned
404 (the API's documented quirk), the line says so, so the next reader
isn't confused by a "successful delete" that came from a 404:

```
Deleted version 4GyXKCLd. (The live API's DELETE returned 404 even though the delete succeeded — expected; see README.)
```

**`--json`** on success:

```json
{ "id": "4GyXKCLd", "deleted": true }
```

On failure, the standard `--json` error shape (see "Errors under `--json`"
below).

**Integration test**: `test/integration/versions-delete.integration.test.ts`
is gated on `RINTH_TEST_PROJECT` (the same throwaway-project variable
`publish`'s integration test uses) on top of the usual `MODRINTH_TOKEN`
gate, and skips cleanly when unset. If it runs, it publishes its own
throwaway version and immediately deletes it — it can never delete a
version it didn't just create.

### `rinth publish`

```
rinth publish <project> --file <path.mrpack> --version <version_number>
  [--name <n>] [--changelog <text> | --changelog-file <path>]
  [--game-version <gv>]... [--loader <l>]...
  [--channel release|beta|alpha] [--featured]
  [--dependency <project_id>:<required|optional>]... [--dry-run]
```

`POST https://api.modrinth.com/v2/version` (multipart: a JSON `data` part
plus the file part named in `data.file_parts`). `<project>` is resolved
from an id or slug to its canonical `project_id` first (`GET
/project/{idOrSlug}`). **The token needs the `create-version` scope** —
the default read scopes are not enough.

`--name` defaults to `--version`; `--channel` defaults to `release`;
`--featured` defaults to `false`; `--game-version`/`--loader`/
`--dependency` are repeatable. `--dependency` values look like
`fabric-api:required` or `cloth-config:optional`. `--changelog` and
`--changelog-file` are mutually exclusive (exit 2 if both are given); a
missing `--changelog-file` is a clear error. A missing/nonexistent
`--file` or a missing `--version` is a usage error (exit 2).

**Duplicate guard**: before uploading, `publish` fetches the project's
versions (`Transport#listVersions` — the same method `versions list`/
`versions latest` use) and checks for an existing version with the same
`version_number`. If one exists, it fails with **exit 5** naming the
existing version's number and id, and the upload is never attempted.

```sh
$ rinth publish sodium --file build/sodium-fabric-0.6.0+mc1.20.4.mrpack \
    --version 0.6.0 --game-version 1.20.4 --loader fabric --channel release
v3xzKq7m  https://modrinth.com/project/sodium/version/v3xzKq7m
```

**`--json`** prints the created version object, unmodified API shape.

**`--dry-run`** prints the request payload that would be sent — the
`data` JSON plus the file part name and size — and exits 0 **without
sending anything and without requiring `MODRINTH_TOKEN`**: it never
resolves `<project>` to a canonical id either (that itself requires a
network call), so `data.project_id` in the dry-run payload is the project
identifier exactly as typed, not the resolved id. Output is redacted like
every other command, so a set `MODRINTH_TOKEN` never leaks into it (there
is nothing to redact anyway — it never touches the token).

```sh
$ rinth publish sodium --file build/pack.mrpack --version 0.6.0 --dry-run
{
  "data": {
    "project_id": "sodium",
    "version_number": "0.6.0",
    "name": "0.6.0",
    "changelog": "",
    "game_versions": [],
    "loaders": [],
    "version_type": "release",
    "featured": false,
    "dependencies": [],
    "file_parts": [
      "pack.mrpack"
    ],
    "primary_file": "pack.mrpack"
  },
  "file": {
    "part": "pack.mrpack",
    "size": 42
  }
}
```

**Upload path** (see `src/client/real.ts` for the full account): the
ticket's two candidate `@modrinth/api-client` upload routes
(`client.upload()`, and `client.labrinth.versions_v3.createVersion()`,
which itself calls `client.upload()`) both throw immediately under Bun.
`GenericModrinthClient extends XHRUploadClient`, whose upload path
constructs a `new XMLHttpRequest()` — a browser-only global that Bun does
not provide (`typeof XMLHttpRequest === "undefined"`, confirmed with a
standalone repro). So `Transport#createVersion` uses a single raw `fetch`
instead: same Bearer token, User-Agent, and `X-Panel-Version` header as
every other request in this file, and still routed through the same
`toCliError()` mapping. This is a Bun/Node runtime incompatibility with
the package's upload client, not a live-API issue.

**Integration test**: `test/integration/publish.integration.test.ts` is
gated on `RINTH_TEST_PROJECT` (unset by default — it names a real project
you're willing to publish throwaway versions to) on top of the usual
`MODRINTH_TOKEN` gate, and skips cleanly, logging that it needs
`RINTH_TEST_PROJECT`, when unset. If it does run, it publishes a real
version numbered `0.0.0-rinth-test-<timestamp>` and deletes it afterwards
via `versions_v2.deleteVersion(id)` — do not point `RINTH_TEST_PROJECT` at
a project whose version history you care about.

## CI recipe

The deploy sequence a consumer runs in CI — resolve the version it just
published (waiting for it to become visible if it isn't yet), then
re-point a server at it:

```sh
version_id=$(rinth --json versions latest "$PROJECT" --version-number "$VERSION" --loader "$LOADER" --wait 300 --wait-interval 15 | jq -r '.id')
rinth servers upstream "$SERVER_ID" --project "$PROJECT" --version "$version_id" --restart
```

`--wait`/`--wait-interval` (see `rinth versions latest` above) replace a
hand-rolled `curl`+`jq` retry loop wrapped around `versions latest` — a
consumer's dispatch path that deliberately does not want to wait can still
call it without `--wait` for the original fail-fast behavior.

**`--version-number` is required here, not optional.** Without it, `--wait`
resolves to whatever the newest version already is by `date_published` —
on any project that already has versions, that's true on the very first
attempt, so the wait never actually waits and this recipe can silently
re-point a live server at the PREVIOUS version instead of the one just
published. `--version-number "$VERSION"` (set to the exact tag CI just
published) is what makes "no match yet" retryable (exit 7,
`NoVersionMatch`) instead of "a match" that just happens to be wrong — see
"Four distinguishable outcomes" below.

**⚠️ The second step does not work against the live API today.** The v0
`reinstall` route `servers upstream` calls is dead at the router — see
"Authentication — what a token can and cannot do" above and "Known gaps /
follow-ups" below. This recipe documents the intended shape of the deploy
pipeline once `upstream` is migrated to the v1 content API; don't wire it
into a real pipeline yet.

## Known gaps / follow-ups

- **`servers upstream` is non-functional against the live API — and this is
  not theoretical, it is a live breakage with a real consumer failing in
  production right now.** The v0 `reinstall` route it calls is dead at the
  router (404 regardless of credentials, server, or project); it needs
  migration to the v1 content API (`POST
  /v1/servers/{id}/worlds/{world}/content`), not done here (see "Scope
  boundary" under RINTH-14's ticket, or the PR body, for why). Production
  evidence, attributed rather than observed from this environment (there is
  no `MODRINTH_TOKEN` here): `brooswit-minecraft/schematic`'s
  `.github/workflows/reusable-server-update.yml` already calls `rinth
  servers upstream`, pinned to a pre-tag commit, in its deploy pipeline.
  Sickos run `33322343392` (2026-08-30T16:23:59Z) shows the step "Resolve
  published version id" succeeding and the very next step, "Update Modrinth
  server", failing (step-level conclusions confirmed via the run API) —
  reported (SCHEM-6, verified by RINTH-1) failing on **every** Server
  update run since 2026-08-29T00:52, with a valid token and correct
  `SERVER_ID`/`PROJECT_ID`/`VERSION_ID`. A caller in that position sees
  exit 4 (`NotFound`) with `reason: "servers_upstream_route_dead"` — see
  "`rinth servers upstream`" above and "Errors under `--json`" below for
  what that message now says instead of a bare 404.
- **`servers get`/`power`/`exec` require a credential Archon accepts for
  that specific server** — a PAT is refused with 403 today; only a
  browser session token works, and there's no way to obtain one in CI. A
  caller sees exit 3 (`AuthMissing`) with `reason:
  "servers_credential_refused"`, naming the specific server — see
  "Authentication — what a token can and cannot do" above.
- **The `publish` success path has never been exercised against the live
  API** — `test/integration/publish.integration.test.ts` is gated on
  `RINTH_TEST_PROJECT`, which is deliberately left unset.
- **`project icon`'s request shape has never been exercised against a live
  authenticated call** — confirmed from labrinth's published server source
  (`apps/labrinth/src/routes/v3/projects.rs:2076`, its accepted extensions
  from `apps/labrinth/src/util/ext.rs:3-11`, and its 256KiB size cap from
  `apps/labrinth/src/routes/v3/projects.rs:2172-2176` — see "`rinth project
  icon`" above and the PR body for the full account), which is stronger
  evidence than the published API docs this used to cite, but is still not
  a live round-trip: there is no `MODRINTH_TOKEN` in this development
  environment. `test/integration/project-icon.integration.test.ts`
  and `test/integration/project-edit.integration.test.ts` are both gated on
  `RINTH_TEST_PROJECT` like `publish`'s, which is deliberately left unset.
- **`ICON_CONTENT_TYPES` (`src/client/index.ts:118-128`) accepts three
  extensions labrinth's server source does not** — `svg`, `svgz`, and
  `rgb`, carried over from the docs-sourced reading `project icon`'s
  section above documents and reconciles. `rinth project icon <id> --file
  logo.svg` passes rinth's own usage check and uploads, then fails at the
  API, since `get_image_content_type()`
  (`apps/labrinth/src/util/ext.rs:3-11`) doesn't match any of the three.
  Fixing `ICON_CONTENT_TYPES` to the narrower, server-confirmed list
  (`bmp`/`gif`/`jpeg`/`jpg`/`png`/`webp`) is a deliberate, deferred code
  change — out of scope for the docs-only evidence upgrade that found it.
- **Public reads still require `MODRINTH_TOKEN`** — there is no tokenless
  mode, even for routes the Modrinth API itself doesn't require auth for.
- **npm publish under `@brooswit` is deferred** — it needs the
  maintainer's passkey. The pinned `bunx --bun github:...#<tag>` install
  is the supported path until then.
- **"No such project" and "a draft this identity can't see" are
  indistinguishable** — the live API returns a byte-identical 404 for both,
  and there is no way to tell them apart from the response alone. Proven by
  design, not a rinth limitation to fix: see "404 diagnosis" above, which
  states this honestly as one outcome with multiple candidate causes rather
  than guessing which one applies.
- **`project create`'s required-field set and `project_type` enum are
  confirmed from the OpenAPI spec at docs.modrinth.com; `project submit`'s
  `status`/`processing` PATCH mechanism, its `draft`+`rejected` submittable
  set, and its no-versions refusal are confirmed from labrinth's published
  server source at github.com/modrinth/code — specifically
  [`apps/labrinth/src/routes/v3/projects.rs`](https://github.com/modrinth/code/blob/main/apps/labrinth/src/routes/v3/projects.rs)
  (the `requested_status` branch, line 801; the `status` permission check,
  line 581; the no-versions refusal, line 616) and
  [`apps/labrinth/src/models/v3/projects.rs`](https://github.com/modrinth/code/blob/main/apps/labrinth/src/models/v3/projects.rs)
  (`is_approved()`, line 559, for the submittable-status set;
  `can_be_requested()`, line 570 — the `ProjectStatus` overload, not the
  distinct `VersionStatus` one at `:957` — for the `requested_status`
  branch's own validation) — stronger evidence than the OpenAPI document,
  but still not a live round-trip: there is no
  `MODRINTH_TOKEN` in this agent environment, so none of this has been
  exercised against the live API.** See the "`rinth project
  create`"/"`rinth project submit`" sections above for exactly what was
  confirmed and from where. (An earlier revision of `project submit`
  PATCHed `requested_status: "approved"` on a spec-only reading; reading
  labrinth's server source found `requested_status` never touches `status`
  at all, and corrected the mechanism to `{ "status": "processing" }` — see
  that section for the full account of the two independent PATCH branches
  involved.)
- **`project submit`'s success path (draft -> processing) has never been
  exercised against the live API, and never will be by this test suite as
  currently designed** — unlike `publish`/`versions delete`/`project
  create`'s throwaway-and-delete integration tests, a real submission enters
  Modrinth's human moderation queue, a side effect on a third party that
  cannot be undone by deleting something afterward. Only the refusal path
  (which never PATCHes) is exercised live, against a real approved project.

## Exit codes

**BREAKING CHANGE (this version):** `versions latest`'s no-match case moved
off exit 4 — see "Four distinguishable outcomes" under `rinth versions
latest` above for the full rationale. Every other code's meaning is
unchanged for every scenario it already covered.

Before this version:

| Code | Meaning                              |
| ---- | ------------------------------------- |
| 0    | OK                                    |
| 1    | Generic / unexpected error            |
| 2    | Usage error (bad args/command)        |
| 3    | Auth missing or rejected (401/403)    |
| 4    | Not found (404) — including `versions latest`'s no-match case |
| 5    | API error, other 4xx/5xx              |
| 6    | Network error                         |

After this version:

| Code | Meaning                              |
| ---- | ------------------------------------- |
| 0    | OK                                    |
| 1    | Generic / unexpected error            |
| 2    | Usage error (bad args/command)        |
| 3    | Auth missing or rejected (401/403)    |
| 4    | Not found (404) — the resource genuinely couldn't be read |
| 5    | API error, other 4xx/5xx              |
| 6    | Network error                         |
| 7    | **NEW** — `versions latest`: the project resolved fine, but no version matched the filters (retryable — see `--wait`) |
| 8    | **NEW** — `versions latest --wait`: the wait budget expired before a match ever appeared |

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

### 404 diagnosis

Every project/version lookup (`project get`, `versions list`, `versions
latest`, and `publish`'s project resolution) routes a 404 through one shared
helper (`src/diagnose.ts`) instead of surfacing a bare "404 Not Found". Every
rinth request already sends the Bearer token unconditionally, so the
message states that plainly and names every candidate cause — deliberately
**one** outcome covering multiple causes, not a guessed answer, because the
live API returns an identical 404 for "no such project" and "a draft this
token's identity can't see" and there is no way to tell them apart from the
response alone:

```
Project my-draft-modpack was not found (HTTP 404), even though this request was authenticated. This could mean:
  - no such project/version exists;
  - it exists but is not visible to this token's identity (e.g. a draft owned by someone else); or
  - the token is missing or was rejected.
Run `rinth whoami` to check which identity is in play.
```

This only ever rewrites the *message* (and sets `reason` — see below); the
exit code, `status`, and `endpoint` are preserved exactly, so the `--json`
error shape does not change shape.

### `servers` diagnosis

`servers get`, `power`, `upstream`, and `exec` route their failures through
two sibling helpers in `src/diagnose.ts`, same file and same
message-only/`reason`-only contract as `diagnoseNotFound` above, instead of
letting a bare API string (e.g. `not found`, the entire output) reach the
user. Unlike `diagnoseNotFound`'s draft-vs-nonexistent case, these two are
**not** one outcome covering multiple candidate causes — each is uniquely
determined by which call produced it, so naming one confidently is honest,
not a guess:

- **`diagnoseUpstreamRouteDead`** rewrites a 404 from `servers upstream`'s
  `reinstall` call (the only thing that call ever hits). This route is
  proven dead at the router, independent of credentials, server, or
  project — see "`rinth servers upstream`" above — so the message names the
  route explicitly and states the remedy is a rinth-side migration to the
  v1 content API, not anything the caller can change. Reason:
  `"servers_upstream_route_dead"`.
- **`diagnoseServerCredentialRefused`** rewrites a 403 from any per-server
  Archon endpoint (`servers get`, `power`, `exec`'s WebSocket auth, and
  `upstream`'s post-reinstall read-back). Every one of these routes rejects
  a PAT identically — confirmed from labrinth's published PAT scope enum
  (there is no `SERVER`/`ARCHON`/`PYRO` scope at all, see "Authentication —
  what a token can and cannot do" above) — so a 403 here is always the
  identity wall, never an ownership/permissions question a different PAT
  could fix. The message names the specific server and points at
  "Authentication — what a token can and cannot do". Reason:
  `"servers_credential_refused"`.

`servers upstream`'s project-resolution step (`--project <slug|id>` ->
`resolveProjectId`) is a project lookup like any other, so its 404 goes
through the existing `diagnoseNotFound` (reason `"project_unreadable"`)
instead of a third helper — reusing the shared helper rather than
duplicating it, per RINTH-14. `servers list` is untouched: `GET
/modrinth/v0/servers` is not a per-server route and is not known to be
dead, so there is nothing here to diagnose.

Because the 404 (dead route) and the 403 (identity wall) never overlap —
different status codes, different call sites, both independently proven —
there is no genuinely ambiguous case between them to name, unlike the
project/version 404. If that ever stops being true (e.g. a future Archon
change makes one of these routes 403 for a *different* reason than
credential type), the honest answer is a new candidate-cause message, not a
guess layered onto these two.

### Errors under `--json`

Every API-backed command routes its failures through the same `CliError`,
which — in addition to the exit code above — carries the HTTP status (`null`
for a non-HTTP failure, e.g. a usage error or a socket-level failure), the
`"<METHOD> <path>"` of the request that failed (`null` when there was none),
and (**new**) a machine-readable `reason` string (`null` when none applies)
so a consumer can switch on a stable string instead of memorizing exit
codes — e.g. `"auth"`, `"project_unreadable"`, `"no_version_match"`,
`"wait_exhausted"`, `"update_not_landed"` (`project edit`'s read-back
verification), `"icon_not_landed"` (`project icon`'s),
`"servers_upstream_route_dead"` (`servers upstream`'s dead v0 `reinstall`
route), `"servers_credential_refused"` (a per-server Archon 403 — see
"`servers` diagnosis" above). `reason` is purely additive: every other
field keeps its existing name and meaning.

- **Plain text** (`--json` not set): the stderr message includes status and
  endpoint when present, e.g.

  ```
  Server ff783f0f-ec3c-4037-b39f-452ce590891d refused this credential (HTTP 403). A labrinth PAT cannot carry per-server Archon access — this is an identity wall, not a missing PAT scope (there is no SERVER/ARCHON/PYRO scope at all). Only a browser session token works here, and there is no way to obtain one in CI. See README "Authentication — what a token can and cannot do".
  ```

  When neither a status nor an endpoint applies (e.g. a usage error), the
  message is unprefixed, as before.

- **`--json`**: on any error, stdout is left empty (there was no result to
  print) and a single JSON value is written to stderr:

  ```json
  {"error":{"code":3,"status":403,"endpoint":"GET /modrinth/v0/servers/ff783f0f-ec3c-4037-b39f-452ce590891d","message":"Server ff783f0f-ec3c-4037-b39f-452ce590891d refused this credential (HTTP 403). A labrinth PAT cannot carry per-server Archon access — this is an identity wall, not a missing PAT scope (there is no SERVER/ARCHON/PYRO scope at all). Only a browser session token works here, and there is no way to obtain one in CI. See README \"Authentication — what a token can and cannot do\".","reason":"servers_credential_refused"}}
  ```

  `code` is the process exit code (same table as above); `status` is the raw
  HTTP status or `null`; `endpoint` is `"<METHOD> <path>"` or `null`;
  `reason` is a stable machine-readable string or `null`.

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
