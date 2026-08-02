#!/usr/bin/env node
const assert = require("assert");

const releaseService = require("../server/src/services/releaseService");
const {
  parseClassEntity,
  resolveClass,
} = require("../server/src/services/ai/classAliasResolver");
const { buildOpenScheduleIntent, resolveIntent } = require("../server/src/services/ai/toolRegistry");

const classIndex = [
  {
    id: "class-2025-animal-science-3",
    name: "25动物科学3班",
    className: "25动物科学3班",
    majorName: "动物科学",
    grade: "2025",
    displayType: "class-schedule",
  },
  {
    id: "class-2025-animal-science-11",
    name: "25动物科学11班",
    className: "25动物科学11班",
    majorName: "动物科学",
    grade: "2025",
    displayType: "class-schedule",
  },
];

function testSpokenGradeAndClassNumber() {
  assert.deepStrictEqual(parseClassEntity("二五级动物科学三班"), {
    grade: "2025",
    majorAlias: "动物科学",
    classNo: 3,
  });
  assert.deepStrictEqual(parseClassEntity("二〇二五级动物科学十一班"), {
    grade: "2025",
    majorAlias: "动物科学",
    classNo: 11,
  });

  const result = resolveClass("二五级动物科学三班", classIndex);
  assert.strictEqual(result.status, "unique");
  assert.strictEqual(result.match.id, "class-2025-animal-science-3");
}

function testToolQueryUsesCanonicalFactName() {
  const originalRead = releaseService.readActiveIndex;
  releaseService.readActiveIndex = (type) => type === "class" ? { items: classIndex } : { items: [] };
  try {
    const intent = buildOpenScheduleIntent({
      goal: "open_schedule",
      entityType: "class",
      entity: "二五级动物科学三班",
      explicitCommand: true,
    });
    assert.strictEqual(intent.name, "search_school_index");
    assert.strictEqual(intent.slots.type, "class");
    assert.strictEqual(intent.slots.q, "25动物科学3班");
    assert.strictEqual(intent.slots.preferredId, "class-2025-animal-science-3");

    const fromNaturalMessage = resolveIntent("帮我查看一下二五级动物科学三班的课表", {});
    assert.strictEqual(fromNaturalMessage.name, "search_school_index");
    assert.strictEqual(fromNaturalMessage.slots.type, "class");
    assert.strictEqual(fromNaturalMessage.slots.q, "25动物科学3班");
    assert.strictEqual(fromNaturalMessage.slots.preferredId, "class-2025-animal-science-3");
  } finally {
    releaseService.readActiveIndex = originalRead;
  }
}

function testAmbiguityIsNeverGuessed() {
  const duplicated = classIndex.concat({
    id: "class-2025-animal-science-3-xianxi",
    name: "25动物科学3班",
    className: "25动物科学3班",
    majorName: "动物科学",
    grade: "2025",
    campus: "仙溪",
    displayType: "class-schedule",
  });
  const result = resolveClass("二五级动物科学三班", duplicated);
  assert.strictEqual(result.status, "ambiguous");
  assert.deepStrictEqual(result.candidates.map((item) => item.id), [
    "class-2025-animal-science-3",
    "class-2025-animal-science-3-xianxi",
  ]);
}

function testRepositoryReleasePackResolution() {
  const intent = resolveIntent("帮我查看一下二五级动物科学三班的课表", {});
  assert.strictEqual(intent.name, "search_school_index");
  assert.strictEqual(intent.slots.type, "class");
  assert.strictEqual(intent.slots.q, "25动物科学3班");
  assert.ok(intent.slots.preferredId, "the repository Release Pack must resolve the real class uniquely");

  const searchIntent = resolveIntent("帮我查二五级动物科学三班课表", {});
  assert.strictEqual(searchIntent.name, "search_school_index");
  assert.strictEqual(searchIntent.slots.type, "class");
  assert.strictEqual(searchIntent.slots.q, "25动物科学3班");
  assert.ok(searchIntent.slots.preferredId,
    "query verbs must use the same spoken-class normalization as open-schedule verbs");
}

testSpokenGradeAndClassNumber();
testToolQueryUsesCanonicalFactName();
testAmbiguityIsNeverGuessed();
testRepositoryReleasePackResolution();
console.log("test-agent-class-spoken-numerals: PASS");
