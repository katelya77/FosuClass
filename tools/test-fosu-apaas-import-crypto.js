const assert = require("assert");
const crypto = require("crypto");
const { sm2 } = require("sm-crypto");
const { createPublicKeyChallenge, __resetForTest } = require("../server/src/services/fosuApaasImportSessionStore");
const { decryptCredentialPayload } = require("../server/src/services/fosuApaasImportService");

function encryptForServer(publicKey, payload) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const encryptedPayload = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const encryptedKey = crypto.publicEncrypt({
    key: publicKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  }, aesKey);
  return {
    encryptedKey: encryptedKey.toString("base64"),
    encryptedPayload: encryptedPayload.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function testDecryptCredentialPayload() {
  __resetForTest();
  const challenge = createPublicKeyChallenge({ ttlSeconds: 300 });
  assert(Array.isArray(challenge.algorithms) && challenge.algorithms.includes("RSA-OAEP"), "public key challenge should advertise RSA-OAEP");
  assert(challenge.algorithms.includes("SM2"), "public key challenge should advertise SM2");
  assert.strictEqual(challenge.preferredAlgorithm, "SM2");
  assert(challenge.publicKeys && challenge.publicKeys.SM2, "public key challenge should include SM2 public key");
  const payload = {
    studentId: "202512340303",
    password: "not-logged-password",
    nonce: challenge.nonce,
    timestamp: Date.now(),
  };
  const encrypted = encryptForServer(challenge.publicKey, payload);
  const decrypted = decryptCredentialPayload(Object.assign({
    keyId: challenge.keyId,
  }, encrypted));
  assert.strictEqual(decrypted.studentId, payload.studentId);
  assert.strictEqual(decrypted.password, payload.password);

  assert.throws(
    () => decryptCredentialPayload(Object.assign({ keyId: challenge.keyId }, encrypted)),
    (error) => error && error.code === "IMPORT_KEY_EXPIRED"
  );
}

function testDecryptSm2CredentialPayload() {
  __resetForTest();
  const challenge = createPublicKeyChallenge({ ttlSeconds: 300 });
  const payload = {
    studentId: "202512340303",
    password: "not-logged-password",
    nonce: challenge.nonce,
    timestamp: Date.now(),
  };
  const encryptedPayload = sm2.doEncrypt(JSON.stringify(payload), challenge.publicKeys.SM2, 1);
  const decrypted = decryptCredentialPayload({
    keyId: challenge.keyId,
    algorithm: "SM2",
    encryptedPayload,
  });
  assert.strictEqual(decrypted.studentId, payload.studentId);
  assert.strictEqual(decrypted.password, payload.password);
}

testDecryptCredentialPayload();
testDecryptSm2CredentialPayload();

console.log("test-fosu-apaas-import-crypto passed");
