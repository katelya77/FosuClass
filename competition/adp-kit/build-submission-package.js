#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const COMPETITION_ROOT = path.resolve(ROOT, "..");
const OUTPUT = path.resolve(COMPETITION_ROOT, "submission-package");
if (path.dirname(OUTPUT) !== COMPETITION_ROOT || path.basename(OUTPUT) !== "submission-package") {
  throw new Error(`拒绝清理非预期目录：${OUTPUT}`);
}

const PERSONAL_IMPORT_EXCLUDED = ["personal-import", "raw-import", "private-import", "personal-timetables"];
for (const dir of PERSONAL_IMPORT_EXCLUDED) {
  const candidate = path.join(COMPETITION_ROOT, dir);
  if (fs.existsSync(candidate)) {
    throw new Error(`拒绝打包个人导入目录：${candidate}（提交包只允许匿名数据，隐私边界见 r49-ma/data-hub/privacy-policy.json）`);
  }
}

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function write(relative, content) {
  const target = path.join(OUTPUT, relative);
  ensureParent(target);
  fs.writeFileSync(target, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function copy(sourceRelative, targetRelative = sourceRelative) {
  const source = path.resolve(ROOT, sourceRelative);
  if (!source.startsWith(`${ROOT}${path.sep}`)) throw new Error(`非法源路径：${sourceRelative}`);
  const target = path.join(OUTPUT, targetRelative);
  ensureParent(target);
  fs.copyFileSync(source, target);
}

function copyDirectory(sourceRelative, targetRelative, accept = () => true) {
  const sourceRoot = path.join(ROOT, sourceRelative);
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const source = path.join(dir, entry.name);
      const relative = path.relative(sourceRoot, source).replace(/\\/g, "/");
      if (entry.isDirectory()) visit(source);
      else if (entry.isFile() && accept(relative)) copy(path.join(sourceRelative, relative), path.join(targetRelative, relative));
    }
  };
  visit(sourceRoot);
}

fs.rmSync(OUTPUT, { recursive: true, force: true });
fs.mkdirSync(OUTPUT, { recursive: true });

const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, "mock-data", "competition-demo-v1.json"), "utf8"));
dataset.meta.generatedBy = "CampusFlow deterministic demo data generator";
write("mock-data/competition-demo-v1.json", JSON.stringify(dataset, null, 2));
copy("mock-data/competition-demo-v1.schema.json", "mock-data/competition-demo-v1.schema.json");

copyDirectory("knowledge", "knowledge", (file) => /\.md$/.test(file));
copyDirectory("qa", "qa", (file) => /\.(?:json|csv|md)$/.test(file));
copyDirectory("workflows", "workflows", (file) => /^(?:0[1-4]-.*\.md|workflow-specs\.json|application-config\.json|role-instruction\.txt)$/.test(file));
copyDirectory("widget", "widget", (file) => /^(?:index\.html|styles\.css|widget\.js|widget-schema\.json|sample-results\.(?:json|js)|校园任务结果卡\.md)$/.test(file));
copyDirectory("evaluation", "evaluation", (file) => /^(?:evaluation-dataset\.(?:json|jsonl|csv)|golden-results\.json|golden-cases\.js|golden-oracle\.js|eval-golden\.js|scoring-rubric\.md)$/.test(file));

copyDirectory("mcp/campus-tools-mcp/src", "tools/campus-tools-mcp/src", (file) => /\.(?:js|ts)$/.test(file));
copyDirectory("mcp/campus-tools-mcp/test", "tools/campus-tools-mcp/test", (file) => /\.test\.js$/.test(file));
for (const file of ["package.json", "package-lock.json", "tsconfig.json"]) copy(`mcp/campus-tools-mcp/${file}`, `tools/campus-tools-mcp/${file}`);
const dockerfile = fs.readFileSync(path.join(ROOT, "mcp", "campus-tools-mcp", "Dockerfile"), "utf8")
  .replace(/adp-kit/g, "submission-package")
  .replace(/mcp\/campus-tools-mcp/g, "tools/campus-tools-mcp");
write("tools/campus-tools-mcp/Dockerfile", dockerfile);

const oraclePath = path.join(OUTPUT, "evaluation", "golden-oracle.js");
const oracle = fs.readFileSync(oraclePath, "utf8")
  .replace(/mcp\/campus-tools-mcp/g, "tools/campus-tools-mcp");
fs.writeFileSync(oraclePath, oracle, "utf8");
const submissionGoldenPath = path.join(OUTPUT, "evaluation", "golden-results.json");
const submissionGolden = JSON.parse(fs.readFileSync(submissionGoldenPath, "utf8"));
submissionGolden.oracleSourceSha256 = require(oraclePath).sourceSha256();
fs.writeFileSync(submissionGoldenPath, `${JSON.stringify(submissionGolden, null, 2)}\n`, "utf8");

const openapi = JSON.parse(fs.readFileSync(path.join(ROOT, "openapi", "campus-tools.openapi.json"), "utf8"));
openapi.servers = [{
  url: "https://{host}",
  description: "部署后填写评审环境的 CampusTools HTTPS 主机名",
  variables: { host: { default: "example.invalid" } },
}];
write("openapi/campus-tools.openapi.json", JSON.stringify(openapi, null, 2));

copy("validate-submission-package.js", "tools/validate-submission-package.js");
write("package.json", JSON.stringify({
  name: "campusflow-competition-submission",
  version: "1.0.0",
  private: true,
  description: "校园智序 · 小序匿名评审工程包",
  scripts: {
    "eval:golden": "node evaluation/eval-golden.js",
    "validate:anonymous": "node tools/validate-submission-package.js",
    test: "npm --prefix tools/campus-tools-mcp test && npm run eval:golden && npm run validate:anonymous",
  },
}, null, 2));

write("README.md", `# 校园智序 · 小序

CampusFlow / CampusTools 匿名评审工程包。动态课程、空教室、冲突和计划事实全部由只读 CampusTools 基于 \`competition-demo-v1\` 确定性计算；生成模型不参与最终事实计算。

## 内容

- \`mock-data/\`：2026-2027 学年第一学期匿名演示数据与 Schema
- \`tools/campus-tools-mcp/\`：MCP、SSE、REST 兼容的 CampusTools 源码与测试
- \`openapi/\`：只含 \`{host}\` 占位符的 OpenAPI 模板
- \`knowledge/\`、\`qa/\`：稳定规则知识；不含动态课表事实
- \`workflows/\`：四条最小 ADP 工作流契约
- \`widget/\`：校园任务结果卡源码与匿名样例
- \`evaluation/\`：80 条任务评测与 33 条确定性 Golden Result

## 验证

\`npm test\`

结果必须同时通过 CampusTools 行为测试、Golden 事实比对和全目录匿名扫描。部署前请在 OpenAPI 中把 \`{host}\` 绑定到独立评审环境；不要连接任何真实校园数据源。`);

function allFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? allFiles(full) : [full];
  });
}
const manifest = allFiles(OUTPUT)
  .filter((file) => path.basename(file) !== "SHA256SUMS.json")
  .sort()
  .map((file) => {
    const buffer = fs.readFileSync(file);
    return {
      path: path.relative(OUTPUT, file).replace(/\\/g, "/"),
      bytes: buffer.length,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    };
  });
write("SHA256SUMS.json", JSON.stringify({ schema: "campusflow-submission-manifest/v1", files: manifest }, null, 2));

require("./validate-submission-package").validate(OUTPUT);
console.log(`[ok] submission-package files=${manifest.length + 1} dataVersion=${dataset.meta.dataVersion} dataHash=${dataset.dataHash}`);
