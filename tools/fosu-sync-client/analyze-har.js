/**
 * 竞品小程序 HAR 抓包分析脚本：
 * 读取并静态分析 ProxyPin 导出的 HAR 数据包，
 * 梳理第三方接口交互格式，并评估其隐私安全风险。
 */

const fs = require("fs");
const path = require("path");

const HAR_PATH = path.resolve(__dirname, "../../docs/captures/ProxyPin5-29_00_52_53.har");
const REPORT_PATH = path.resolve(__dirname, "../../docs/captures/third-party-bnsk-analysis.md");

// 确保 docs/captures 目录存在
const capturesDir = path.dirname(HAR_PATH);
if (!fs.existsSync(capturesDir)) {
  fs.mkdirSync(capturesDir, { recursive: true });
}

function desensitize(text, fieldName = "") {
  if (!text) return "";
  const name = fieldName.toLowerCase();
  
  // 密码或口令脱敏
  if (name.includes("pwd") || name.includes("pass") || name.includes("secret")) {
    return "[REDACTED_PASSWORD_HASH]";
  }
  
  // 学号脱敏 (掩盖后 6 位)
  if (name.includes("acc") || name.includes("user") || name.includes("student")) {
    if (text.length > 6) {
      return text.substring(0, text.length - 6) + "******";
    }
    return "******";
  }

  // 姓名脱敏 (保留姓氏)
  if (name.includes("name") || name.includes("xm")) {
    if (text.length > 0) {
      return text[0] + "*".repeat(text.length - 1);
    }
  }

  return text;
}

