#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  ACTIVE_DOCUMENT_ID,
  CONTENT_COLLECTION_PREFIX,
  REGISTRY_COLLECTION,
  buildDeployment,
} = require("../../server/src/content/dailyKnowledgeCloudbaseData");
const appConfigService = require("../../server/src/services/appConfigService");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_ENV_ID = "cloud1-d3g17rpe7566d3d5c";
const PRODUCTION_CONFIRMATION = "publish-fosu-daily-knowledge";
const BATCH_SIZE = 10;
const MCPORTER_PACKAGE = "mcporter@0.13.8";

function parseArgs(argv) {
  const args = {
    execute: false,
    verify: false,
    prune: true,
    keep: 2,
    envId: DEFAULT_ENV_ID,
    confirm: "",
    rollback: "",
  };
  argv.forEach((arg) => {
    if (arg === "--execute") args.execute = true;
    else if (arg === "--verify") args.verify = true;
    else if (arg === "--no-prune") args.prune = false;
    else if (arg.startsWith("--keep=")) args.keep = Math.max(2, Number(arg.slice(7)) || 2);
    else if (arg.startsWith("--env=")) args.envId = arg.slice(6);
    else if (arg.startsWith("--confirm=")) args.confirm = arg.slice(10);
    else if (arg.startsWith("--rollback=")) args.rollback = arg.slice(11);
  });
  return args;
}

function findNpxCli() {
  const candidates = [
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js"),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function callMcp(tool, args) {
  const npxCli = findNpxCli();
  const command = npxCli ? process.execPath : (process.platform === "win32" ? "npx.cmd" : "npx");
  const commandArgs = (npxCli ? [npxCli] : []).concat([
    "--yes",
    MCPORTER_PACKAGE,
    "call",
    `cloudbase.${tool}`,
    "--args",
    JSON.stringify(args),
    "--output",
    "json",
  ]);
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const error = new Error(`CloudBase MCP ${tool} failed`);
    error.code = "CLOUDBASE_MCP_CALL_FAILED";
    error.stderr = String(result.stderr || "").slice(-4000);
    throw error;
  }
  let payload;
  try {
    payload = JSON.parse(String(result.stdout || "{}"));
  } catch (error) {
    const wrapped = new Error(`CloudBase MCP ${tool} returned invalid JSON`);
    wrapped.code = "CLOUDBASE_MCP_INVALID_JSON";
    throw wrapped;
  }
  if (payload && payload.isError) {
    const error = new Error(`CloudBase MCP ${tool} rejected the request`);
    error.code = "CLOUDBASE_MCP_REQUEST_REJECTED";
    throw error;
  }
  return payload;
}

function listCollections() {
  const result = callMcp("readNoSqlDatabaseStructure", { action: "listCollections", limit: 1000 });
  return Array.isArray(result.collections)
    ? result.collections.map((item) => String(item.TableName || item.Name || item.name || item.CollectionName || item))
    : [];
}

function ensureCollection(collectionName, existing) {
  const created = !existing.includes(collectionName);
  if (created) callMcp("writeNoSqlDatabaseStructure", { action: "createCollection", collectionName });
  callMcp("managePermissions", {
    action: "updateResourcePermission",
    resourceType: "noSqlDatabase",
    resourceId: collectionName,
    permission: "READONLY",
  });
  return created;
}

function insertDocuments(collectionName, documents) {
  for (let offset = 0; offset < documents.length; offset += BATCH_SIZE) {
    const batch = documents.slice(offset, offset + BATCH_SIZE);
    callMcp("writeNoSqlDatabaseContent", {
      action: "insert",
      collectionName,
      documents: batch,
    });
  }
}

function listDocumentIds(collectionName) {
  const result = callMcp("readNoSqlDatabaseContent", {
    collectionName,
    projection: { _id: 1 },
    limit: 1000,
  });
  const records = result.data || result.documents || result.records || [];
  return new Set(Array.isArray(records) ? records.map((item) => String(item && item._id || "")).filter(Boolean) : []);
}

function readRegistry() {
  try {
    const result = callMcp("readNoSqlDatabaseContent", {
      collectionName: REGISTRY_COLLECTION,
      query: { _id: ACTIVE_DOCUMENT_ID },
      limit: 1,
    });
    const records = result.data || result.documents || result.records || [];
    return Array.isArray(records) ? (records[0] || null) : null;
  } catch (error) {
    return null;
  }
}

