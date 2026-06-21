#!/usr/bin/env node

const path = require("path");
const { spawnSync } = require("child_process");

const campusMapAssetService = require("../../server/src/services/campusMapAssetService");

function parseArgs(argv) {
  const args = { assetIds: [] };
  (argv || []).forEach((item) => {
    if (!item.startsWith("--")) return;
    const body = item.slice(2);
    const eq = body.indexOf("=");
    const key = eq >= 0 ? body.slice(0, eq) : body;
    const value = eq >= 0 ? body.slice(eq + 1) : true;
    if (key === "asset-id") args.assetIds.push(value);
    else args[key] = value;
  });
  return args;
}

function quoteWinArg(value) {
  const text = String(value || "");
  if (/^[a-zA-Z0-9_./\\:=@+-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function runTcbHostingDeploy(localPath, cloudPath, envId) {
  const command = process.platform === "win32" ? "tcb.cmd" : "tcb";
  const args = ["hosting", "deploy", localPath, cloudPath, "-e", envId];
  const result = process.platform === "win32"
    ? spawnSync("cmd.exe", ["/d", "/s", "/c", [command].concat(args).map(quoteWinArg).join(" ")], {
        stdio: "inherit",
        encoding: "utf8",
      })
    : spawnSync(command, args, {
        stdio: "inherit",
        encoding: "utf8",
      });
  if (result.error || result.status !== 0) {
    const error = new Error(`tcb hosting deploy failed for ${cloudPath}`);
    error.code = "CAMPUS_MAP_TCB_DEPLOY_FAILED";
    error.status = result.status;
    throw error;
  }
  return { command, args, status: result.status };
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function currentAssetIds() {
  const state = campusMapAssetService.listAssetsByMap();
  return unique(Object.keys(state).map((mapKey) => {
    const group = state[mapKey];
    return group && group.current && group.current.assetId || group && group.versions && group.versions[0] && group.versions[0].assetId || "";
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const execute = args.execute === true || args.execute === "true";
  const force = args.force === true || args.force === "true";
  const envId = args["env-id"] || args.envId || campusMapAssetService.getCloudbaseEnvId();
  campusMapAssetService.ensureInitialized();
  const assetIds = unique(args.assetIds.length ? args.assetIds : currentAssetIds());
  const assets = assetIds.map((assetId) => campusMapAssetService.getAsset(assetId)).filter(Boolean);
  const plan = assets.map((asset) => ({
    assetId: asset.assetId,
    mapKey: asset.mapKey,
    localPath: campusMapAssetService.getAssetAbsolutePath(asset),
    cloudPath: asset.cloudbasePath,
    cloudbaseUrl: asset.cloudbaseUrl,
    sha256: asset.sha256,
    size: asset.size,
    mime: asset.mime,
    alreadySynced: campusMapAssetService.isCloudbaseSynced(asset),
  }));

  if (!execute || args["dry-run"] === true) {
    console.log(JSON.stringify({
      success: true,
      dryRun: true,
      envId,
      count: plan.length,
      uploadCount: force ? plan.length : plan.filter((item) => !item.alreadySynced).length,
      force,
      plan,
      command: `node tools/cloudbase/deploy-campus-map-assets.js ${assetIds.map((id) => `--asset-id=${id}`).join(" ")} --execute`,
    }, null, 2));
    return;
  }

  const deployed = [];
  const skipped = [];
  for (const item of plan) {
    if (!force && item.alreadySynced) {
      const health = await campusMapAssetService.fetchBinaryMeta(item.cloudbaseUrl, {
        sha256: item.sha256,
        size: item.size,
        mime: item.mime,
      });
      campusMapAssetService.markCloudbaseResult(item.assetId, health);
      if (health.ok) {
        skipped.push({ assetId: item.assetId, mapKey: item.mapKey, cloudbaseUrl: item.cloudbaseUrl, reason: "already-synced", health });
        continue;
      }
    }
    runTcbHostingDeploy(item.localPath, item.cloudPath, envId);
    const health = await campusMapAssetService.fetchBinaryMeta(item.cloudbaseUrl, {
      sha256: item.sha256,
      size: item.size,
      mime: item.mime,
    });
    campusMapAssetService.markCloudbaseResult(item.assetId, health);
    if (!health.ok) {
      const error = new Error(`CloudBase verification failed for ${item.assetId}: ${health.message || health.status}`);
      error.code = "CAMPUS_MAP_CLOUDBASE_VERIFY_FAILED";
      error.health = health;
      throw error;
    }
    deployed.push({ assetId: item.assetId, mapKey: item.mapKey, cloudbaseUrl: item.cloudbaseUrl, health });
  }

  console.log(JSON.stringify({
    success: true,
    dryRun: false,
    envId,
    count: deployed.length,
    skippedCount: skipped.length,
    deployed,
    skipped,
    storage: path.resolve(campusMapAssetService.STORE_DIR),
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    code: error.code || "CAMPUS_MAP_CLOUDBASE_DEPLOY_FAILED",
    message: error.message,
    status: error.status,
    health: error.health || undefined,
  }, null, 2));
  process.exit(1);
});
