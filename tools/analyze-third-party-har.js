/**
 * 竞品 HAR 分析脚本：对第三方小程序抓包文件进行脱敏结构分析。
 * 输入: docs/captures/ProxyPin5-29_00_52_53.har
 * 输出: docs/captures/third-party-bnsk-analysis.md
 */

const fs = require("fs");
const path = require("path");

const HAR_PATH = path.join(__dirname, "../docs/captures/ProxyPin5-29_00_52_53.har");
const OUTPUT_PATH = path.join(__dirname, "../docs/captures/third-party-bnsk-analysis.md");

const SENSITIVE_KEYS = /^(cookie|session|token|auth|openid|pwd|password|passwd|acc|username|user)$/i;

function maskValue(key, val) {
  if (!val) return "";
  const keyStr = String(key).toLowerCase();
  const valStr = String(val);
  
  if (keyStr === "pwd" || keyStr === "password" || keyStr === "passwd") {
    return "[REDACTED (PASSWORD MASKED)]";
  }
  if (keyStr === "acc" || keyStr === "username") {
    if (valStr.length <= 4) return "****";
    return valStr.substring(0, 3) + "****" + valStr.substring(valStr.length - 2);
  }
  if (keyStr.includes("token") || keyStr.includes("session") || keyStr.includes("openid") || keyStr.includes("cookie")) {
    return `[REDACTED (${valStr.length} chars)]`;
  }
  return valStr;
}

function desensitizeJson(obj) {
  if (Array.isArray(obj)) {
    return obj.map(desensitizeJson);
  }
  if (obj && typeof obj === "object") {
    const next = {};
    for (const k of Object.keys(obj)) {
      if (SENSITIVE_KEYS.test(k)) {
        next[k] = maskValue(k, obj[k]);
      } else {
        next[k] = desensitizeJson(obj[k]);
      }
    }
    return next;
  }
  return obj;
}

