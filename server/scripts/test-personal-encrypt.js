/**
 * 个人学号统一认证密码加密测试
 * NOTE: 验证 encryptFosuPassword 输出格式正确 (非空 Base64 字符串) 且由于随机因子导致每次密文不同。
 */

const assert = require("assert");
const { encryptFosuPassword } = require("../src/utils/fosu-password-encrypt");

function testEncrypt() {
  const salt = "nwxB9tTnv9UJDSX6";
  const pass = "sample-input";
  
  const res1 = encryptFosuPassword(pass, salt);
  const res2 = encryptFosuPassword(pass, salt);
  
  // 验证是否是 Base64 格式的非空字符串
  const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  assert.ok(res1 && res1.length > 0, "密文不可为空");
  assert.ok(base64Regex.test(res1), "必须为合法 Base64 格式字符串");
  
  // 验证由于随机前缀和随机 IV，两次加密输出不同
  assert.notStrictEqual(res1, res2, "每次加密结果应该由于随机因子而不同");
  
  console.log("Personal encryption tests passed");
}

try {
  testEncrypt();
} catch (error) {
  console.error("Personal encryption tests failed:", error && error.message);
  process.exit(1);
}
