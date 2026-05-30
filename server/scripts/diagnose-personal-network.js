/**
 * 个人课表网络连通性健康诊断脚本
 * NOTE: 检查 authserver.fosu.edu.cn 与 100.fosu.edu.cn 的 DNS 解析状态及 HTTP(S) 可达性，并在异常时给出具体的排查指导。
 */

const dns = require("dns").promises;
const axios = require("axios");

async function checkDns(hostname) {
  try {
    const ips = await dns.lookup(hostname);
    return { resolved: true, address: ips.address };
  } catch (error) {
    return { resolved: false, error: error.message };
  }
}

async function checkHttp(url) {
  try {
    const res = await axios.get(url, {
      timeout: 5000,
      validateStatus: () => true, // 允许所有状态码
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    return { reachable: true, status: res.status };
  } catch (error) {
    return { reachable: false, error: error.message };
  }
}

async function runDiagnosis() {
  console.log("==================================================");
  console.log("  FosuClass 个人同步网络环境诊断工具");
  console.log("==================================================");

  const authHost = "authserver.fosu.edu.cn";
  const eduHost = "100.fosu.edu.cn";

  const authLoginUrl = "https://authserver.fosu.edu.cn/authserver/login";
  const eduHomeUrl = "http://100.fosu.edu.cn";
  const eduCasUrl = "http://100.fosu.edu.cn/caslogin.jsp?kstzType=null";

  // 1. DNS 检查
  console.log("1. 正在检查 DNS 解析状态...");
  const authDns = await checkDns(authHost);
  const eduDns = await checkDns(eduHost);

  if (authDns.resolved) {
    console.log(`[✔] ${authHost} 解析成功: ${authDns.address}`);
  } else {
    console.log(`[✘] ${authHost} 解析失败: ${authDns.error}`);
  }

  if (eduDns.resolved) {
    console.log(`[✔] ${eduHost} 解析成功: ${eduDns.address}`);
  } else {
    console.log(`[✘] ${eduHost} 解析失败: ${eduDns.error}`);
  }

  // 2. HTTP/HTTPS 可达性检查
  console.log("\n2. 正在检查 HTTP/HTTPS 连通性...");
  
  let authHttp = { reachable: false };
  if (authDns.resolved) {
    authHttp = await checkHttp(authLoginUrl);
    if (authHttp.reachable) {
      console.log(`[✔] 统一认证登录页 ${authLoginUrl} 访问成功，状态码: ${authHttp.status}`);
    } else {
      console.log(`[✘] 统一认证登录页 ${authLoginUrl} 访问失败: ${authHttp.error}`);
    }
  } else {
    console.log(`[-] 由于 DNS 解析失败，跳过访问 ${authLoginUrl}`);
  }

  let eduHomeHttp = { reachable: false };
  let eduCasHttp = { reachable: false };

  if (eduDns.resolved) {
    eduHomeHttp = await checkHttp(eduHomeUrl);
    if (eduHomeHttp.reachable) {
      console.log(`[✔] 教务 100 网首页 ${eduHomeUrl} 访问成功，状态码: ${eduHomeHttp.status}`);
    } else {
      console.log(`[✘] 教务 100 网首页 ${eduHomeUrl} 访问失败: ${eduHomeHttp.error}`);
    }

    eduCasHttp = await checkHttp(eduCasUrl);
    if (eduCasHttp.reachable) {
      console.log(`[✔] 教务 100 网登录入口 ${eduCasUrl} 访问成功，状态码: ${eduCasHttp.status}`);
    } else {
      console.log(`[✘] 教务 100 网登录入口 ${eduCasUrl} 访问失败: ${eduCasHttp.error}`);
    }
  } else {
    console.log(`[-] 由于 DNS 解析失败，跳过访问 ${eduHomeUrl} 和 ${eduCasUrl}`);
  }

  // 3. 输出总结和建议
  console.log("\n==================================================");
  console.log("  诊断结论与排查建议");
  console.log("==================================================");

  if (authHttp.reachable && !eduDns.resolved) {
    console.log("诊断状态：统一认证站可访问，但教务 100 网在当前运行环境中无法解析。");
    console.log("\n排查建议：");
    console.log("个人课表同步需要后端能同时访问 authserver.fosu.edu.cn 和 100.fosu.edu.cn。");
    console.log("请检查 Docker DNS、服务器是否处于校园网/校 VPN、或是否需要配置内网 DNS/hosts。");
  } else if (!authDns.resolved && !eduDns.resolved) {
    console.log("诊断状态：检测到彻底的网络不通或外网 DNS 解析失效。");
    console.log("\n排查建议：");
    console.log("当前节点可能无法连接任何学校资源，请先检查宿主机/容器的网络连接和 DNS 配置。");
  } else if (authHttp.reachable && eduDns.resolved && (!eduHomeHttp.reachable || !eduCasHttp.reachable)) {
    console.log("诊断状态：统一认证站可访问，教务 100 网域名可解析，但 100 网 HTTP 连通失败。");
    console.log("\n排查建议：");
    console.log("可能需要通过校园网或校内 VPN 环境才能访问 100 网。请检查网络路由及防火墙规则。");
  } else if (authHttp.reachable && eduHomeHttp.reachable && eduCasHttp.reachable) {
    console.log("诊断状态：各项服务指标正常。");
    console.log("\n建议：网络连接状况良好，您可以继续进行滑块与登录认证测试。");
  } else {
    console.log("诊断状态：部分或全部服务访问异常。");
    console.log("\n排查建议：");
    console.log(`- 统一认证站 DNS: ${authDns.resolved ? "正常" : "异常"}`);
    console.log(`- 统一认证站 HTTP: ${authHttp.reachable ? "正常" : "异常"}`);
    console.log(`- 100 网 DNS: ${eduDns.resolved ? "正常" : "异常"}`);
    console.log(`- 100 网 HTTP: ${eduHomeHttp.reachable ? "正常" : "异常"}`);
    console.log("请根据上述异常项排查内网代理、VPN、Docker 网络路由等设置。");
  }
  console.log("==================================================");
}

runDiagnosis().catch((err) => {
  console.error("运行诊断工具时发生未知错误:", err);
  process.exit(1);
});
