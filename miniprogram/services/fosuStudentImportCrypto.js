function getCrypto() {
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  if (typeof crypto !== "undefined" && crypto.subtle) {
    return crypto;
  }
  return null;
}

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
  const binary = wx.base64ToArrayBuffer
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
  if (wx.arrayBufferToBase64) {
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

async function encryptCredentialPayload(publicKeyPem, payload) {
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
    algorithm: "RSA-OAEP-256/AES-256-GCM",
    encryptedKey: arrayBufferToBase64(encryptedKey),
    encryptedPayload: arrayBufferToBase64(ciphertext.buffer),
    iv: arrayBufferToBase64(iv.buffer),
    tag: arrayBufferToBase64(tag.buffer),
  };
}

module.exports = {
  encryptCredentialPayload,
};
