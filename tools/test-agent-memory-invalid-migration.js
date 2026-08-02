#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { UserPreferenceService } = require("../server/src/services/ai/conversation/userPreferenceService");

function deriveKey(secret) {
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(value, secret, aad) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decrypt(envelope, secret, aad) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(envelope.iv, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8"));
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-invalid-memory-migration-"));
  const secret = "migration-test-secret-at-least-32-bytes";
  const principal = { authenticated: true, principalKey: "invalid-memory-owner" };
  try {
    const service = new UserPreferenceService({ dataDir: root, secret });
    const filePath = service.filePath(principal.principalKey);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
      schemaVersion: "user-preferences.v1",
      updatedAt: "2026-08-01T00:00:00.000Z",
      encrypted: encrypt({ preferredName: "什么", campus: "仙溪校区" }, secret, principal.principalKey),
    }), "utf8");

    const first = await service.listMemoryItems({ principal, includeInactive: true });
    assert.strictEqual(first.items.some((item) => item.key === "preferredName"), false,
      "legacy preferredName=什么 must never become active v2 memory");
    assert.strictEqual(first.items.find((item) => item.key === "campus").normalizedValue, "仙溪校区",
      "safe legacy memories must be preserved");

    const migratedEnvelope = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.strictEqual(migratedEnvelope.schemaVersion, "user-memory.v2");
    const migrated = decrypt(migratedEnvelope.encrypted, secret, principal.principalKey);
    assert.ok(migrated.audit.some((entry) => entry.action === "invalidate_semantic"
      && entry.targetId === "legacy:preferredName"), "migration must leave a durable audit event");
    const second = await service.listMemoryItems({ principal, includeInactive: true });
    assert.strictEqual(second.revision, first.revision, "migration must be idempotent after the first read");
    console.log("test-agent-memory-invalid-migration: PASS");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
