const AES_CHARS = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
const SBOX = [
  99, 124, 119, 123, 242, 107, 111, 197, 48, 1, 103, 43, 254, 215, 171, 118,
  202, 130, 201, 125, 250, 89, 71, 240, 173, 212, 162, 175, 156, 164, 114, 192,
  183, 253, 147, 38, 54, 63, 247, 204, 52, 165, 229, 241, 113, 216, 49, 21,
  4, 199, 35, 195, 24, 150, 5, 154, 7, 18, 128, 226, 235, 39, 178, 117,
  9, 131, 44, 26, 27, 110, 90, 160, 82, 59, 214, 179, 41, 227, 47, 132,
  83, 209, 0, 237, 32, 252, 177, 91, 106, 203, 190, 57, 74, 76, 88, 207,
  208, 239, 170, 251, 67, 77, 51, 133, 69, 249, 2, 127, 80, 60, 159, 168,
  81, 163, 64, 143, 146, 157, 56, 245, 188, 182, 218, 33, 16, 255, 243, 210,
  205, 12, 19, 236, 95, 151, 68, 23, 196, 167, 126, 61, 100, 93, 25, 115,
  96, 129, 79, 220, 34, 42, 144, 136, 70, 238, 184, 20, 222, 94, 11, 219,
  224, 50, 58, 10, 73, 6, 36, 92, 194, 211, 172, 98, 145, 149, 228, 121,
  231, 200, 55, 109, 141, 213, 78, 169, 108, 86, 244, 234, 101, 122, 174, 8,
  186, 120, 37, 46, 28, 166, 180, 198, 232, 221, 116, 31, 75, 189, 139, 138,
  112, 62, 181, 102, 72, 3, 246, 14, 97, 53, 87, 185, 134, 193, 29, 158,
  225, 248, 152, 17, 105, 217, 142, 148, 155, 30, 135, 233, 206, 85, 40, 223,
  140, 161, 137, 13, 191, 230, 66, 104, 65, 153, 45, 15, 176, 84, 187, 22,
];
const RCON = [0, 1, 2, 4, 8, 16, 32, 64, 128, 27, 54];

function directError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function utf8Bytes(text) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(String(text));
  const encoded = unescape(encodeURIComponent(String(text)));
  const bytes = new Uint8Array(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) bytes[index] = encoded.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    output += alphabet[(triple >> 18) & 63];
    output += alphabet[(triple >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }
  return output;
}

async function secureRandomBytes(length, options) {
  if (options && typeof options.randomBytes === "function") {
    const supplied = await options.randomBytes(length);
    const bytes = supplied instanceof Uint8Array ? supplied : new Uint8Array(supplied);
    if (bytes.length < length) throw directError("DIRECT_CRYPTO_UNAVAILABLE");
    return bytes.slice(0, length);
  }
  const bytes = new Uint8Array(length);
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }
  if (typeof wx !== "undefined" && typeof wx.getRandomValues === "function") {
    const values = await new Promise((resolve, reject) => {
      wx.getRandomValues({
        length,
        success: (result) => resolve(result && result.randomValues),
        fail: () => reject(directError("DIRECT_CRYPTO_UNAVAILABLE")),
      });
    });
    const view = new Uint8Array(values);
    if (view.length < length) throw directError("DIRECT_CRYPTO_UNAVAILABLE");
    return view.slice(0, length);
  }
  throw directError("DIRECT_CRYPTO_UNAVAILABLE");
}

async function randomString(length, options) {
  let result = "";
  const limit = 256 - (256 % AES_CHARS.length);
  while (result.length < length) {
    const bytes = await secureRandomBytes(length, options);
    for (let index = 0; index < bytes.length && result.length < length; index += 1) {
      if (bytes[index] >= limit) continue;
      result += AES_CHARS.charAt(bytes[index] % AES_CHARS.length);
    }
  }
  return result;
}

