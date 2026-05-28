/**
 * 本地诊断脚本：检查本机是否已成功连接佛大 EasyConnect VPN 或校园网。
 */

const dns = require("dns").promises;
const axios = require("axios");
require("dotenv").config();

const FOSU_BASE_URL = process.env.FOSU_BASE_URL || "https://100.fosu.edu.cn";
const FOSU_AUTH_URL = process.env.FOSU_AUTH_URL || "https://authserver.fosu.edu.cn";

// 检查是否为内网 IP 范围
function isInternalIp(ip) {
  if (!ip) return false;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  if (ip.startsWith("172.")) {
    const parts = ip.split(".").map(Number);
    if (parts.length >= 2) {
      return parts[1] >= 16 && parts[1] <= 31;
    }
  }
  // 兜底支持佛大可能使用的其他内网或特定网段
  return ip.startsWith("172.");
}

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
  let easyConnectLikelyConnected = false;

  try {
    const result = await dns.lookup(hostname, { all: true });
    addresses = result.map((r) => r.address);
    console.log(`   解析成功！解析到以下 IP 地址:`);
    addresses.forEach((addr) => {
      const isInternal = isInternalIp(addr);
      if (isInternal) {
        easyConnectLikelyConnected = true;
      }
      console.log(`   - ${addr} [${isInternal ? "校内内网 IP" : "外网/公网 IP"}]`);
    });
  } catch (error) {
    console.error(`❌ DNS 解析失败: ${error.message}`);
    console.log(`⚠️  提示: 无法解析域名。请先连接“佛大 EasyConnect”或身处“佛大校园网”环境内再试！`);
    return false;
  }

  if (!easyConnectLikelyConnected) {
    console.warn(`⚠️  警告: DNS 解析成功但未匹配到校内内网 IP 范围。`);
  }

  // 2. 检查网络访问 (HTTPS)
  console.log(`\n2. 正在尝试通过 Node.js 访问 HTTPS ${FOSU_BASE_URL} ...`);
  let httpsSuccess = false;
  let tlsHandshakeFailed = false;

  try {
    const response = await axios.get(FOSU_BASE_URL, {
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    console.log(`   HTTPS 访问成功！HTTP 状态码: ${response.status}`);
    httpsSuccess = true;
  } catch (error) {
    const responseUrl = error.config?.url || "";
    const isRedirectToAuth = responseUrl.includes("authserver.fosu.edu.cn") || error.message.includes("Redirect");
    
    if (isRedirectToAuth || (error.response && error.response.status === 302)) {
      console.log(`   HTTPS 访问成功！已成功跳转至统一身份认证页面。`);
      httpsSuccess = true;
    } else {
      console.warn(`⚠️  HTTPS 访问失败: ${error.message}`);
      // 判断是否为 SSL/TLS 握手失败
      const errStr = (error.message || "") + (error.code || "");
      if (
        errStr.includes("TLS") || 
        errStr.includes("handshake") || 
        errStr.includes("SSL") || 
        errStr.includes("disconnected") ||
        error.code === "ECONNRESET"
      ) {
        tlsHandshakeFailed = true;
      }
    }
  }

  // 3. 同时尝试 HTTP
  let httpSuccess = false;
  const httpUrl = FOSU_BASE_URL.replace(/^https:/i, "http:");
  console.log(`\n3. 正在尝试访问 HTTP 端口 ${httpUrl} ...`);
  try {
    const response = await axios.get(httpUrl, {
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });
    console.log(`   HTTP 访问成功！HTTP 状态码: ${response.status}`);
    httpSuccess = true;
  } catch (error) {
    const responseUrl = error.config?.url || "";
    const isRedirectToAuth = responseUrl.includes("authserver.fosu.edu.cn") || error.message.includes("Redirect");
    
    if (isRedirectToAuth || (error.response && error.response.status === 302)) {
      console.log(`   HTTP 访问成功！已成功跳转至统一身份认证页面。`);
      httpSuccess = true;
    } else {
      console.warn(`⚠️  HTTP 访问失败: ${error.message}`);
    }
  }

  // 4. 检查统一认证可用性 (如果是 HTTPS 访问，也进行一遍测试)
  console.log(`\n4. 正在尝试访问统一身份认证 ${FOSU_AUTH_URL} ...`);
  let authSuccess = false;
  try {
    await axios.get(FOSU_AUTH_URL, {
      timeout: 8000,
    });
    console.log(`   统一身份认证系统响应正常。`);
    authSuccess = true;
  } catch (error) {
    console.log(`⚠️  统一身份认证系统访问警告 (可能不影响使用): ${error.message}`);
  }

  console.log(`\n===================================`);
  
  // 最终状态判断
  if (httpsSuccess || httpSuccess) {
    console.log(`🎉 诊断结果: 本机校内网环境正常！已成功连接到教务网。`);
    console.log(`您可以继续运行 'npm run login' 进行登录。`);
    console.log(`===================================`);
    return true;
  }

  if (easyConnectLikelyConnected && tlsHandshakeFailed) {
    console.log(`ℹ️  [NODE_TLS_HANDSHAKE_FAILED]`);
    console.log(`提示: Node.js 与学校内网 HTTPS 服务握手失败，但 DNS 已解析到校内 IP，可继续尝试 Playwright 浏览器登录。`);
    console.log(`请运行 'npm run login'，Playwright 浏览器能够忽略此 TLS 握手问题。`);
    console.log(`===================================`);
    return true; // 允许继续
  }

  if (easyConnectLikelyConnected) {
    console.log(`ℹ️  提示: 虽然 Node.js 网络请求失败，但 DNS 已解析到校内内网 IP，允许继续尝试 Playwright 登录。`);
    console.log(`===================================`);
    return true; // 允许继续
  }

  console.error(`❌ 诊断结果: 无法连接到学校教务网！`);
  console.log(`💡 提示: 请先确认已启动并成功连接了 EasyConnect VPN。`);
  console.log(`===================================`);
  return false;
}

if (require.main === module) {
  diagnose().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = diagnose;