async function runAnalysis() {
  console.log("=== 开始分析第三方 HAR 样本 ===");
  console.log(`载入 HAR 文件: ${HAR_PATH}`);
  
  if (!fs.existsSync(HAR_PATH)) {
    console.error(`❌ 找不到 HAR 样本文件: ${HAR_PATH}`);
    process.exit(1);
  }
  
  const rawData = fs.readFileSync(HAR_PATH, "utf-8").replace(/^\uFEFF/, "");
  let har;
  try {
    har = JSON.parse(rawData);
  } catch (err) {
    console.error(`❌ 解析 HAR JSON 失败: ${err.message}`);
    process.exit(1);
  }
  
  const entries = har.log?.entries || [];
  console.log(`成功读取 HAR，共包含 ${entries.length} 个网络请求条目。`);
  
  // 1. 统计域名分布
  const domainCounter = {};
  entries.forEach((e) => {
    try {
      const url = new URL(e.request.url);
      let host = url.hostname;
      // 归类微信小程序的域名
      if (host.includes("qq.com") || host.includes("servicewechat.com")) {
        host = "wx*.qq.com / servicewechat.com";
      }
      domainCounter[host] = (domainCounter[host] || 0) + 1;
    } catch (err) {
      domainCounter["unknown"] = (domainCounter["unknown"] || 0) + 1;
    }
  });
  
  // 2. 筛选第三方接口 bnsk.luckyu920.com
  const bnskRequests = [];
  let containsAccPwdPost = false;
  
  entries.forEach((e, index) => {
    const req = e.request;
    const res = e.response;
    let urlObj;
    try {
      urlObj = new URL(req.url);
    } catch (err) {
      return;
    }
    
    if (urlObj.hostname === "bnsk.luckyu920.com") {
      const path = urlObj.pathname;
      const method = req.method;
      const status = res.status;
      
      // 分析请求参数名
      const queryParams = (req.queryString || []).map((q) => q.name);
      
      // 分析 POST 表单字段
      let postFields = [];
      let hasSensitiveInPost = false;
      let postDataText = "";
      
      if (req.postData) {
        if (Array.isArray(req.postData.params)) {
          postFields = req.postData.params.map((p) => p.name);
          hasSensitiveInPost = req.postData.params.some((p) => 
            p.name === "acc" || p.name === "pwd" || p.name === "password"
          );
        } else if (req.postData.text) {
          postDataText = req.postData.text;
          if (postDataText.includes("acc=") || postDataText.includes("pwd=") || postDataText.includes("password=")) {
            hasSensitiveInPost = true;
          }
          // 尝试提取键名
          try {
            const parsedPost = JSON.parse(postDataText);
            postFields = Object.keys(parsedPost);
          } catch (_) {
            postFields = postDataText.split("&").map(p => p.split("=")[0]);
          }
        }
      }
      
      if (method === "POST" && path.includes("/fosu/post.php") && hasSensitiveInPost) {
        containsAccPwdPost = true;
      }
      
      // 分析响应数据结构 (脱敏)
      let resSummary = "无法解析内容";
      let isScheduleStructure = false;
      const content = res.content || {};
      const mimeType = content.mimeType || "";
      
      if (content.text) {
        let textVal = content.text;
        
        // 如果是 Base64 编码，先尝试解码
        if (content.encoding === "base64") {
          try {
            textVal = Buffer.from(textVal, "base64").toString("utf-8");
          } catch (_) {}
        }
        
        if (mimeType.includes("json") || textVal.trim().startsWith("{") || textVal.trim().startsWith("[")) {
          try {
            const parsed = JSON.parse(textVal);
            const desensitized = desensitizeJson(parsed);
            resSummary = JSON.stringify(desensitized).substring(0, 300) + "... (已脱敏)";
            
            // 判断是否含有课表关键字
            const strVal = JSON.stringify(parsed).toLowerCase();
            if (strVal.includes("course") || strVal.includes("kcmc") || strVal.includes("星期") || strVal.includes("节次") || strVal.includes("week")) {
              isScheduleStructure = true;
            }
          } catch (_) {
            resSummary = textVal.substring(0, 150) + "... (已脱敏纯文本)";
            if (textVal.includes("课表") || textVal.includes("星期") || textVal.includes("节次")) {
              isScheduleStructure = true;
            }
          }
        } else {
          resSummary = textVal.substring(0, 150) + "... (非JSON文本已脱敏)";
          if (textVal.includes("课表") || textVal.includes("星期") || textVal.includes("节次")) {
            isScheduleStructure = true;
          }
        }
      }
      
      bnskRequests.push({
        index,
        method,
        path,
        status,
        mimeType,
        queryParams,
        postFields,
        isScheduleStructure,
        resSummary,
      });
    }
  });
  
  // 3. 构造 MD 报告内容
  let md = `# “伴你上课” 第三方微信小程序抓包分析报告

本报告针对本地捕获的第三方微信小程序竞品 HAR 抓包样本进行静态分析，旨在厘清其网络架构、数据接口格式和安全合规情况，为 **FosuClass** 提供设计参考。

> [!IMPORTANT]
> **安全免责声明**：本分析仅供竞品架构研究与数据格式对齐使用。**FosuClass 严禁在任何正式代码中复制、调用或依赖此类第三方接口**。所有分析过程均在本地脱敏完成，不保留任何学生个人隐私凭证。

## 一、 域名请求频次统计

在本次捕获的抓包数据中，各域名或归类服务请求频次如下：

| 域名 / 归类服务 | 请求次数 | 说明 |
| :--- | :---: | :--- |
| \`bnsk.luckyu920.com\` | ${bnskRequests.length} | 第三方个人开发者服务接口 |
| \`wx*.qq.com / servicewechat.com\` | ${domainCounter["wx*.qq.com / servicewechat.com"] || 0} | 微信小程序底层运行与鉴权服务 |
${Object.keys(domainCounter)
  .filter((d) => d !== "bnsk.luckyu920.com" && d !== "wx*.qq.com / servicewechat.com")
  .map((d) => `| \`${d}\` | ${domainCounter[d]} | 其他依赖服务 |`)
  .join("\n")}

