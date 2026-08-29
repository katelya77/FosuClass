"use strict";

const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const FAMILY_BY_KIND = {
  "xls-legacy": "portal-family-qz-legacy",
  xlsx: "xlsx-generic",
  csv: "csv-generic",
};

const EXT_KIND = {
  ".xls": "xls-legacy",
  ".xlsx": "xlsx",
  ".csv": "csv",
};

/**
 * 中性源检测：只识别文件字节/扩展名对应的 provider 家族与能力，绝不输出学校身份、
 * 学校名、教师/班级或个人标识。OLE2/BIFF magic 命中 → portal-family-qz-legacy。
 */
function detectSource({ filename = "", bytes = null } = {}) {
  const name = typeof filename === "string" ? filename.toLowerCase() : "";
  let kind = "unknown";
  let confidence = 0;
  let magic = null;

  if (Buffer.isBuffer(bytes) && bytes.length >= 8) {
    const head = bytes.subarray(0, 8);
    if (head.equals(OLE2_MAGIC)) {
      kind = "xls-legacy";
      magic = "ole2";
      confidence = 0.98;
    } else if (bytes.length >= 4 && bytes.subarray(0, 4).equals(ZIP_MAGIC)) {
      kind = "xlsx";
      magic = "zip";
      confidence = 0.95;
    }
  }

  if (kind === "unknown" && name) {
    for (const [ext, k] of Object.entries(EXT_KIND)) {
      if (name.endsWith(ext)) {
        kind = k;
        confidence = 0.6;
        break;
      }
    }
  }

  if (kind === "unknown") {
    confidence = 0;
  }

  const family = FAMILY_BY_KIND[kind] || "unknown";

  return {
    family,
    kind,
    magic,
    mime: kind === "xls-legacy" ? "application/vnd.ms-excel" : kind === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : kind === "csv" ? "text/csv" : "application/octet-stream",
    confidence,
    providers: family === "unknown" ? [] : [family],
    note: kind === "xls-legacy" ? "OLE2/BIFF legacy spreadsheet; normalization only, no credential access" : "neutral source",
  };
}

module.exports = { detectSource, OLE2_MAGIC, ZIP_MAGIC };