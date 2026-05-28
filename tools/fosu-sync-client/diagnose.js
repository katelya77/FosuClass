/**
 * 本地诊断脚本：检查本机是否已成功连接佛大 EasyConnect VPN 或校园网。
 */

const dns = require("dns").promises;
const axios = require("axios");
require("dotenv").config();

const FOSU_BASE_URL = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
const FOSU_AUTH_URL = process.env.FOSU_AUTH_URL || "https://authserver.fosu.edu.cn";

async function diagnose() {
  console.log("=== 开始诊断佛大教务网连接状态 ===");
  console.log(`目标教务网: ${FOSU_BASE_URL}`);
  console.log(`目标统一认证: ${FOSU_AUTH_URL}`);

  let hostname;
  try {
    hostname = new URL(FOSU_BASE_URL).hostname;
  } catch (e) {
    console.error(`❌ FOSU_BASE_URL 格式不正确: ${e.message}`);
    process.exit(1);
  }

  // 1. 检查 DNS 解析
  console.log(`\n1. 正在解析 DNS: ${hostname} ...`);
  let addresses = [];
  try {
    const result = await dns.lookup(hostname, { all: true });
    addresses = result.map((r) => r.address);
    console.log(`   解析成功！解析到以下 IP 地址:`);
    addresses.forEach((addr) => {
      // 检查是否属于校内私有网段，例如 172.16.x.x 等
      const isInternal = addr.startsWith("172.16.") || addr.startsWith("10.") || addr.startsWith("192.168.");
      console.log(`   - ${addr} [${isInternal ? "校内内网 IP" : "外网/公网 IP"}]`);
    });
  } catch (error) {
    console.error(`❌ DNS 解析失败: ${error.message}`);
    console.log(`⚠️  提示: 无法解析域名。请先连接“佛大 EasyConnect”或身处“佛大校园网”环境内再试！`);
    return false;
  }

  // 2. 检查网络访问
  console.log(`\n2. 正在尝试访问 ${FOSU_BASE_URL} ...`);
  try {
    const response = await axios.get(FOSU_BASE_URL, {
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400, // 或者是跳转
    });
    console.log(`   访问成功！HTTP 状态码: ${response.status}`);
  } catch (error) {
    // 可能是重定向到 authserver 导致报错，或者 TLS 证书问题，这里提取具体特征
    const responseUrl = error.config?.url || "";
    const isRedirectToAuth = responseUrl.includes("authserver.fosu.edu.cn") || error.message.includes("Redirect");
    
    if (isRedirectToAuth || (error.response && error.response.status === 302)) {
      console.log(`   访问成功！已成功跳转至统一身份认证页面。`);
    } else {
      console.error(`❌ 访问教务网失败: ${error.message}`);
      if (error.code === "ECONNABORTED") {
        console.log(`⚠️  访问超时。这通常是由于 VPN 连接不稳定或校内服务器无响应导致。`);
      } else {
        console.log(`⚠️  提示: 请检查是否已经打开并成功登录了 EasyConnect VPN。`);
      }
      return false;
    }
  }

  // 3. 检查统一认证可用性
  console.log(`\n3. 正在尝试访问统一身份认证 ${FOSU_AUTH_URL} ...`);
  try {
    const response = await axios.get(FOSU_AUTH_URL, {
      timeout: 8000,
    });
    console.log(`   访问成功！统一身份认证系统响应正常。`);
  } catch (error) {
    console.log(`⚠️  统一身份认证系统访问警告 (可能不影响使用): ${error.message}`);
  }

  console.log(`\n===================================`);
  console.log(`🎉 诊断结果: 本机校内网环境正常！已成功识别到校园网/VPN。`);
  console.log(`您可以继续运行 'npm run login' 进行登录。`);
  console.log(`===================================`);
  return true;
}

if (require.main === module) {
  diagnose().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = diagnose;