function countDocuments(collectionName) {
  const result = callMcp("readNoSqlDatabaseContent", {
    collectionName,
    projection: { _id: 1, contentVersion: 1 },
    limit: 1000,
  });
  const records = result.data || result.documents || result.records || [];
  return Array.isArray(records) ? records.length : Number(result.total || 0);
}

function readCollectionPermission(collectionName) {
  const result = callMcp("queryPermissions", {
    action: "getResourcePermission",
    resourceType: "noSqlDatabase",
    resourceId: collectionName,
  });
  const data = result && result.data ? result.data : result;
  const permissions = Array.isArray(data && data.permissions) ? data.permissions : [];
  return String(data && data.aclTag || permissions[0] && permissions[0].Permission || "").toUpperCase();
}

function updateRegistry(deployment, previousCollection) {
  callMcp("writeNoSqlDatabaseContent", {
    action: "update",
    collectionName: REGISTRY_COLLECTION,
    query: { _id: ACTIVE_DOCUMENT_ID },
    update: {
      $set: {
        schemaVersion: 1,
        activeCollection: deployment.collectionName,
        previousCollection: previousCollection || "",
        count: deployment.count,
        managedCount: deployment.managedCount,
        builtinCount: deployment.builtinCount,
        rotationOffset: deployment.rotationOffset,
        rotationCount: deployment.rotationCount,
        enabled: deployment.enabled !== false,
        strategy: deployment.strategy || "balanced",
        source: deployment.source || "builtin",
        contentVersion: deployment.contentVersion,
        publishedAt: deployment.publishedAt,
      },
    },
    upsert: true,
  });
}

function rollback(collectionName, currentRegistry, collections) {
  if (!collections.includes(collectionName) || !collectionName.startsWith(CONTENT_COLLECTION_PREFIX)) {
    throw new Error("Rollback collection does not exist or has an invalid prefix");
  }
  const count = countDocuments(collectionName);
  if (count < 1 || count > 1000) throw new Error("Rollback collection failed validation");
  const version = collectionName.slice(CONTENT_COLLECTION_PREFIX.length);
  updateRegistry({
    collectionName,
    count,
    contentVersion: version,
    publishedAt: new Date().toISOString(),
    enabled: currentRegistry && currentRegistry.enabled !== false,
    strategy: currentRegistry && currentRegistry.strategy || "balanced",
    source: currentRegistry && currentRegistry.source || "builtin",
    rotationOffset: Math.min(Number(currentRegistry && currentRegistry.rotationOffset) || 0, count - 1),
    rotationCount: count,
    managedCount: Number(currentRegistry && currentRegistry.managedCount) || 0,
    builtinCount: Number(currentRegistry && currentRegistry.builtinCount) || count,
  }, currentRegistry && currentRegistry.activeCollection || "");
  return { activeCollection: collectionName, count };
}

function pruneCollections(collections, activeCollection, previousCollection, keep) {
  const versions = collections.filter((name) => name.startsWith(CONTENT_COLLECTION_PREFIX)).sort().reverse();
  const retained = new Set([activeCollection, previousCollection].filter(Boolean));
  versions.forEach((name) => {
    if (retained.size < keep) retained.add(name);
  });
  const removed = [];
  versions.filter((name) => !retained.has(name)).forEach((collectionName) => {
    callMcp("writeNoSqlDatabaseStructure", { action: "deleteCollection", collectionName });
    removed.push(collectionName);
  });
  return { retained: Array.from(retained), removed };
}

