#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const joined = (...parts) => parts.join("");
const FORBIDDEN_TERMS = [
  joined("Fosu", "Class"),
  joined("佛课", "小表"),
  joined("小佛", "助手"),
  joined("小佛", "AI"),
  joined("佛山", "大学"),
  joined("仙溪", "校区"),
  joined("江湾", "校区"),
  joined("河滨", "校区"),
  joined("github", ".com"),
  joined("tcloudbase", ".com"),
  joined("cloudbase", ".com"),
  joined("gsxjnpx", ".cn"),
  joined("101", ".42", ".184", ".216"),
  joined("space", "Id"),
  joined("app", "Id"),
  joined("katelya", "77"),
];

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~-]{12,}/i,
  /\b(?:sk|ghp|github_pat)-?[A-Za-z0-9_-]{16,}\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/,
  /(?:api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*["'][^"']{12,}["']/i,
];

const ABSOLUTE_PATH_PATTERNS = [
  /[A-Za-z]:[\\/](?:Users|Documents|Workspace)[\\/]/i,
  /\/(?:Users|home)\/[^/\s]+\//,
  /\/mnt\/[a-z]\/Users\//i,
];

function filesRecursively(root) {
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      assert(!entry.isSymbolicLink(), `提交包禁止符号链接：${path.relative(root, full)}`);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  visit(root);
  return files.sort();
}

function validate(root) {
  const resolved = path.resolve(root);
  assert(fs.existsSync(resolved) && fs.statSync(resolved).isDirectory(), `提交包目录不存在：${resolved}`);
  const files = filesRecursively(resolved);
  assert(files.length > 0, "提交包不得为空");
  let bytes = 0;
  let textFiles = 0;
  const findings = [];
  for (const file of files) {
    const relative = path.relative(resolved, file).replace(/\\/g, "/");
    const buffer = fs.readFileSync(file);
    bytes += buffer.length;
    if (buffer.includes(0)) {
      findings.push(`${relative}: binary file`);
      continue;
    }
    textFiles += 1;
    const content = buffer.toString("utf8");
    const searchable = `${relative}\n${content}`;
    for (const term of FORBIDDEN_TERMS) {
      if (searchable.toLowerCase().includes(term.toLowerCase())) findings.push(`${relative}: forbidden term`);
    }
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(content)) findings.push(`${relative}: credential-shaped value`);
    }
    for (const pattern of ABSOLUTE_PATH_PATTERNS) {
      if (pattern.test(content)) findings.push(`${relative}: local absolute path`);
    }
  }
  assert.deepStrictEqual(findings, [], `提交包匿名扫描失败：\n${[...new Set(findings)].join("\n")}`);
  const openapi = JSON.parse(fs.readFileSync(path.join(resolved, "openapi", "campus-tools.openapi.json"), "utf8"));
  assert.strictEqual(openapi.servers.length, 1, "提交版 OpenAPI 只能保留一个占位 server");
  assert.strictEqual(openapi.servers[0].url, "https://{host}", "提交版 OpenAPI 禁止真实部署地址");
  assert(!files.some((file) => /(?:^|[\\/])reports(?:[\\/]|$)/i.test(file)), "提交包禁止 reports/");
  assert(!files.some((file) => /(?:^|[\\/])screenshots?(?:[\\/]|$)/i.test(file)), "提交包禁止 screenshots/");
  console.log(`Submission package scan passed: files=${files.length}, textFiles=${textFiles}, bytes=${bytes}, findings=0, credentialCandidates=0`);
  return { files: files.length, textFiles, bytes, findings: 0 };
}

if (require.main === module) {
  const inPackage = path.basename(__dirname).toLowerCase() === "tools";
  const defaultRoot = inPackage ? path.resolve(__dirname, "..") : path.resolve(__dirname, "..", "submission-package");
  validate(process.argv[2] || defaultRoot);
}

module.exports = { validate };
