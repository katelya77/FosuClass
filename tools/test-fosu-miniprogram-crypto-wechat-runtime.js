const assert = require("assert");
const crypto = require("crypto");
const path = require("path");
const { createPublicKeyChallenge, __resetForTest } = require("../server/src/services/fosuApaasImportSessionStore");
const { decryptCredentialPayload } = require("../server/src/services/fosuApaasImportService");

const servicePath = path.join(__dirname, "..", "miniprogram", "services", "fosuStudentImportCrypto.js");
const vendorPath = path.join(__dirname, "..", "miniprogram", "services", "vendor", "sm2.js");

function freshCryptoService() {
  delete require.cache[require.resolve(servicePath)];
  delete require.cache[require.resolve(vendorPath)];
  return require(servicePath);
}

function randomArrayBuffer(length) {
  const bytes = crypto.randomBytes(length);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function testGetterOnlyWindowSm2Fallback() {
  __resetForTest();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousWx = globalThis.wx;
  const fakeWindow = {};

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    get() {
      return fakeWindow;
    },
  });
  globalThis.wx = {
    getRandomValues(options = {}) {
      const randomValues = randomArrayBuffer(Number(options.length || 0));
      if (typeof options.success === "function") {
        options.success({ randomValues });
      }
      return { randomValues };
    },
  };

  try {
    const { encryptCredentialPayload } = freshCryptoService();
    const challenge = createPublicKeyChallenge({ ttlSeconds: 300 });
    const payload = {
      studentId: "202512340303",
      password: "not-logged-password",
      nonce: challenge.nonce,
      timestamp: Date.now(),
    };
    const encrypted = await encryptCredentialPayload({
      keyId: challenge.keyId,
      nonce: challenge.nonce,
      publicKeys: { SM2: challenge.publicKeys.SM2 },
      sm2PublicKey: challenge.publicKeys.SM2,
      algorithms: ["SM2"],
      preferredAlgorithm: "SM2",
    }, payload);

    assert.strictEqual(encrypted.algorithm, "SM2");
    assert(fakeWindow.crypto && typeof fakeWindow.crypto.getRandomValues === "function",
      "SM2 fallback should install getRandomValues without assigning globalThis.window");

    const decrypted = decryptCredentialPayload(Object.assign({
      keyId: challenge.keyId,
    }, encrypted));
    assert.strictEqual(decrypted.studentId, payload.studentId);
    assert.strictEqual(decrypted.password, payload.password);
  } finally {
    delete globalThis.wx;
    if (previousWx !== undefined) globalThis.wx = previousWx;
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      delete globalThis.window;
    }
  }
}

async function testReadonlyCryptoWithoutNavigator() {
  __resetForTest();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousWx = globalThis.wx;
  const fakeWindow = {};
  const readonlyCrypto = Object.freeze({});

  Object.defineProperty(fakeWindow, "crypto", {
    configurable: false,
    get() {
      return readonlyCrypto;
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    get() {
      return fakeWindow;
    },
  });
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      get() {
        return undefined;
      },
    });
  } catch (error) {
    // Some Node versions expose a non-configurable navigator; the first test still covers the getter-only window case.
  }
  globalThis.wx = {
    getRandomValues(options = {}) {
      const randomValues = randomArrayBuffer(Number(options.length || 0));
      if (typeof options.success === "function") {
        options.success({ randomValues });
      }
      return { randomValues };
    },
  };

  try {
    const { encryptCredentialPayload } = freshCryptoService();
    const challenge = createPublicKeyChallenge({ ttlSeconds: 300 });
    const payload = {
      studentId: "202512340304",
      password: "not-logged-password",
      nonce: challenge.nonce,
      timestamp: Date.now(),
    };
    const encrypted = await encryptCredentialPayload({
      keyId: challenge.keyId,
      nonce: challenge.nonce,
      publicKeys: { SM2: challenge.publicKeys.SM2 },
      sm2PublicKey: challenge.publicKeys.SM2,
      algorithms: ["SM2"],
      preferredAlgorithm: "SM2",
    }, payload);
    const decrypted = decryptCredentialPayload(Object.assign({
      keyId: challenge.keyId,
    }, encrypted));
    assert.strictEqual(encrypted.algorithm, "SM2");
    assert.strictEqual(decrypted.studentId, payload.studentId);
    assert.strictEqual(decrypted.password, payload.password);
  } finally {
    delete globalThis.wx;
    if (previousWx !== undefined) globalThis.wx = previousWx;
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      delete globalThis.window;
    }
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
}

testGetterOnlyWindowSm2Fallback()
  .then(testReadonlyCryptoWithoutNavigator)
  .then(() => {
    console.log("test-fosu-miniprogram-crypto-wechat-runtime passed");
  })
  .catch((error) => {
    console.error(error && error.message || error);
    process.exitCode = 1;
  });
