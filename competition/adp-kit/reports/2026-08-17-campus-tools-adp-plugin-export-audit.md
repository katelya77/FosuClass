# 2026-08-17 CampusTools ADP 插件导出审计报告

- 日期：2026-08-17
- 分支：`feat/campusflow-adp-integration`（head `a25ac65` + 本次 R49.2 改动）
- 范围：`output/competition-adp/final/CampusFlow-ADP-Import-Bundle.zip`（含 4 个 Workflow ZIP）、`output/competition-adp/next/ADP-Runtime-Closure-Pack.zip`、`.tmp/adp-repro-a/{01-Schedule-Final,CampusFlow-ADP-Import-Bundle}.zip`
- 结论：**未发现明文凭据 / API Key / Token / Cookie / 私钥**；但发现工作流 JSON 内嵌**内部部署 URL**（见 §4 风险项）

## 1. 审计方法

- 全量解包 ZIP（含嵌套 ZIP）至临时目录，不做任何修改。
- 对全部文本类文件（json/md/txt/html/js/yaml/yml/env/ini/cfg）执行正则上下文扫描：
  `token | api_key | api-key | secret | password | passwd | authorization | bearer | credential | cookie | sessionid | akid | secretkey | BEGIN (RSA|PRIVATE|OPENSSH)`，命中项输出 ±45 字符上下文人工复核。
- 二进制类文件（xlsx / png 等）仅列文件名与来源，不逐字节扫描（工作流导出包的 xlsx 为参数/示例表，内容由 workflows.xlsx 导出源控制）。

## 2. 扫描结果（凭据类）

| 文件 | 命中 | 复核结论 |
| --- | --- | --- |
| `validation-report*.json`（bundle 内） | 文件名级 2 | 上下文复核 0 命中，纯误报（词库噪声） |
| `01/02/03/04 *_workflow.json`（final） | 103 / 70 / 95 / 65 | 见 §3 |
| `ADP-Runtime-Closure-Pack.zip`（next） | 0 | 干净 |
| `.tmp/adp-repro-a/*.zip` | 103（同一 01 workflow） | 同 §3 |

## 3. workflow.json 命中项逐类判定

1. `ModelParams` / `MaxTokens` / `Temperature`：**模型参数，非凭据**。模型名出现 `u-intent-pro`（腾讯平台模型标识，非密钥）。
2. HTTP 节点鉴权：
   - `SecretAuthData: {"Method":"TENCENT_CLOUD","TCAuthInfo":{}}` — 空对象，未内嵌凭据 ✅
   - Authorization 头绑定方式：`InputType: ENV_VARIABLE`（`ENV.campus_api_token`），且节点提示文本明确写「不要粘贴真实 token，token 值绑定到环境变量 ENV.campus_api_token」✅ —— 符合「不得把 API Key 写入导出包」纪律。
3. 中文提示文本中的「Bearer token」「cookie」等词：**使用说明性文字，非真实值**。

## 4. 风险项（非凭据，但需注意）

1. **内部部署 URL 内嵌于工作流**：
   `https://cloud1-d3g17rpe7566d3d5c-1442900641.ap-shanghai.app.tcloudbase.com/campusflow-adp-tools/api/get_academic_context`
   - 出现在 final 与 repro-a 的 `01-..._workflow.json` HTTP 节点中。
   - 这是**用户私有 CloudBase 环境域名**。导出包不进入本仓库 Git（位于 `output/` 与 `.tmp/`，属用户本地产物），因此不会污染 Git 历史；但：
   - 若需把导入包/评审材料**交给第三方账号或评委**，应先用匿名/相对地址替换或重定向到比赛专用环境；切勿直接外发含私有域名的 zip。
   - 提示：该节点路径为 `api/get_academic_context`（旧 CampusTools 直连端点），而 ADP 现行绑定应为 5 个 Agent Tool Façade（`/api/campus_*`，契约 `r49-ma/tools/openapi/campus-agent-tools.adp-import.json`，R49.2）。导入前需确认工作流指向的端点是当前 runtime 真实支持的路径。
2. **数据版本不一致**：bundle `manifest.json` 记录 `dataVersion=competition-demo-v1`、`dataHash=sha1:fefef4bf425b`（2026-08-12 编译器产物）；而当前事实源与已部署 runtime 为 `competition-demo-v2`、`sha1:4f3bbbb45d1f`（`/health` 实测 2026-08-17）。若该 bundle 曾被导入 ADP，模型侧数据事实存在滞后风险；新导入请基于 R49.2 契约 + v2 runtime 重新验证。

## 5. 合规结论与建议

- 凭据纪律：**通过**。所有扫描对象均无明文凭据；鉴权走环境变量。
- 建议：
  1. 使用 `r49-ma/tools/openapi/campus-agent-tools.adp-import.json`（R49.2）作为导入契约，确认工作流 HTTP 节点指向 `/api/campus_*` Façade。
  2. 对外分享任何 zip 前执行 `git check-ignore` 确认不落 Git + 私有域名脱敏。
  3. 重新导出（如需要）时以 `competition-demo-v2`（sha1:4f3bbbb45d1f）为数据基准，避免 v1/v2 混用。