function verifyDeployment(deployment, collections) {
  if (Array.isArray(collections) && (!collections.includes(deployment.collectionName) || !collections.includes(REGISTRY_COLLECTION))) {
    return {
      ok: false,
      registry: null,
      count: 0,
      expectedCount: deployment.count,
      code: "DAILY_KNOWLEDGE_CLOUDBASE_NOT_DEPLOYED",
    };
  }
  try {
    const registry = readRegistry();
    const count = countDocuments(deployment.collectionName);
    const permissions = {
      content: readCollectionPermission(deployment.collectionName),
      registry: readCollectionPermission(REGISTRY_COLLECTION),
    };
    const expectations = {
      activeCollection: deployment.collectionName,
      contentVersion: deployment.contentVersion,
      count: deployment.count,
      rotationCount: deployment.rotationCount,
      rotationOffset: deployment.rotationOffset,
      enabled: deployment.enabled !== false,
      strategy: deployment.strategy || "balanced",
      source: deployment.source || "builtin",
    };
    const actual = registry ? {
      activeCollection: registry.activeCollection,
      contentVersion: registry.contentVersion,
      count: Number(registry.count),
      rotationCount: Number(registry.rotationCount),
      rotationOffset: Number(registry.rotationOffset),
      enabled: registry.enabled !== false,
      strategy: registry.strategy || "balanced",
      source: registry.source || "builtin",
    } : null;
    const mismatches = Object.keys(expectations).filter((key) => !actual || actual[key] !== expectations[key]);
    if (count !== deployment.count) mismatches.push("documentCount");
    if (permissions.content !== "READONLY") mismatches.push("contentPermission");
    if (permissions.registry !== "READONLY") mismatches.push("registryPermission");
    const ok = mismatches.length === 0;
    return { ok, registry, count, expectedCount: deployment.count, permissions, expectations, mismatches };
  } catch (error) {
    return {
      ok: false,
      registry: null,
      count: 0,
      expectedCount: deployment.count,
      code: error.code || "DAILY_KNOWLEDGE_CLOUDBASE_NOT_DEPLOYED",
    };
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const now = new Date();
  const adminState = appConfigService.getDailyKnowledgeAdminState(now);
  const time = now.getTime();
  const managed = (adminState.managed || []).filter((item) => {
    if (!item || item.enabled !== true) return false;
    const start = item.startAt ? new Date(item.startAt).getTime() : NaN;
    const end = item.endAt ? new Date(item.endAt).getTime() : NaN;
    return !(Number.isFinite(start) && time < start) && !(Number.isFinite(end) && time > end);
  }).sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));
  const deployment = buildDeployment({ managed, builtin: adminState.builtin || [], policy: adminState.policy }, now);
  const plan = {
    mode: options.execute ? "execute" : (options.verify ? "verify" : "dry-run"),
    envId: options.envId,
    registryCollection: deployment.registryCollection,
    contentCollection: deployment.collectionName,
    contentVersion: deployment.contentVersion,
    count: deployment.count,
    managedCount: deployment.managedCount,
    builtinCount: deployment.builtinCount,
    rotationCount: deployment.rotationCount,
    enabled: deployment.enabled,
    strategy: deployment.strategy,
    source: deployment.source,
    categories: deployment.documents.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1;
      return acc;
    }, {}),
    permission: "READONLY",
    keepVersions: options.keep,
    rollback: options.rollback || null,
  };
  if (!options.execute && !options.verify) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  callMcp("auth", { action: "set_env", envId: options.envId });
  const collections = listCollections();
  const existingRegistry = collections.includes(REGISTRY_COLLECTION) ? readRegistry() : null;
  if (options.verify) {
    console.log(JSON.stringify(Object.assign({}, plan, { verification: verifyDeployment(deployment, collections) }), null, 2));
    return;
  }
  if (options.confirm !== PRODUCTION_CONFIRMATION) {
    throw new Error(`Production write requires --confirm=${PRODUCTION_CONFIRMATION}`);
  }
  if (options.rollback) {
    console.log(JSON.stringify(Object.assign({}, plan, {
      result: rollback(options.rollback, existingRegistry, collections),
    }), null, 2));
    return;
  }
  const contentCreated = ensureCollection(deployment.collectionName, collections);
  const existingIds = contentCreated ? new Set() : listDocumentIds(deployment.collectionName);
  const missingDocuments = deployment.documents.filter((document) => !existingIds.has(document._id));
  if (missingDocuments.length) insertDocuments(deployment.collectionName, missingDocuments);
  const refreshedCollections = contentCreated ? collections.concat(deployment.collectionName) : collections;
  ensureCollection(REGISTRY_COLLECTION, refreshedCollections);
  const count = countDocuments(deployment.collectionName);
  if (count !== deployment.count) throw new Error(`CloudBase verification failed: expected ${deployment.count}, got ${count}`);
  updateRegistry(deployment, existingRegistry && existingRegistry.activeCollection || "");
  const verification = verifyDeployment(deployment, listCollections());
  if (!verification.ok) throw new Error("CloudBase registry verification failed");
  const finalCollections = listCollections();
  const cleanup = options.prune
    ? pruneCollections(finalCollections, deployment.collectionName, existingRegistry && existingRegistry.activeCollection || "", options.keep)
    : { retained: [], removed: [] };
  console.log(JSON.stringify(Object.assign({}, plan, { verification, cleanup }), null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ success: false, code: error.code || "DAILY_KNOWLEDGE_SYNC_FAILED", message: error.message }, null, 2));
  process.exitCode = 1;
}
