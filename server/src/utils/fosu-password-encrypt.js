/**
 * 强智统一身份认证密码 AES 加密工具
 * NOTE: 复现教务系统前端登录页的 encrypt.js 密码加密算法。
 */

const crypto = require("crypto");

const AES_CHARS = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";

/**
 * 生成指定长度的随机字符串，字符集遵循强智加密规范
 * @param {number} length 随机字符串的长度
 * @returns {string} 随机生成的字符串
 */
function randomString(length) {
  let result = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(0, AES_CHARS.length);
    result += AES_CHARS.charAt(randomIndex);
  }
  return result;
}

/**
 * 对明文密码进行强智 CAS 统一认证规范的 AES-128-CBC 加密
 * @param {string} rawPassword 用户的明文密码
 * @param {string} pwdEncryptSalt 每次从统一认证登录页实时解析到的动态加密盐值
 * @returns {string} Base64 格式的密码密文
 */
function encryptFosuPassword(rawPassword, pwdEncryptSalt) {
  if (!pwdEncryptSalt) {
    throw new Error("Encryption salt is required but was empty");
  }

  // 1. 生成 64 位随机前缀
  const prefix = randomString(64);
  const plaintext = prefix + rawPassword;

  // 2. 转换 key 字节数组，强智使用 16 字节（128位）密钥
  const key = Buffer.from(pwdEncryptSalt, "utf8");

  // 3. 生成 16 位随机 IV
  const ivString = randomString(16);
  const iv = Buffer.from(ivString, "utf8");

  // 4. 使用 aes-128-cbc 进行加密，Node.js 默认采用 PKCS#7 填充
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");

  return encrypted;
}

module.exports = {
  randomString,
  encryptFosuPassword,
};
