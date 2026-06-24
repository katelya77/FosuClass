function getCrypto() {
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  if (typeof crypto !== "undefined" && crypto.subtle) {
    return crypto;
  }
  return null;
}

let sm2Module = null;

function utf8ToUint8Array(text) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(String(text || ""));
  }
  const encoded = unescape(encodeURIComponent(String(text || "")));
  const bytes = new Uint8Array(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) {
    bytes[index] = encoded.charCodeAt(index);
  }
  return bytes;
}

function base64ToArrayBuffer(base64) {
  const binary = typeof wx !== "undefined" && wx.base64ToArrayBuffer
    ? wx.base64ToArrayBuffer(base64)
    : null;
  if (binary) return binary;
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  if (typeof wx !== "undefined" && wx.arrayBufferToBase64) {
    return wx.arrayBufferToBase64(buffer);
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function pemToArrayBuffer(pem) {
  const base64 = String(pem || "")
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  return base64ToArrayBuffer(base64);
}

function randomBytes(cryptoApi, length) {
  const bytes = new Uint8Array(length);
  cryptoApi.getRandomValues(bytes);
  return bytes;
}

function arrayBufferLikeToUint8Array(value) {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value.buffer instanceof ArrayBuffer) {
    return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength || value.length || 0);
  }
  return null;
}

function fallbackRandomBytes(length) {
  const cryptoApi = getCrypto();
  const bytes = new Uint8Array(length);
  if (cryptoApi && cryptoApi.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
    return Promise.resolve(bytes);
  }
  if (typeof wx !== "undefined" && typeof wx.getRandomValues === "function") {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        const result = arrayBufferLikeToUint8Array(value && (value.randomValues || value.data || value));
        resolve(result && result.length >= length ? result.slice(0, length) : weakRandomBytes(length));
      };
      try {
        const maybe = wx.getRandomValues({
          length,
          success: finish,
          fail: () => finish(null),
        });
        if (maybe && (maybe.randomValues || maybe instanceof ArrayBuffer || maybe instanceof Uint8Array)) {
          finish(maybe.randomValues || maybe);
        }
      } catch (error) {
        finish(null);
      }
    });
  }
  return Promise.resolve(weakRandomBytes(length));
}

function weakRandomBytes(length) {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256) & 0xff;
  }
  return bytes;
}

function makeSeededGetRandomValues(seedBytes) {
  let offset = 0;
  const seed = arrayBufferLikeToUint8Array(seedBytes) || weakRandomBytes(64);
  return function getRandomValues(target) {
    const bytes = arrayBufferLikeToUint8Array(target);
    if (!bytes) return target;
    for (let index = 0; index < bytes.length; index += 1) {
      if (offset < seed.length) {
        bytes[index] = seed[offset];
        offset += 1;
      } else {
        bytes[index] = Math.floor(Math.random() * 256) & 0xff;
      }
    }
    return target;
  };
}

function makeSeededMathRandom(seedBytes, fallbackRandom) {
  let offset = 0;
  const seed = arrayBufferLikeToUint8Array(seedBytes) || weakRandomBytes(64);
  const nextRandom = typeof fallbackRandom === "function" ? fallbackRandom : Math.random;
  return function seededMathRandom() {
    let value = 0;
    for (let index = 0; index < 4; index += 1) {
      const next = offset < seed.length ? seed[offset] : Math.floor(nextRandom() * 256) & 0xff;
      offset += 1;
      value = (value << 8) | next;
    }
    return (value >>> 0) / 0x100000000;
  };
}

function getWindowObject() {
  if (typeof globalThis === "undefined") return null;
  try {
    const candidate = globalThis.window;
    if (candidate && typeof candidate === "object") return candidate;
  } catch (error) {
    return null;
  }
  return null;
}

function createWindowObject() {
  if (typeof globalThis === "undefined") return null;
  try {
    const candidate = {};
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: candidate,
    });
    return candidate;
  } catch (error) {
    return null;
  }
}

