const assert = require("assert");
const crypto = require("crypto");
const { encryptFosuPassword, AES_CHARS } = require("../miniprogram/services/fosuDirectPasswordCrypto");

function nodeEncrypt(password, salt, prefix, iv) {
  const cipher = crypto.createCipheriv("aes-128-cbc", Buffer.from(salt, "utf8"), Buffer.from(iv, "utf8"));
  return cipher.update(prefix + password, "utf8", "base64") + cipher.final("base64");
}

async function run() {
  const salt = "nwxB9tTnv9UJDSX6";
  const password = "sample-input";
  const prefix = AES_CHARS.charAt(1).repeat(64);
  const iv = AES_CHARS.charAt(2).repeat(16);
  const bytes = Uint8Array.from([1, 2]);
  const encrypted = await encryptFosuPassword(password, salt, {
    randomBytes(length) {
      const out = new Uint8Array(length);
      out.fill(length === 64 ? bytes[0] : bytes[1]);
      return out;
    },
  });
  assert.strictEqual(encrypted, nodeEncrypt(password, salt, prefix, iv));

  const again = await encryptFosuPassword(password, salt);
  assert.notStrictEqual(again, encrypted);
  const decoded = Buffer.from(again, "base64");
  assert.ok(decoded.length >= 16);
  await assert.rejects(() => encryptFosuPassword(password, "short"), (error) => error.code === "LOGIN_PAGE_CHANGED");
  console.log("test-fosu-direct-password-crypto passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
