import { describe, expect, test } from "bun:test";
import {
  CONFIRM_PHRASE,
  checkGate,
  chooseTargetVersion,
  compareReadBack,
  formatReadBack,
  modpackRequest,
  selectTarget,
  snapshotFromAddons,
  statusOf,
  verdictFor,
  type AddonsLike,
  type ReadBack,
} from "../../scripts/mutating-probe/lib.ts";

const armed = { RINTH_MUTATING_PROBE: "1", RINTH_MUTATING_PROBE_CONFIRM: CONFIRM_PHRASE, MODRINTH_TOKEN: "t" };

describe("mutating probe gate", () => {
  test("is off with an empty env (the ci.yml pull_request case)", () => {
    expect(checkGate({}).ok).toBe(false);
    expect(checkGate({ MODRINTH_TOKEN: "t" }).ok).toBe(false);
  });
  test("requires exactly '1'", () => {
    expect(checkGate({ ...armed, RINTH_MUTATING_PROBE: "true" }).ok).toBe(false);
  });
  test("requires the exact confirmation phrase", () => {
    expect(checkGate({ ...armed, RINTH_MUTATING_PROBE_CONFIRM: "yes" }).ok).toBe(false);
    expect(checkGate({ ...armed, RINTH_MUTATING_PROBE_CONFIRM: undefined }).ok).toBe(false);
  });
  test("requires a token", () => {
    expect(checkGate({ ...armed, MODRINTH_TOKEN: "" }).ok).toBe(false);
  });
  test("opens only when everything holds", () => {
    expect(checkGate(armed)).toEqual({ ok: true });
  });
});

describe("selectTarget", () => {
  test("refuses zero or many servers", () => {
    expect(selectTarget([]).ok).toBe(false);
    expect(selectTarget([{ id: "a", worlds: [] }, { id: "b", worlds: [] }]).ok).toBe(false);
  });
  test("refuses zero or many active worlds", () => {
    expect(selectTarget([{ id: "a", worlds: [{ id: "w", is_active: false }] }]).ok).toBe(false);
    expect(
      selectTarget([{ id: "a", worlds: [{ id: "w1", is_active: true }, { id: "w2", is_active: true }] }]).ok,
    ).toBe(false);
  });
  test("picks the single active world", () => {
    expect(selectTarget([{ id: "a", worlds: [{ id: "w1", is_active: false }, { id: "w2", is_active: true }] }])).toEqual({
      ok: true,
      serverId: "a",
      worldId: "w2",
    });
  });
});

const addons = (over: Partial<AddonsLike> = {}): AddonsLike => ({
  modpack: { spec: { platform: "modrinth", project_id: "P", version_id: "V1" } },
  modloader: "fabric",
  modloader_version: "0.1",
  game_version: "1.21",
  ...over,
});

describe("snapshotFromAddons", () => {
  test("captures a restorable modrinth modpack", () => {
    const result = snapshotFromAddons(addons());
    expect(result).toEqual({
      ok: true,
      snapshot: { projectId: "P", versionId: "V1", modloader: "fabric", modloaderVersion: "0.1", gameVersion: "1.21" },
    });
  });
  test("aborts when not restorable", () => {
    expect(snapshotFromAddons(addons({ installing: "modpack" })).ok).toBe(false);
    expect(snapshotFromAddons(addons({ modpack: null })).ok).toBe(false);
    expect(snapshotFromAddons(addons({ modpack: { spec: { platform: "local_file" } } })).ok).toBe(false);
    expect(snapshotFromAddons(addons({ modpack: { spec: { platform: "modrinth", project_id: "P" } } })).ok).toBe(false);
  });
});