function getOrCreateCryptoObject(windowObject) {
  if (!windowObject) return null;
  try {
    if (windowObject.crypto && typeof windowObject.crypto === "object") {
      return windowObject.crypto;
    }
  } catch (error) {
    return null;
  }
  try {
    windowObject.crypto = {};
    if (windowObject.crypto && typeof windowObject.crypto === "object") {
      return windowObject.crypto;
    }
  } catch (error) {
    // Fall through to defineProperty for runtimes with accessor-only fields.
  }
  try {
    const cryptoObject = {};
    Object.defineProperty(windowObject, "crypto", {
      configurable: true,
      writable: true,
      value: cryptoObject,
    });
    return cryptoObject;
  } catch (error) {
    return null;
  }
}

function installGetRandomValues(cryptoObject, getRandomValues) {
  if (!cryptoObject || typeof getRandomValues !== "function") return false;
  try {
    if (typeof cryptoObject.getRandomValues === "function") return true;
  } catch (error) {
    return false;
  }
  try {
    cryptoObject.getRandomValues = getRandomValues;
    if (cryptoObject.getRandomValues === getRandomValues) return true;
  } catch (error) {
    // Fall through to defineProperty for accessor-only fields.
  }
  try {
    Object.defineProperty(cryptoObject, "getRandomValues", {
      configurable: true,
      writable: true,
      value: getRandomValues,
    });
    return cryptoObject.getRandomValues === getRandomValues;
  } catch (error) {
    return false;
  }
}

function installNavigatorShim(restoreFns) {
  if (typeof globalThis === "undefined") return;
  try {
    if (globalThis.navigator) return;
  } catch (error) {
    // Fall through and try to replace an accessor that returns nothing.
  }
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      writable: true,
      value: { appName: "", appVersion: "" },
    });
    restoreFns.push(() => {
      if (previousNavigator) {
        Object.defineProperty(globalThis, "navigator", previousNavigator);
      } else {
        delete globalThis.navigator;
      }
    });
  } catch (error) {
    // If the runtime refuses navigator changes, the SM2 vendor can still use Math.random fallback when no window.crypto is visible.
  }
}

function installWxRandomShim(seedBytes) {
  const restoreFns = [];
  const getRandomValues = makeSeededGetRandomValues(seedBytes);
  const windowObject = getWindowObject() || createWindowObject();
  const cryptoObject = getOrCreateCryptoObject(windowObject);
  const installedCrypto = installGetRandomValues(cryptoObject, getRandomValues);

  installNavigatorShim(restoreFns);

  if (!installedCrypto && typeof Math !== "undefined" && typeof Math.random === "function") {
    const previousRandom = Math.random;
    const seededRandom = makeSeededMathRandom(seedBytes, previousRandom);
    Math.random = seededRandom;
    restoreFns.push(() => {
      Math.random = previousRandom;
    });
  }

  return function restoreRandomShim() {
    while (restoreFns.length) {
      const restore = restoreFns.pop();
      try {
        restore();
      } catch (error) {
        // Ignore restore failures; encryption has already finished module init.
      }
    }
  };
}

async function loadSm2Module() {
  if (sm2Module) return sm2Module;
  const seedBytes = await fallbackRandomBytes(128);
  const restoreRandomShim = installWxRandomShim(seedBytes);
  try {
    sm2Module = require("./vendor/sm2");
  } finally {
    if (typeof restoreRandomShim === "function") {
      restoreRandomShim();
    }
  }
  return sm2Module;
}

function normalizeKeyInfo(keyInfoOrPublicKey) {
  if (typeof keyInfoOrPublicKey === "string") {
    return {
      publicKey: keyInfoOrPublicKey,
      publicKeys: { "RSA-OAEP": keyInfoOrPublicKey },
      algorithms: ["RSA-OAEP"],
    };
  }
  return keyInfoOrPublicKey || {};
}

