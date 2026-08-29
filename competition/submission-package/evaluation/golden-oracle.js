"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { callTool } = require("../tools/campus-tools-mcp/src/tools");

const ROOT = path.resolve(__dirname, "..");
const ORACLE_SOURCES = [
  "mock-data/competition-demo-v1.json",
  "tools/campus-tools-mcp/src/data.js",
  "tools/campus-tools-mcp/src/envelope.js",
  "tools/campus-tools-mcp/src/tools.js",
  "evaluation/golden-cases.js",
];

function sourceSha256() {
  const hash = crypto.createHash("sha256");
  for (const relative of ORACLE_SOURCES) {
    hash.update(relative);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(ROOT, relative)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function walkIds(value, ids) {
  if (Array.isArray(value)) {
    value.forEach((item) => walkIds(item, ids));
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.lessonId === "string") ids.lessonIds.add(value.lessonId);
  if (typeof value.courseId === "string") ids.courseIds.add(value.courseId);
  if (typeof value.roomId === "string") ids.roomIds.add(value.roomId);
  Object.values(value).forEach((item) => walkIds(item, ids));
}

function canonicalExpected(envelope) {
  const ids = { lessonIds: new Set(), courseIds: new Set(), roomIds: new Set() };
  walkIds(envelope.items, ids);
  const conflictCount = envelope.summary && Number.isInteger(envelope.summary.conflictCount)
    ? envelope.summary.conflictCount
    : null;
  const lessonCount = envelope.summary && Number.isInteger(envelope.summary.lessonCount)
    ? envelope.summary.lessonCount
    : null;
  const empty = conflictCount != null
    ? conflictCount === 0
    : lessonCount != null
      ? lessonCount === 0
      : envelope.items.length === 0;
  return {
    dataVersion: envelope.dataVersion,
    dataHash: envelope.evidence && envelope.evidence.dataHash,
    success: envelope.success,
    itemCount: envelope.items.length,
    resolvedEntity: envelope.resolvedEntity
      ? { id: envelope.resolvedEntity.id, name: envelope.resolvedEntity.name }
      : null,
    comparedEntities: Array.isArray(envelope.compared)
      ? envelope.compared.map((item) => ({ id: item.id, name: item.name }))
      : [],
    lessonIds: [...ids.lessonIds].sort(),
    courseIds: [...ids.courseIds].sort(),
    roomIds: [...ids.roomIds].sort(),
    conflictCount,
    lessonCount,
    empty,
    verified: Boolean(envelope.evidence && envelope.evidence.verified),
  };
}

function executeCase(item) {
  return {
    id: item.id,
    tool: item.tool,
    input: item.input,
    expected: canonicalExpected(callTool(item.tool, item.input)),
  };
}

module.exports = { ORACLE_SOURCES, canonicalExpected, executeCase, sourceSha256 };