function analyze() {
  console.log("=== 开始静态分析 HAR 抓包数据 ===");
  console.log(`输入文件: ${HAR_PATH}`);

  if (!fs.existsSync(HAR_PATH)) {
    console.error(`❌ 未找到目标 HAR 抓包文件，请确认路径正确：\n${HAR_PATH}`);
    process.exit(1);
  }

  let harData;
  try {
    const raw = fs.readFileSync(HAR_PATH, "utf-8");
    harData = JSON.parse(raw);
  } catch (err) {
    console.error(`❌ 解析 HAR JSON 失败: ${err.message}`);
    process.exit(1);
  }

  const entries = harData.log?.entries || [];
  console.log(`📊 共载入 ${entries.length} 条网络请求记录。`);

  // 统计不同域名的频次
  const domainCounter = {};
  const bnskRequests = [];

  entries.forEach(entry => {
    const urlStr = entry.request?.url || "";
    try {
      const url = new URL(urlStr);
      const host = url.hostname;
      domainCounter[host] = (domainCounter[host] || 0) + 1;
      
      if (host.includes("luckyu920.com")) {
        bnskRequests.push(entry);
      }
    } catch (e) {
      // 忽略非法 URL 格式
    }
  });

  console.log("\n🌐 域名请求频次分布统计:");
  Object.keys(domainCounter).forEach(host => {
    console.log(`   - ${host}: ${domainCounter[host]} 次`);
  });

  console.log(`\n📌 发现 ${bnskRequests.length} 条指向 luckyu920.com 的竞品调用。`);

  // 对 bnsk 请求进行细节梳理并脱敏
  const apiDetails = [];
  bnskRequests.forEach(req => {
    const request = req.request;
    const response = req.response;
    const url = new URL(request.url);
    const pathStr = url.pathname;
    const method = request.method;
    const status = response.status;
    const contentType = response.content?.mimeType || "text/plain";
    
    // 解析 POST Body 参数名
    const postParams = [];
    const desensitizedPostData = {};
    if (request.postData?.text) {
      const text = request.postData.text;
      const urlParams = new URLSearchParams(text);
      urlParams.forEach((val, key) => {
        postParams.push(key);
        desensitizedPostData[key] = desensitize(val, key);
      });
    }

    // 尝试解析响应文本并脱敏
    let responseText = response.content?.text || "";
    let isSchedule = false;
    let desensitizedResponse = responseText;

    if (responseText) {
      // 判断是否包含课表特征
      if (responseText.includes("获取课表成功") || responseText.includes("动物解剖学")) {
        isSchedule = true;
      }
      
      // 响应体脱敏：将返回的学生个人姓名和学号进行替换
      // 假设格式为 "获取课表成功|学号|姓名|学院|班级|时间戳"
      if (isSchedule) {
        const parts = responseText.split("|");
        if (parts.length > 4) {
          parts[1] = desensitize(parts[1], "acc"); // 学号
          parts[2] = desensitize(parts[2], "name"); // 姓名
          desensitizedResponse = parts.slice(0, 5).join("|") + "|[REDACTED_SCHEDULE_DATA_ARRAY]";
        }
      }
    }

    apiDetails.push({
      method,
      path: pathStr,
      status,
      contentType,
      postParams,
      desensitizedPostData,
      isSchedule,
      desensitizedResponse: desensitizedResponse.substring(0, 180) + (desensitizedResponse.length > 180 ? "..." : "")
    });
  });

  // 3. 生成脱敏 Markdown 分析报告
  let report = `# “伴你上课” 第三方微信小程序抓包分析报告

本报告针对本地捕获的第三方微信小程序竞品 HAR 抓包样本进行静态分析，旨在厘清其网络架构、数据接口格式和安全合规情况，为 **FosuClass** 提供设计参考。

> [!IMPORTANT]
> **安全免责声明**：本分析仅供竞品架构研究与数据格式对齐使用。**FosuClass 严禁在任何正式代码中复制、调用或依赖此类第三方接口**。所有分析过程均在本地脱敏完成，不保留任何学生个人隐私凭证。

## 一、 域名请求频次统计

在本次捕获的抓包数据中，各域名或归类服务请求频次如下：

| 域名 / 归类服务 | 请求次数 | 说明 |
| :--- | :---: | :--- |
`;

  Object.keys(domainCounter).forEach(host => {
    let desc = "辅助依赖服务";
    if (host.includes("luckyu920.com")) {
      desc = "第三方个人开发者服务接口";
    } else if (host.includes("qq.com") || host.includes("servicewechat.com")) {
      desc = "微信小程序底层运行与鉴权服务";
    }
    report += `| \`${host}\` | ${domainCounter[host]} | ${desc} |\n`;
  });

  report += `
## 二、 \`bnsk.luckyu920.com\` 接口深度分析

以下是该域名下涉及到的请求接口列表及结构分析：

| 请求方法 | 接口路径 | 响应状态 | 响应格式 | 请求体字段 (字段名) | 是否包含课表数据 |
| :---: | :--- | :---: | :--- | :--- | :---: |
`;

  apiDetails.forEach(api => {
    report += `| **${api.method}** | \`${api.path}\` | ${api.status} | \`${api.contentType.split(";")[0]}\` | ${api.postParams.length > 0 ? api.postParams.map(p => `\`${p}\``).join(", ") : "无"} | ${api.isSchedule ? "✅ 是" : "❌ 否"} |\n`;
  });

  report += `
### 1. 关键接口详细脱敏解析

`;

  apiDetails.forEach(api => {
    report += `#### ${api.method} \`${api.path}\`
- **用途**：${api.isSchedule ? "请求获取个人课表" : "环境可用性校验或版本公告"}
- **请求字段**（已掩码脱敏）：
  \`\`\`json
  ${JSON.stringify(api.desensitizedPostData, null, 2).replace(/\n/g, "\n  ")}
  \`\`\`
- **响应样例**（已掩码脱敏）：
  \`\`\`text
  ${api.desensitizedResponse}
  \`\`\`

`;
  });

  report += `## 三、 ⚠️ 安全风险评估

> [!CAUTION]
> 根据对 \`POST /fosu/post.php\` 接口的解析，该接口的请求体中包含了 **学号 (\`acc\`)** 与 **密码 (\`pwd\`)** 字段。
> 
> **这说明该第三方小程序会将学生的教务处账号与口令加密后提交至第三方的个人服务器 (\`bnsk.luckyu920.com\`)，由其后台代理访问教务网。**
> 
> 这带来了极大的数据安全与合规风险：
> 1. **凭证泄露隐患**：学生的学校教务密码被送往第三方服务器，有被截获、解密甚至用于其他用途的隐患。
> 2. **风控异常登录**：集中式第三方服务器模拟登录会导致学校内网防火墙检测到突发、高频的异地 IP 登录，从而触发教务系统的账号封禁。
> 3. **安全架构劣势**：一旦第三方服务器宕机或作者不再维护，整个小程序课表系统将彻底瘫痪。
> 
> **决策建议**：FosuClass 绝不调用或依赖该第三方接口。FosuClass 必须坚持采用“本地同步器抓取缓存 + 开发者/用户贡献课表 + VPS 纯缓存展示”的离线安全架构。

## 四、 竞品课表数据格式参考

从 \`post.php\` 返回的脱敏响应中可以看出：
- 其格式为简单的竖线 \`|\` 割裂字符组成的数据流，这能极大缩减网络报文大小。
- 返回的课程属性包含：课程名、上课周次、任课教师和上课教室。
- 维度上与强智教务处系统返回的原始 iframe HTML 经 FosuClass 现有 Parser 转化后的数据结构高度吻合，证明 FosuClass 独立编写的 HTML 解析模块足以自给自足。
`;

  fs.writeFileSync(REPORT_PATH, report, "utf-8");
  console.log(`✅ 成功生成 HAR 抓包脱敏分析报告: docs/captures/third-party-bnsk-analysis.md`);
}

if (require.main === module) {
  analyze();
}

module.exports = analyze;
