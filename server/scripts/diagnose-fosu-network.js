/**
 * 后端诊断脚本：在服务器上检查能否访问佛大教务系统。
 * 如果解析失败或无法连接，输出引导本地同步架构的信息。
 */

const dns = require("dns").promises;
const axios = require("axios");
const config = require("../src/config");

async function runDiagnosis() {
  console.log("=== 佛山大学教务网 VPS 网络连通性诊断 ===");
  const targetUrl = config.FOSU_BASE_URL || "https://100.fosu.edu.cn";
  const hostname = new URL(targetUrl).hostname;
  
  console.log(`目标域名: ${hostname}`);
  console.log("正在尝试进行 DNS 解析...");

  let ips = [];
  try {
    const result = await dns.lookup(hostname, { all: true });
    ips = result.map((r) => r.address);
    console.log(`DNS 解析成功: ${ips.join(", ")}`);
  } catch (error) {
    console.error("❌ DNS 解析失败！无法获取域名 IP 地址。");
    console.log(JSON.stringify({
      success: false,
      reasonCode: "FOSU_INTRANET_ONLY",
      message: "100.fosu.edu.cn 仅佛大校园网或 EasyConnect VPN 内可解析。Oracle VPS 不应直接连接校园 VPN，建议使用本地同步器同步数据。",
      details: error.message
    }, null, 2));
    process.exit(1);
  }

  console.log("正在尝试发起 HTTP 连接...");
  try {
    const response = await axios.get(targetUrl, { timeout: 5000 });
    console.log(`🎉 连接成功！HTTP 状态码: ${response.status}`);
  } catch (error) {
    console.error("❌ 发起 HTTP 请求失败！");
    console.log(JSON.stringify({
      success: false,
      reasonCode: "FOSU_INTRANET_ONLY",
      message: "100.fosu.edu.cn 仅佛大校园网或 EasyConnect VPN 内可解析。Oracle VPS 不应直接连接校园 VPN，建议使用本地同步器同步数据。",
      details: error.message
    }, null, 2));
    process.exit(1);
  }
}

runDiagnosis();
