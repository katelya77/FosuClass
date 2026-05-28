#!/usr/bin/env node

const assert = require("assert");
const { parseCourseText } = require("../cloudfunctions/common/parser");

const sample = [
  "动物学\n覃丽梅副教授\n5-14周\nC7-308[01-02]节",
  "有机化学\n汪军副教授\n9-16周\nC7-503[03-04]节",
  "动物解剖学\n陈芳副教授\n5-8,10-15周\nC7-305[03-04-05]节\n备注:还有学时自己补回",
  "大学英语2(跨文化交流英语)\n李德博\n1-16周\nB5-304(语音室)[11-12]节",
  "分析化学\n王选东助理研究员\n1-4,6周\nC7-503[03-04]节",
  "形势与政策2\n赵孟孟讲师（高校）\n11,13周\nC7-502[08-09]节",
  "晚间实验\n谭杰安助理实验师\n单周\nB8-202[11-12-13-14]节",
].join("\n-----\n");

const courses = parseCourseText(sample, {
  className: "脱敏班级",
  semester: "2025-2026学年第二学期",
  weekday: 1,
});

assert.strictEqual(courses.length, 7);
assert.strictEqual(courses[0].teacherName, "覃丽梅");
assert.deepStrictEqual(courses[0].weeks, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
assert.strictEqual(courses[2].startSection, 3);
assert.strictEqual(courses[2].endSection, 5);
assert.deepStrictEqual(courses[2].weeks, [5, 6, 7, 8, 10, 11, 12, 13, 14, 15]);
assert.strictEqual(courses[2].remark, "还有学时自己补回");
assert.strictEqual(courses[3].classroom, "B5-304(语音室)");
assert.strictEqual(courses[3].startSection, 11);
assert.strictEqual(courses[4].teacherName, "王选东");
assert.deepStrictEqual(courses[4].weeks, [1, 2, 3, 4, 6]);
assert.ok(courses[4].rawText.indexOf("分析化学") >= 0);
assert.strictEqual(courses[5].teacherName, "赵孟孟");
assert.deepStrictEqual(courses[5].weeks, [11, 13]);
assert.strictEqual(courses[6].teacherName, "谭杰安");
assert.strictEqual(courses[6].endSection, 14);
assert.deepStrictEqual(courses[6].weeks, [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]);

console.log("Parser smoke test passed.");
