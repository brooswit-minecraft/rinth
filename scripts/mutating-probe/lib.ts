// Pure decision logic for the MINECRAFT-34 mutating installContent probe.
// No network, no I/O: everything here is unit-tested offline. The I/O half
// lives in run.ts. Nothing in this file may return or format a server id,
// world id, name, or credential field for logging — callers print only the
// statuses/booleans/counts built by the `format*` helpers.

/** Exact phrase a human must type to arm the probe. */
export const CONFIRM_PHRASE = "MUTATE-PAID-SERVER";

export type Env = Record<string, string | undefined>;

export type GateResult = { ok: true } | { ok: false; reason: string };

/**
 * The probe is OFF unless every one of these holds. Fails closed: a missing
 * or malformed value is a refusal, never a default-on.
 */
export function checkGate(env: Env): GateResult {
  if (env["RINTH_MUTATING_PROBE"] !== "1") {
    return { ok: false, reason: "RINTH_MUTATING_PROBE is not exactly '1'" };
  }
  if (env["RINTH_MUTATING_PROBE_CONFIRM"] !== CONFIRM_PHRASE) {
    return { ok: false, reason: "RINTH_MUTATING_PROBE_CONFIRM does not equal the required confirmation phrase" };
  }
  if (!env["MODRINTH_TOKEN"]) {
    return { ok: false, reason: "MODRINTH_TOKEN is not set" };
  }
  return { ok: true };
}

export interface WorldLike {
  id: string;
  is_active: boolean;
}
export interface ServerLike {
  id: string;
  worlds: WorldLike[];
}

export type Target = { ok: true; serverId: string; worldId: string } | { ok: false; reason: string };

/** Refuses to guess: exactly one server with exactly one active world. */
export function selectTarget(servers: ServerLike[]): Target {
  if (servers.length !== 1) {
    return { ok: false, reason: `expected exactly 1 server, found ${servers.length}` };
  }
  const server = servers[0] as ServerLike;
  const active = server.worlds.filter((world) => world.is_active && world.id.length > 0);
  if (active.length !== 1) {
    return { ok: false, reason: `expected exactly 1 active world, found ${active.length}` };
  }
  return { ok: true, serverId: server.id, worldId: (active[0] as WorldLike).id };
}

export interface AddonsLike {
  modpack: { spec: { platform: string; project_id?: string; version_id?: string } } | null;
  installing?: string | undefined;
  modloader: string | null;
  modloader_version: string | null;
  game_version: string | null;
}

export interface Snapshot {
  projectId: string;
  versionId: string;
  modloader: string | null;
  modloaderVersion: string | null;
  gameVersion: string | null;
}

export type SnapshotResult = { ok: true; snapshot: Snapshot } | { ok: false; reason: string };

/**
 * A state we can restore: a Modrinth-platform modpack with both ids, and no
 * install already in flight. Anything else (no modpack, local file, bare
 * loader install) cannot be put back by a modpack installContent, so the
 * probe must abort before writing.
 */
export function snapshotFromAddons(addons: AddonsLike): SnapshotResult {
  if (addons.installing) {
    return { ok: false, reason: "an install is already in progress" };
  }
  const spec = addons.modpack?.spec;
  if (!spec) {
    return { ok: false, reason: "world has no linked modpack, so its content cannot be restored" };
  }
  if (spec.platform !== "modrinth") {
    return { ok: false, reason: `linked modpack platform is '${spec.platform}', not 'modrinth'; not restorable` };
  }
  if (!spec.project_id || !spec.version_id) {
    return { ok: false, reason: "linked modpack is missing a project or version id" };
  }
  return {
    ok: true,
    snapshot: {
      projectId: spec.project_id,
      versionId: spec.version_id,
      modloader: addons.modloader,
      modloaderVersion: addons.modloader_version,
      gameVersion: addons.game_version,
    },
  };
}

export type ModpackRequest = {
  content_variant: "modpack";
  spec: { platform: "modrinth"; project_id: string; version_id: string };
  soft_override: false;
};

export function modpackRequest(projectId: string, versionId: string): ModpackRequest {
  return {
    content_variant: "modpack",
    spec: { platform: "modrinth", project_id: projectId, version_id: versionId },
    soft_override: false,
  };
}

/** Same-version unless the operator explicitly supplied a different one. */
export function chooseTargetVersion(snapshot: Snapshot, override: string | undefined): { versionId: string; sameAsInstalled: boolean } {
  const versionId = override && override.length > 0 ? override : snapshot.versionId;
  return { versionId, sameAsInstalled: versionId === snapshot.versionId };
}

export function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object" && "statusCode" in error) {
    const code = (error as { statusCode?: unknown }).statusCode;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

export type ReadBack = {
  /** The world is still present and still the single active one. */
  worldPresent: boolean;
  /** Modpack ids as read back, compared to what we expected. */
  projectMatches: boolean;
  versionMatches: boolean;
  /** Loader/MC version fields unchanged from the snapshot. */
  runtimeUnchanged: boolean;
  installing: boolean;
};

export function compareReadBack(
  addons: AddonsLike,
  expected: { projectId: string; versionId: string },
  snapshot: Snapshot,
  worldPresent: boolean,
): ReadBack {
  const spec = addons.modpack?.spec;
  return {
    worldPresent,
    projectMatches: spec?.platform === "modrinth" && spec.project_id === expected.projectId,
    versionMatches: spec?.platform === "modrinth" && spec.version_id === expected.versionId,
    runtimeUnchanged:
      addons.modloader === snapshot.modloader &&
      addons.modloader_version === snapshot.modloaderVersion &&
      addons.game_version === snapshot.gameVersion,
    installing: Boolean(addons.installing),
  };
}

/** Booleans only; safe for a public log. */
export function formatReadBack(label: string, readBack: ReadBack): string {
  return (
    `${label}: world_present=${readBack.worldPresent} project_matches=${readBack.projectMatches} ` +
    `version_matches=${readBack.versionMatches} runtime_unchanged=${readBack.runtimeUnchanged} installing=${readBack.installing}`
  );
}

export type Verdict =
  | "REPOINT_REACHABLE_AND_CONFIRMED"
  | "ACCEPTED_BUT_NOT_VERIFIABLE_SAME_VERSION"
  | "ACCEPTED_BUT_READBACK_UNCHANGED"
  | "REJECTED_CREDENTIAL_SHAPED"
  | "REJECTED_SAME_AS_INVALID_TOKEN"
  | "REJECTED_NO_CONTROL"
  | "INCONCLUSIVE";

export function verdictFor(input: {
  writeStatus: number | "2xx";
  controlStatus: number | "2xx" | undefined;
  sameVersion: boolean;
  readBack: ReadBack | undefined;
}): Verdict {
  if (input.writeStatus === 0) return "INCONCLUSIVE";
  if (input.controlStatus === "2xx" || input.controlStatus === undefined) {
    return input.writeStatus === "2xx" ? "INCONCLUSIVE" : "REJECTED_NO_CONTROL";
  }
  if (input.writeStatus !== "2xx") {
    return input.writeStatus === input.controlStatus ? "REJECTED_SAME_AS_INVALID_TOKEN" : "REJECTED_CREDENTIAL_SHAPED";
  }
  if (!input.readBack || !input.readBack.worldPresent) return "INCONCLUSIVE";
  if (input.sameVersion) return "ACCEPTED_BUT_NOT_VERIFIABLE_SAME_VERSION";
  return input.readBack.versionMatches && input.readBack.projectMatches
    ? "REPOINT_REACHABLE_AND_CONFIRMED"
    : "ACCEPTED_BUT_READBACK_UNCHANGED";
}
