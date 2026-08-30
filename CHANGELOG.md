# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/). CI
enforces that this file has a `## [<version>]` heading matching the
`version` field in `package.json` — see README.md.

## [0.8.0] - 2026-08-30

Driven by the same hand-`curl`ing of Modrinth on 2026-08-29 that produced
0.6.0: `project create` and `project submit` take the two operations that
move a project through its lifecycle — coming into existence as a DRAFT, and
moving into review — out of hand-typed curl.

### Added

- `rinth project create --slug <slug> --title <title> --description <text>
  (--body <text> | --body-file <path>) --project-type mod|modpack
  --client-side required|optional|unsupported --server-side
  required|optional|unsupported --license <license_id> [--category <c>]...
  [--license-url <url>] [--source-url <url>] [--issues-url <url>]
  [--dry-run]` (`src/commands/project.ts`): labrinth v2 `POST /project`
  (multipart; an optional icon part is never sent here — `project icon`
  owns that). Every project created is born a `draft` (`is_draft: true`,
  `initial_versions: []`, both constants the command supplies). The
  required-flag set is a CLI-level decision layered on a verified fact, not
  a claim about the API's own strictness: the OpenAPI spec at
  docs.modrinth.com names only `project_type` as schema-required for this
  endpoint, but the CLI additionally requires `slug`/`title`/`description`/
  `body`(-file)/`project_type`/`client_side`/`server_side`/`license` so it
  can't produce a technically-valid but useless draft — each missing flag
  is a usage error (exit 2) naming that flag. `--project-type` accepts only
  `mod`/`modpack` (confirmed from the same spec — narrower than the
  ticket's own guess, which conflated the create-time enum with
  `Labrinth.Projects.v2.ProjectType`'s broader *derived display* values).
  `--dry-run` prints the exact payload, sends nothing, and needs no
  `MODRINTH_TOKEN` (the branch never reads `ctx.transport`, matching
  `publish --dry-run`'s contract). **None of this has been exercised
  against the live API** — confirmed from the OpenAPI spec and the vendored
  `@modrinth/api-client` source only; there is no `MODRINTH_TOKEN` in the
  agent environment. See README "`rinth project create`" and "Known gaps /
  follow-ups".
- `rinth project submit <idOrSlug>` (`src/commands/project.ts`): moves a
  project out of `draft`/`rejected` via labrinth v2 `PATCH
  /project/{idOrSlug}`, following the read-first / refuse-by-name / write /
  read-back discipline `versions delete` and `servers upstream`
  established — never reports success on the write's own result, and a
  read-back showing no status change is reported as a failure (exit 5,
  `ApiError`, reason `"submit_unverified"`). `draft` and `rejected` are
  treated as submittable — confirmed from
  `apps/labrinth/src/models/v3/projects.rs:559`'s `is_approved()`, which
  excludes both — a non-submittable state is refused (exit 5, reason
  `"not_submittable"`) naming the actual status. The PATCH body is `{
  "status": "processing" }`, constructed as a literal with no reference to
  the project just read, so it cannot be accidentally widened. Confirmed
  from `apps/labrinth/src/routes/v3/projects.rs` (github.com/modrinth/code):
  `requested_status` (validated against `can_be_requested()` —
  `apps/labrinth/src/models/v3/projects.rs:570`, the `ProjectStatus`
  overload, not the distinct `VersionStatus` one at `:957` — which excludes
  `processing`; branch at line 801) writes only that one column and never
  touches `status`; `status` is validated by a separate permission check
  (line 581) that explicitly allows an ordinary user to set `Processing`
  on a non-approved project, and is the branch that actually performs the
  transition. A pre-flight refusal (exit 5, reason `"no_versions"`), citing
  `apps/labrinth/src/routes/v3/projects.rs:616`, blocks submitting a
  project with no versions before ever
  PATCHing — also confirmed real from the same server source, which refuses
  exactly this transition when `versions` is empty. See README "`rinth
  project submit`" for the full account, including the earlier
  `requested_status`-based revision this corrects.
- `Transport#createProject`/`Transport#updateProject`
  (`src/client/index.ts`/`real.ts`/`fake.ts`), plus `CreateProjectRequest`/
  `CreateProjectType`/`CreateProjectEnvironment`/`CreateProjectIconFile`
  types. `createProject` follows `createVersion`'s raw-`fetch` pattern (the
  API client's own upload support still throws under Bun — see `rinth
  publish`'s "Upload path" note). `updateProject(idOrSlug, patch: Record<string,
  unknown>): Promise<void>` is a general, sparse PATCH method — its exact
  signature was arbitrated at the epic level (RINTH-1) since RINTH-4's
  `project edit` needs the identical shape — and is deliberately
  void-returning so no caller can be tempted to trust a write's own
  response instead of reading the resource back. Implemented via
  `client.labrinth.projects_v2.edit()`, a typed PATCH method confirmed by
  reading the vendored package's compiled source.
- `test/integration/project-create.integration.test.ts`: gated on
  `MODRINTH_TOKEN` **and** a new `RINTH_TEST_CREATE_PROJECT` opt-in (this
  test creates a real project) — skips cleanly, logging why, when either is
  unset; if it runs, it creates a real throwaway draft and deletes it
  afterward via a direct `client.labrinth.projects_v2.delete()` call.
  `test/integration/project-submit.integration.test.ts`: gated on
  `MODRINTH_TOKEN` only, exercises `submit`'s refusal path live against a
  real approved project (`sodium`) without ever attempting a write.
  `submit`'s success path (draft -> processing) is deliberately not
  exercised live by any test in this suite — see README "Known gaps /
  follow-ups" for why.
## [0.7.0] - 2026-08-30

Driven by the same hand-`curl`ing session as 0.6.0: the two operations that
MUTATE an existing project (editing its metadata, uploading its icon) were
also done by hand that day. Builds on RINTH-2's authenticated project-read
path and shared 404 diagnosis.

### Added

- `rinth project edit <idOrSlug>` (`src/commands/project.ts`): a SPARSE
  `PATCH /v2/project/{idOrSlug}` — sends only the fields the operator
  actually passed on the command line (`--description`, `--body`/
  `--body-file`, `--client-side`, `--server-side`, `--source-url`,
  `--issues-url`, `--license`, `--license-url`, repeatable `--category`),
  never a full object built by reading the project first. Proven by a test
  asserting the captured PATCH body deep-equals exactly the passed flags.
  Passing no editable flag is a usage error (exit 2), not a no-op PATCH.
  `--body`/`--body-file` are mutually exclusive (exit 2), matching
  `publish`'s `--changelog`/`--changelog-file` pattern. **`--category` is
  LIST-REPLACING**: repeated `--category` REPLACES the project's whole
  category list, it does not append — documented plainly in the README and
  in `--help`/usage so an operator can't discover it by wiping their
  categories. The write field names differ from the read shape `getProject`
  returns: license is flat (`license_id`/`license_url`) on write, a nested
  `license: {id, name, url}` object on read — confirmed against
  https://docs.modrinth.com/api/operations/modifyproject/ (fetched
  directly; the vendored `@modrinth/api-client`'s own `projects_v2.edit()`
  types its body as `Partial<Project>`, which is wrong for this reason, so
  this deliberately doesn't reuse it). After the write, reads the project
  back (never trusts the PATCH's own status code) and reports every
  patched field whose read-back value doesn't match what was sent as a
  FAILURE — `ExitCode.ApiError` (5), matching `deleteVersionCommand`'s
  precedent for "a write that 2xx'd but didn't land" (see the BREAKING
  CHANGE-adjacent process note below), with an additive `reason:
  "update_not_landed"` under `--json`. `--json` prints the resulting
  project object; human mode prints only the fields that changed.
- `rinth project icon <idOrSlug> --file <path>` (`src/commands/project.ts`):
  `PATCH /v2/project/{idOrSlug}/icon?ext=<ext>` with the raw image bytes as
  the request body (not multipart) — confirmed against
  https://docs.modrinth.com/api/operations/changeprojecticon/ (fetched
  directly) and cross-checked against the vendored `@modrinth/api-client`
  0.60.0 source, which has no v2 icon method to compare against (only a
  v3-only `projects_v3.changeIcon()`, itself unusable — see below); **not
  exercised against a live authenticated call, no `MODRINTH_TOKEN` in this
  environment** — see PR body for the full account of what was and wasn't
  confirmed. The extension is inferred from `--file`'s path; an unsupported
  type is a usage error (exit 2) naming what IS accepted (`png`, `jpg`,
  `jpeg`, `bmp`, `gif`, `webp`, `svg`, `svgz`, `rgb` — `ICON_CONTENT_TYPES`
  in `src/client/index.ts`, shared with the real transport's Content-Type
  header so the two can't drift apart); a missing/nonexistent `--file` is a
  usage error (exit 2), matching `publish --file`. Reads the project back
  BEFORE and AFTER the upload and reports the *resulting* `icon_url`; a 2xx
  that leaves `icon_url` unchanged is a FAILURE — `ExitCode.ApiError` (5),
  `reason: "icon_not_landed"` under `--json`.
- `Transport#updateProject(idOrSlug, patch: Record<string, unknown>):
  Promise<void>` (`src/client/index.ts`/`real.ts`/`fake.ts`): the real
  transport uses `client.request()` (the same escape hatch
  `getCurrentUser`/`resolveProjectId` already use) rather than the API
  client's typed `projects_v2.edit()`, since that method's `Partial<Project>`
  typing is wrong for the write-shape `license` field (see above). `patch`
  is a plain `Record<string, unknown>` and the method returns `void`,
  deliberately NOT the updated project — signature fixed by RINTH-4/RINTH-3
  epic-level arbitration so both stories' independent branches (this one,
  and RINTH-3's `project create`/`project submit`) agree on it byte-for-
  byte; whichever merges into `main` second deletes its duplicate. Callers
  MUST verify via `getProject` — there is nothing in the PATCH response to
  trust.
- `Transport#uploadProjectIcon(idOrSlug, ext, bytes): Promise<void>`
  (`src/client/index.ts`/`real.ts`/`fake.ts`): a raw `fetch`, the same
  fallback shape `createVersion`'s `createVersionRaw` uses and for the same
  underlying reason — `GenericModrinthClient extends XHRUploadClient`,
  whose `upload()` throws immediately under Bun (`XMLHttpRequest` is
  undefined), and the only typed icon method in the vendored client
  (`projects_v3.changeIcon()`) is v3-only and still routes through that
  same broken `upload()` path. Sends the same Bearer token, User-Agent, and
  `X-Panel-Version: 1` header every other raw-fetch transport method here
  carries.
- `FakeTransportFixtures.project` (`src/client/fake.ts`) can now be a
  function, not just a fixed value, so a test can return a DIFFERENT
  project across successive `getProject` calls — needed for `project
  edit`/`project icon`'s read-back verification tests (before/after
  comparison, and the deliberately-unchanged-value failure case). Existing
  fixed-value usages are unaffected.
- Sixteen-plus new unit tests across `test/unit/commands/project.test.ts`
  and `test/unit/client/real.test.ts`, covering: every `edit` field
  individually and combined, the exact-body assertion, no-editable-flag
  usage error, `--body`/`--body-file` mutual exclusion, a missing
  `--body-file`, the edit-field-did-not-land failure (including a
  categories order-insensitive comparison), a good icon upload, an
  unsupported icon extension, a missing icon file, the icon-did-not-land
  failure, 404 diagnosis on both commands (pre-flight, write, and
  read-back), and redaction on both commands' error paths. All run offline
  against the fake transport; `bun test` passes with zero network access.
- `test/integration/project-edit.integration.test.ts` and
  `test/integration/project-icon.integration.test.ts`: gated on
  `MODRINTH_TOKEN` and additionally `RINTH_TEST_PROJECT` (the same
  double-gate `publish`/`versions-delete`'s integration tests use), since
  both mutate a real project. Per epic-level ruling (see PR body), this
  double-gate is intentionally the full extent of the opt-in — no third
  env var was added, and neither this session nor the agent attempted to
  set or discover `RINTH_TEST_PROJECT`. Both restore what they changed
  (description / icon) back to its pre-test value afterward when they run
  at all, and skip cleanly, logging why, whenever the double-gate isn't
  met — which is always true in this repo's default CI today.

### Process note

- `ExitCode.ApiError` (5), not a new taxonomy entry, is now the established
  pattern (per this story and RINTH-3, by epic-level ruling) for "a write
  returned 2xx but a read-back proves it didn't land" — `deleteVersionCommand`
  (`src/commands/versions.ts`) was and remains the reference
  implementation; this release's two new read-back failures
  (`update_not_landed`, `icon_not_landed`) follow it exactly, alongside the
  additive `reason` string `CliError` already carries.

## [0.6.0] - 2026-08-30

Driven by hand-`curl`ing Modrinth on 2026-08-29 and hitting two places
where the live API lies: a DRAFT project 404s to an unauthenticated read
(byte-identical to a 404 for a project that doesn't exist), and `DELETE
/v2/version/{id}` returns 404 even when the delete succeeds.

### BREAKING CHANGE

- `versions latest`'s no-match case moved off exit 4 (`NotFound`) onto a
  new, dedicated exit 7 (`NoVersionMatch`). It used to share exit 4 with
  "no such project", which meant a caller couldn't tell "this doesn't
  exist" (permanent) apart from "nothing matched yet" (worth retrying) —
  see "Four distinguishable outcomes" under `rinth versions latest` in the
  README, and the exit-code table (before/after) under "Exit codes". Every
  other exit code keeps its existing meaning for every scenario it already
  covered.

### Added

- `rinth project get <idOrSlug>` (new command family, `src/commands/project.ts`):
  labrinth v2 `GET /project/{idOrSlug}` with the Bearer token always
  attached, so a DRAFT project the token's identity can see resolves —
  where a hand-rolled unauthenticated request 404s. `--json` prints the
  unmodified project object; human mode prints a summary (id, slug, title,
  status, project_type, client_side/server_side, categories, license,
  source_url, issues_url). A 404 is routed through the new shared diagnosis
  helper rather than surfacing bare.
- `rinth versions delete <version_id>` (`src/commands/versions.ts`):
  `DELETE /v2/version/{id}`, but never trusts that call's own status code —
  the live API returns 404 even when the delete succeeds. Reads the version
  back afterward and decides purely from that: `DELETE` 2xx or 404 + a 404
  read-back both mean deleted (exit 0; the human message notes when the
  live API's 404-on-success quirk fired); `DELETE` 404 + a 200 read-back is
  a genuine failure (exit 5, message says the version is still present);
  any other `DELETE` 4xx/5xx maps normally and the read-back is never
  attempted. `--json` prints `{"id","deleted":true}` on success. Gained
  `Transport#getVersion`/`Transport#deleteVersion`
  (`src/client/index.ts`/`real.ts`/`fake.ts`).
- A shared 404-diagnosis helper (`src/diagnose.ts`, `diagnoseNotFound()`):
  every project/version lookup — `project get`, `versions list`, `versions
  latest`, and `publish`'s project resolution — now routes a 404 through
  it instead of surfacing a bare "404 Not Found". The rewritten message
  states the request was authenticated and names every candidate cause
  (no such project/version; a draft not visible to this identity; a
  missing/rejected token) and points at `rinth whoami`. Deliberately one
  outcome covering multiple causes, not a guess at which applies — the
  live API returns an identical 404 for "no such project" and "a draft
  this identity can't see," and there's no way to tell them apart from the
  response alone. Preserves the existing `CliError`'s `exitCode`/`status`/
  `endpoint` exactly — the `--json` error shape only gains a better
  `message` (plus the additive `reason` below), it does not change shape.
- `rinth versions latest --wait <seconds> [--wait-interval <seconds>]`:
  bounded polling for a downstream consumer (SCHEM-6's deploy workflow,
  which today hand-rolls a `curl`+`jq` retry loop of ~20 attempts at 15s
  with its own draft-404 handling) to replace that loop with rinth itself.
  Both the total budget and the poll interval are the caller's to set —
  `--wait-interval` defaults to 15s when omitted, and is a usage error
  without `--wait`. Without `--wait`, behavior is unchanged: exactly one
  attempt. Delivers four machine-distinguishable outcomes (distinct exit
  codes, see the BREAKING CHANGE note, plus an additive `reason` string on
  the `--json` error object): token absent/rejected (`"auth"`, exit 3); the
  project itself unreadable, authenticated (`"project_unreadable"`, exit
  4); the project resolved but nothing matched the filters
  (`"no_version_match"`, exit 7 — the retryable one `--wait` polls on); the
  wait budget exhausted (`"wait_exhausted"`, exit 8). Only the third is
  ever retried — an auth or project-read failure aborts immediately, with
  or without `--wait`. Nothing is printed on any attempt but the last
  (success or final error) — every write still goes through
  `src/output.ts`; see `test/unit/commands/versions.test.ts`'s
  redaction-to-exhaustion test, which drives `--wait` to exhaustion across
  multiple attempts with a sentinel `MODRINTH_TOKEN` and asserts it never
  appears in any captured output. Polls through a new injectable clock
  seam (`Clock` in `src/clock.ts`, `CommandContext.clock` in
  `src/commands/types.ts`) rather than a hidden CLI flag, so unit tests run
  the real budget/elapsed-time arithmetic instantly and offline
  (`createFakeClock()` in `src/client/fake.ts`).
- `CliError` (`src/errors.ts`) gained an optional `reason` (a stable,
  machine-readable string, `null` by default) alongside `status`/
  `endpoint`; `--json` error output gains the matching `reason` field,
  additive to the documented `{error:{code,status,endpoint,message}}`
  shape. Set by `diagnoseNotFound()` (`"project_unreadable"`), a
  missing/rejected token (`"auth"`, from `requireToken()` and
  `toCliError()`'s 401/403 mapping), and `versions latest --wait`'s two new
  outcomes above.
- Two new exit codes, `ExitCode.NoVersionMatch` (7) and
  `ExitCode.WaitTimeout` (8) — see the BREAKING CHANGE note.
- `test/integration/project.integration.test.ts` and
  `test/integration/versions-delete.integration.test.ts`: gated on
  `MODRINTH_TOKEN` (both) and additionally `RINTH_TEST_PROJECT` (the
  delete test, following `publish.integration.test.ts`'s pattern — it
  publishes its own throwaway version and immediately deletes it, so it
  can never delete a version it didn't just create); both skip cleanly
  when their env vars are unset.

## [0.5.0] - 2026-08-28

### Added

- `install-proof` CI job (`.github/workflows/ci.yml`): on a fresh
  ubuntu-latest runner, without checking out the repo's working tree,
  proves the exact consumer install path — `bunx --bun
  github:brooswit-minecraft/rinth#<ref> --help`, `versions latest sodium
  --loader fabric`, and `whoami --json` (logging only `{id, username}`,
  never the raw object). Resolves the PR head sha on `pull_request`
  events since `github.sha` there is an unfetchable merge commit; the
  token-gated steps skip cleanly when `MODRINTH_TOKEN` isn't set, mirroring
  the existing `integration` job.

### Changed

- README: corrected the stale Status line to the actual v0.4.0/v0.5.0
  command surface; replaced the Install section with the pinned `bunx
  --bun github:...#v0.5.0` path plus a GitHub Actions snippet and an
  npm-publish-deferred note; added an "Authentication — what a token can
  and cannot do" summary, a `whoami --json` email-redaction caution, a
  "CI recipe" section (with an inline warning that `servers upstream`
  doesn't work live yet), and a "Known gaps / follow-ups" section.

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
- `rinth publish <project> --file <path.mrpack> --version <version_number>
  [--name <n>] [--changelog <text> | --changelog-file <path>]
  [--game-version <gv>]... [--loader <l>]... [--channel
  release|beta|alpha] [--featured] [--dependency
  <project_id>:<required|optional>]... [--dry-run]` — creates a version
  with an uploaded file via labrinth v2 `POST /version` (multipart).
  Resolves `<project>` (id or slug) to its canonical `project_id` via the
  new `Transport#getProject`. Guards against duplicates: fetches the
  project's versions via `Transport#listVersions` (reusing the existing
  method, no second way to fetch versions) and fails with exit 5, naming
  the existing version, if `--version` already exists — the upload is
  never attempted in that case. `--changelog`/`--changelog-file` are
  mutually exclusive (exit 2); `--name` defaults to `--version`;
  `--channel` defaults to `release`; `--featured` defaults to `false`.
  `--dry-run` prints the exact `data` payload plus the file part name and
  size, sends nothing, and — because it never reads `ctx.transport` —
  needs no `MODRINTH_TOKEN`. On success prints the created version's id
  and Modrinth URL; `--json` prints the unmodified created version object.
- **Upload path finding**: neither candidate route the ticket named
  (`client.upload()`, or `client.labrinth.versions_v3.createVersion()`,
  which itself calls `client.upload()`) works under Bun —
  `GenericModrinthClient extends XHRUploadClient`, whose `upload()`
  constructs a `new XMLHttpRequest()`, a browser-only global Bun does not
  provide (`typeof XMLHttpRequest === "undefined"`), so both throw
  immediately. `Transport#createVersion` falls back to a single raw
  `fetch` (`src/client/real.ts`), sending the same Bearer token,
  User-Agent, and `X-Panel-Version` header every other request carries,
  still mapped through `toCliError()`.
- `Transport#getProject` and `Transport#createVersion`
  (`src/client/index.ts` + `real.ts` + `fake.ts`), plus `CreateVersionRequest`
  /`CreateVersionDependency`/`CreateVersionFile` types for the multipart
  payload shape.
- `src/cli.ts`'s command dispatch now constructs the real transport lazily
  (on first read of `ctx.transport`) instead of eagerly before every
  command runs. Every existing command reads `ctx.transport` as its first
  action, so this changes nothing observable for `whoami`/`servers`/
  `versions` — it exists so `rinth publish --dry-run`, which never reads
  `ctx.transport`, can satisfy its "no token required" requirement without
  changing `createRealTransport()`'s own unconditional `requireToken()`.

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
- KAN-735 diagnosis: measured against a real server, every per-server Archon
  endpoint this CLI calls (`get`/`power`/console WebSocket auth) is 403 with
  the org's PAT while `servers list` succeeds; `reinstall` 404s instead — and
  an invalid-token control confirmed this is a router-level 404 (the v0
  `/reinstall` route doesn't resolve at all, regardless of credentials) —
  see README "Known live blocker". Not a PAT scope problem (labrinth's scope
  enum has no `SERVERS_*` entry); most likely needs session-level JWT
  identity a PAT can't carry. A v1 content-API migration for `upstream` is a
  possible follow-up, not done here.

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
