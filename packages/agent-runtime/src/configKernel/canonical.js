// P4a：确定性 canonical JSON 与摘要。版本文档、快照与 configVersion 的可验证性
// 依赖同一套序列化：键排序、无 undefined、无函数。摘要只覆盖内容字段（不含
// digest 自身）。

const crypto = require("crypto");

function canonicalize(value) {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).sort().forEach((key) => {
      const item = value[key];
      if (item === undefined || typeof item === "function") return;
      out[key] = canonicalize(item);
    });
    return out;
  }
  return null;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Digest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

// 深拷贝并丢弃不可 JSON 化的字段（payload 必须可持久化）。
function jsonClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

module.exports = Object.freeze({
  canonicalJson,
  jsonClone,
  sha256Digest,
});
