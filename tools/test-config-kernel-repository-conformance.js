#!/usr/bin/env node
// P4a：Config Kernel Repository 契约测试（conformance suite）。
// 通用契约由 packages/agent-runtime 的 runConfigKernelRepositoryConformance
// 提供，对文件适配器运行；P5a 的 PostgreSQL 适配器将以同一工厂复跑。
// 文件适配器专项：digest 校验对存储篡改 fail closed。
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createConfigKernelFileRepository,
  runConfigKernelRepositoryConformance,
  sha256Digest,
} = require("../packages/agent-runtime");

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "config-kernel-repo-"));
}

function throwsCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

const executed = runConfigKernelRepositoryConformance({
  assert,
  label: "file",
  createRepository: () => createConfigKernelFileRepository({ root: tmpRoot() }),
  sha256Digest,
});
executed.forEach((name) => console.log(`✓ ${name}`));

// 文件适配器专项：篡改版本文档内容后 digest 校验必须 fail closed。
{
  const root = tmpRoot();
  const repo = createConfigKernelFileRepository({ root });
  const content = {
    schemaVersion: "config-artifact.v1",
    domain: "skill",
    artifactId: "conformance",
    environment: "trial",
    version: 1,
    payload: { skills: [{ id: "alpha" }] },
    origin: "admin",
    sourceDigest: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "conformance",
  };
  const doc = Object.assign({}, content, { digest: sha256Digest(content) });
  repo.putVersion(doc);
  const file = path.join(root, "artifacts", "skill", "conformance", "trial", "v1.json");
  fs.writeFileSync(file, JSON.stringify(Object.assign({}, doc, { payload: { skills: [{ id: "tampered" }] } })));
  throwsCode(() => repo.getVersion("skill", "conformance", "trial", 1), "CONFIG_KERNEL_STORAGE_CORRUPT");

  // current 引用不是合法 JSON：读取方必须得到 coded corruption，而非静默空配置。
  fs.mkdirSync(path.join(root, "current"), { recursive: true });
  fs.writeFileSync(path.join(root, "current", "trial.json"), "{{{", "utf8");
  throwsCode(() => repo.readCurrentRef("trial"), "CONFIG_KERNEL_STORAGE_CORRUPT");
  console.log("✓ file: tampered documents fail closed on digest/parse verification");
}

console.log("\ntest-config-kernel-repository-conformance: PASS");