function getRsaPublicKey(keyInfo) {
  return keyInfo.publicKey || keyInfo.publicKeys && keyInfo.publicKeys["RSA-OAEP"] || "";
}

function getSm2PublicKey(keyInfo) {
  return keyInfo.sm2PublicKey || keyInfo.publicKeys && keyInfo.publicKeys.SM2 || "";
}

function supportsAlgorithm(keyInfo, algorithm) {
  const algorithms = Array.isArray(keyInfo.algorithms) ? keyInfo.algorithms : [];
  return !algorithms.length || algorithms.indexOf(algorithm) >= 0;
}

async function encryptWithRsaHybrid(publicKeyPem, payload) {
  const cryptoApi = getCrypto();
  if (!cryptoApi || !cryptoApi.subtle || !cryptoApi.getRandomValues) {
    const error = new Error("CLIENT_CRYPTO_UNAVAILABLE");
    error.code = "CLIENT_CRYPTO_UNAVAILABLE";
    throw error;
  }

  const rsaKey = await cryptoApi.subtle.importKey(
    "spki",
    pemToArrayBuffer(publicKeyPem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const aesKey = await cryptoApi.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"]
  );
  const iv = randomBytes(cryptoApi, 12);
  const plaintext = utf8ToUint8Array(JSON.stringify(payload || {}));
  const encrypted = await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    aesKey,
    plaintext
  );
  const rawAesKey = await cryptoApi.subtle.exportKey("raw", aesKey);
  const encryptedKey = await cryptoApi.subtle.encrypt(
    { name: "RSA-OAEP" },
    rsaKey,
    rawAesKey
  );

  const encryptedBytes = new Uint8Array(encrypted);
  const tagLength = 16;
  const ciphertext = encryptedBytes.slice(0, encryptedBytes.length - tagLength);
  const tag = encryptedBytes.slice(encryptedBytes.length - tagLength);

  return {
    algorithm: "RSA-OAEP",
    encryptedKey: arrayBufferToBase64(encryptedKey),
    encryptedPayload: arrayBufferToBase64(ciphertext.buffer),
    iv: arrayBufferToBase64(iv.buffer),
    tag: arrayBufferToBase64(tag.buffer),
  };
}

async function encryptWithSm2(publicKey, payload) {
  const sm2 = await loadSm2Module();
  const encryptedPayload = sm2.doEncrypt(JSON.stringify(payload || {}), publicKey, 1);
  if (!encryptedPayload) {
    const error = new Error("CLIENT_CRYPTO_UNAVAILABLE");
    error.code = "CLIENT_CRYPTO_UNAVAILABLE";
    throw error;
  }
  return {
    algorithm: "SM2",
    encryptedPayload,
  };
}

async function encryptCredentialPayload(keyInfoOrPublicKey, payload) {
  const keyInfo = normalizeKeyInfo(keyInfoOrPublicKey);
  const rsaPublicKey = getRsaPublicKey(keyInfo);
  const sm2PublicKey = getSm2PublicKey(keyInfo);
  const cryptoApi = getCrypto();

  if (rsaPublicKey && supportsAlgorithm(keyInfo, "RSA-OAEP") && cryptoApi && cryptoApi.subtle && cryptoApi.getRandomValues) {
    return encryptWithRsaHybrid(rsaPublicKey, payload);
  }
  if (sm2PublicKey && supportsAlgorithm(keyInfo, "SM2")) {
    return encryptWithSm2(sm2PublicKey, payload);
  }
  if (rsaPublicKey && supportsAlgorithm(keyInfo, "RSA-OAEP")) {
    return encryptWithRsaHybrid(rsaPublicKey, payload);
  }

  const error = new Error("CLIENT_CRYPTO_UNAVAILABLE");
  error.code = "CLIENT_CRYPTO_UNAVAILABLE";
  throw error;
}

module.exports = {
  encryptCredentialPayload,
};