function expandKey(key) {
  const words = [];
  for (let index = 0; index < 4; index += 1) {
    words.push((key[index * 4] << 24) | (key[index * 4 + 1] << 16) | (key[index * 4 + 2] << 8) | key[index * 4 + 3]);
  }
  for (let index = 4; index < 44; index += 1) {
    let temp = words[index - 1];
    if (index % 4 === 0) {
      temp = ((temp << 8) | (temp >>> 24)) >>> 0;
      temp = ((SBOX[(temp >>> 24) & 255] << 24) | (SBOX[(temp >>> 16) & 255] << 16) | (SBOX[(temp >>> 8) & 255] << 8) | SBOX[temp & 255]) >>> 0;
      temp = (temp ^ (RCON[index / 4] << 24)) >>> 0;
    }
    words.push((words[index - 4] ^ temp) >>> 0);
  }
  return words;
}

function addRoundKey(state, words, round) {
  for (let column = 0; column < 4; column += 1) {
    const word = words[round * 4 + column];
    state[column * 4] ^= (word >>> 24) & 255;
    state[column * 4 + 1] ^= (word >>> 16) & 255;
    state[column * 4 + 2] ^= (word >>> 8) & 255;
    state[column * 4 + 3] ^= word & 255;
  }
}

function encryptBlock(input, words) {
  const state = Array.from(input);
  addRoundKey(state, words, 0);
  for (let round = 1; round <= 10; round += 1) {
    for (let index = 0; index < 16; index += 1) state[index] = SBOX[state[index]];
    const shifted = state.slice();
    for (let row = 1; row < 4; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        state[column * 4 + row] = shifted[((column + row) % 4) * 4 + row];
      }
    }
    if (round < 10) {
      const mixed = state.slice();
      for (let column = 0; column < 4; column += 1) {
        const offset = column * 4;
        const a = mixed[offset];
        const b = mixed[offset + 1];
        const c = mixed[offset + 2];
        const d = mixed[offset + 3];
        state[offset] = gmul(a, 2) ^ gmul(b, 3) ^ c ^ d;
        state[offset + 1] = a ^ gmul(b, 2) ^ gmul(c, 3) ^ d;
        state[offset + 2] = a ^ b ^ gmul(c, 2) ^ gmul(d, 3);
        state[offset + 3] = gmul(a, 3) ^ b ^ c ^ gmul(d, 2);
      }
    }
    addRoundKey(state, words, round);
  }
  return state;
}

function gmul(value, factor) {
  if (factor === 1) return value;
  if (factor === 2) return ((value << 1) ^ (value & 128 ? 27 : 0)) & 255;
  if (factor === 3) return gmul(value, 2) ^ value;
  return value;
}

function pkcs7(bytes) {
  const pad = 16 - (bytes.length % 16);
  const output = new Uint8Array(bytes.length + pad);
  output.set(bytes);
  output.fill(pad, bytes.length);
  return output;
}

function aes128CbcEncrypt(plaintext, key, iv) {
  const words = expandKey(key);
  const padded = pkcs7(plaintext);
  const output = new Uint8Array(padded.length);
  let previous = iv;
  for (let offset = 0; offset < padded.length; offset += 16) {
    const block = new Uint8Array(16);
    for (let index = 0; index < 16; index += 1) block[index] = padded[offset + index] ^ previous[index];
    const encrypted = encryptBlock(block, words);
    output.set(encrypted, offset);
    previous = encrypted;
  }
  return output;
}

async function encryptFosuPassword(rawPassword, pwdEncryptSalt, options) {
  const salt = String(pwdEncryptSalt || "");
  const key = utf8Bytes(salt);
  if (key.length !== 16) throw directError("LOGIN_PAGE_CHANGED");
  const prefix = await randomString(64, options);
  const ivString = await randomString(16, options);
  const encrypted = aes128CbcEncrypt(utf8Bytes(prefix + String(rawPassword || "")), key, utf8Bytes(ivString));
  return bytesToBase64(encrypted);
}

module.exports = {
  AES_CHARS,
  encryptFosuPassword,
  randomString,
};
