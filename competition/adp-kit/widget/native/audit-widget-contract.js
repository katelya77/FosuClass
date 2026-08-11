#!/usr/bin/env node
"use strict";

const fs = require("fs");

function sortKeys(values) {
  return [...values].sort();
}

function equalSets(a, b) {
  const aa = sortKeys(a);
  const bb = sortKeys(b);
  return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
}

function parseSchemaKeys(schemaSource) {
  if (!schemaSource) return { mode: "empty", keys: [] };
  if (typeof schemaSource === "object") {
    return { mode: "json-schema", keys: Object.keys(schemaSource.properties || {}) };
  }
  const text = String(schemaSource).trim();
  if (text.startsWith("{")) {
    const parsed = JSON.parse(text);
    return { mode: "json-schema", keys: Object.keys(parsed.properties || {}) };
  }
  if (/z\.object\s*\(/.test(text)) {
    const objectBody = text.match(/z\.object\s*\(\s*\{([\s\S]*?)\}\s*\)/);
    if (!objectBody) return { mode: "zod", keys: [] };
    const keys = [];
    const propertyRe = /(?:^|\n|,)\s*["']?([A-Za-z_$][\w$]*)["']?\s*:\s*z\./g;
    let match;
    while ((match = propertyRe.exec(objectBody[1]))) keys.push(match[1]);
    return { mode: "zod", keys };
  }
  return { mode: "unknown", keys: [] };
}

function auditWidget(widget, contract = null) {
  const inner = JSON.parse(Buffer.from(widget.encodedWidget, "base64").toString("utf8"));
  const outerSchema = widget.jsonSchema || {};
  const outerKeys = Object.keys(outerSchema.properties || {});
  const innerSchema = parseSchemaKeys(inner.schema);
  const defaultKeys = Object.keys(inner.defaultState || {});
  const expectedKeys = contract ? contract.fields.map((field) => field.name) : innerSchema.keys;
  const view = String(inner.view || "");
  const missingFromView = expectedKeys.filter((key) => !new RegExp(`\\b${key}\\b`).test(view));

  const checks = {
    encodedWidgetPresent: Boolean(widget.encodedWidget),
    outerTemplateMatchesInnerView: String(widget.template || "") === view,
    outerSchemaMatchesInnerSchema: equalSets(outerKeys, innerSchema.keys),
    defaultMatchesInnerSchema: equalSets(defaultKeys, innerSchema.keys),
    contractMatchesInnerSchema: contract ? equalSets(expectedKeys, innerSchema.keys) : true,
    contractMatchesOuterSchema: contract ? equalSets(expectedKeys, outerKeys) : true,
    contractMatchesDefault: contract ? equalSets(expectedKeys, defaultKeys) : true,
    contractFieldsUsedByView: missingFromView.length === 0,
  };

  return {
    name: widget.name,
    widgetId: inner.id,
    schemaMode: innerSchema.mode,
    outerTemplateEmpty: String(widget.template || "") === "",
    outerJsonSchemaKeys: outerKeys,
    innerSchemaKeys: innerSchema.keys,
    defaultKeys,
    expectedKeys,
    missingFromView,
    validity: {
      schemaValidity: inner.schemaValidity,
      viewValidity: inner.viewValidity,
      defaultStateValidity: inner.defaultStateValidity,
    },
    checks,
    pass: Object.values(checks).every(Boolean),
  };
}

if (require.main === module) {
  const widgetPath = process.argv[2];
  const contractPath = process.argv[3];
  if (!widgetPath) {
    console.error("usage: node audit-widget-contract.js <file.widget> [contract.json]");
    process.exit(2);
  }
  const widget = JSON.parse(fs.readFileSync(widgetPath, "utf8"));
  const contract = contractPath ? JSON.parse(fs.readFileSync(contractPath, "utf8")) : null;
  const result = auditWidget(widget, contract);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.pass ? 0 : 1);
}

module.exports = { auditWidget, parseSchemaKeys, equalSets };