describe("request and target version", () => {
  test("modpack request is soft_override false on the modrinth platform", () => {
    expect(modpackRequest("P", "V")).toEqual({
      content_variant: "modpack",
      spec: { platform: "modrinth", project_id: "P", version_id: "V" },
      soft_override: false,
    });
  });
  const snap = { projectId: "P", versionId: "V1", modloader: null, modloaderVersion: null, gameVersion: null };
  test("defaults to the installed version", () => {
    expect(chooseTargetVersion(snap, undefined)).toEqual({ versionId: "V1", sameAsInstalled: true });
    expect(chooseTargetVersion(snap, "")).toEqual({ versionId: "V1", sameAsInstalled: true });
  });
  test("honours an explicit override", () => {
    expect(chooseTargetVersion(snap, "V2")).toEqual({ versionId: "V2", sameAsInstalled: false });
  });
});

describe("statusOf", () => {
  test("extracts numeric statusCode only", () => {
    expect(statusOf({ statusCode: 403 })).toBe(403);
    expect(statusOf({ statusCode: "403" })).toBeUndefined();
    expect(statusOf(new Error("x"))).toBeUndefined();
    expect(statusOf(null)).toBeUndefined();
  });
});

const rb = (over: Partial<ReadBack> = {}): ReadBack => ({
  worldPresent: true,
  projectMatches: true,
  versionMatches: true,
  runtimeUnchanged: true,
  installing: false,
  ...over,
});

describe("read-back and verdict", () => {
  const snap = { projectId: "P", versionId: "V1", modloader: "fabric", modloaderVersion: "0.1", gameVersion: "1.21" };
  test("compares ids, runtime and installing", () => {
    const same = compareReadBack(addons(), { projectId: "P", versionId: "V1" }, snap, true);
    expect(same).toEqual({ worldPresent: true, projectMatches: true, versionMatches: true, runtimeUnchanged: true, installing: false });
    const diff = compareReadBack(
      addons({ modloader: "forge", installing: "modpack", modpack: null }),
      { projectId: "P", versionId: "V2" },
      snap,
      false,
    );
    expect(diff).toEqual({ worldPresent: false, projectMatches: false, versionMatches: false, runtimeUnchanged: false, installing: true });
  });
  test("formats booleans only", () => {
    const text = formatReadBack("L", { worldPresent: true, projectMatches: true, versionMatches: false, runtimeUnchanged: true, installing: false });
    expect(text).toBe("L: world_present=true project_matches=true version_matches=false runtime_unchanged=true installing=false");
  });

  test("verdicts", () => {
    const v = verdictFor;
    expect(v({ writeStatus: 403, controlStatus: 401, sameVersion: true, readBack: undefined })).toBe("REJECTED_CREDENTIAL_SHAPED");
    expect(v({ writeStatus: 404, controlStatus: 404, sameVersion: true, readBack: undefined })).toBe("REJECTED_SAME_AS_INVALID_TOKEN");
    expect(v({ writeStatus: 403, controlStatus: undefined, sameVersion: true, readBack: undefined })).toBe("REJECTED_NO_CONTROL");
    expect(v({ writeStatus: "2xx", controlStatus: "2xx", sameVersion: true, readBack: rb() })).toBe("INCONCLUSIVE");
    expect(v({ writeStatus: 0, controlStatus: 401, sameVersion: true, readBack: rb() })).toBe("INCONCLUSIVE");
    expect(v({ writeStatus: "2xx", controlStatus: 401, sameVersion: true, readBack: undefined })).toBe("INCONCLUSIVE");
    expect(v({ writeStatus: "2xx", controlStatus: 401, sameVersion: true, readBack: rb({ worldPresent: false }) })).toBe("INCONCLUSIVE");
    expect(v({ writeStatus: "2xx", controlStatus: 401, sameVersion: true, readBack: rb() })).toBe("ACCEPTED_BUT_NOT_VERIFIABLE_SAME_VERSION");
    expect(v({ writeStatus: "2xx", controlStatus: 401, sameVersion: false, readBack: rb() })).toBe("REPOINT_REACHABLE_AND_CONFIRMED");
    expect(v({ writeStatus: "2xx", controlStatus: 401, sameVersion: false, readBack: rb({ versionMatches: false }) })).toBe(
      "ACCEPTED_BUT_READBACK_UNCHANGED",
    );
  });
});