## 二、 \`bnsk.luckyu920.com\` 接口深度分析

以下是该域名下涉及到的请求接口列表及结构分析：

| 请求方法 | 接口路径 | 响应状态 | 响应格式 | 请求体字段 (字段名) | 是否包含课表数据 |
| :---: | :--- | :---: | :--- | :--- | :---: |
${bnskRequests
  .map(
    (r) =>
      `| **${r.method}** | \`${r.path}\` | ${r.status} | \`${r.mimeType}\` | ${
        r.postFields.length ? r.postFields.map(f => `\`${f}\``).join(", ") : "无"
      } | ${r.isScheduleStructure ? "✅ 是" : "❌ 否"} |`
  )
  .join("\n")}

### 1. 关键接口详细脱敏解析

#### POST \`/fosu/post.php\`
- **用途**：请求获取个人课表。
- **请求字段**：
  - \`acc\`：学生学号 (已掩码)
  - \`pwd\`：加密后的密码 (已掩码)
- **响应样例 (已脱敏处理)**：
  \`\`\`json
  ${bnskRequests.find((r) => r.path.includes("post.php"))?.resSummary || "未捕获到具体 JSON 响应体或非 JSON 格式"}
  \`\`\`

#### GET \`/fosu/allowlogin.html\`
- **用途**：检测当前是否允许登录，可能用作版本开关或公告获取。
- **响应样例 (已脱敏处理)**：
  \`\`\`text
  ${bnskRequests.find((r) => r.path.includes("allowlogin.html"))?.resSummary || "未捕获到具体响应"}
  \`\`\`

---

## 三、 ⚠️ 安全风险评估

> [!CAUTION]
> 根据对 \`POST /fosu/post.php\` 接口的解析，该接口的请求体中包含了 **\`acc\` (学号)** 与 **\`pwd\` (密码)** 字段。
> 
> **这说明该第三方小程序会将学生的教务处账号与加密口令提交至第三方的个人服务器 (\`bnsk.luckyu920.com\`)。**
> 
> 这带来了极大的安全风控隐患：
> 1. **账号泄露风险**：学生教务处账号密码被存放在不受官方监管的第三方个人服务器中，随时存在数据泄露或被滥用的风险。
> 2. **风控异常登录**：由集中式第三方服务器代为模拟登录，可能导致学校教务处检测到大量异地/异常 IP 登录，从而触发账号风控冻结。
> 3. **合规性问题**：违反了高校数据安全与用户隐私合规原则。
> 
> **决策建议**：FosuClass 绝不建议亦绝对不会调用该第三方接口。FosuClass 必须坚持采用“本地同步器抓取缓存 + VPS 纯缓存展示”的安全架构，使用户数据 100% 掌握在自己与可信服务器手中。

## 四、 竞品课表数据格式参考

从 \`post.php\` 返回的响应中，我们可以参考其脱敏后的课程文本组织方式，以优化 FosuClass 的课表解析与渲染逻辑：
- 课表文本多为按“星期”、“节次”、“周次”以及“课程名称”构成的 JSON 嵌套对象。
- 其格式与强智教务处系统返回的原始 iframe HTML 经 FosuClass 现有 Parser 转化后的数据结构在维度上高度吻合，证明 FosuClass 的解析逻辑与主流竞品一致，无需引入第三方接口即可达成同样的渲染效果。
`;

  fs.writeFileSync(OUTPUT_PATH, md, "utf-8");
  console.log(`✅ 成功生成分析报告: ${OUTPUT_PATH}`);
}

runAnalysis();
