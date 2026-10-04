#!/usr/bin/env bun
// MINECRAFT-34: the single, human-authorized, MUTATING v1 installContent
// probe. OFF by default; see lib.ts#checkGate and
// .github/workflows/mutating-probe.yml. Never wired into `test`,
// `test:integration`, or ci.yml. Prints statuses/booleans/counts only —
// never a server id, world id, name, project/version id, or credential.
//
// Sequence (one attempt, no retries, no loops):
//   1. gate  2. list + pick target  3. CAPTURE current modpack (abort if not
//   restorable)  4. invalid-token control  5. WRITE once  6. one settle wait,
//   one READ-BACK  7. RESTORE (only if the read-back differs from the capture)
//   8. one read-back of the restore  9. verdict.

import { AuthFeature, GenericModrinthClient, PanelVersionFeature } from "@modrinth/api-client";
import type { AuthConfig } from "@modrinth/api-client";
import {
  checkGate,
  chooseTargetVersion,
  compareReadBack,
  formatReadBack,
  modpackRequest,
  selectTarget,
  snapshotFromAddons,
  statusOf,
  verdictFor,
} from "./lib.ts";

function buildClient(token: string): GenericModrinthClient {
  const authConfig: AuthConfig = { token };
  return new GenericModrinthClient({
    userAgent: "rinth-cli-mutating-probe-MINECRAFT-34 (+https://github.com/brooswit-minecraft/rinth)",
    features: [new AuthFeature(authConfig), new PanelVersionFeature()],
  });
}

function abort(reason: string): never {
  console.log(`MUTATING PROBE: ABORTED BEFORE ANY WRITE — ${reason}`);
  process.exit(1);
}

const gate = checkGate(process.env);
if (!gate.ok) {
  console.log(`MUTATING PROBE: DID NOT RUN — ${gate.reason}`);
  process.exit(0);
}

const token = process.env["MODRINTH_TOKEN"] as string;
const client = buildClient(token);
const settleMs = Math.min(Math.max(Number(process.env["RINTH_PROBE_SETTLE_MS"] ?? "15000") || 15000, 0), 60000);

// 2. discover target (read-only)
let servers;
try {
  servers = await client.archon.servers_v1.list();
} catch (error) {
  abort(`servers_v1.list() failed with status ${statusOf(error) ?? "none"}`);
}
const target = selectTarget(servers);
if (!target.ok) abort(target.reason);
const { serverId, worldId } = target;

// 3. capture (read-only) — must be restorable or we do not write
let addonsBefore;
try {
  addonsBefore = await client.archon.content_v1.getAddons(serverId, worldId, { addons: false, updates: false });
} catch (error) {
  abort(`could not capture current content (status ${statusOf(error) ?? "none"})`);
}
const captured = snapshotFromAddons(addonsBefore);
if (!captured.ok) abort(captured.reason);
const { snapshot } = captured;
const { versionId: targetVersionId, sameAsInstalled } = chooseTargetVersion(
  snapshot,
  process.env["RINTH_PROBE_TARGET_VERSION_ID"],
);
console.log(`MUTATING PROBE: captured restorable modrinth modpack state (captured=true, target_is_same_version=${sameAsInstalled})`);

// 4. invalid-token control: same call, garbage token, BEFORE the real write.
// An unauthenticated 2xx here would itself have performed the call, so it
// stops the run before the real write.
const invalidClient = buildClient("rinth-mutating-probe-not-a-real-token");
let controlStatus: number | "2xx" | undefined;
try {
  await invalidClient.archon.content_v1.installContent(serverId, worldId, modpackRequest(snapshot.projectId, snapshot.versionId));
  controlStatus = "2xx";
} catch (error) {
  controlStatus = statusOf(error);
}
console.log(`MUTATING PROBE: invalid-token control => ${controlStatus ?? "no-status"}`);
if (controlStatus === "2xx" || controlStatus === undefined) {
  console.log("MUTATING PROBE: control did not produce a rejection status; NOT performing the real write. Verdict INCONCLUSIVE.");
  process.exit(1);
}

async function readBack(
  label: string,
  expected: { projectId: string; versionId: string },
): Promise<ReturnType<typeof compareReadBack> | undefined> {
  try {
    const list = await client.archon.servers_v1.get(serverId);
    const present = list.worlds.some((world) => world.id === worldId);
    const addons = await client.archon.content_v1.getAddons(serverId, worldId, { addons: false, updates: false });
    const result = compareReadBack(addons, expected, snapshot, present);
    console.log(formatReadBack(label, result));
    return result;
  } catch (error) {
    console.log(`${label}: read-back failed (status ${statusOf(error) ?? "none"})`);
    return undefined;
  }
}

// 5. THE ONE WRITE
let writeStatus: number | "2xx";
try {
  await client.archon.content_v1.installContent(serverId, worldId, modpackRequest(snapshot.projectId, targetVersionId));
  writeStatus = "2xx";
} catch (error) {
  const status = statusOf(error);
  if (status === undefined) {
    console.log("MUTATING PROBE: write threw with no HTTP status (transport error); state unknown, attempting read-back only.");
  }
  writeStatus = status ?? 0;
}
console.log(`MUTATING PROBE: installContent (v1, modpack/modrinth, soft_override=false) => ${writeStatus}`);

// 6. one settle wait + one read-back (the 2xx is NOT success; this is)
let back;
if (writeStatus === "2xx" || writeStatus === 0) {
  await Bun.sleep(settleMs);
  back = await readBack("MUTATING PROBE read-back after write", { projectId: snapshot.projectId, versionId: targetVersionId });
}

// 7/8. restore only when something may have changed away from the capture
const accepted = writeStatus === "2xx" || writeStatus === 0;
const needsRestore = accepted && (!sameAsInstalled || !back || !back.versionMatches || !back.projectMatches);
if (needsRestore) {
  let restoreStatus: number | "2xx";
  try {
    await client.archon.content_v1.installContent(serverId, worldId, modpackRequest(snapshot.projectId, snapshot.versionId));
    restoreStatus = "2xx";
  } catch (error) {
    restoreStatus = statusOf(error) ?? 0;
  }
  console.log(`MUTATING PROBE: restore installContent => ${restoreStatus}`);
  await Bun.sleep(settleMs);
  const restored = await readBack("MUTATING PROBE read-back after restore", {
    projectId: snapshot.projectId,
    versionId: snapshot.versionId,
  });
  const ok = restored?.projectMatches === true && restored.versionMatches && restored.runtimeUnchanged && !restored.installing;
  console.log(`MUTATING PROBE: restored_to_captured_state=${ok}`);
  if (!ok) console.log("MUTATING PROBE: RESTORE NOT CONFIRMED — operator must check the server manually.");
} else {
  console.log("MUTATING PROBE: restore not needed (target was the installed version, or the write did not change it).");
}

// 9. verdict
const verdict = verdictFor({
  writeStatus,
  controlStatus,
  sameVersion: sameAsInstalled,
  readBack: back,
});
console.log(`MUTATING PROBE VERDICT (this run, v1 only): ${verdict}`);
