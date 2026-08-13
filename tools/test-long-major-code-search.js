"use strict";

const assert = require("assert");
const service = require("../server/src/services/schoolSearchContractService");

const term = "2026-2027-1";
const releaseVersion = "test-release";
const majorCode = "3C3A6B4C710B4C8C9079446B5F5FCD96";
const item = {
  id: "class-25-animal-medicine-6",
  className: "25-animal-medicine-6",
  name: "25-animal-medicine-6",
  collegeCode: "04",
  collegeName: "animal-science-college",
  grade: "2025",
  majorCode,
  majorName: "animal-medicine",
  semester: term,
};

const normalized = service.normalizeRequest({ majorCode });
assert.strictEqual(
  normalized.majorCode,
  majorCode,
  "real 32-character majorCode must survive request normalization"
);

const result = service.search({
  type: "class",
  q: item.className,
  term,
  releaseVersion,
  collegeCode: item.collegeCode,
  grade: item.grade,
  majorCode,
}, { _items: [item] });

assert.strictEqual(result.success, true);
assert.strictEqual(result.total, 1, "real 32-character majorCode must match the class index");
assert.strictEqual(result.items[0].id, item.id);
console.log("test-long-major-code-search passed");
