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
    const widgetStart = text.search(/const\s+widgetSchema\s*=\s*z/);
    const source = widgetStart >= 0 ? text.slice(widgetStart) : text;
    const keys = [];
    // Tencent's exported Zod source declares reusable nested schemas first.
    // Canonical widget properties are the four-space entries in widgetSchema.
    const propertyRe = /^ {4}["']?([A-Za-z_$][\w$]*)["']?\s*:\s*z(?:\.|\s*$)/gm;
    let match;
    while ((match = propertyRe.exec(source))) keys.push(match[1]);
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
  const presentationFields = expectedKeys.filter((key) => key !== "version");
  const missingFromView = presentationFields.filter((key) => !new RegExp(`\\b${key}\\b`).test(view));
  const outerTemplate = String(widget.template || "");
  const templateConventionValid = outerTemplate === "" || outerTemplate === view;
  const tieSchema = outerSchema.properties && outerSchema.properties.displayMeta
    && outerSchema.properties.displayMeta.properties
    && outerSchema.properties.displayMeta.properties.tieGroupCount;
  const tieSemanticsValid = !tieSchema || (tieSchema.minimum === 1 && /tieGroupCount:\s*z\.number\(\)\.int\(\)\.min\(1\)\.optional\(\)/.test(String(inner.schema || "")));

  const checks = {
    encodedWidgetPresent: Boolean(widget.encodedWidget),
    outerTemplateMatchesInnerView: templateConventionValid,
    outerSchemaMatchesInnerSchema: equalSets(outerKeys, innerSchema.keys),
    defaultMatchesInnerSchema: equalSets(defaultKeys, innerSchema.keys),
    contractMatchesInnerSchema: contract ? equalSets(expectedKeys, innerSchema.keys) : true,
    contractMatchesOuterSchema: contract ? equalSets(expectedKeys, outerKeys) : true,
    contractMatchesDefault: contract ? equalSets(expectedKeys, defaultKeys) : true,
    contractFieldsUsedByView: missingFromView.length === 0,
    tieGroupCountSemantics: tieSemanticsValid,
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
