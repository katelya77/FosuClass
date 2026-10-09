#!/usr/bin/env node
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const ENV_FILE = "/etc/fosuclass/full-sync.env", KEY_FILE = "/etc/fosuclass/collector-transfer.key";
function fail(code) { throw Object.assign(new Error(code), { code }); }
function privateFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.uid !== 0 || (stat.mode & 0o077)))) fail("PRIVATE_FILE_PERMISSIONS_REJECTED");
}
function privateDirectory(dir) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.uid !== 0 || (stat.mode & 0o022)))) fail("PRIVATE_DIRECTORY_REJECTED");
}
function validate(values) {
  if (values.FULL_SYNC_AGENT_ID !== "wyz-schedule-collector" || !/^[A-Za-z0-9+\/_=~.-]{32,256}$/.test(values.FULL_SYNC_AGENT_TOKEN || "") || !/^[A-Za-z0-9+\/_=~.-]{32,256}$/.test(values.FULL_SYNC_SIGNING_SECRET || "") || values.FULL_SYNC_AGENT_TOKEN === values.FULL_SYNC_SIGNING_SECRET) fail("COLLECTOR_CREDENTIALS_REJECTED");
  return { FULL_SYNC_AGENT_ID: values.FULL_SYNC_AGENT_ID, FULL_SYNC_AGENT_TOKEN: values.FULL_SYNC_AGENT_TOKEN, FULL_SYNC_SIGNING_SECRET: values.FULL_SYNC_SIGNING_SECRET, FOSU_API_BASE: "https://class.katelya.eu.org", FOSU_COLLECTOR_EXECUTE: "0", SCHOOL_CONCURRENCY: "1" };
}
function readEnvFile(file) {
  privateFile(file); privateDirectory(path.dirname(file));
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=([A-Za-z0-9+\/_=~.:-]*)$/);
    if (!match || Object.hasOwn(values, match[1])) fail("COLLECTOR_ENV_FORMAT_REJECTED");
    values[match[1]] = match[2];
  }
  const checked = validate(values);
  if (Object.keys(values).some(key => !Object.hasOwn(checked, key)) || values.FOSU_API_BASE !== checked.FOSU_API_BASE || values.FOSU_COLLECTOR_EXECUTE !== "0" || values.SCHOOL_CONCURRENCY !== "1") fail("READ_ONLY_CONFIGURATION_REQUIRED");
  return checked;
}
function publicId(key) { return crypto.createHash("sha256").update((key instanceof crypto.KeyObject && key.type === "public" ? key : crypto.createPublicKey(key)).export({ type: "spki", format: "der" })).digest("hex"); }
function seal(values, publicKey, now = Date.now()) {
  const key = publicKey instanceof crypto.KeyObject && publicKey.type === "public" ? publicKey : crypto.createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails.modulusLength < 3072) fail("RECIPIENT_KEY_REJECTED");
  const meta = { version: 1, algorithm: "RSA-OAEP-SHA256+AES-256-GCM", recipient: publicId(key), createdAt: now, expiresAt: now + 7 * 86400000 };
  const aes = crypto.randomBytes(32), iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", aes, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(meta)));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(validate(values)), "utf8"), cipher.final()]);
  return Object.assign({}, meta, { wrappedKey: crypto.publicEncrypt({ key, oaepHash: "sha256" }, aes).toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: encrypted.toString("base64") });
}
function open(envelope, privateKey, now = Date.now()) {
  const { version, algorithm, recipient, createdAt, expiresAt } = envelope;
  if (version !== 1 || algorithm !== "RSA-OAEP-SHA256+AES-256-GCM" || recipient !== publicId(privateKey) || !Number.isSafeInteger(createdAt) || !Number.isSafeInteger(expiresAt) || now < createdAt - 60000 || now > expiresAt || expiresAt - createdAt > 7 * 86400000) fail("CREDENTIAL_ENVELOPE_REJECTED");
  try {
    const aes = crypto.privateDecrypt({ key: privateKey, oaepHash: "sha256" }, Buffer.from(envelope.wrappedKey, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", aes, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from(JSON.stringify({ version, algorithm, recipient, createdAt, expiresAt })));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return validate(JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8")));
  } catch (_) { fail("CREDENTIAL_ENVELOPE_REJECTED"); }
}
function exclusive(file, content) {
  privateDirectory(path.dirname(file));
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function keygen() {
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  if (fs.existsSync(KEY_FILE)) privateFile(KEY_FILE);
  else {
    const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 4096, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    exclusive(KEY_FILE, keys.privateKey);
  }
  const publicKey = crypto.createPublicKey(fs.readFileSync(KEY_FILE)).export({ type: "spki", format: "pem" });
  const output = KEY_FILE + ".pub";
  if (!fs.existsSync(output)) exclusive(output, publicKey);
  else if (fs.readFileSync(output, "utf8") !== publicKey) fail("RECIPIENT_KEY_CONFLICT");
  return { recipientKey: "READY", publicFile: output };
}
async function probe(values) {
  const { client, config } = require("./collector");
  const response = await client(config(values))("POST", "/api/full-sync/v1/heartbeat", { ok: true });
  if (!response || response.ok !== true) fail("ORACLE_HEARTBEAT_REJECTED");
  return { authentication: "PASS", heartbeat: "PASS", execute: false, claimRequests: 0, schoolRequests: 0 };
}
async function importEnvelope(file, probeFn = probe, target = ENV_FILE, keyFile = KEY_FILE) {
  privateFile(file); privateFile(keyFile); privateDirectory(path.dirname(target));
  if (fs.statSync(file).size > 16384) fail("CREDENTIAL_ENVELOPE_REJECTED");
  const values = open(JSON.parse(fs.readFileSync(file, "utf8")), fs.readFileSync(keyFile));
  if (fs.existsSync(target)) {
    const old = readEnvFile(target);
    if (Object.keys(values).some(key => values[key] !== old[key])) fail("EXISTING_CREDENTIALS_CONFLICT");
    await probeFn(old);
  } else {
    // Authenticate before creating the service's environment. A bad transfer
    // cannot replace a valid installation or create a runnable configuration.
    await probeFn(values);
    const temporary = target + ".import-" + crypto.randomBytes(8).toString("hex");
    exclusive(temporary, Object.entries(values).map(([key, value]) => key + "=" + value).join("\n") + "\n");
    try { fs.linkSync(temporary, target); } finally { fs.unlinkSync(temporary); }
  }
  fs.unlinkSync(file);
  return { configured: true, permissions: "600", authentication: "PASS", execute: false, transferFileRemoved: true };
}
async function cli() {
  if (process.platform !== "linux" || process.getuid() !== 0) fail("LINUX_ROOT_REQUIRED");
  const action = process.argv[2];
  if (action === "keygen") return keygen();
  if (action === "import") return importEnvelope(process.argv[3] || "/root/wyz-full-sync.encrypted.json");
  if (action === "verify") return probe(readEnvFile(ENV_FILE));
  fail("CREDENTIAL_ACTION_REJECTED");
}
if (require.main === module) cli().then(value => console.log(JSON.stringify(value))).catch(error => { console.error(JSON.stringify({ status: "failed", code: /^[A-Z_]+$/.test(error.code || "") ? error.code : "CREDENTIAL_OPERATION_FAILED" })); process.exitCode = 1; });
module.exports = { exclusive, importEnvelope, open, probe, privateFile, publicId, readEnvFile, seal, validate };
